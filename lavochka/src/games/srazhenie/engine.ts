/* «Сражение» — советский «Стратего» (листы для печати jakobCIT): поле 10×10 с двумя озёрами, по 40 фишек.
 * Ранги: 1 Маршал … 9 Солдат, 10 Разведчик; меньше число — сильнее (в тексте правил сказано наоборот — опечатка,
 * см. docs/analysis/materials-srazhenie.md). Разведчик, напав на Маршала, побеждает его. Мину обезвреживает только Сапёр (8).
 * Клетки: c + 10·r, r = 0 — верхний ряд (синие, место 1), r = 9 — нижний (зелёные, место 0). Без DOM. */
import type { Options, Rng } from '../../core/types';

export const SIZE = 10;
export const N = SIZE * SIZE;
export const MINE = 11;
export const FLAG = 12;
export const SAPPER = 8;
export const SCOUT = 10;
export const MARSHAL = 1;
export const SOLDIER = 9;
/** Сколько фишек каждого ранга (индекс — ранг). */
export const COUNT: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 3, 5: 4, 6: 4, 7: 4, 8: 5, 9: 8, 10: 1, 11: 6, 12: 1 };
export const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
export const NAMES: Record<number, string> = {
  1: 'Маршал',
  2: 'Генерал',
  3: 'Полковник',
  4: 'Майор',
  5: 'Капитан',
  6: 'Лейтенант',
  7: 'Сержант',
  8: 'Сапёр',
  9: 'Солдат',
  10: 'Разведчик',
  11: 'Мина',
  12: 'Знамя',
};
/** Падежи для журнала: «Капитан бьёт Сержанта». */
export const ACC: Record<number, string> = {
  1: 'Маршала',
  2: 'Генерала',
  3: 'Полковника',
  4: 'Майора',
  5: 'Капитана',
  6: 'Лейтенанта',
  7: 'Сержанта',
  8: 'Сапёра',
  9: 'Солдата',
  10: 'Разведчика',
  11: 'мину',
  12: 'знамя',
};
/** Ничья, если столько полуходов подряд не было ни одного боя. */
export const QUIET = 200;
/** Одной фишкой между двумя клетками туда-обратно — не больше стольких ходов подряд. */
export const SHUTTLE = 3;

export const LAKE = new Set([42, 43, 52, 53, 46, 47, 56, 57]);

export interface Cfg {
  /** Солдат (9) ходит как разведчик «Стратего» — на любое число свободных клеток по прямой. */
  run: boolean;
}
export function cfgFrom(o: Options): Cfg {
  return { run: o.move === 'run' };
}

export interface Piece {
  id: number;
  owner: number;
  /** Ранг; null — чужая нераскрытая фишка (в view соперника). */
  rank: number | null;
  moved: boolean;
  /** Ранг раскрыт в бою — его знают оба. */
  known: boolean;
}

export type Phase = 'deploy' | 'play' | 'over';

export interface State {
  cfg: Cfg;
  cells: (Piece | null)[];
  phase: Phase;
  ready: [boolean, boolean];
  /** Расстановку уже меняли кнопкой (перемешать / с умом) — бот второй раз не перекладывает. */
  laid: [boolean, boolean];
  turn: number;
  winner: number | null;
  why: '' | 'flag' | 'stuck' | 'quiet' | 'both';
  /** Последний ход (клетки) — для подсветки. */
  last: number[];
  quiet: number;
  /** Туда-обратно: последняя фишка места, её клетки и сколько раз подряд. */
  shuttle: [Shuttle, Shuttle];
  /** Потери: ранги снятых фишек каждого места. */
  lost: [number[], number[]];
  plies: number;
}
export interface Shuttle {
  id: number;
  a: number;
  b: number;
  n: number;
}

export type Action =
  | { type: 'swap'; a: number; b: number }
  | { type: 'shuffle' }
  | { type: 'auto' }
  | { type: 'layout'; ranks: number[] }
  | { type: 'ready' }
  | { type: 'move'; from: number; to: number };

export type Event =
  | { type: 'swap'; seat: number; a: number; b: number }
  | { type: 'layout'; seat: number }
  | { type: 'ready'; seat: number }
  | { type: 'start' }
  | { type: 'move'; seat: number; from: number; to: number; id: number }
  | { type: 'battle'; seat: number; from: number; to: number; att: number; def: number; res: 'win' | 'lose' | 'both' }
  | { type: 'end'; winner: number | null; why: State['why'] };

export const row = (p: number) => Math.floor(p / SIZE);
export const col = (p: number) => p % SIZE;

/** Своя зона: четыре ближних ряда. i = 0…9 — передний ряд слева направо (как видит хозяин), …, 30…39 — задний. */
export function zoneCell(seat: number, i: number): number {
  const r = Math.floor(i / SIZE);
  const c = i % SIZE;
  return seat === 0 ? (6 + r) * SIZE + c : (3 - r) * SIZE + (SIZE - 1 - c);
}
export function inZone(seat: number, p: number): boolean {
  const r = row(p);
  return seat === 0 ? r >= 6 : r <= 3;
}

export function army(): number[] {
  const out: number[] = [];
  for (const r of RANKS) for (let k = 0; k < COUNT[r]; k++) out.push(r);
  return out;
}

export function validLayout(ranks: unknown): ranks is number[] {
  if (!Array.isArray(ranks) || ranks.length !== 40) return false;
  const cnt: Record<number, number> = {};
  for (const r of ranks) {
    if (typeof r !== 'number' || !COUNT[r]) return false;
    cnt[r] = (cnt[r] ?? 0) + 1;
  }
  return RANKS.every((r) => cnt[r] === COUNT[r]);
}

function shuffled<T>(a: T[], rng: Rng): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

/** Расстановка «с умом»: знамя в заднем ряду под минами, остальные мины — во втором-четвёртом рядах,
 * солдаты-разведчики впереди, сапёры не в первом ряду. Бот и кнопка «Расставить с умом». */
export function smartLayout(rng: Rng): number[] {
  const L: (number | null)[] = Array(40).fill(null);
  const fc = rng.int(SIZE);
  const flag = 30 + fc;
  L[flag] = FLAG;
  // мины вокруг знамени: перед ним и по бокам
  const guard = [flag - 10, fc > 0 ? flag - 1 : -1, fc < 9 ? flag + 1 : -1].filter((x) => x >= 0);
  let mines = COUNT[MINE];
  for (const g of guard) {
    if (mines > 0 && rng.next() < 0.9) {
      L[g] = MINE;
      mines--;
    }
  }
  const free = (from: number, to: number) => shuffled(Array.from({ length: to - from }, (_, k) => from + k), rng).filter((k) => L[k] == null);
  for (const k of free(10, 40)) {
    if (mines <= 0) break;
    if (rng.next() < 0.3) {
      L[k] = MINE;
      mines--;
    }
  }
  for (const k of free(10, 40)) {
    if (mines <= 0) break;
    L[k] = MINE;
    mines--;
  }
  const put = (r: number, n: number, rows: [number, number][]) => {
    for (let k = 0; k < n; k++) {
      const [a, b] = rows[rng.int(rows.length)];
      const pool = free(a, b);
      const at = pool.length ? pool[0] : free(0, 40)[0];
      L[at] = r;
    }
  };
  put(SOLDIER, 5, [[0, 10]]);
  put(SOLDIER, COUNT[SOLDIER] - 5, [[0, 20]]);
  put(MARSHAL, 1, [[0, 20], [10, 30]]);
  put(2, 1, [[10, 30]]);
  put(SCOUT, 1, [[10, 30]]);
  put(SAPPER, COUNT[SAPPER], [[10, 40], [20, 40]]);
  for (const r of [3, 4, 5, 6, 7]) put(r, COUNT[r], [[0, 30], [0, 40]]);
  return L.map((x) => x as number);
}

export function newState(cfg: Cfg): State {
  return {
    cfg,
    cells: Array(N).fill(null),
    phase: 'deploy',
    ready: [false, false],
    laid: [false, false],
    turn: 0,
    winner: null,
    why: '',
    last: [],
    quiet: 0,
    shuttle: [
      { id: -1, a: -1, b: -1, n: 0 },
      { id: -1, a: -1, b: -1, n: 0 },
    ],
    lost: [[], []],
    plies: 0,
  };
}

export function place(s: State, seat: number, ranks: number[]) {
  for (let i = 0; i < 40; i++) {
    const p = zoneCell(seat, i);
    const old = s.cells[p];
    s.cells[p] = { id: old ? old.id : seat * 100 + i, owner: seat, rank: ranks[i], moved: false, known: false };
  }
}

export function setup(opts: Options, rng: Rng): State {
  const s = newState(cfgFrom(opts));
  place(s, 0, shuffled(army(), rng));
  place(s, 1, shuffled(army(), rng));
  return s;
}

export function toAct(s: State): number[] {
  if (s.phase === 'over') return [];
  if (s.phase === 'deploy') return [0, 1].filter((x) => !s.ready[x]);
  return [s.turn];
}

const DIRS = [-SIZE, SIZE, -1, 1];

function step(p: number, d: number): number {
  const q = p + d;
  if (q < 0 || q >= N) return -1;
  if ((d === 1 || d === -1) && row(q) !== row(p)) return -1;
  if (LAKE.has(q)) return -1;
  return q;
}

export function movable(rank: number | null): boolean {
  return rank !== MINE && rank !== FLAG;
}

/** Ходы фишки с клетки p (только для своих фишек — ранг известен). */
export function movesFrom(s: State, p: number): number[] {
  const pc = s.cells[p];
  if (!pc || pc.rank == null || !movable(pc.rank)) return [];
  const out: number[] = [];
  const far = s.cfg.run && pc.rank === SOLDIER;
  const sh = s.shuttle[pc.owner];
  for (const d of DIRS) {
    let q = step(p, d);
    while (q >= 0) {
      const t = s.cells[q];
      if (t && t.owner === pc.owner) break;
      // туда-обратно не больше SHUTTLE раз подряд
      const back = sh.id === pc.id && sh.n >= SHUTTLE && ((p === sh.a && q === sh.b) || (p === sh.b && q === sh.a));
      if (!back) out.push(q);
      if (t || !far) break;
      q = step(q, d);
    }
  }
  return out;
}

export function legalMoves(s: State, seat: number): Action[] {
  const out: Action[] = [];
  for (let p = 0; p < N; p++) {
    const pc = s.cells[p];
    if (pc && pc.owner === seat) for (const to of movesFrom(s, p)) out.push({ type: 'move', from: p, to });
  }
  return out;
}

/** Исход боя для нападающего. */
export function fight(att: number, def: number): 'win' | 'lose' | 'both' {
  if (def === FLAG) return 'win';
  if (def === MINE) return att === SAPPER ? 'win' : 'lose';
  if (att === SCOUT && def === MARSHAL) return 'win';
  if (att === def) return 'both';
  return att < def ? 'win' : 'lose';
}

function clone(s: State): State {
  return {
    ...s,
    cells: s.cells.map((c) => (c ? { ...c } : null)),
    ready: [...s.ready] as [boolean, boolean],
    laid: [...s.laid] as [boolean, boolean],
    shuttle: [{ ...s.shuttle[0] }, { ...s.shuttle[1] }],
    lost: [[...s.lost[0]], [...s.lost[1]]],
    last: [...s.last],
  };
}

function finish(s: State, winner: number | null, why: State['why'], events: Event[]) {
  s.phase = 'over';
  s.winner = winner;
  s.why = why;
  events.push({ type: 'end', winner, why });
}

function anyMove(s: State, seat: number): boolean {
  for (let p = 0; p < N; p++) {
    const pc = s.cells[p];
    if (pc && pc.owner === seat && movesFrom(s, p).length) return true;
  }
  return false;
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (!a || typeof a !== 'object') return null;
  if (s0.phase === 'deploy') {
    if (s0.ready[seat]) return null;
    const s = clone(s0);
    if (a.type === 'swap') {
      if (!Number.isInteger(a.a) || !Number.isInteger(a.b) || a.a === a.b) return null;
      if (!inZone(seat, a.a) || !inZone(seat, a.b)) return null;
      [s.cells[a.a], s.cells[a.b]] = [s.cells[a.b], s.cells[a.a]];
      return { state: s, events: [{ type: 'swap', seat, a: a.a, b: a.b }] };
    }
    if (a.type === 'shuffle' || a.type === 'auto' || a.type === 'layout') {
      let ranks: number[];
      if (a.type === 'layout') {
        if (!validLayout(a.ranks)) return null;
        ranks = a.ranks;
      } else ranks = a.type === 'auto' ? smartLayout(rng) : shuffled(army(), rng);
      place(s, seat, ranks);
      s.laid[seat] = true;
      return { state: s, events: [{ type: 'layout', seat }] };
    }
    if (a.type === 'ready') {
      s.ready[seat] = true;
      const events: Event[] = [{ type: 'ready', seat }];
      if (s.ready[0] && s.ready[1]) {
        s.phase = 'play';
        s.turn = 0;
        events.push({ type: 'start' });
      }
      return { state: s, events };
    }
    return null;
  }
  if (s0.phase !== 'play' || seat !== s0.turn || a.type !== 'move') return null;
  if (!movesFrom(s0, a.from).includes(a.to)) return null;
  const pc0 = s0.cells[a.from];
  if (!pc0 || pc0.owner !== seat) return null;
  const s = clone(s0);
  const me = s.cells[a.from]!;
  const target = s.cells[a.to];
  const events: Event[] = [];
  me.moved = true;
  s.cells[a.from] = null;
  // туда-обратно
  const sh = s.shuttle[seat];
  if (sh.id === me.id && ((a.from === sh.a && a.to === sh.b) || (a.from === sh.b && a.to === sh.a))) sh.n++;
  else s.shuttle[seat] = { id: me.id, a: a.from, b: a.to, n: 1 };
  if (!target) {
    s.cells[a.to] = me;
    s.quiet++;
    events.push({ type: 'move', seat, from: a.from, to: a.to, id: me.id });
  } else {
    const res = fight(me.rank!, target.rank!);
    events.push({ type: 'battle', seat, from: a.from, to: a.to, att: me.rank!, def: target.rank!, res });
    s.quiet = 0;
    s.shuttle[seat] = { id: -1, a: -1, b: -1, n: 0 };
    if (res === 'win') {
      me.known = true;
      s.cells[a.to] = me;
      s.lost[target.owner].push(target.rank!);
    } else if (res === 'lose') {
      target.known = true;
      s.lost[seat].push(me.rank!);
    } else {
      s.cells[a.to] = null;
      s.lost[seat].push(me.rank!);
      s.lost[target.owner].push(target.rank!);
    }
    if (target.rank === FLAG) {
      s.last = [a.from, a.to];
      s.plies++;
      finish(s, seat, 'flag', events);
      return { state: s, events };
    }
  }
  s.last = [a.from, a.to];
  s.plies++;
  const other = 1 - seat;
  if (s.quiet >= QUIET) finish(s, null, 'quiet', events);
  else if (!anyMove(s, other)) {
    if (!anyMove(s, seat)) finish(s, null, 'both', events);
    else finish(s, seat, 'stuck', events);
  } else s.turn = other;
  void rng;
  return { state: s, events };
}

/** Что видят места seats: чужие нераскрытые фишки — без ранга (до конца партии). */
export function makeView(s: State, seats: number[] | 'all'): State {
  if (seats === 'all' || s.phase === 'over') return s;
  return {
    ...s,
    cells: s.cells.map((c) => (c && !seats.includes(c.owner) && !c.known ? { ...c, rank: null } : c)),
  };
}

export function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  if ((ev.type === 'swap' || ev.type === 'layout') && !seats.includes(ev.seat)) return null;
  return ev;
}
