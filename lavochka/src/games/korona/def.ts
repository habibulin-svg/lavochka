/**
 * «Корона Эмбера 1994» — описание игры для сборника: настройки, боты, показ правил.
 *
 * Движок (engine.ts) умеет поле 1: ход по сетке, характеристики ПС/ПУ/ПМ/ПО и жизни ПЖ,
 * талеры, карточки приключений, обменный пункт, лазарет, лицей, ПРОВАЛ (выход в Эмбер при
 * 13 по всем характеристикам и пустой котомке). Поле 2 (лабиринт, покои, тронный зал
 * с коронацией, арена) и механические эффекты карточек — следующий шаг.
 */
import type { BotDef, GameDef, Options, Rng, SeatSpec } from '../../core/types';
import { cardByNumber } from './data';
import { apply, kindOf, neighbours, newState, result, stepTargets, type Action, type Event, type State } from './engine';
import { CELL_RULES, CORONATION_TEXT, DECK_SIZE, START, STATS, WORLDS } from './rules';

export interface KoronaView {
  seats: number[];
  turn: number;
  phase: State['phase'];
  die: number;
  left: number;
  heroes: State['heroes'];
  names: Record<number, string>;
  kinds: Record<number, 'human' | 'bot'>;
  targets: number[];
  card: { num: number | null; text: string } | null;
  log: string[];
  winner: number | null;
}

const SEAT_LOOK = [
  { name: 'Владыка', color: '#c0392b', light: '#f3b7ae', dark: '#7d2016' },
  { name: 'Принц', color: '#2c6fd1', light: '#b3cdf3', dark: '#173f7d' },
  { name: 'Барон', color: '#2f9e5f', light: '#b2e3c7', dark: '#175c35' },
  { name: 'Маркиз', color: '#c9a227', light: '#f0e0a8', dark: '#7d6314' },
  { name: 'Герцог', color: '#8e44ad', light: '#dcbbea', dark: '#552a6b' },
  { name: 'Граф', color: '#e07b39', light: '#f6cfae', dark: '#8c4517' },
];

/** Память бота: сколько ходов подряд состояние не меняется (по виду этого не видно). */
const botMemory = new Map<number, { sig: string; n: number }>();
/** Сбросить память бота (при новой партии). */
export function resetBotMemory() {
  botMemory.clear();
}
function barren(seat: number, sig: string): number {
  const m = botMemory.get(seat);
  if (!m || m.sig !== sig) {
    botMemory.set(seat, { sig, n: 0 });
    return 0;
  }
  m.n += 1;
  return m.n;
}

/** Сосед, ведущий по кратчайшему пути к ближайшей клетке нужного вида (BFS с возвратом по родителям). */
function nextToward(s: State, seat: number, want: (n: number) => boolean): number | null {
  const from = s.heroes[seat].cell;
  const dist = new Map<number, number>([[from, 0]]);
  const prev = new Map<number, number>();
  const q: number[] = [from];
  let found: number | null = null;
  for (let i = 0; i < q.length && found == null; i++) {
    const n = q[i];
    if (n !== from && want(n)) {
      found = n;
      break;
    }
    for (const m of neighbours(n)) {
      if (!dist.has(m)) {
        dist.set(m, dist.get(n)! + 1);
        prev.set(m, n);
        q.push(m);
      }
    }
  }
  if (found == null) return null;
  let cur = found;
  while (prev.get(cur) != null && prev.get(cur) !== from) cur = prev.get(cur)!;
  return prev.get(cur) === from ? cur : null;
}

/** Бот: копит характеристики у лицея, затем уходит через ПРОВАЛ и коронуется. */
function chooseBot(s: State, seat: number, level: number): Action | null {
  if (s.winner != null || seat !== s.turn) return null;
  if (s.phase === 'card') return { type: 'ok' };
  const h = s.heroes[seat];
  // поле 2: стать принцем, пройти лабиринт, дойти до трона и короноваться
  if (h.ember) {
    if (!h.prince) return { type: 'prince' };
    if (h.zone === 'capital') return { type: 'labyrinth' };
    if (h.zone === 'labyrinth') return { type: 'toPalace' };
    if (h.zone === 'palace') return { type: 'toThrone' };
    if (h.zone === 'throne') return { type: 'coronate' };
    return null;
  }
  if (s.phase === 'roll') return { type: 'roll' };
  if (s.phase !== 'step') return null;
  // пришли на полезную клетку и ещё есть шаги — останавливаемся, чтобы сработало её правило;
  // если просто стоим на ней с прошлого хода, идём дальше (иначе бот застревает на месте)
  const here = kindOf(h.cell);
  const moved = s.left < s.die;
  if (moved && s.left > 0 && (here === 'lyceum' || here === 'meadow' || here === 'exchange' || here === 'hospital')) return { type: 'stop' };
  const ready = STATS.every((k) => h.st[k] >= CELL_RULES.fall.need) && h.items.length === 0;
  if (ready) return { type: 'step', to: nextToward(s, seat, (n) => kindOf(n) === 'fall') ?? stepTargets(s, seat)[0] };
  if (level === 1) return { type: 'step', to: stepTargets(s, seat)[0] };
  // на обменном пункте меняем избыток на недостающее (движок: 2 из одной характеристики → 1 в другую)
  if (here === 'exchange') {
    const sorted = [...STATS].sort((a, b) => h.st[a] - h.st[b]);
    const low = sorted[0];
    const high = sorted[sorted.length - 1];
    // сначала покупка за талеры (5 за характеристику), потом обмен избытка
    if (h.st[low] < CELL_RULES.fall.need && h.thalers >= CELL_RULES.exchange.buyPrice) return { type: 'buyStat', stat: low };
    if (h.st[low] < CELL_RULES.fall.need && h.st[high] >= 4) return { type: 'exchange', from: high, to: low };
  }
  // при обнулившемся ПУ или ПС идём в лазарет (безумных лечат бесплатно) или к лицею
  const weak = STATS.some((k) => h.st[k] <= 0);
  if (weak) {
    const to = nextToward(s, seat, (n) => kindOf(n) === 'hospital' || kindOf(n) === 'lyceum');
    return { type: 'step', to: to ?? stepTargets(s, seat)[0] };
  }
  // если состояние не меняется десятки ходов — меняем цель по кругу, чтобы выйти из цикла
  const sig = `${h.cell}|${h.life}|${h.thalers}|${STATS.map((k) => h.st[k]).join(',')}`;
  const idle = barren(seat, sig);
  const cycle = Math.floor(idle / 40) % 3;
  // если есть талеры — идём на обменный пункт покупать характеристики (5 талеров за одну),
  // иначе к лицею и ведьмину лугу
  const canBuy = h.thalers >= CELL_RULES.exchange.buyPrice;
  const want =
    idle > 40
      ? cycle === 0
        ? (n: number) => kindOf(n) === 'hospital' || kindOf(n) === 'lyceum'
        : cycle === 1
          ? (n: number) => kindOf(n) === 'exchange'
          : (n: number) => kindOf(n) === 'meadow' || kindOf(n) === 'lyceum'
      : canBuy
        ? (n: number) => kindOf(n) === 'exchange' || kindOf(n) === 'lyceum'
        : (n: number) => kindOf(n) === 'lyceum' || kindOf(n) === 'meadow' || kindOf(n) === 'exchange';
  // сначала пробуем дойти именно до обменного пункта (там покупка характеристик),
  // и только если он недостижим — к лицею и лугу
  const direct = nextToward(s, seat, want);
  const to = direct ?? nextToward(s, seat, (n) => kindOf(n) === 'lyceum' || kindOf(n) === 'meadow') ?? stepTargets(s, seat)[0];
  return { type: 'step', to };
}

export const def: GameDef<State, Action, Event, KoronaView> = {
  id: 'korona',
  title: 'Корона Эмбера',
  players: { min: 2, max: 6, default: 3 },
  seats: SEAT_LOOK,


  presets: [
    { id: 'full', label: 'Корона Эмбера', hint: 'полная колода, долгий путь к трону', options: { deck: '200' } },
    { id: 'short', label: 'Корона Эмбера. Короткая партия', hint: 'меньше карточек, быстрее к Эмберу', options: { deck: '60' } },
  ],

  setup: (seats: SeatSpec[], opts: Options, rng: Rng): State => {
    resetBotMemory();
    return newState(
      seats.map((s) => ({ seat: s.seat, kind: s.kind === 'human' ? ('human' as const) : ('bot' as const), name: s.name, level: s.level })),
      { deck: Number(opts.deck) || DECK_SIZE },
      rng,
    );
  },

  toAct: (s) => (s.winner == null ? [s.turn] : []),

  apply: (s, seat, a, rng) => {
    const r = apply(s, seat, a, rng);
    return r ? { state: r.state, events: r.events } : null;
  },

  view: (s, seats): KoronaView => {
    const shown = seats === 'all' ? s.seats : seats;
    const heroes: State['heroes'] = {};
    for (const seat of shown) heroes[seat] = s.heroes[seat];
    const cardNum = s.card;
    const c = cardNum != null ? cardByNumber(cardNum) : null;
    return {
      seats: s.seats,
      turn: s.turn,
      phase: s.phase,
      die: s.die,
      left: s.left,
      heroes,
      names: s.names,
      kinds: s.kinds,
      targets: seats !== 'all' && seats.includes(s.turn) ? stepTargets(s, s.turn) : [],
      card: cardNum != null ? { num: cardNum, text: c?.text ?? `Карточка №${cardNum}` } : null,
      log: s.log.slice(-12),
      winner: s.winner,
    };
  },

  result: (s) => {
    const r = result(s);
    return r ? { winners: [r.winner], text: r.text, scores: Object.fromEntries(s.seats.map((seat, i) => [seat, r.scores[i]])) } : null;
  },

  bot: {
    levels: ['Лёгкий', 'Средний', 'Сложный'],
    choose: (v, seat, level) => {
      const fake: State = {
        seats: Object.keys(v.heroes).map(Number),
        kinds: v.kinds,
        names: v.names,
        levels: {},
        heroes: v.heroes,
        turn: v.turn,
        phase: v.phase,
        die: v.die,
        left: v.left,
        deck: [],
        card: v.card?.num ?? null,
        log: v.log,
        winner: v.winner,
      };
      return chooseBot(fake, seat, level);
    },
  } as BotDef<KoronaView, Action>,

  describe: (ev, name) => {
    switch (ev.type) {
      case 'roll':
        return `${name(ev.seat)} бросает кубик: ${ev.die}`;
      case 'step':
        return `${name(ev.seat)} идёт на поле ${ev.cell}`;
      case 'card':
        return `${name(ev.seat)}: ${ev.text}`;
      case 'money':
        return `${name(ev.seat)}: ${ev.delta > 0 ? '+' : ''}${ev.delta} талеров`;
      case 'stat':
        return `${name(ev.seat)}: ${ev.stat} ${ev.delta > 0 ? '+' : ''}${ev.delta}`;
      case 'life':
        return `${name(ev.seat)}: жизни ${ev.delta > 0 ? '+' : ''}${ev.delta}`;
      case 'fall':
        return ev.ok ? `${name(ev.seat)} выходит в Королевство Эмбер!` : `${name(ev.seat)} не смог выйти в Эмбер`;
      case 'over':
        return `${name(ev.winner)} — Владыка Королевства Эмбер`;
      default:
        return null;
    }
  },

  rules: {
    goal: 'Первым выйти в Королевство Эмбер — через ПРОВАЛ, имея 13 по всем характеристикам и пустую котомку.',
    sections: [
      {
        title: 'Как идёт игра',
        html:
          '<p>Бросок кубика — сколько полей пройти; шаг делается к соседней клетке сетки.</p>' +
          '<p>Клетки четырёх миров: Магии, Ума, Силы и Золота; между ними — обменные пункты, ЛАЗАРЕТ и ЗАГОТКОНТОРА.</p>' +
          '<p>На клетках берутся карточки приключений: находки, враги, ловушки.</p>' +
          `<p>Характеристики: ${STATS.join(', ')}; старт — ${START['ПС']} по каждой, жизни 4.</p>` +
          `<p>В оригинале ${DECK_SIZE} карточек приключений; для короткой партии можно взять 60.</p>`,
      },
      {
        title: 'ПРОВАЛ и корона',
        html:
          '<p>ПРОВАЛ пускает в Эмбер только с 13 по всем четырём характеристикам и без друзей, предметов и магических предметов.</p>' +
          '<p>Не вышел — теряешь 1 ПУ и идёшь дальше.</p>' +
          `<p>На поле 2 ждёт коронация: «${CORONATION_TEXT}», а на арене — поединок принцев за корону.</p>`,
      },
      {
        title: 'Миры поля',
        html: '<p>' + WORLDS.map((w) => `${w.name} — ${w.cells} клеток`).join('; ') + '</p>',
      },
    ],
  },
};

export default def;
