/* «Маджонг» — пасьянс из костей маджонга: черепаха и другие раскладки, «соединялка» (шисен-сё). Без DOM.
 * Один игрок — обычный пасьянс; несколько — дуэль: у каждого своя доска с одной и той же раздачей, кто первым разобрал. */
import { SeededRng } from '../../core/rng';
import type { DemoScript, GameDef, Options, Rng, SeatSpec } from '../../core/types';
import { presetTables, type RecordTable } from '../../core/records';
import { canPair, geoOf, isFree, left, pairScore, pairsOf, reshuffle, solvableDeal, solve, tileSet, type Geo } from './engine';
import { layoutOf, LAYOUTS, type Layout } from './layouts';
import { kindName, kindOf, TILE_CREDITS } from './tiles';
import { shuffle } from '../../core/rng';

export const SEATS = [
  { name: 'Вовка', color: '#c0281e', light: '#e86a5a', dark: '#7a140e' },
  { name: 'Ленка', color: '#23408f', light: '#5a78c8', dark: '#122450' },
  { name: 'Серёга', color: '#2a7a3a', light: '#5aaa6a', dark: '#164a20' },
  { name: 'Танька', color: '#8a5a10', light: '#c8964a', dark: '#4a3008' },
];

export interface Board {
  t: number[];
  moves: number;
  shuffles: number;
  /** 0 — играет, 1 — разобрал, 2 — тупик или сдался. */
  end: 0 | 1 | 2;
  /** Снимки для отмены: раскладка до хода и сколько было перемешиваний. */
  hist: { t: number[]; shuffles: number }[];
}

export interface Cfg {
  layout: string;
  /** Сколько можно перемешать: −1 — без ограничения. */
  shuffles: number;
  /** Решаемая раздача (иначе — как ляжет). */
  solvable: boolean;
}

export interface State {
  cfg: Cfg;
  seats: number[];
  start: number[];
  boards: Record<number, Board>;
  order: number[];
  turn: number;
}

export interface View {
  cfg: Cfg;
  seats: number[];
  /** Все доски открыты: в пасьянсе прятать нечего. Историю отмены не шлём — только признак. */
  boards: Record<number, Omit<Board, 'hist'> & { undo: boolean }>;
  order: number[];
}

export type Action = { t: 'pair'; a: number; b: number } | { t: 'shuffle' } | { t: 'undo' } | { t: 'giveup' } | { t: 'think' };

export type Event =
  | { type: 'pair'; seat: number; a: number; b: number; ka: number; kb: number }
  | { type: 'shuffle'; seat: number }
  | { type: 'undo'; seat: number }
  | { type: 'won'; seat: number; moves: number; place: number }
  | { type: 'stuck'; seat: number }
  | { type: 'giveup'; seat: number };

export const layoutOfCfg = (c: Cfg): Layout => layoutOf(c.layout);
export const geoOfCfg = (c: Cfg): Geo => geoOf(layoutOfCfg(c));

export function cfgOf(o: Options): Cfg {
  const sh = Number(o.shuffles ?? 3);
  return { layout: layoutOf(o.layout).id, shuffles: [-1, 0, 1, 3, 5].includes(sh) ? sh : 3, solvable: o.solvable !== false };
}

export function newState(c: Cfg, seats: number[], rng: Rng): State {
  const l = layoutOfCfg(c);
  const g = geoOf(l);
  const ids = tileSet(l.pos.length, rng);
  const places = l.pos.map((_, i) => i);
  let start: number[];
  if (c.solvable) start = solvableDeal(g, places, ids, rng);
  else {
    const sh = shuffle(ids, rng);
    start = places.map((_, i) => sh[i]);
  }
  const boards: Record<number, Board> = {};
  for (const s of seats) boards[s] = { t: start.slice(), moves: 0, shuffles: 0, end: 0, hist: [] };
  return { cfg: c, seats, start, boards, order: [], turn: 0 };
}

export const shufflesLeft = (c: Cfg, b: Pick<Board, 'shuffles'>) => (c.shuffles < 0 ? Infinity : c.shuffles - b.shuffles);

/** После хода: разобрал? тупик без перемешиваний? */
function settle(c: Cfg, g: Geo, b: Board): Board {
  if (left(b.t) === 0) return { ...b, end: 1 };
  if (!pairsOf(g, b.t).length && shufflesLeft(c, b) <= 0) return { ...b, end: 2 };
  return b;
}

function toAct(s: State): number[] {
  const live = s.seats.filter((x) => !s.boards[x].end);
  if (!live.length) return [];
  const k = s.turn % live.length;
  return [...live.slice(k), ...live.slice(0, k)];
}

function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  const b0 = s0.boards[seat];
  if (!b0 || b0.end || !a || typeof a !== 'object') return null;
  const g = geoOfCfg(s0.cfg);
  const ev: Event[] = [];
  let b: Board | null = null;
  const snap = () => [...b0.hist, { t: b0.t, shuffles: b0.shuffles }].slice(-200);
  switch (a.t) {
    case 'think':
      b = b0;
      break;
    case 'pair': {
      if (!canPair(g, b0.t, a.a, a.b)) return null;
      const t = b0.t.slice();
      ev.push({ type: 'pair', seat, a: a.a, b: a.b, ka: kindOf(t[a.a]), kb: kindOf(t[a.b]) });
      t[a.a] = -1;
      t[a.b] = -1;
      b = settle(s0.cfg, g, { ...b0, t, moves: b0.moves + 1, hist: snap() });
      break;
    }
    case 'shuffle': {
      if (shufflesLeft(s0.cfg, b0) <= 0) return null;
      b = settle(s0.cfg, g, { ...b0, t: reshuffle(g, b0.t, rng), shuffles: b0.shuffles + 1, hist: snap() });
      ev.push({ type: 'shuffle', seat });
      break;
    }
    case 'undo': {
      const h = b0.hist[b0.hist.length - 1];
      if (!h) return null;
      // перемешивание назад не берётся: отмена возвращает раскладку, но не счётчик
      b = { ...b0, t: h.t, moves: b0.moves + (h.shuffles === b0.shuffles ? -1 : 0), hist: b0.hist.slice(0, -1) };
      ev.push({ type: 'undo', seat });
      break;
    }
    case 'giveup':
      b = { ...b0, end: 2 };
      ev.push({ type: 'giveup', seat });
      break;
    default:
      return null;
  }
  const s: State = { ...s0, boards: { ...s0.boards, [seat]: b }, turn: s0.turn + 1, order: s0.order.slice() };
  if (b.end === 1 && !b0.end) {
    s.order.push(seat);
    ev.push({ type: 'won', seat, moves: b.moves, place: s.order.length });
  } else if (b.end === 2 && !b0.end && a.t !== 'giveup') ev.push({ type: 'stuck', seat });
  return { state: s, events: ev };
}

function view(s: State, _seats: number[] | 'all'): View {
  const boards: View['boards'] = {};
  for (const x of s.seats) {
    const { hist, ...rest } = s.boards[x];
    boards[x] = { ...rest, undo: hist.length > 0 };
  }
  return { cfg: s.cfg, seats: s.seats, boards, order: s.order };
}

function result(s: State) {
  if (toAct(s).length) return null;
  const name = layoutOfCfg(s.cfg).label;
  const total = layoutOfCfg(s.cfg).pos.length;
  const scores: Record<number, number> = {};
  for (const x of s.seats) scores[x] = total - left(s.boards[x].t);
  if (s.seats.length === 1) {
    const b = s.boards[s.seats[0]];
    return { winners: b.end === 1 ? [s.seats[0]] : [], text: b.end === 1 ? `${name}: разобрана за ${b.moves} ходов` : `${name}: не разобрана — осталось ${left(b.t)} костей`, scores };
  }
  if (s.order.length) return { winners: [s.order[0]], text: `${name}: первым разобрал`, scores };
  const best = Math.max(...s.seats.map((x) => scores[x]));
  return { winners: s.seats.filter((x) => scores[x] === best), text: `${name}: ни у кого не сошлось — больше костей снято`, scores };
}

// ---------------------------------------------------------------- бот

function botChoose(v: View, seat: number, level: number, rng: Rng): Action {
  const b = v.boards[seat];
  if (!b || b.end) return { t: 'think' };
  // живой соперник не щёлкает пары со скоростью автомата
  if (rng.next() < [0.55, 0.3, 0.12][level]) return { t: 'think' };
  const g = geoOfCfg(v.cfg);
  const ps = pairsOf(g, b.t);
  if (!ps.length) return shufflesLeft(v.cfg, b) > 0 ? { t: 'shuffle' } : { t: 'giveup' };
  if (level === 0) {
    const [a, c] = ps[rng.int(ps.length)];
    return { t: 'pair', a, b: c };
  }
  if (level === 2) {
    const win = solve(g, b.t, 4000);
    if (win) return { t: 'pair', a: win[0], b: win[1] };
  }
  let best = ps[0];
  let bs = -Infinity;
  for (const p of ps) {
    const sc = pairScore(g, b.t, p[0], p[1]) + rng.next() * (level === 1 ? 2 : 0.5);
    if (sc > bs) {
      bs = sc;
      best = p;
    }
  }
  return { t: 'pair', a: best[0], b: best[1] };
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [{ seat: 0, kind: 'bot', name: SEATS[0].name, level: 2 }];

/** Показ: известная раздача, первые ходы «по уму» с подписями. */
function demo(layout: string, seed: number, n: number, intro: string, say: (k: number, s: State, a: number, b: number) => string): DemoScript<State, Action> {
  const c = cfgOf({ layout });
  const start = () => newState(c, [0], new SeededRng(seed));
  let steps: DemoScript<State, Action>['steps'] | null = null;
  return {
    seats: demoSeats,
    options: { layout },
    setup: () => start(),
    intro,
    get steps() {
      if (steps) return steps;
      steps = [];
      let s = start();
      const g = geoOfCfg(c);
      for (let k = 0; k < n; k++) {
        const t = s.boards[0].t;
        const m = solve(g, t, 3000) ?? pairsOf(g, t)[0];
        if (!m) break;
        steps.push({ seat: 0, action: { t: 'pair', a: m[0], b: m[1] }, caption: say(k, s, m[0], m[1]) });
        s = apply(s, 0, { t: 'pair', a: m[0], b: m[1] }, new SeededRng(1))!.state;
      }
      return steps;
    },
  };
}

const kn = (s: State, i: number) => kindName(kindOf(s.boards[0].t[i]));
const side = (s: State, i: number) => {
  const g = geoOfCfg(s.cfg);
  const p = layoutOfCfg(s.cfg).pos[i];
  if (p.z > 0 && g.above[i].length === 0) return 'на ней ничего не лежит';
  return g.left[i].every((j) => s.boards[0].t[j] < 0) ? 'слева пусто' : 'справа пусто';
};


/** Таблица рекордов: раскладка; «как ляжет» и «без перемешиваний» — отдельно. */
function recTable(o: Options): RecordTable | null {
  const c = cfgOf(o);
  const l = layoutOf(c.layout);
  const extra = [c.solvable ? '' : 'как ляжет', c.shuffles === 0 ? 'без перемешиваний' : ''].filter(Boolean);
  return { id: `${l.id}${c.solvable ? '' : '-rnd'}${c.shuffles === 0 ? '-nosh' : ''}`, label: [l.label, ...extra].join(', ') };
}

export const def: GameDef<State, Action, Event, View> = {
  id: 'mahjong',
  title: 'Маджонг',
  players: { min: 1, max: 4, default: 1 },
  seats: SEATS,
  options: [
    { key: 'layout', label: 'Раскладка', type: 'select', choices: LAYOUTS.map((l) => ({ value: l.id, label: `${l.label} — ${l.hint}` })), default: 'turtle' },
    {
      key: 'shuffles',
      label: 'Перемешать',
      hint: 'зашли в тупик — оставшиеся кости можно перемешать (раскладка снова сойдётся)',
      type: 'select',
      choices: [
        { value: 3, label: 'три раза' },
        { value: 1, label: 'один раз' },
        { value: 5, label: 'пять раз' },
        { value: -1, label: 'сколько угодно' },
        { value: 0, label: 'нельзя' },
      ],
      default: 3,
    },
    { key: 'solvable', label: 'Раздача сходится', hint: 'раскладка всегда разбирается до конца, если не ошибиться; выключите — как ляжет', type: 'toggle', default: true },
  ],
  presets: [
    { id: 'turtle', label: 'Черепаха', hint: 'Классика: 144 кости, пять этажей', options: { layout: 'turtle', shuffles: 3, solvable: true } },
    { id: 'pyramid', label: 'Пирамида', options: { layout: 'pyramid', shuffles: 3, solvable: true } },
    { id: 'fortress', label: 'Крепость', options: { layout: 'fortress', shuffles: 3, solvable: true } },
    { id: 'mountains', label: 'Три горы', options: { layout: 'mountains', shuffles: 3, solvable: true } },
    { id: 'cross', label: 'Крест', options: { layout: 'cross', shuffles: 3, solvable: true } },
    { id: 'butterfly', label: 'Бабочка', options: { layout: 'butterfly', shuffles: 3, solvable: true } },
    { id: 'connect', label: 'Соединялка', hint: 'Шисен-сё: пары соединяют линией', options: { layout: 'connect', shuffles: 3, solvable: true } },
    { id: 'hard', label: 'Черепаха без поблажек', hint: 'Как ляжет, перемешивать нельзя', options: { layout: 'turtle', shuffles: 0, solvable: false } },
  ],

  setup: (seats, o, rng) =>
    newState(
      cfgOf(o),
      seats.map((x) => x.seat).sort((a, b) => a - b),
      rng
    ),
  toAct,
  apply,
  view,
  redact(ev, seats) {
    if (ev.type === 'won' || ev.type === 'giveup' || ev.type === 'stuck') return ev;
    return seats === 'all' || seats.includes(ev.seat) ? ev : null;
  },
  result,
  records: {
    columns: [{ key: 'ms', label: 'Время', sort: 'asc', format: 'time' }],
    table: recTable,
    tables: () => presetTables(def, recTable),
    score: (s, { ms, actions }) => (s.boards[s.seats[0]]?.end === 1 ? { values: { ms }, help: actions.some((a) => (a as Action).t === 'undo') } : null),
    minMs: () => 10_000,
    help: true,
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: botChoose },
  describe(ev, name) {
    if (ev.type === 'won') return `🏁 ${name(ev.seat)}: раскладка разобрана за ${ev.moves} ходов${ev.place > 1 ? ` (${ev.place}-е место)` : ''}`;
    if (ev.type === 'stuck') return `${name(ev.seat)}: пар больше нет — тупик`;
    if (ev.type === 'giveup') return `${name(ev.seat)} сдаётся`;
    if (ev.type === 'shuffle') return `${name(ev.seat)} перемешивает кости`;
    return null;
  },

  showcase() {
    let s = newState(cfgOf({ layout: 'turtle' }), [0], new SeededRng(4242));
    const g = geoOfCfg(s.cfg);
    for (let k = 0; k < 14; k++) {
      const m = solve(g, s.boards[0].t, 2000);
      if (!m) break;
      s = apply(s, 0, { t: 'pair', a: m[0], b: m[1] }, new SeededRng(1))!.state;
    }
    return s;
  },

  rules: {
    goal: 'Разобрать раскладку: снимать со стола пары одинаковых свободных костей, пока не уберёшь все. Вдвоём и больше — у всех одна и та же раздача, кто первым.',
    sections: [
      {
        title: 'Кости',
        html: `<p>В наборе 144 кости. Три масти — <b>медяки</b> (круги), <b>бамбуки</b> и <b>тьмы</b> (иероглиф «вань» — десять тысяч), от 1 до 9, по четыре каждой.
          Четыре <b>ветра</b> (Восток, Юг, Запад, Север) и три <b>дракона</b> (красный, зелёный, белый) — тоже по четыре.
          И восемь одиночных: четыре <b>цветка</b> (слива, орхидея, хризантема, бамбук) и четыре <b>сезона</b>.</p>
          <p>Пара — две одинаковые кости. Цветок идёт в пару <b>с любым цветком</b>, сезон — <b>с любым сезоном</b>.</p>`,
      },
      {
        title: 'Свободные кости',
        html: `<p>Снять можно только <b>свободную</b> кость: на ней ничего не лежит, и <b>слева или справа</b> от неё пусто (хотя бы с одной стороны).
          Нажмите на кость, потом на такую же — пара уйдёт. Несвободные кости затенены, свободные можно подсветить.</p>
          <p>Главная хитрость — не снимать пару бездумно: если свободны три одинаковые, а четвёртая заперта, берите те две, что сами что-то держат.
          Сначала разбирайте высокие горки и длинные ряды.</p>`,
        demo: demo('turtle', 777, 5, 'Черепаха: 144 кости в пять этажей.', (k, s, a, b) => `${k === 0 ? 'Ищем одинаковые свободные кости. ' : ''}${kn(s, a)} и ${kn(s, b) === kn(s, a) ? 'ещё один такой же' : kn(s, b)}: у одной ${side(s, a)}, у другой ${side(s, b)}.`),
      },
      {
        title: 'Тупик и перемешивание',
        html: `<p>Раздача всегда сходится, если не ошибиться (эту настройку можно выключить — тогда как ляжет). Свободных пар не осталось —
          <b>перемешайте</b> оставшиеся кости: они лягут по тем же местам так, что раскладка снова сойдётся. Перемешиваний обычно три.</p>
          <p>Есть <b>подсказка</b> (покажет пару) и отмена хода. Вдвоём и больше — дуэль: доски у всех одинаковые, кто первым разобрал — тот и победил.</p>`,
      },
      {
        title: 'Раскладки',
        html: `<p><b>Черепаха</b> — классика: 87 костей внизу, 36, 16, 4 и одна на макушке; по бокам — «лапы» и «хвост».
          <b>Пирамида</b> — квадратная, <b>Крепость</b> — стена с четырьмя башнями по углам, <b>Три горы</b> — горки со ступенькой в полкости
          (верхняя кость лежит на стыке четырёх нижних), <b>Крест</b> и <b>Бабочка</b>.</p>`,
      },
      {
        title: 'Соединялка (шисен-сё)',
        html: `<p>Плоское поле 18 × 8, все кости в один слой. Пару снимают, если две одинаковые кости можно <b>соединить линией</b>
          по пустым местам не больше чем <b>с двумя поворотами</b> под прямым углом. Линия может обходить поле снаружи, по краю.</p>`,
        demo: demo('connect', 31, 5, 'Соединялка: линия — не больше двух поворотов.', (k, s, a, b) => `${k === 0 ? 'Сначала доступны кости по краю и соседние. ' : ''}${kn(s, a)} — ${kn(s, b) === kn(s, a) ? 'с такой же' : kn(s, b)}: линия проходит.`),
      },
      { title: 'Рисунок костей', html: TILE_CREDITS },
    ],
  },
};

export { isFree };
