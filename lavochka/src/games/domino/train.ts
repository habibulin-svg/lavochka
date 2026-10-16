/* Домино — «Мексиканский поезд» (без DOM). Набор до 6-6, 2–4 игрока.
 *
 * Семь конов: в первом в центр («станцию») ставят дубль 6-6, дальше 5-5 … 0-0. Остальные кости раздают
 * (вдвоём по 8, втроём по 7, вчетвером по 6), лишнее — базар. От станции у каждого свой поезд, и ещё один общий —
 * мексиканский. Ход — одна кость: в свой поезд, в мексиканский или в чужой, если на нём стоит паровозик (поезд открыт).
 * Нечем ходить — берёшь одну из базара; не подошла — пропускаешь, и на твоём поезде появляется паровозик,
 * пока сам в него не сходишь. Положил дубль — ходи ещё раз и закрой его; не смог — дубль «висит», и все по очереди
 * обязаны закрыть его, прежде чем ходить куда-то ещё. Кон кончается, когда кто-то выложил все кости, или когда
 * базар пуст и все подряд пропустили. Очки с рук пишут на себя; после седьмого кона выиграл тот, у кого меньше.
 */
import type { Options, Rng } from '../../core/types';
import { allBones, isDouble, pips, sameBone, type Bone, type Tile } from './engine';

/** Номер поезда: 0…3 — поезд места, 4 — мексиканский. */
export const MEX = 4;

export interface TCfg {
  variant: 'train';
  /** Сколько конов: 7 (от 6-6 до 0-0) или 3 (6-6, 5-5, 4-4). */
  rounds: number;
}

export interface TState {
  cfg: TCfg;
  seats: number[];
  hands: Bone[][];
  yard: Bone[];
  /** Число станции (дубль в центре). */
  engine: number;
  round: number;
  /** Поезда мест (по номеру места) и мексиканский — [MEX]. */
  trains: Tile[][];
  /** Открытые поезда (паровозик). Мексиканский открыт всегда. */
  open: boolean[];
  /** Поезд с незакрытым дублем — ходить можно только в него. */
  due: number | null;
  turn: number;
  phase: 'play' | 'over';
  /** Уже брал из базара в этот ход. */
  drew: boolean;
  /** Пропусков подряд (при пустом базаре — рыба). */
  passes: number;
  /** Очки по местам. */
  scores: number[];
  winners: number[];
}

export interface TView extends TState {
  counts: number[];
  yardCount: number;
  me: number[];
}

export type TAction = { type: 'play'; bone: Bone; train: number } | { type: 'draw' } | { type: 'pass' };

export type TEvent =
  | { type: 'tdeal'; round: number; engine: number; first: number; counts: number[]; yard: number; hands?: Bone[][] }
  | { type: 'tplay'; seat: number; bone: Bone; train: number; tile: Tile; double: boolean; closed: boolean }
  | { type: 'tdraw'; seat: number; bone?: Bone; left: number }
  | { type: 'tpass'; seat: number }
  | { type: 'tround'; out: number | null; pips: number[]; scores: number[]; hands: Bone[][] }
  | { type: 'tend'; winners: number[]; scores: number[] };

export const isTrainCfg = (o: Options) => String(o.variant) === 'train';
export const tcfgFrom = (o: Options): TCfg => ({ variant: 'train', rounds: Number(o.rounds) === 3 ? 3 : 7 });

const handSize = (n: number) => (n === 2 ? 8 : n === 3 ? 7 : 6);
const norm = (b: Bone): Bone => (b[0] <= b[1] ? [b[0], b[1]] : [b[1], b[0]]);
const nextSeat = (s: Pick<TState, 'seats'>, seat: number) => s.seats[(s.seats.indexOf(seat) + 1) % s.seats.length];

function shuffle<T>(a: T[], rng: Rng): T[] {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

/** Число на конце поезда. */
export function trainEnd(s: Pick<TState, 'trains' | 'engine'>, train: number): number {
  const t = s.trains[train];
  return t.length ? t[t.length - 1].b : s.engine;
}

/** Куда может ходить место: какие поезда открыты для него. */
export function trainsFor(s: Pick<TState, 'seats' | 'open' | 'due'>, seat: number): number[] {
  if (s.due != null) return [s.due];
  return [seat, MEX, ...s.seats.filter((x) => x !== seat && s.open[x])];
}

export interface TMove {
  bone: Bone;
  train: number;
}

export function trainMoves(s: Pick<TState, 'seats' | 'open' | 'due' | 'trains' | 'engine'>, seat: number, hand: Bone[]): TMove[] {
  const out: TMove[] = [];
  for (const train of trainsFor(s, seat)) {
    const v = trainEnd(s, train);
    for (const bone of hand) if (bone[0] === v || bone[1] === v) out.push({ bone, train });
  }
  return out;
}

export function newTrain(cfg: TCfg, seats: number[]): TState {
  return {
    cfg,
    seats: seats.slice(),
    hands: [[], [], [], []],
    yard: [],
    engine: 6,
    round: 0,
    trains: [[], [], [], [], []],
    open: [false, false, false, false, true],
    due: null,
    turn: seats[0],
    phase: 'play',
    drew: false,
    passes: 0,
    scores: [0, 0, 0, 0],
    winners: [],
  };
}

export function trainDeal(s0: TState, rng: Rng): { state: TState; events: TEvent[] } {
  const round = s0.round + 1;
  const engine = 7 - round;
  const deck = shuffle(
    allBones().filter((b) => !(b[0] === engine && b[1] === engine)),
    rng,
  );
  const hands: Bone[][] = [[], [], [], []];
  const n = handSize(s0.seats.length);
  for (const seat of s0.seats) hands[seat] = deck.splice(0, n).map(norm);
  const first = s0.seats[(round - 1) % s0.seats.length];
  const s: TState = {
    ...s0,
    round,
    engine,
    hands,
    yard: deck,
    trains: [[], [], [], [], []],
    open: [false, false, false, false, true],
    due: null,
    turn: first,
    phase: 'play',
    drew: false,
    passes: 0,
  };
  return {
    state: s,
    events: [{ type: 'tdeal', round, engine, first, counts: hands.map((h) => h.length), yard: deck.length, hands: hands.map((h) => h.slice()) }],
  };
}

export function trainSetup(seats: number[], opts: Options, rng: Rng): TState {
  return trainDeal(newTrain(tcfgFrom(opts), seats), rng).state;
}

function endRound(s: TState, out: number | null, ev: TEvent[], rng: Rng): { state: TState; events: TEvent[] } {
  const p = s.hands.map((h) => h.reduce((a, b) => a + pips(b), 0));
  const scores = s.scores.map((x, i) => (s.seats.includes(i) ? x + p[i] : x));
  ev.push({ type: 'tround', out, pips: p, scores: scores.slice(), hands: s.hands.map((h) => h.slice()) });
  const st: TState = { ...s, scores };
  if (s.round >= s.cfg.rounds) {
    const min = Math.min(...s.seats.map((x) => scores[x]));
    const winners = s.seats.filter((x) => scores[x] === min);
    ev.push({ type: 'tend', winners, scores: scores.slice() });
    return { state: { ...st, phase: 'over', winners }, events: ev };
  }
  const d = trainDeal(st, rng);
  return { state: d.state, events: [...ev, ...d.events] };
}

export function trainApply(s0: TState, seat: number, a: TAction, rng: Rng): { state: TState; events: TEvent[] } | null {
  if (s0.phase === 'over' || seat !== s0.turn || !a || typeof a !== 'object') return null;
  const hand = s0.hands[seat];
  const moves = trainMoves(s0, seat, hand);
  const ev: TEvent[] = [];
  if (a.type === 'draw') {
    if (moves.length || s0.drew || !s0.yard.length) return null;
    const yard = s0.yard.slice();
    const bone = yard.shift()!;
    const hands = s0.hands.slice();
    hands[seat] = [...hand, bone];
    ev.push({ type: 'tdraw', seat, bone, left: yard.length });
    return { state: { ...s0, yard, hands, drew: true }, events: ev };
  }
  if (a.type === 'pass') {
    if (moves.length || (!s0.drew && s0.yard.length)) return null;
    const open = s0.open.slice();
    open[seat] = true;
    ev.push({ type: 'tpass', seat });
    const s: TState = { ...s0, open, passes: s0.passes + 1, drew: false, turn: nextSeat(s0, seat) };
    // базар пуст и все подряд пропустили — кон заперт
    if (!s.yard.length && s.passes >= s.seats.length) return endRound(s, null, ev, rng);
    return { state: s, events: ev };
  }
  if (a.type !== 'play' || !Array.isArray(a.bone)) return null;
  const m = moves.find((x) => sameBone(x.bone, a.bone) && x.train === a.train);
  if (!m) return null;
  const v = trainEnd(s0, m.train);
  const tile: Tile = { a: v, b: m.bone[0] === v ? m.bone[1] : m.bone[0], seat };
  const trains = s0.trains.map((t, i) => (i === m.train ? [...t, tile] : t));
  const hands = s0.hands.slice();
  hands[seat] = hand.filter((b) => !sameBone(b, m.bone));
  const open = s0.open.slice();
  if (m.train === seat) open[seat] = false;
  const dbl = isDouble(m.bone);
  const closed = s0.due != null && m.train === s0.due;
  ev.push({ type: 'tplay', seat, bone: m.bone, train: m.train, tile, double: dbl, closed });
  let s: TState = { ...s0, trains, hands, open, passes: 0, drew: false, due: closed ? null : s0.due };
  if (!hands[seat].length) return endRound(s, seat, ev, rng);
  // дубль: ходи ещё раз и закрой его
  if (dbl) s = { ...s, due: m.train };
  else s = { ...s, turn: nextSeat(s, seat) };
  return { state: s, events: ev };
}

export function trainView(s: TState, seats: number[] | 'all'): TView {
  const see = (x: number) => seats === 'all' || seats.includes(x);
  return {
    ...s,
    hands: s.hands.map((h, x) => (see(x) ? h.slice() : [])),
    yard: [],
    counts: s.hands.map((h, i) => (s as Partial<TView>).counts?.[i] ?? h.length),
    yardCount: (s as Partial<TView>).yardCount ?? s.yard.length,
    me: seats === 'all' ? s.seats.slice() : seats.slice(),
  };
}

export const yardLeft = (s: TState) => (s as Partial<TView>).yardCount ?? s.yard.length;

/** Боты поезда. Лёгкий — любая кость; средний — тяжёлые и дубли, которые сможет закрыть, свой поезд; сложный — ещё
 * ходит в чужие открытые поезда, сберегая свой, и не оставляет висеть дубль, который сам не закроет. */
export function trainChoose(s: TState, seat: number, level: number, rng: Rng): TAction | null {
  if (s.phase === 'over' || s.turn !== seat) return null;
  const hand = s.hands[seat];
  const moves = trainMoves(s, seat, hand);
  if (!moves.length) return !s.drew && yardLeft(s) ? { type: 'draw' } : { type: 'pass' };
  if (level === 0) {
    const m = moves[rng.int(moves.length)];
    return { type: 'play', bone: m.bone, train: m.train };
  }
  const val = (m: TMove) => {
    const rest = hand.filter((b) => !sameBone(b, m.bone));
    let v = pips(m.bone);
    if (isDouble(m.bone)) {
      // дубль — только если есть чем закрыть
      const can = rest.some((b) => b[0] === m.bone[0] || b[1] === m.bone[0]);
      v += can ? 12 : -15;
    }
    if (m.train === seat) v += level >= 2 ? 1 : 4;
    if (level >= 2 && m.train !== seat && m.train !== MEX) v += 4;
    if (level >= 2 && m.train === MEX) v += 2;
    return v + rng.next();
  };
  const best = moves.map((m) => ({ m, v: val(m) })).sort((a, b) => b.v - a.v)[0].m;
  return { type: 'play', bone: best.bone, train: best.train };
}
