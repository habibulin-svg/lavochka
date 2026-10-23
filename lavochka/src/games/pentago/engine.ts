/* Пентаго (Томас Флодён, 2005) — правила без DOM.
 * Доска 6×6 из четырёх квадрантов 3×3, которые поворачиваются. Ход — поставить шарик на пустую лунку, затем
 * повернуть любой квадрант на четверть оборота по часовой или против (пустой — тоже можно). Побеждает тот, у кого
 * пять шариков в ряд — по горизонтали, вертикали или диагонали; если ряд сложился сразу после постановки, крутить
 * уже не нужно. Ряд после поворота у обоих — ничья; доска заполнена без ряда — ничья.
 * Большая доска 9×9 из девяти квадрантов (Pentago XL) — на 2–4 игроков, ход по кругу, те же пять в ряд; квадрант крутят
 * только по часовой, а если ряд после поворота сложился у нескольких — победа всем им.
 * «Поворот по желанию» — домашнее облегчение: квадрант можно не крутить. */
import type { Options } from '../../core/types';

export type Look = 'wood' | 'stone';

export interface Cfg {
  /** Сторона доски: 6 или 9; квадрантов по стороне — size / 3. */
  size: number;
  /** Сколько в ряд для победы. */
  line: number;
  /** Можно не поворачивать. */
  free: boolean;
  look: Look;
}

export function cfgFrom(o: Options): Cfg {
  const size = Number(o.size) === 9 ? 9 : 6;
  return { size, line: 5, free: !!o.free, look: o.look === 'stone' ? 'stone' : 'wood' };
}

export interface State {
  cfg: Cfg;
  /** −1 — пусто, иначе место. */
  board: number[];
  /** Места за столом по порядку хода. */
  order: number[];
  turn: number;
  phase: 'place' | 'twist';
  ply: number;
  over: boolean;
  /** Победители (пусто — ничья). */
  winners: number[];
  why: Why | null;
  /** Последняя постановка и поворот (для подсветки). */
  last: number[];
  twist: { q: number; dir: number } | null;
  /** Ряд победителя (клетки) — для подсветки. */
  row: number[];
}

/** Поставить шарик; повернуть квадрант q (dir: 1 — по часовой, −1 — против); q = −1 — не крутить (если можно). */
export type Action = { type: 'place'; p: number } | { type: 'twist'; q: number; dir: number };
export type Why = 'line' | 'both' | 'full';
export type Event =
  | { type: 'place'; seat: number; p: number }
  | { type: 'twist'; seat: number; q: number; dir: number }
  | { type: 'end'; winners: number[]; why: Why; row: number[] };

export const quads = (c: Cfg) => (c.size / 3) * (c.size / 3);
export const X = (c: Cfg, p: number) => p % c.size;
export const Y = (c: Cfg, p: number) => (p - (p % c.size)) / c.size;
export const quadOf = (c: Cfg, p: number) => Math.floor(Y(c, p) / 3) * (c.size / 3) + Math.floor(X(c, p) / 3);

/** Окна длины line по всем направлениям (кэш по размеру). */
const winCache = new Map<string, Int16Array[]>();
export function windows(c: Cfg): Int16Array[] {
  const k = `${c.size}:${c.line}`;
  let w = winCache.get(k);
  if (w) return w;
  w = [];
  const n = c.size;
  const L = c.line;
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ]) {
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const ex = x + dx * (L - 1);
        const ey = y + dy * (L - 1);
        if (ex < 0 || ex >= n || ey < 0 || ey >= n) continue;
        const cells = new Int16Array(L);
        for (let i = 0; i < L; i++) cells[i] = (y + dy * i) * n + x + dx * i;
        w.push(cells);
      }
  }
  winCache.set(k, w);
  return w;
}

/** Поворот квадранта q на доске b (копия). */
export function rotate(c: Cfg, b: number[], q: number, dir: number): number[] {
  const out = b.slice();
  const k = c.size / 3;
  const ox = (q % k) * 3;
  const oy = Math.floor(q / k) * 3;
  for (let r = 0; r < 3; r++)
    for (let col = 0; col < 3; col++) {
      // по часовой: (col, r) → (2 − r, col); против: (col, r) → (r, 2 − col)
      const nc = dir > 0 ? 2 - r : r;
      const nr = dir > 0 ? col : 2 - col;
      out[(oy + nr) * c.size + ox + nc] = b[(oy + r) * c.size + ox + col];
    }
  return out;
}

/** Не меняется ли квадрант от поворота (пустой или один шарик в середине). */
export function still(c: Cfg, b: number[], q: number): boolean {
  const k = c.size / 3;
  const ox = (q % k) * 3;
  const oy = Math.floor(q / k) * 3;
  for (let r = 0; r < 3; r++) for (let col = 0; col < 3; col++) if ((r !== 1 || col !== 1) && b[(oy + r) * c.size + ox + col] >= 0) return false;
  return true;
}

/** Ряды мест: место → клетки первого найденного ряда. */
export function lines(c: Cfg, b: number[]): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const w of windows(c)) {
    const v = b[w[0]];
    if (v < 0 || out.has(v)) continue;
    let ok = true;
    for (let i = 1; i < w.length && ok; i++) if (b[w[i]] !== v) ok = false;
    if (ok) out.set(v, Array.from(w));
  }
  return out;
}

export function newState(cfg: Cfg, order: number[]): State {
  return { cfg, board: new Array(cfg.size * cfg.size).fill(-1), order, turn: order[0], phase: 'place', ply: 0, over: false, winners: [], why: null, last: [], twist: null, row: [] };
}

export const setup = (seats: number[], o: Options) => newState(cfgFrom(o), seats.slice().sort((a, b) => a - b));
export const toAct = (s: State) => (s.over ? [] : [s.turn]);

/** Направления поворота: на большой доске — только по часовой. */
export const dirs = (c: Cfg) => (c.size === 9 ? [1] : [1, -1]);

const nextSeat = (s: State) => s.order[(s.order.indexOf(s.turn) + 1) % s.order.length];

export function legal(s: State): Action[] {
  if (s.over) return [];
  const c = s.cfg;
  if (s.phase === 'place') {
    const out: Action[] = [];
    for (let p = 0; p < s.board.length; p++) if (s.board[p] < 0) out.push({ type: 'place', p });
    return out;
  }
  const out: Action[] = [];
  for (let q = 0; q < quads(c); q++) for (const dir of dirs(c)) out.push({ type: 'twist', q, dir });
  if (c.free) out.push({ type: 'twist', q: -1, dir: 0 });
  return out;
}

function finish(s: State, winners: number[], why: Why, row: number[], events: Event[]) {
  s.over = true;
  s.winners = winners;
  s.why = why;
  s.row = row;
  events.push({ type: 'end', winners, why, row });
}

/** Действие без проверки. */
export function step(s0: State, a: Action): { state: State; events: Event[] } {
  const c = s0.cfg;
  const s: State = { ...s0, board: s0.board.slice() };
  const seat = s0.turn;
  const events: Event[] = [];
  s.ply++;
  if (a.type === 'place') {
    s.board[a.p] = seat;
    s.last = [a.p];
    s.twist = null;
    events.push({ type: 'place', seat, p: a.p });
    const l = lines(c, s.board).get(seat);
    if (l) {
      finish(s, [seat], 'line', l, events);
      return { state: s, events };
    }
    s.phase = 'twist';
    return { state: s, events };
  }
  if (a.q >= 0) {
    s.board = rotate(c, s.board, a.q, a.dir);
    // отметка постановки едет вместе с квадрантом
    if (s.last.length && quadOf(c, s.last[0]) === a.q) s.last = [rotate(c, s.board.map((_, i) => i), a.q, a.dir).indexOf(s.last[0])];
    s.twist = { q: a.q, dir: a.dir };
    events.push({ type: 'twist', seat, q: a.q, dir: a.dir });
  } else {
    s.twist = null;
    events.push({ type: 'twist', seat, q: -1, dir: 0 });
  }
  const ls = lines(c, s.board);
  if (ls.size === 1) {
    const [w, row] = [...ls.entries()][0];
    finish(s, [w], 'line', row, events);
  } else if (ls.size > 1) {
    // у двоих — ничья; на большой доске — победа всем, у кого ряд
    if (c.size === 9) finish(s, [...ls.keys()].sort((a, b) => a - b), 'line', [...ls.values()].flat(), events);
    else finish(s, [], 'both', [...ls.values()].flat(), events);
  }
  else if (s.board.every((v) => v >= 0)) finish(s, [], 'full', [], events);
  else {
    s.phase = 'place';
    s.turn = nextSeat(s);
  }
  return { state: s, events };
}

export function apply(s: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  if (s.over || seat !== s.turn || !a) return null;
  if (a.type === 'place') {
    if (s.phase !== 'place' || !Number.isInteger(a.p) || a.p < 0 || a.p >= s.board.length || s.board[a.p] >= 0) return null;
    return step(s, a);
  }
  if (a.type !== 'twist' || s.phase !== 'twist') return null;
  if (a.q === -1 ? !s.cfg.free : !(Number.isInteger(a.q) && a.q >= 0 && a.q < quads(s.cfg) && dirs(s.cfg).includes(a.dir))) return null;
  return step(s, a);
}
