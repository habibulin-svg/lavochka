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
 *
 * Окей: показ индикатора (gösterme) — у кого вторая такая же фишка, как индикатор, показывает её в свой первый ход: остальным −1.
 *
 * «Окей 101» (по Pagat): по 21 фишке, первому 22; окей — как в окее. Ход: взять (колода или сброс соседа), выложить и доложить
 * сколько хочешь, сбросить одну. Первая выкладка — комбинациями на 101 очко (окей — за ту фишку, которую заменяет) или пятью
 * парами; открывшийся парами дальше кладёт только пары. Вышел (последняя фишка — в сброс) — себе −101, остальным штраф:
 * не открывшимся 202, открывшимся — сумма фишек (окей на руке — 101); открылся победитель парами или вышел океем — штрафы вдвое.
 * Колода кончилась — сдача без победителя, штрафы те же. Партия — заданное число сдач, побеждает меньший счёт.
 */
import type { Options, Rng } from '../../core/types';
import { shuffle } from '../../core/rng';
import { fullSet, groupValue, orderGroup, pairsOf, partition, sameTile, sevenPairs, validGroup, type Face, type MeldRules, type Tile } from './tiles';

export type Mode = 'okey' | 'rummikub' | 'o101';
export const OPEN101 = 101;

export interface Cfg {
  mode: Mode;
  /** Окей: очков на старте. Руммикуб: сдач в партии. */
  start: number;
  rounds: number;
}

export function cfgFrom(o: Options): Cfg {
  const mode: Mode = o.mode === 'rummikub' ? 'rummikub' : o.mode === 'o101' ? 'o101' : 'okey';
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
  /** «Окей 101»: открылся парами. */
  pairs?: boolean[];
  /** Окей: кто показал индикатор в этой сдаче. */
  shown?: number[];
}

export interface View extends Omit<State, 'stock'> {
  stockLeft: number;
  counts: number[];
}

export type Action =
  | { type: 'draw'; from: 'stock' | 'left' }
  | { type: 'discard'; tile: Tile; finish?: boolean }
  | { type: 'play'; tiles: Tile[] }
  | { type: 'pass' }
  | { type: 'show' };

export type Event =
  | { type: 'deal'; round: number; dealer: number; indicator: Tile | null; racks?: Tile[][] }
  | { type: 'draw'; seat: number; from: 'stock' | 'left'; tile?: Tile }
  | { type: 'discard'; seat: number; tile: Tile; finish: boolean }
  | { type: 'play'; seat: number; tiles: Tile[]; table: Tile[][] }
  | { type: 'pass'; seat: number }
  | { type: 'show'; seat: number; tile: Tile }
  | { type: 'hand'; winner: number | null; text: string; delta: number[]; score: number[]; reveal?: Tile[][] }
  | { type: 'end'; winner: number; score: number[] };

export const rulesOf = (cfg: Cfg): MeldRules => ({ wrap13: cfg.mode !== 'rummikub' });
/** С индикатором и океем (окей и «Окей 101»). */
export const withOkey = (cfg: Cfg) => cfg.mode !== 'rummikub';

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
    pairs: z(0).map(() => false),
    shown: [],
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
  s.pairs = s.seats.reduce((a, x) => ((a[x] = false), a), [] as boolean[]);
  s.shown = [];
  const first = nextIn(s.seats, s.dealer);
  if (s.cfg.mode !== 'rummikub') {
    // индикатор — не ложный окей
    const i = tiles.findIndex((t) => t.n > 0);
    s.indicator = tiles[i];
    tiles = [...tiles.slice(0, i), ...tiles.slice(i + 1)];
    s.okey = { c: s.indicator.c, n: s.indicator.n === 13 ? 1 : s.indicator.n + 1 };
    const n = s.cfg.mode === 'o101' ? 21 : 14;
    for (const x of s.seats) s.racks[x] = tiles.splice(0, x === first ? n + 1 : n);
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

/** Окей: фишка для показа индикатора — вторая такая же, как индикатор; показывают в свой первый ход, один раз за сдачу. */
export function showTile(s: State | View, seat: number): Tile | null {
  if (s.cfg.mode !== 'okey' || !s.indicator || s.shown?.includes(seat) || s.moves >= s.seats.length) return null;
  const ind = s.indicator;
  return s.racks[seat].find((t) => t.c === ind.c && t.n === ind.n) ?? null;
}

/** «Окей 101»: как ляжет стол, если выложить эти фишки (null — нельзя); pairs — кладутся парами. */
export function arrange101(s: State | View, seat: number, tiles: Tile[]): { table: Tile[][]; pairs: boolean } | null {
  const face = faceOf(s);
  const rules = rulesOf(s.cfg);
  if (!tiles.length || !tiles.every((t) => has(s.racks[seat], t))) return null;
  const opened = s.opened[seat];
  const byPairs = s.pairs?.[seat];
  // открытые парами — только пары; ещё не открывшийся может открыться пятью парами
  const pr = pairsOf(tiles, face);
  if ((!opened && pr && pr.length >= 5) || (opened && byPairs)) return pr ? { table: [...s.table, ...pr], pairs: true } : null;
  const own = partition(tiles, face, rules);
  if (!opened) {
    if (!own) return null;
    const sum = own.reduce((x, g) => x + groupValue(g, face, rules), 0);
    return sum >= OPEN101 ? { table: [...s.table, ...own.map((g) => orderGroup(g, face, rules))], pairs: false } : null;
  }
  if (own) return { table: [...s.table, ...own.map((g) => orderGroup(g, face, rules))], pairs: false };
  // докладка по одной к комбинациям на столе (к парам не докладывают), остаток — своими комбинациями
  const table = s.table.map((g) => g.slice());
  const left: Tile[] = [];
  for (const t of tiles) {
    const i = table.findIndex((g) => g.length >= 3 && validGroup([...g, t].map(face), rules));
    if (i >= 0) table[i] = orderGroup([...table[i], t], face, rules);
    else left.push(t);
  }
  if (!left.length) return { table, pairs: false };
  const rest = partition(left, face, rules);
  return rest ? { table: [...table, ...rest.map((g) => orderGroup(g, face, rules))], pairs: false } : null;
}

/** «Окей 101»: штраф за фишки на руке — не открылся 202, иначе сумма (окей — 101). */
export function penalty101(s: State, seat: number): number {
  if (!s.opened[seat]) return 202;
  const face = faceOf(s);
  return s.racks[seat].reduce((x, t) => x + (face(t).wild ? 101 : face(t).n), 0);
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
    pairs: (s0.pairs ?? []).slice(),
    shown: (s0.shown ?? []).slice(),
  };
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn || !a) return null;
  const s = clone(s0);
  const ev: Event[] = [];
  if (s.cfg.mode === 'o101') return apply101(s, seat, a, rng, ev);
  if (s.cfg.mode === 'okey') {
    if (a.type === 'show') {
      // показ индикатора: остальным −1
      const t = showTile(s, seat);
      if (!t) return null;
      s.shown!.push(seat);
      const delta = s.seats.reduce((x, k) => ((x[k] = k === seat ? 0 : -1), x), [] as number[]);
      for (const x of s.seats) s.score[x] += delta[x];
      ev.push({ type: 'show', seat, tile: t });
      if (s.seats.some((x) => s.score[x] <= 0)) return endRound(s, null, 'показ индикатора', s.seats.reduce((x, k) => ((x[k] = 0), x), [] as number[]), rng, ev);
      return { state: s, events: ev };
    }
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

/** «Окей 101»: взять, выложить (сколько угодно раз), сбросить. */
function apply101(s: State, seat: number, a: Action, rng: Rng, ev: Event[]): { state: State; events: Event[] } | null {
  if (a.type === 'draw') {
    if (s.phase !== 'draw') return null;
    if (a.from === 'left') {
      const left = s.discards[prevIn(s.seats, seat)];
      if (!left.length) return null;
      const t = left.pop()!;
      s.racks[seat].push(t);
      ev.push({ type: 'draw', seat, from: 'left', tile: t });
    } else {
      if (!s.stock.length) return end101(s, null, 'колода кончилась', rng, ev);
      const t = s.stock.shift()!;
      s.racks[seat].push(t);
      ev.push({ type: 'draw', seat, from: 'stock', tile: t });
    }
    s.phase = 'discard';
    return { state: s, events: ev };
  }
  if (a.type === 'play') {
    // выкладывают, пока на руке остаётся хоть одна фишка для сброса
    if (s.phase !== 'discard' || !Array.isArray(a.tiles) || a.tiles.length >= s.racks[seat].length) return null;
    const r = arrange101(s, seat, a.tiles);
    if (!r) return null;
    s.racks[seat] = s.racks[seat].filter((x) => !a.tiles.some((t) => sameTile(t, x)));
    s.table = r.table;
    if (!s.opened[seat]) s.pairs![seat] = r.pairs;
    s.opened[seat] = true;
    ev.push({ type: 'play', seat, tiles: a.tiles.slice(), table: r.table.map((g) => g.slice()) });
    return { state: s, events: ev };
  }
  if (a.type === 'discard') {
    if (s.phase !== 'discard' || !has(s.racks[seat], a.tile)) return null;
    const tile = s.racks[seat].find((x) => sameTile(x, a.tile))!;
    // выйти можно, только открывшись
    if (s.racks[seat].length === 1 && !s.opened[seat]) return null;
    s.racks[seat] = s.racks[seat].filter((x) => !sameTile(x, tile));
    s.discards[seat].push(tile);
    const out = !s.racks[seat].length;
    ev.push({ type: 'discard', seat, tile, finish: out });
    if (out) return end101(s, seat, faceOf(s)(tile).wild ? 'вышел океем' : s.pairs![seat] ? 'вышел, открывшись парами' : 'вышел', rng, ev, faceOf(s)(tile).wild);
    if (++s.moves >= MAX_MOVES) return end101(s, null, 'сдача затянулась', rng, ev);
    s.turn = nextIn(s.seats, seat);
    s.phase = 'draw';
    return { state: s, events: ev };
  }
  return null;
}

/** «Окей 101»: конец сдачи — штрафы (вдвое, если победитель открылся парами или вышел океем), победителю −101 (−202). */
function end101(s: State, winner: number | null, text: string, rng: Rng, ev: Event[], byOkey = false) {
  const k = winner != null && (s.pairs![winner] || byOkey) ? 2 : 1;
  const delta = s.seats.reduce((x, p) => ((x[p] = p === winner ? -101 * k : penalty101(s, p) * k), x), [] as number[]);
  return endRound(s, winner, text, delta, rng, ev);
}

function endRound(s: State, winner: number | null, text: string, delta: number[], rng: Rng, ev: Event[]) {
  for (const x of s.seats) s.score[x] += delta[x];
  s.last = { winner, text };
  ev.push({ type: 'hand', winner, text, delta, score: s.score.slice(), reveal: s.racks.map((r) => (r ? r.slice() : r)) });
  const done = s.cfg.mode === 'okey' ? s.seats.some((x) => s.score[x] <= 0) || s.round >= 30 : s.round >= s.cfg.rounds;
  if (done) {
    s.over = true;
    // в «Окее 101» счёт — штрафы: побеждает меньший
    const best = s.cfg.mode === 'o101' ? Math.min(...s.seats.map((x) => s.score[x])) : Math.max(...s.seats.map((x) => s.score[x]));
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
