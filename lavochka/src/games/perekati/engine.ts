/* Перекати-поле (А. Ю. Коровин, «Малыш», 1987) — правила без DOM.
 * У каждого 5 кубиков (в большом поле — 6); одна грань кубика другого цвета — «контрольная», «шляпка».
 * Кубики стоят в своём первом ряду шляпкой вверх; цель — перевести все на противоположную сторону, в клетки,
 * где стояли кубики соперника, и поставить шляпкой вверх. Кто первым — выиграл.
 * Ход — перекатить один свой кубик через ребро на свободную соседнюю клетку (не по диагонали): грани при этом
 * поворачиваются. Пропускать ход нельзя, перепрыгивать — тоже. Кубик на финишной клетке шляпкой вверх больше
 * не двигается. Нельзя больше двух раз повторять один и тот же ход (у нас: тот же кубик с той же клетки на ту же,
 * в том же положении — третий раз среди своих 8 последних ходов, если есть другой ход).
 * Нет хода (кубики заперты) — конец: выигрывает тот, кто поставил на финиш больше кубиков (поровну — ничья).
 * Место 0 — внизу (дом — нижний ряд), место 1 — вверху. Первым ходит тот, на кого выпал жребий. */
import type { Options, Rng } from '../../core/types';

export type Size = 'print' | 'malysh' | 'drawing';
export type Look = 'green' | 'blue' | 'paper';

export interface Cfg {
  size: Size;
  look: Look;
  /** Ширина (кубиков у каждого) и длина поля вместе со стартовыми рядами. */
  w: number;
  l: number;
}

/** Размеры: печатное поле (6×6 между стартовыми рядами), коробка «Малыша» (5×6), рисунок из правил (5×7). */
export const SIZES: Record<Size, [number, number]> = { print: [6, 8], malysh: [5, 6], drawing: [5, 7] };

export function cfgFrom(o: Options): Cfg {
  const size: Size = o.size === 'malysh' || o.size === 'drawing' ? o.size : 'print';
  const look: Look = o.look === 'blue' || o.look === 'paper' ? o.look : 'green';
  const [w, l] = SIZES[size];
  return { size, look, w, l };
}

/** Где шляпка: вверху, внизу, на северной (к верху доски), южной, восточной, западной грани. */
export const UP = 0;
export const DOWN = 1;
export const NORTH = 2;
export const SOUTH = 3;
export const EAST = 4;
export const WEST = 5;
export const FACE_RU = ['вверху', 'внизу', 'сбоку', 'сбоку', 'сбоку', 'сбоку'];

/** Направления катания: dx, dy. */
export const DIRS: [number, number][] = [
  [0, -1],
  [0, 1],
  [1, 0],
  [-1, 0],
];
/** Куда уходит шляпка при перекате в направлении d. */
const ROLL: number[][] = [
  // на север: верх → север → низ → юг → верх
  [NORTH, SOUTH, DOWN, UP, EAST, WEST],
  // на юг
  [SOUTH, NORTH, UP, DOWN, EAST, WEST],
  // на восток: верх → восток → низ → запад → верх
  [EAST, WEST, NORTH, SOUTH, DOWN, UP],
  // на запад
  [WEST, EAST, NORTH, SOUTH, UP, DOWN],
];
export const roll = (face: number, d: number) => ROLL[d][face];

/** Сколько ходов можно делать до подсчёта (на случай бесконечного топтания). */
export const PLY_LIMIT = 400;
/** Окно своих ходов для запрета повтора и сколько раз ход уже можно было сделать. */
const REPEAT_WINDOW = 8;
const REPEAT_MAX = 2;

export interface State {
  cfg: Cfg;
  /** −1 — пусто, иначе id кубика = seat * 8 + номер. */
  board: number[];
  /** Где шляпка у каждого кубика (по id). */
  face: number[];
  turn: number;
  ply: number;
  /** Свои последние ходы мест — ключи «откуда-куда-шляпка». */
  hist: [string[], string[]];
  over: boolean;
  /** null — ничья (или ещё идёт). */
  winner: number | null;
  why: Why | null;
  last: number[];
}

export type Action = { type: 'move'; from: number; to: number };
export type Why = 'all' | 'stuck' | 'limit';
export type Event =
  | { type: 'move'; seat: number; from: number; to: number; face: number; after: number; locked: boolean }
  | { type: 'end'; winner: number | null; why: Why; done: [number, number]; stuck?: number };

export const seatOf = (id: number) => (id >= 8 ? 1 : 0);
export const cubeId = (seat: number, i: number) => seat * 8 + i;
export const homeRow = (c: Cfg, seat: number) => (seat === 0 ? c.l - 1 : 0);
export const goalRow = (c: Cfg, seat: number) => (seat === 0 ? 0 : c.l - 1);
export const at = (c: Cfg, x: number, y: number) => y * c.w + x;
export const X = (c: Cfg, p: number) => p % c.w;
export const Y = (c: Cfg, p: number) => (p - (p % c.w)) / c.w;

export function newState(cfg: Cfg, first = 0): State {
  const board = new Array(cfg.w * cfg.l).fill(-1);
  const face = new Array(16).fill(UP);
  for (const seat of [0, 1]) for (let i = 0; i < cfg.w; i++) board[at(cfg, i, homeRow(cfg, seat))] = cubeId(seat, i);
  return { cfg, board, face, turn: first, ply: 0, hist: [[], []], over: false, winner: null, why: null, last: [] };
}

/** Кто ходит первым — жребий. */
export const setup = (o: Options, rng: Rng): State => newState(cfgFrom(o), rng.int(2));

export const toAct = (s: State) => (s.over ? [] : [s.turn]);

/** Кубик на клетке p стоит на финише шляпкой вверх — больше не двигается. */
export function locked(s: State, p: number): boolean {
  const id = s.board[p];
  return id >= 0 && s.face[id] === UP && Y(s.cfg, p) === goalRow(s.cfg, seatOf(id));
}

/** Сколько кубиков места уже на финише шляпкой вверх. */
export function done(s: State, seat: number): number {
  let n = 0;
  for (let p = 0; p < s.board.length; p++) if (s.board[p] >= 0 && seatOf(s.board[p]) === seat && locked(s, p)) n++;
  return n;
}

const key = (s: State, from: number, to: number) => `${from}-${to}-${s.face[s.board[from]]}`;

/** Ходы без запрета повтора. */
function raw(s: State, seat: number): Action[] {
  const c = s.cfg;
  const out: Action[] = [];
  for (let p = 0; p < s.board.length; p++) {
    const id = s.board[p];
    if (id < 0 || seatOf(id) !== seat || locked(s, p)) continue;
    const x = X(c, p);
    const y = Y(c, p);
    for (const [dx, dy] of DIRS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= c.w || ny < 0 || ny >= c.l) continue;
      const q = at(c, nx, ny);
      if (s.board[q] < 0) out.push({ type: 'move', from: p, to: q });
    }
  }
  return out;
}

/** Ход, который был бы третьим повтором (запрещён, если есть другие). */
export function repeated(s: State, seat: number, a: Action): boolean {
  const k = key(s, a.from, a.to);
  return s.hist[seat].filter((h) => h === k).length >= REPEAT_MAX;
}

export function legal(s: State): Action[] {
  if (s.over) return [];
  const all = raw(s, s.turn);
  const ok = all.filter((a) => !repeated(s, s.turn, a));
  return ok.length ? ok : all;
}

/** Направление хода from → to. */
export function dirOf(c: Cfg, from: number, to: number): number {
  const dx = X(c, to) - X(c, from);
  const dy = Y(c, to) - Y(c, from);
  return DIRS.findIndex(([a, b]) => a === dx && b === dy);
}

function finish(s: State, winner: number | null, why: Why, events: Event[], stuck?: number) {
  s.over = true;
  s.winner = winner;
  s.why = why;
  events.push({ type: 'end', winner, why, done: [done(s, 0), done(s, 1)], stuck });
}

/** Ход без проверки допустимости. */
export function step(s0: State, a: Action): { state: State; events: Event[] } {
  const c = s0.cfg;
  const s: State = { ...s0, board: s0.board.slice(), face: s0.face.slice(), hist: [s0.hist[0].slice(), s0.hist[1].slice()] };
  const seat = s0.turn;
  const events: Event[] = [];
  const id = s.board[a.from];
  const before = s.face[id];
  const h = s.hist[seat];
  h.push(key(s0, a.from, a.to));
  if (h.length > REPEAT_WINDOW) h.shift();
  s.face[id] = roll(before, dirOf(c, a.from, a.to));
  s.board[a.to] = id;
  s.board[a.from] = -1;
  s.last = [a.from, a.to];
  s.ply++;
  events.push({ type: 'move', seat, from: a.from, to: a.to, face: before, after: s.face[id], locked: locked(s, a.to) });
  if (done(s, seat) === c.w) {
    finish(s, seat, 'all', events);
    return { state: s, events };
  }
  s.turn = 1 - seat;
  if (!raw(s, s.turn).length) {
    const d0 = done(s, 0);
    const d1 = done(s, 1);
    finish(s, d0 === d1 ? null : d0 > d1 ? 0 : 1, 'stuck', events, s.turn);
  } else if (s.ply >= PLY_LIMIT) {
    const d0 = done(s, 0);
    const d1 = done(s, 1);
    finish(s, d0 === d1 ? null : d0 > d1 ? 0 : 1, 'limit', events);
  }
  return { state: s, events };
}

export function apply(s: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  if (s.over || seat !== s.turn || !a || a.type !== 'move') return null;
  return legal(s).some((m) => m.from === a.from && m.to === a.to) ? step(s, a) : null;
}

/** Сколько перекатов нужно кубику с клетки p в положении face, чтобы встать на клетку target шляпкой вверх
 * (без учёта других кубиков). Таблицы считаются один раз на размер поля. */
const tables = new Map<string, number[][]>();
export function distTable(c: Cfg): number[][] {
  const k = `${c.w}x${c.l}`;
  let t = tables.get(k);
  if (t) return t;
  t = [];
  const n = c.w * c.l;
  for (let target = 0; target < n; target++) {
    // обратный обход: из (target, UP) — перекаты назад
    const d = new Array(n * 6).fill(-1);
    d[target * 6 + UP] = 0;
    const q = [target * 6 + UP];
    for (let i = 0; i < q.length; i++) {
      const st = q[i];
      const p = (st / 6) | 0;
      const f = st % 6;
      for (let dir = 0; dir < 4; dir++) {
        // в st пришли перекатом в направлении dir из клетки p − dir, где шляпка была f0: roll(f0, dir) = f
        const px = X(c, p) - DIRS[dir][0];
        const py = Y(c, p) - DIRS[dir][1];
        if (px < 0 || px >= c.w || py < 0 || py >= c.l) continue;
        const f0 = ROLL[dir].indexOf(f);
        const prev = at(c, px, py) * 6 + f0;
        if (d[prev] < 0) {
          d[prev] = d[st] + 1;
          q.push(prev);
        }
      }
    }
    t.push(d);
  }
  tables.set(k, t);
  return t;
}
