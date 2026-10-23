/* Гекс — правила (без DOM). Ромб n×n из шестиугольников (9, 11, 13). Чёрные (место 0) ходят первыми и соединяют
 * свои стороны — верхнюю и нижнюю (ряды 0 и n−1), белые — левую и правую (столбцы 0 и n−1). Камень ставят на любую пустую
 * клетку, камни не снимают. Ничьих не бывает: заполненная доска всегда соединяет чьи-то стороны.
 * Правило обмена (по желанию): после первого хода чёрных белые могут «забрать» этот ход — камень становится белым
 * и отражается к их сторонам (клетка x,y → y,x), дальше снова ходят чёрные. Так первому ходу нет смысла быть слишком сильным.
 * Клетки: p = y·n + x; соседи — (±1,0), (0,±1), (+1,−1), (−1,+1). */
import type { Options } from '../../core/types';

export interface Cfg {
  size: 9 | 11 | 13;
  swap: boolean;
}

export function cfgFrom(o: Options): Cfg {
  const sz = Number(o.size);
  return { size: sz === 9 || sz === 13 ? sz : 11, swap: o.swap !== false };
}

export const BLACK = 1;
export const WHITE = 2;
export const NB = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, -1],
  [-1, 1],
];

export interface State {
  cfg: Cfg;
  n: number;
  board: number[];
  turn: number;
  last: number;
  moves: number;
  /** Белые воспользовались обменом. */
  swapped: boolean;
  over: boolean;
  winner: number | null;
  /** Цепочка победителя (для показа). */
  path: number[];
}

export type Action = { type: 'play'; p: number } | { type: 'swap' };
export type Event = { type: 'play'; seat: number; p: number } | { type: 'swap'; from: number; to: number } | { type: 'end'; winner: number; path: number[] };

export const colorOf = (seat: number) => (seat === 0 ? BLACK : WHITE);

export function newState(cfg: Cfg): State {
  const n = cfg.size;
  return { cfg, n, board: Array(n * n).fill(0), turn: 0, last: -1, moves: 0, swapped: false, over: false, winner: null, path: [] };
}

export function setup(_seats: number[], opts: Options): State {
  return newState(cfgFrom(opts));
}

export const toAct = (s: State): number[] => (s.over ? [] : [s.turn]);

export function neighbors(n: number, p: number): number[] {
  const x = p % n;
  const y = (p - x) / n;
  const out: number[] = [];
  for (const [dx, dy] of NB) {
    const xx = x + dx;
    const yy = y + dy;
    if (xx >= 0 && yy >= 0 && xx < n && yy < n) out.push(yy * n + xx);
  }
  return out;
}

/** Цепочка цвета c от своей стороны до другой (кратчайшая по камням) или null. */
export function connection(b: number[], n: number, c: number): number[] | null {
  const prev = new Map<number, number>();
  const q: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = c === BLACK ? i : i * n;
    if (b[p] === c) {
      prev.set(p, -1);
      q.push(p);
    }
  }
  for (let k = 0; k < q.length; k++) {
    const p = q[k];
    const x = p % n;
    const y = (p - x) / n;
    if ((c === BLACK ? y : x) === n - 1) {
      const path: number[] = [];
      for (let t = p; t >= 0; t = prev.get(t)!) path.push(t);
      return path;
    }
    for (const r of neighbors(n, p))
      if (b[r] === c && !prev.has(r)) {
        prev.set(r, p);
        q.push(r);
      }
  }
  return null;
}

export const canSwap = (s: State) => s.cfg.swap && !s.over && s.moves === 1 && s.turn === 1 && !s.swapped;

export function isLegal(s: State, p: number): boolean {
  return !s.over && p >= 0 && p < s.n * s.n && !s.board[p];
}

export function apply(s0: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn || !a) return null;
  const n = s0.n;
  const s: State = { ...s0, board: s0.board.slice() };
  if (a.type === 'swap') {
    if (!canSwap(s0)) return null;
    const from = s0.last;
    const x = from % n;
    const y = (from - x) / n;
    const to = x * n + y;
    s.board[from] = 0;
    s.board[to] = WHITE;
    s.last = to;
    s.moves++;
    s.swapped = true;
    s.turn = 0;
    return { state: s, events: [{ type: 'swap', from, to }] };
  }
  if (a.type !== 'play' || !isLegal(s0, a.p)) return null;
  const c = colorOf(seat);
  s.board[a.p] = c;
  s.last = a.p;
  s.moves++;
  const events: Event[] = [{ type: 'play', seat, p: a.p }];
  const path = connection(s.board, n, c);
  if (path) {
    s.over = true;
    s.winner = seat;
    s.path = path;
    events.push({ type: 'end', winner: seat, path });
  } else s.turn = 1 - seat;
  return { state: s, events };
}

export const makeView = (s: State): State => s;
