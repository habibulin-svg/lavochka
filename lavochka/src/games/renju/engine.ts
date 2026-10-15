/* Рэндзю и гомоку — правила (без DOM). Доска 15×15, чёрные (место 0) ходят первыми — в центр.
 *
 * Рэндзю: побеждает ряд из пяти. Чёрным запрещены («фолы»): длинный ряд (6 и больше), вилка 4×4 (два «четыре» сразу),
 * вилка 3×3 (две открытые тройки сразу). Ход, который сразу даёт пятёрку, разрешён всегда. Белым можно всё,
 * и длинный ряд у них тоже победа. Тонкость «ложной тройки» (тройка, которую нельзя развить из-за фола) упрощена:
 * тройка считается открытой, если добавлением камня получается открытая четвёрка.
 * Гомоку: без фолов; «свободное» — пять и больше побеждают, «строгое» — ровно пять.
 * Доска заполнена — ничья.
 */
import type { Options } from '../../core/types';

export type Variant = 'renju' | 'free' | 'exact';

export interface Cfg {
  variant: Variant;
  size: 15 | 19;
}

export function cfgFrom(o: Options): Cfg {
  const variant: Variant = o.variant === 'free' || o.variant === 'exact' ? o.variant : 'renju';
  return { variant, size: Number(o.size) === 19 ? 19 : 15 };
}

export const BLACK = 1;
export const WHITE = 2;
const DIRS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

export interface State {
  cfg: Cfg;
  n: number;
  board: number[];
  turn: number;
  last: number;
  moves: number;
  over: boolean;
  winner: number | null;
  /** Пятёрка победителя (для показа). */
  line: number[];
}

export type Action = { type: 'play'; p: number };
export type Event = { type: 'play'; seat: number; p: number } | { type: 'end'; winner: number | null; line: number[] };

export function newState(cfg: Cfg): State {
  const n = cfg.size;
  return { cfg, n, board: Array(n * n).fill(0), turn: 0, last: -1, moves: 0, over: false, winner: null, line: [] };
}

export function setup(_seats: number[], opts: Options): State {
  return newState(cfgFrom(opts));
}

export const toAct = (s: State): number[] => (s.over ? [] : [s.turn]);
const colorOf = (seat: number) => (seat === 0 ? BLACK : WHITE);

/** Длина ряда цвета c через p в направлении d (p уже стоит). */
function run(b: number[], n: number, p: number, d: number[], c: number): number[] {
  const x0 = p % n;
  const y0 = (p - x0) / n;
  const cells = [p];
  for (const sgn of [1, -1]) {
    let x = x0 + d[0] * sgn;
    let y = y0 + d[1] * sgn;
    while (x >= 0 && y >= 0 && x < n && y < n && b[y * n + x] === c) {
      cells.push(y * n + x);
      x += d[0] * sgn;
      y += d[1] * sgn;
    }
  }
  return cells;
}

/** Пятёрка (точно 5 для чёрных в рэндзю и в строгом; 5+ иначе) через p. */
export function fiveThrough(b: number[], n: number, p: number, c: number, exact: boolean): number[] | null {
  for (const d of DIRS) {
    const r = run(b, n, p, d, c);
    if (exact ? r.length === 5 : r.length >= 5) return r;
  }
  return null;
}

const exactFor = (cfg: Cfg, c: number) => cfg.variant === 'exact' || (cfg.variant === 'renju' && c === BLACK);

/** Пункты линии через p в направлении d: от -4 до +4 (вне доски — -1). */
function lineCells(n: number, p: number, d: number[], span = 5): number[] {
  const x0 = p % n;
  const y0 = (p - x0) / n;
  const out: number[] = [];
  for (let k = -span; k <= span; k++) {
    const x = x0 + d[0] * k;
    const y = y0 + d[1] * k;
    out.push(x >= 0 && y >= 0 && x < n && y < n ? y * n + x : -1);
  }
  return out;
}

/** Сколько пустых пунктов в этом направлении дают чёрным ровно пятёрку через p. */
function fiveSpots(b: number[], n: number, p: number, d: number[]): number[] {
  const spots: number[] = [];
  for (const q of lineCells(n, p, d, 4)) {
    if (q < 0 || b[q] !== 0) continue;
    b[q] = BLACK;
    const r = run(b, n, q, d, BLACK);
    if (r.length === 5 && r.includes(p)) spots.push(q);
    b[q] = 0;
  }
  return spots;
}

/** Фол чёрных при ходе в p (камень уже стоит на доске b). */
export function foul(b: number[], n: number, p: number): 'overline' | 'four-four' | 'three-three' | null {
  if (fiveThrough(b, n, p, BLACK, true)) return null;
  for (const d of DIRS) if (run(b, n, p, d, BLACK).length >= 6) return 'overline';
  let fours = 0;
  let threes = 0;
  for (const d of DIRS) {
    const f = fiveSpots(b, n, p, d);
    if (f.length) {
      fours++;
      continue;
    }
    // открытая тройка: есть пустой пункт, после которого — открытая четвёрка (два способа сделать пятёрку)
    for (const q of lineCells(n, p, d, 4)) {
      if (q < 0 || b[q] !== 0) continue;
      b[q] = BLACK;
      const open = fiveSpots(b, n, p, d).length >= 2 && run(b, n, q, d, BLACK).length < 6;
      b[q] = 0;
      if (open) {
        threes++;
        break;
      }
    }
  }
  if (fours >= 2) return 'four-four';
  if (threes >= 2) return 'three-three';
  return null;
}

export function isLegal(s: State, p: number): boolean {
  if (s.over || !Number.isInteger(p) || p < 0 || p >= s.n * s.n || s.board[p]) return false;
  if (s.moves === 0 && s.cfg.variant === 'renju') return p === ((s.n * s.n) >> 1);
  if (s.cfg.variant === 'renju' && s.turn === 0) {
    const b = s.board.slice();
    b[p] = BLACK;
    if (foul(b, s.n, p)) return false;
  }
  return true;
}

export function apply(s0: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn || !a || a.type !== 'play' || !isLegal(s0, a.p)) return null;
  const s: State = { ...s0, board: s0.board.slice() };
  const c = colorOf(seat);
  s.board[a.p] = c;
  s.last = a.p;
  s.moves++;
  s.turn = 1 - seat;
  const ev: Event[] = [{ type: 'play', seat, p: a.p }];
  const five = fiveThrough(s.board, s.n, a.p, c, exactFor(s.cfg, c));
  if (five) {
    s.over = true;
    s.winner = seat;
    s.line = five;
    ev.push({ type: 'end', winner: seat, line: five });
  } else if (s.moves >= s.n * s.n || !hasMove(s)) {
    // доска заполнена (или чёрным некуда ходить — все пустые пункты фолы) — ничья
    s.over = true;
    ev.push({ type: 'end', winner: null, line: [] });
  }
  return { state: s, events: ev };
}

function hasMove(s: State): boolean {
  for (let p = 0; p < s.n * s.n; p++) if (!s.board[p] && isLegal(s, p)) return true;
  return false;
}

export const makeView = (s: State): State => s;
export { DIRS, run, lineCells, colorOf };
