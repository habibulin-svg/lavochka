/* Реверси — правила (без DOM). Доска n×n (6, 8, 10), чёрные (место 0) ходят первыми.
 *
 * Ход — поставить фишку так, чтобы между ней и другой своей фишкой по прямой (горизонталь, вертикаль, диагональ)
 * без промежутков стояли фишки соперника: все они переворачиваются. Нет такого хода — пропуск; нет ходов ни у кого
 * (или доска полна) — конец, у кого фишек больше, тот и выиграл (в «анти-реверси» — у кого меньше).
 * Начало: «крестом» — четыре фишки в центре накрест (как в советской коробке и в отелло);
 * «свободное» — как в реверси 1880-х: первые четыре фишки игроки ставят по очереди на центральные клетки, без переворотов.
 */
import type { Options } from '../../core/types';

export type Start = 'cross' | 'free';
export type Look = 'soviet' | 'green';

export interface Cfg {
  size: 6 | 8 | 10;
  start: Start;
  anti: boolean;
  look: Look;
}

export function cfgFrom(o: Options): Cfg {
  const sz = Number(o.size);
  return {
    size: sz === 6 || sz === 10 ? sz : 8,
    start: o.start === 'free' ? 'free' : 'cross',
    anti: o.anti === true,
    look: o.look === 'green' ? 'green' : 'soviet',
  };
}

export const BLACK = 1;
export const WHITE = 2;
export const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

export interface State {
  cfg: Cfg;
  n: number;
  board: number[];
  turn: number;
  last: number;
  /** Сколько фишек поставлено (для свободного начала). */
  moves: number;
  over: boolean;
  winner: number | null;
  /** Перевёрнутые последним ходом (для показа). */
  flipped: number[];
  /** Сколько фишек каждый взял из своей трубки. */
  placed: [number, number];
}

export type Action = { type: 'play'; p: number };
export type Event =
  | { type: 'play'; seat: number; p: number; flips: number[] }
  | { type: 'pass'; seat: number }
  | { type: 'end'; winner: number | null; score: [number, number] };

export const colorOf = (seat: number) => (seat === 0 ? BLACK : WHITE);

/** Центральные клетки 2×2. */
export function center(n: number): number[] {
  const c = n / 2;
  return [(c - 1) * n + c - 1, (c - 1) * n + c, c * n + c - 1, c * n + c];
}

export function newState(cfg: Cfg): State {
  const n = cfg.size;
  const board = Array(n * n).fill(0);
  let moves = 0;
  if (cfg.start === 'cross') {
    const [a, b, c, d] = center(n);
    board[a] = WHITE;
    board[d] = WHITE;
    board[b] = BLACK;
    board[c] = BLACK;
    moves = 4;
  }
  const placed: [number, number] = moves ? [2, 2] : [0, 0];
  return { cfg, n, board, turn: 0, last: -1, moves, over: false, winner: null, flipped: [], placed };
}

export function setup(_seats: number[], opts: Options): State {
  return newState(cfgFrom(opts));
}

export const toAct = (s: State): number[] => (s.over ? [] : [s.turn]);

/** Что перевернёт фишка цвета c на клетке p (пусто — ход невозможен). */
export function flipsAt(b: number[], n: number, p: number, c: number): number[] {
  if (b[p]) return [];
  const o = c === BLACK ? WHITE : BLACK;
  const x0 = p % n;
  const y0 = (p - x0) / n;
  const out: number[] = [];
  for (const [dx, dy] of DIRS) {
    let x = x0 + dx;
    let y = y0 + dy;
    const run: number[] = [];
    while (x >= 0 && y >= 0 && x < n && y < n && b[y * n + x] === o) {
      run.push(y * n + x);
      x += dx;
      y += dy;
    }
    if (run.length && x >= 0 && y >= 0 && x < n && y < n && b[y * n + x] === c) out.push(...run);
  }
  return out;
}

const opening = (s: State) => s.cfg.start === 'free' && s.moves < 4;

/** Все допустимые ходы цвета c. */
export function movesFor(s: State, c: number): number[] {
  const n = s.n;
  if (opening(s)) return center(n).filter((p) => !s.board[p]);
  const out: number[] = [];
  for (let p = 0; p < n * n; p++) if (!s.board[p] && flipsAt(s.board, n, p, c).length) out.push(p);
  return out;
}

export function isLegal(s: State, p: number): boolean {
  if (s.over || p < 0 || p >= s.n * s.n || s.board[p]) return false;
  if (opening(s)) return center(s.n).includes(p);
  return flipsAt(s.board, s.n, p, colorOf(s.turn)).length > 0;
}

export function count(b: number[]): [number, number] {
  let bl = 0;
  let wh = 0;
  for (const v of b) {
    if (v === BLACK) bl++;
    else if (v === WHITE) wh++;
  }
  return [bl, wh];
}

/** Победитель по счёту: место или null (ничья). */
export function winnerOf(b: number[], anti: boolean): number | null {
  const [bl, wh] = count(b);
  if (bl === wh) return null;
  return (bl > wh) !== anti ? 0 : 1;
}

export function apply(s0: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn || a?.type !== 'play' || !isLegal(s0, a.p)) return null;
  const s: State = { ...s0, board: s0.board.slice() };
  const c = colorOf(seat);
  const flips = opening(s0) ? [] : flipsAt(s.board, s.n, a.p, c);
  s.board[a.p] = c;
  for (const q of flips) s.board[q] = c;
  s.last = a.p;
  s.moves++;
  s.flipped = flips;
  s.placed = [s0.placed[0], s0.placed[1]];
  s.placed[seat]++;
  const events: Event[] = [{ type: 'play', seat, p: a.p, flips }];
  const next = 1 - seat;
  s.turn = next;
  if (movesFor(s, colorOf(next)).length) return { state: s, events };
  if (movesFor(s, c).length) {
    events.push({ type: 'pass', seat: next });
    s.turn = seat;
    return { state: s, events };
  }
  s.over = true;
  s.winner = winnerOf(s.board, s.cfg.anti);
  events.push({ type: 'end', winner: s.winner, score: count(s.board) });
  return { state: s, events };
}

export const makeView = (s: State): State => s;
