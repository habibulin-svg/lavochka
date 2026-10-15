/* Перудо («лжец на костях») — правила (без DOM). У каждого 5 костей под стаканчиком, свои видит только он.
 *
 * По кругу заявки «N граней X» — на всём столе, у всех вместе, не меньше N костей с гранью X. Единицы («пако») — джокеры:
 * считаются за любую грань. Следующий повышает: больше костей, или столько же, но грань старше. На единицы — можно вдвое меньшим
 * числом (с округлением вверх), обратно с единиц — вдвое больше плюс один. Начинать кон с единиц нельзя.
 * «Не верю!» — все поднимают стаканчики: меньше заявленного — заявивший теряет кость, иначе — сомневавшийся.
 * «Точно!» (если за столом трое и больше) — ровно столько: угадавший возвращает кость (не больше пяти), не угадал — теряет.
 * Палафико: у кого осталась последняя кость — следующий кон (один раз) без джокеров, грань в нём не меняют, начинать можно с единиц.
 * Потерявший кость начинает следующий кон. Без костей — выбыл; остался один — победил.
 */
import type { Options, Rng } from '../../core/types';

export interface Cfg {
  /** Единицы — джокеры. */
  jokers: boolean;
  calza: boolean;
  palafico: boolean;
  dice: number;
}

export function cfgFrom(o: Options): Cfg {
  return { jokers: o.jokers !== false, calza: o.calza !== false, palafico: o.palafico !== false, dice: [3, 4, 5].includes(Number(o.dice)) ? Number(o.dice) : 5 };
}

export interface Bid {
  seat: number;
  n: number;
  face: number;
}

export interface Reveal {
  kind: 'dudo' | 'calza';
  caller: number;
  bid: Bid;
  actual: number;
  dice: number[][];
  /** Кто потерял кость (или null) и кто вернул. */
  loser: number | null;
  gainer: number | null;
  palafico: boolean;
}

export interface State {
  cfg: Cfg;
  seats: number[];
  dice: number[][];
  /** Сколько костей у каждого (видно всем). */
  counts: number[];
  turn: number;
  bid: Bid | null;
  /** Все заявки кона по порядку. */
  history: Bid[];
  round: number;
  palafico: boolean;
  palaficoDone: boolean[];
  last: Reveal | null;
  over: boolean;
}

export type Action = { type: 'bid'; n: number; face: number } | { type: 'dudo' } | { type: 'calza' };

export type Event =
  | { type: 'roll'; round: number; palafico: boolean; starter: number; dice?: number[][] }
  | { type: 'bid'; seat: number; n: number; face: number }
  | { type: 'reveal'; reveal: Reveal }
  | { type: 'out'; seat: number }
  | { type: 'end'; winner: number };

export const alive = (s: State) => s.seats.filter((p) => s.counts[p] > 0);
const nextAlive = (s: State, seat: number) => {
  let p = s.seats[(s.seats.indexOf(seat) + 1) % s.seats.length];
  for (let i = 0; i < s.seats.length && s.counts[p] <= 0; i++) p = s.seats[(s.seats.indexOf(p) + 1) % s.seats.length];
  return p;
};
export const totalDice = (s: State) => s.seats.reduce((a, p) => a + s.counts[p], 0);
/** Единицы — джокеры в этом коне. */
export const wild = (s: State) => s.cfg.jokers && !s.palafico;
export const calzaAllowed = (s: State) => s.cfg.calza && !!s.bid && alive(s).length >= 3;

export function newState(cfg: Cfg, seats: number[]): State {
  return {
    cfg,
    seats: seats.slice(),
    dice: [[], [], [], [], [], []],
    counts: [0, 1, 2, 3, 4, 5].map((p) => (seats.includes(p) ? cfg.dice : 0)),
    turn: seats[0],
    bid: null,
    history: [],
    round: 0,
    palafico: false,
    palaficoDone: [false, false, false, false, false, false],
    last: null,
    over: false,
  };
}

function roll(s: State, starter: number, rng: Rng, ev: Event[]) {
  s.round++;
  s.dice = [0, 1, 2, 3, 4, 5].map((p) => Array.from({ length: s.counts[p] }, () => 1 + rng.int(6)).sort((a, b) => a - b));
  s.bid = null;
  s.history = [];
  s.turn = starter;
  ev.push({ type: 'roll', round: s.round, palafico: s.palafico, starter, dice: s.dice.map((d) => d.slice()) });
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  const s = newState(cfgFrom(opts), seats);
  roll(s, seats[rng.int(seats.length)], rng, []);
  return s;
}

export const toAct = (s: State): number[] => (s.over ? [] : [s.turn]);

/** Сколько костей с гранью face на столе (с джокерами, если они в силе). */
export function countFace(dice: number[][], face: number, wildOnes: boolean): number {
  let n = 0;
  for (const d of dice) for (const x of d) if (x === face || (wildOnes && face !== 1 && x === 1)) n++;
  return n;
}

/** Можно ли заявить n граней face после текущей заявки. */
export function validBid(s: State, n: number, face: number): boolean {
  if (!Number.isInteger(n) || !Number.isInteger(face) || face < 1 || face > 6 || n < 1 || n > totalDice(s)) return false;
  const cur = s.bid;
  const w = wild(s);
  if (!cur) return !(w && face === 1);
  if (s.palafico) return face === cur.face && n > cur.n;
  if (!w) return n > cur.n || (n === cur.n && face > cur.face);
  if (cur.face !== 1 && face !== 1) return n > cur.n || (n === cur.n && face > cur.face);
  if (cur.face !== 1 && face === 1) return n >= Math.ceil(cur.n / 2);
  if (cur.face === 1 && face === 1) return n > cur.n;
  return n >= cur.n * 2 + 1;
}

/** Наименьшее допустимое число для грани face (или 0, если нельзя). */
export function minBid(s: State, face: number): number {
  for (let n = 1; n <= totalDice(s); n++) if (validBid(s, n, face)) return n;
  return 0;
}

function lose(s: State, p: number, ev: Event[]) {
  s.counts[p]--;
  if (s.counts[p] === 0) ev.push({ type: 'out', seat: p });
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn || !a || typeof a !== 'object') return null;
  const s: State = { ...s0, counts: s0.counts.slice(), dice: s0.dice.map((d) => d.slice()), history: s0.history.slice(), palaficoDone: s0.palaficoDone.slice() };
  const ev: Event[] = [];
  if (a.type === 'bid') {
    if (!validBid(s, Number(a.n), Number(a.face))) return null;
    const b = { seat, n: Number(a.n), face: Number(a.face) };
    s.bid = b;
    s.history.push(b);
    s.turn = nextAlive(s, seat);
    ev.push({ type: 'bid', seat, n: b.n, face: b.face });
    return { state: s, events: ev };
  }
  if (a.type !== 'dudo' && a.type !== 'calza') return null;
  if (!s.bid || s.bid.seat === seat) return null;
  if (a.type === 'calza' && !calzaAllowed(s)) return null;
  const bid = s.bid;
  const actual = countFace(s.dice, bid.face, wild(s));
  let loser: number | null = null;
  let gainer: number | null = null;
  if (a.type === 'dudo') loser = actual < bid.n ? bid.seat : seat;
  else if (actual === bid.n) {
    if (s.counts[seat] < s.cfg.dice) gainer = seat;
  } else loser = seat;
  const reveal: Reveal = { kind: a.type, caller: seat, bid, actual, dice: s.dice.map((d) => d.slice()), loser, gainer, palafico: s.palafico };
  s.last = reveal;
  ev.push({ type: 'reveal', reveal });
  if (gainer != null) s.counts[gainer]++;
  if (loser != null) lose(s, loser, ev);
  const left = alive(s);
  if (left.length <= 1) {
    s.over = true;
    s.dice = s.dice.map(() => []);
    ev.push({ type: 'end', winner: left[0] });
    return { state: s, events: ev };
  }
  // начинает потерявший (выбыл — следующий за ним), после удачного «точно» — угадавший
  let starter = loser ?? gainer ?? seat;
  if (s.counts[starter] <= 0) starter = nextAlive(s, starter);
  // палафико: у потерявшего осталась последняя кость
  s.palafico = false;
  if (s.cfg.palafico && loser != null && s.counts[loser] === 1 && !s.palaficoDone[loser] && left.length >= 3) {
    s.palafico = true;
    s.palaficoDone[loser] = true;
  }
  roll(s, starter, rng, ev);
  return { state: s, events: ev };
}

export function makeView(s: State, seats: number[] | 'all'): State {
  const see = (p: number) => seats === 'all' || seats.includes(p);
  return { ...s, dice: s.dice.map((d, p) => (see(p) ? d.slice() : [])) };
}
