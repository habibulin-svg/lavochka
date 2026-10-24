/* Окей и руммикуб — правила (без DOM). Сводка — docs/analysis/rules-rummy.md.
 *
 * Окей (Турция): 106 фишек — 1…13 четырёх цветов по две и два «ложных окея». Открывают индикатор; окей (джокер) — фишка того же
 * цвета на единицу старше (13 → 1), ложный окей играет за саму фишку-окей. Первому 15 фишек, остальным по 14. Ход: взять верхнюю
 * из колоды или последнюю сброшенную соседом слева, сбросить одну. Выход — сбросом 15-й, когда 14 оставшихся раскладываются
 * в группы (3–4 одного номера разных цветов) и ряды (3+ подряд одного цвета; 12-13-1 можно, 13-1-2 нельзя) или в семь пар.
 * У всех по 20 очков: при выходе соперникам −2, сбросом окея или семью парами — −4. У кого очков не осталось — партия:
 * побеждает тот, у кого больше. Колода кончилась — сдача без очков.
 * Руммикуб: два настоящих джокера, по 14 фишек, на стол выкладывают комбинации; первый раз — на 30 очков и только своими.
 * Выложившись, можно перестраивать весь стол — лишь бы в конце хода всё на нём было правильными комбинациями. Не выложил — бери фишку.
 * Вышел — соперникам минус сумма их фишек (джокер 30), тебе — плюс сумма. Партия — заданное число сдач.
 */
import type { Options, Rng } from '../../core/types';
import { shuffle } from '../../core/rng';
import { fullSet, groupValue, orderGroup, partition, sameTile, sevenPairs, validGroup, type Face, type MeldRules, type Tile } from './tiles';

export type Mode = 'okey' | 'rummikub';

export interface Cfg {
  mode: Mode;
  /** Окей: очков на старте. Руммикуб: сдач в партии. */
  start: number;
  rounds: number;
}

export function cfgFrom(o: Options): Cfg {
  const mode: Mode = o.mode === 'rummikub' ? 'rummikub' : 'okey';
  return { mode, start: [10, 20].includes(Number(o.start)) ? Number(o.start) : 20, rounds: [1, 3, 5].includes(Number(o.rounds)) ? Number(o.rounds) : 3 };
}

export const OPEN = 30;
export const MAX_MOVES = 300;

export interface State {
  cfg: Cfg;
  seats: number[];
  dealer: number;
  stock: Tile[];
  racks: Tile[][];
  /** Сброс каждого (верх — последний). */
  discards: Tile[][];
  indicator: Tile | null;
  /** Фишка-окей (цвет и номер). */
  okey: { c: number; n: number } | null;
  table: Tile[][];
  opened: boolean[];
  phase: 'draw' | 'discard' | 'turn';
  turn: number;
  /** Руммикуб: сколько подряд взяли из пустой колоды (все — конец сдачи). */
  passes: number;
  /** Ходов в этой сдаче (предел — сдача без победителя). */
  moves: number;
  score: number[];
  round: number;
  last: { winner: number | null; text: string } | null;
  over: boolean;
  winner: number | null;
}

export interface View extends Omit<State, 'stock'> {
  stockLeft: number;
  counts: number[];
}

export type Action =
  | { type: 'draw'; from: 'stock' | 'left' }
  | { type: 'discard'; tile: Tile; finish?: boolean }
  | { type: 'play'; tiles: Tile[] }
  | { type: 'pass' };

export type Event =
  | { type: 'deal'; round: number; dealer: number; indicator: Tile | null; racks?: Tile[][] }
  | { type: 'draw'; seat: number; from: 'stock' | 'left'; tile?: Tile }
  | { type: 'discard'; seat: number; tile: Tile; finish: boolean }
  | { type: 'play'; seat: number; tiles: Tile[]; table: Tile[][] }
  | { type: 'pass'; seat: number }
  | { type: 'hand'; winner: number | null; text: string; delta: number[]; score: number[]; reveal?: Tile[][] }
  | { type: 'end'; winner: number; score: number[] };

export const rulesOf = (cfg: Cfg): MeldRules => ({ wrap13: cfg.mode === 'okey' });

/** Как играет фишка в этой сдаче. */
export function faceOf(s: State | View): (t: Tile) => Face {
  if (s.cfg.mode === 'rummikub') return (t) => ({ wild: t.n === 0, c: t.c, n: t.n });
  const ok = s.okey!;
  return (t) => {
    if (t.n === 0) return { wild: false, c: ok.c, n: ok.n }; // ложный окей — за саму фишку
    if (t.c === ok.c && t.n === ok.n) return { wild: true, c: t.c, n: t.n };
    return { wild: false, c: t.c, n: t.n };
  };
}

const nextIn = (list: number[], seat: number) => list[(list.indexOf(seat) + 1) % list.length];
const prevIn = (list: number[], seat: number) => list[(list.indexOf(seat) - 1 + list.length) % list.length];

export function newState(cfg: Cfg, seats: number[]): State {
  const z = (v: number) => seats.reduce((a, x) => ((a[x] = v), a), [] as number[]);
  return {
    cfg,
    seats: seats.slice(),
    dealer: seats[seats.length - 1],
    stock: [],
    racks: seats.reduce((a, x) => ((a[x] = []), a), [] as Tile[][]),
    discards: seats.reduce((a, x) => ((a[x] = []), a), [] as Tile[][]),
    indicator: null,
    okey: null,
    table: [],
    opened: seats.reduce((a, x) => ((a[x] = false), a), [] as boolean[]),
    phase: 'draw',
    turn: seats[0],
    passes: 0,
    moves: 0,
    score: z(cfg.mode === 'okey' ? cfg.start : 0),
    round: 0,
    last: null,
    over: false,
    winner: null,
  };
}

function dealRound(s: State, rng: Rng, ev: Event[]) {
  s.round++;
  if (s.round > 1) s.dealer = nextIn(s.seats, s.dealer);
  let tiles = shuffle(fullSet(), rng);
  s.table = [];
  s.passes = 0;
  s.moves = 0;
  for (const x of s.seats) {
    s.discards[x] = [];
    s.opened[x] = false;
  }
  const first = nextIn(s.seats, s.dealer);
  if (s.cfg.mode === 'okey') {
    // индикатор — не ложный окей
    const i = tiles.findIndex((t) => t.n > 0);
    s.indicator = tiles[i];
    tiles = [...tiles.slice(0, i), ...tiles.slice(i + 1)];
    s.okey = { c: s.indicator.c, n: s.indicator.n === 13 ? 1 : s.indicator.n + 1 };
    for (const x of s.seats) s.racks[x] = tiles.splice(0, x === first ? 15 : 14);
    s.phase = 'discard';
  } else {
    s.indicator = null;
    s.okey = null;
    for (const x of s.seats) s.racks[x] = tiles.splice(0, 14);
    s.phase = 'turn';
  }
  s.stock = tiles;
  s.turn = first;
  ev.push({ type: 'deal', round: s.round, dealer: s.dealer, indicator: s.indicator, racks: s.racks.map((r) => (r ? r.slice() : r)) });
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  const s = newState(cfgFrom(opts), seats);
  dealRound(s, rng, []);
  return s;
}

export const toAct = (s: State): number[] => (s.over ? [] : [s.turn]);
const has = (r: Tile[], t: Tile) => r.some((x) => sameTile(x, t));

/** Окей: можно ли выйти, сбросив эту фишку. */
export function canFinish(s: State | View, seat: number, tile: Tile): false | 'melds' | 'pairs' {
  if (s.cfg.mode !== 'okey' || s.phase !== 'discard') return false;
  const rest = s.racks[seat].filter((x) => !sameTile(x, tile));
  if (rest.length !== 14) return false;
  const face = faceOf(s);
  if (partition(rest, face, rulesOf(s.cfg))) return 'melds';
  if (sevenPairs(rest, face)) return 'pairs';
  return false;
}

/** Руммикуб: как ляжет стол, если выложить эти фишки (null — нельзя). */
export function arrange(s: State | View, seat: number, tiles: Tile[]): Tile[][] | null {
  const face = faceOf(s);
  const rules = rulesOf(s.cfg);
  if (!tiles.length || !tiles.every((t) => has(s.racks[seat], t))) return null;
  const own = partition(tiles, face, rules);
  if (!s.opened[seat]) {
    if (!own) return null;
    const sum = own.reduce((x, g) => x + groupValue(g, face, rules), 0);
    return sum >= OPEN ? [...s.table, ...own.map((g) => orderGroup(g, face, rules))] : null;
  }
  if (own) return [...s.table, ...own.map((g) => orderGroup(g, face, rules))];
  // доложить к группам на столе по одной
  const table = s.table.map((g) => g.slice());
  const left: Tile[] = [];
  for (const t of tiles) {
    const i = table.findIndex((g) => validGroup([...g, t].map(face), rules));
    if (i >= 0) table[i] = orderGroup([...table[i], t], face, rules);
    else left.push(t);
  }
  if (!left.length) return table;
  const rest = partition(left, face, rules);
  if (rest) return [...table, ...rest.map((g) => orderGroup(g, face, rules))];
  // перестроить весь стол
  const all = partition([...s.table.flat(), ...tiles], face, rules);
  return all ? all.map((g) => orderGroup(g, face, rules)) : null;
}

/** Сумма фишек на подставке (штраф руммикуба). */
export const rackValue = (r: Tile[]) => r.reduce((x, t) => x + (t.n === 0 ? 30 : t.n), 0);

function clone(s0: State): State {
  return {
    ...s0,
    stock: s0.stock.slice(),
    racks: s0.racks.map((r) => (r ? r.slice() : r)),
    discards: s0.discards.map((d) => (d ? d.slice() : d)),
    table: s0.table.map((g) => g.slice()),
    opened: s0.opened.slice(),
    score: s0.score.slice(),
  };
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn || !a) return null;
  const s = clone(s0);
  const ev: Event[] = [];
  if (s.cfg.mode === 'okey') {
    if (a.type === 'draw') {
      if (s.phase !== 'draw') return null;
      if (a.from === 'left') {
        const left = s.discards[prevIn(s.seats, seat)];
        if (!left.length) return null;
        const t = left.pop()!;
        s.racks[seat].push(t);
        ev.push({ type: 'draw', seat, from: 'left', tile: t });
      } else {
        if (!s.stock.length) return endRound(s, null, 'колода кончилась', s.seats.reduce((x, k) => ((x[k] = 0), x), [] as number[]), rng, ev);
        const t = s.stock.shift()!;
        s.racks[seat].push(t);
        ev.push({ type: 'draw', seat, from: 'stock', tile: t });
      }
      s.phase = 'discard';
      return { state: s, events: ev };
    }
    if (a.type === 'discard') {
      if (s.phase !== 'discard' || !has(s.racks[seat], a.tile)) return null;
      const how = a.finish ? canFinish(s, seat, a.tile) : false;
      if (a.finish && !how) return null;
      const tile = s.racks[seat].find((x) => sameTile(x, a.tile))!;
      s.racks[seat] = s.racks[seat].filter((x) => !sameTile(x, tile));
      s.discards[seat].push(tile);
      ev.push({ type: 'discard', seat, tile, finish: !!how });
      if (how) {
        const double = how === 'pairs' || faceOf(s)(tile).wild;
        const delta = s.seats.reduce((x, k) => ((x[k] = k === seat ? 0 : double ? -4 : -2), x), [] as number[]);
        return endRound(s, seat, how === 'pairs' ? 'семь пар' : double ? 'выход океем' : 'выход', delta, rng, ev);
      }
      // фишку гоняют через сброс, колода не убывает — сдача без победителя
      if (++s.moves >= MAX_MOVES) return endRound(s, null, 'сдача затянулась', s.seats.reduce((x, k) => ((x[k] = 0), x), [] as number[]), rng, ev);
      s.turn = nextIn(s.seats, seat);
      s.phase = 'draw';
      return { state: s, events: ev };
    }
    return null;
  }
  // руммикуб
  if (a.type === 'play') {
    if (!Array.isArray(a.tiles)) return null;
    const table = arrange(s, seat, a.tiles);
    if (!table) return null;
    s.racks[seat] = s.racks[seat].filter((x) => !a.tiles.some((t) => sameTile(t, x)));
    s.table = table;
    s.opened[seat] = true;
    s.passes = 0;
    ev.push({ type: 'play', seat, tiles: a.tiles.slice(), table: table.map((g) => g.slice()) });
    if (!s.racks[seat].length) {
      const delta = s.seats.reduce((x, k) => ((x[k] = k === seat ? 0 : -rackValue(s.racks[k])), x), [] as number[]);
      delta[seat] = -s.seats.reduce((x, k) => x + (k === seat ? 0 : delta[k]), 0);
      return endRound(s, seat, 'выход', delta, rng, ev);
    }
    s.turn = nextIn(s.seats, seat);
    return { state: s, events: ev };
  }
  if (a.type === 'draw' || a.type === 'pass') {
    if (s.stock.length) {
      const t = s.stock.shift()!;
      s.racks[seat].push(t);
      ev.push({ type: 'draw', seat, from: 'stock', tile: t });
      s.passes = 0;
    } else {
      ev.push({ type: 'pass', seat });
      s.passes++;
      if (s.passes >= s.seats.length) {
        // никто не может — у кого меньше на подставке, тот и вышел
        const vals = s.seats.map((k) => rackValue(s.racks[k]));
        const best = Math.min(...vals);
        const w = s.seats[vals.indexOf(best)];
        const delta = s.seats.reduce((x, k) => ((x[k] = k === w ? 0 : -(rackValue(s.racks[k]) - best)), x), [] as number[]);
        delta[w] = -s.seats.reduce((x, k) => x + (k === w ? 0 : delta[k]), 0);
        return endRound(s, w, 'ходов нет — меньше всех на подставке', delta, rng, ev);
      }
    }
    s.turn = nextIn(s.seats, seat);
    return { state: s, events: ev };
  }
  return null;
}

function endRound(s: State, winner: number | null, text: string, delta: number[], rng: Rng, ev: Event[]) {
  for (const x of s.seats) s.score[x] += delta[x];
  s.last = { winner, text };
  ev.push({ type: 'hand', winner, text, delta, score: s.score.slice(), reveal: s.racks.map((r) => (r ? r.slice() : r)) });
  const done = s.cfg.mode === 'okey' ? s.seats.some((x) => s.score[x] <= 0) || s.round >= 30 : s.round >= s.cfg.rounds;
  if (done) {
    s.over = true;
    const best = Math.max(...s.seats.map((x) => s.score[x]));
    s.winner = s.seats.find((x) => s.score[x] === best)!;
    ev.push({ type: 'end', winner: s.winner, score: s.score.slice() });
    return { state: s, events: ev };
  }
  dealRound(s, rng, ev);
  return { state: s, events: ev };
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const see = (x: number) => seats === 'all' || seats.includes(x);
  const v = s as unknown as Partial<View>;
  const { stock, ...rest } = s as State;
  return {
    ...rest,
    racks: s.racks.map((r, i) => (r ? (see(i) ? r.slice() : []) : r)),
    counts: s.racks.map((r, i) => (r ? (v.counts?.[i] ?? r.length) : 0)),
    stockLeft: v.stockLeft ?? stock?.length ?? 0,
  };
}

export const leftOf = prevIn;
