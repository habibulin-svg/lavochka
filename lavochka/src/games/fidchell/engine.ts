/* Фидхел (fidchell) — древнеирландская игра «деревянной мудрости», правила без DOM. Подлинных правил не сохранилось,
 * играем по реконструкциям на доске 7×7 (как доска из Баллиндерри, 49 лунок). Все фишки ходят как ладья — по прямой
 * на сколько угодно пустых клеток; берут «в клещи»: ходом зажать чужую фишку между двумя своими по прямой.
 * Самому вставать между двумя чужими можно — так не берут.
 *   Ард-Ри: 16 бронзовых по краям против короля и 8 костяных вокруг него, первой ходит бронза. Король уходит на любую клетку края;
 *     взят, когда окружён с четырёх сторон (у трона — с трёх и трон). На трон встаёт только король, пустой трон
 *     враждебен всем (годится вместо второй фишки клещей). Король вооружён — помогает брать.
 *   Ланнах: та же расстановка, первой ходит бронза, король ходит лишь на одну клетку и уходит в угол; углы — только для короля и
 *     враждебны, как пустой трон.
 *   Равные силы: без короля, по 8 фишек (ряд у своего края и одна впереди); проигрывает оставшийся с одной фишкой.
 * Во всех — нет ходов — проигрыш; 200 ходов без исхода: в «равных силах» побеждает тот, у кого больше фишек, иначе ничья. */
import type { Options } from '../../core/types';

export type Kind = 'ardri' | 'lannach' | 'equal';
export type Look = 'ballinderry' | 'carved';

export interface Cfg {
  kind: Kind;
  look: Look;
}

export function cfgFrom(o: Options): Cfg {
  const k = o.kind;
  return {
    kind: k === 'lannach' || k === 'equal' ? k : 'ardri',
    look: o.look === 'carved' ? 'carved' : 'ballinderry',
  };
}

/** Бронза — место 0, кость — место 1, король — костяной (место 1). */
export const BRONZE = 1;
export const BONE = 2;
export const KING = 3;

export interface Rules {
  king: boolean;
  /** Король уходит: на край или в угол. */
  escape: 'edge' | 'corner' | null;
  /** Король ходит только на соседнюю клетку. */
  kingStep: boolean;
  /** Кто ходит первым. */
  first: number;
}

export const RULES: Record<Kind, Rules> = {
  ardri: { king: true, escape: 'edge', kingStep: false, first: 0 },
  lannach: { king: true, escape: 'corner', kingStep: true, first: 0 },
  equal: { king: false, escape: null, kingStep: false, first: 0 },
};

export const N = 7;
const C = 3;
export const THRONE = C * N + C;
export const LIMIT = 200;

export interface State {
  cfg: Cfg;
  board: number[];
  turn: number;
  ply: number;
  over: boolean;
  winner: number | null;
  last: number[];
  /** Сколько фишек взято у каждого места. */
  lost: [number, number];
}

export type Action = { type: 'move'; from: number; to: number };
export type Why = 'escape' | 'king' | 'stuck' | 'one' | 'long';
export type Event =
  | {
      type: 'move';
      seat: number;
      from: number;
      to: number;
      piece: number;
      taken: number[];
    }
  | { type: 'end'; winner: number | null; why: Why };

export const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < N && y < N ? y * N + x : -1);
export const sideOf = (v: number) => (v === BRONZE ? 0 : v ? 1 : -1);

export function isCorner(p: number): boolean {
  const x = p % N;
  const y = (p - x) / N;
  return (x === 0 || x === N - 1) && (y === 0 || y === N - 1);
}
export function isEdge(p: number): boolean {
  const x = p % N;
  const y = (p - x) / N;
  return x === 0 || y === 0 || x === N - 1 || y === N - 1;
}

/** Клетка только для короля: трон, а в Ланнахе ещё и углы. */
export function restricted(s: State, p: number): boolean {
  const r = RULES[s.cfg.kind];
  if (!r.king) return false;
  return p === THRONE || (r.escape === 'corner' && isCorner(p));
}

/** Клетка выхода короля. */
export function isEscape(s: State, p: number): boolean {
  const e = RULES[s.cfg.kind].escape;
  return e === 'corner' ? isCorner(p) : e === 'edge' ? isEdge(p) : false;
}

export function layout(kind: Kind): {
  b: [number, number][];
  w: [number, number][];
  king: boolean;
} {
  if (kind === 'equal') {
    const b: [number, number][] = [];
    const w: [number, number][] = [];
    for (let x = 0; x < N; x++) {
      b.push([x, N - 1]);
      w.push([x, 0]);
    }
    b.push([C, N - 2]);
    w.push([C, 1]);
    return { b, w, king: false };
  }
  // по краям — по три в середине стороны и одна перед ними; вокруг короля — квадрат 3×3
  const b: [number, number][] = [];
  for (const [x, y] of [
    [2, 0],
    [3, 0],
    [4, 0],
    [3, 1],
  ])
    b.push([x, y], [x, N - 1 - y], [y, x], [N - 1 - y, x]);
  const w: [number, number][] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) w.push([C + dx, C + dy]);
  return { b, w, king: true };
}

export function newState(cfg: Cfg): State {
  const L = layout(cfg.kind);
  const board = Array(N * N).fill(0);
  for (const [x, y] of L.b) board[at(x, y)] = BRONZE;
  for (const [x, y] of L.w) board[at(x, y)] = BONE;
  if (L.king) board[THRONE] = KING;
  return {
    cfg,
    board,
    turn: RULES[cfg.kind].first,
    ply: 0,
    over: false,
    winner: null,
    last: [],
    lost: [0, 0],
  };
}

export const setup = (_seats: number[], o: Options) => newState(cfgFrom(o));
export const toAct = (s: State) => (s.over ? [] : [s.turn]);

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Ходы фишки с клетки p. */
export function movesFrom(s: State, p: number): number[] {
  const king = s.board[p] === KING;
  const step = king && RULES[s.cfg.kind].kingStep;
  const out: number[] = [];
  const x0 = p % N;
  const y0 = (p - x0) / N;
  for (const [dx, dy] of DIRS) {
    let x = x0 + dx;
    let y = y0 + dy;
    while (x >= 0 && y >= 0 && x < N && y < N) {
      const q = y * N + x;
      if (s.board[q]) break;
      if (king || !restricted(s, q)) out.push(q);
      else if (q !== THRONE) break; // в угол нельзя, а через пустой трон пройти можно
      if (step) break;
      x += dx;
      y += dy;
    }
  }
  return out;
}

export function legal(s: State): Action[] {
  if (s.over) return [];
  const out: Action[] = [];
  s.board.forEach((v, p) => {
    if (sideOf(v) !== s.turn) return;
    for (const q of movesFrom(s, p)) out.push({ type: 'move', from: p, to: q });
  });
  return out;
}

function hasMove(s: State, side: number): boolean {
  for (let p = 0; p < N * N; p++) if (sideOf(s.board[p]) === side && movesFrom(s, p).length) return true;
  return false;
}

/** Враждебна ли клетка q фишке стороны side (как вторая половина клещей). */
function hostile(s: State, q: number, side: number): boolean {
  const v = s.board[q];
  if (v) return sideOf(v) !== side; // король вооружён
  return restricted(s, q);
}

export function count(s: State, side: number): number {
  let c = 0;
  for (const v of s.board) if (sideOf(v) === side && v !== KING) c++;
  return c;
}

/** Взят ли король: окружён с четырёх сторон бронзой (трон и, в Ланнахе, угол — за бронзу). */
function kingTaken(s: State): boolean {
  const k = s.board.indexOf(KING);
  if (k < 0) return false;
  const kx = k % N;
  const ky = (k - kx) / N;
  return DIRS.every(([dx, dy]) => {
    const q = at(kx + dx, ky + dy);
    return q >= 0 && (s.board[q] === BRONZE || (!s.board[q] && restricted(s, q)));
  });
}

export function step(s0: State, a: Action): { state: State; events: Event[] } {
  const s: State = {
    ...s0,
    board: s0.board.slice(),
    lost: [s0.lost[0], s0.lost[1]],
  };
  const seat = s0.turn;
  const piece = s.board[a.from];
  s.board[a.from] = 0;
  s.board[a.to] = piece;
  s.last = [a.from, a.to];
  const taken: number[] = [];
  const tx = a.to % N;
  const ty = (a.to - tx) / N;
  for (const [dx, dy] of DIRS) {
    const q = at(tx + dx, ty + dy);
    if (q < 0) continue;
    const v = s.board[q];
    if (!v || v === KING || sideOf(v) === seat) continue;
    const b = at(tx + 2 * dx, ty + 2 * dy);
    if (b >= 0 && hostile(s, b, 1 - seat)) taken.push(q);
  }
  for (const q of taken) {
    s.board[q] = 0;
    s.lost[1 - seat]++;
  }
  const events: Event[] = [{ type: 'move', seat, from: a.from, to: a.to, piece, taken }];
  s.ply++;
  const end = (winner: number | null, why: Why) => {
    s.over = true;
    s.winner = winner;
    events.push({ type: 'end', winner, why });
    return { state: s, events };
  };
  const r = RULES[s.cfg.kind];
  if (piece === KING && isEscape(s, a.to)) return end(1, 'escape');
  if (r.king && seat === 0 && kingTaken(s)) return end(0, 'king');
  if (!r.king && count(s, 1 - seat) <= 1) return end(seat, 'one');
  s.turn = 1 - seat;
  if (!hasMove(s, s.turn)) return end(seat, 'stuck');
  if (s.ply >= LIMIT) {
    if (r.king) return end(null, 'long');
    const a0 = count(s, 0);
    const a1 = count(s, 1);
    return end(a0 === a1 ? null : a0 > a1 ? 0 : 1, 'long');
  }
  return { state: s, events };
}

export function apply(s: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  if (s.over || seat !== s.turn || !a || a.type !== 'move') return null;
  if (sideOf(s.board[a.from]) !== seat || !movesFrom(s, a.from).includes(a.to)) return null;
  return step(s, a);
}
