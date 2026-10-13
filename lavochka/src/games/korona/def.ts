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
import { CORONATION_TEXT, DECK_SIZE, START, STATS, WORLDS } from './rules';

export interface KoronaView {
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

/** Бот: идёт к ПРОВАЛУ и копит характеристики; уровень 1 — просто к соседу. */
function chooseBot(s: State, seat: number, level: number): Action | null {
  if (s.winner != null || seat !== s.turn) return null;
  if (s.phase === 'card') return { type: 'ok' };
  if (s.phase === 'roll') return { type: 'roll' };
  if (s.phase !== 'step') return null;
  const targets = stepTargets(s, seat);
  if (!targets.length) return null;
  if (level === 1) return { type: 'step', to: targets[0] };
  // уровни 2-3: сначала ищем ПРОВАЛ в двух шагах, иначе клетку, где растут характеристики
  const goal = targets.find((n) => kindOf(n) === 'fall');
  if (goal != null && s.left <= 2) return { type: 'step', to: goal };
  const useful = targets
    .map((n) => ({ n, k: kindOf(n) }))
    .filter((x) => x.k === 'lyceum' || x.k === 'meadow' || x.k === 'exchange' || x.k === 'fall');
  if (useful.length) return { type: 'step', to: useful[0].n };
  if (level >= 3) {
    // ищем соседа, у которого дальше больше соседей (не застревать в углу)
    const ranked = targets.slice().sort((a, b) => neighbours(b).length - neighbours(a).length);
    return { type: 'step', to: ranked[0] };
  }
  return { type: 'step', to: targets[0] };
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

  setup: (seats: SeatSpec[], opts: Options, rng: Rng): State =>
    newState(
      seats.map((s) => ({ seat: s.seat, kind: s.kind === 'human' ? ('human' as const) : ('bot' as const), name: s.name, level: s.level })),
      { deck: Number(opts.deck) || DECK_SIZE },
      rng,
    ),

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
