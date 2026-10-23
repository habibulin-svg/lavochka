/* Тафл (хнефатафл, «шахматы викингов») — правила без DOM. Нападающие (место 0) ходят первыми и окружают;
 * защитники (место 1) выводят короля из центра — в угол (Копенгаген, Фетлар, Брандубх) или на край (Таблут).
 * Все фигуры ходят как ладья: по прямой на сколько угодно пустых клеток. На трон (центр) и в углы встаёт только король;
 * пустой трон проходить можно. Взятие — «в клещи»: ходом поставить свою фигуру так, чтобы чужая оказалась между ней
 * и другой вашей фигурой (или враждебной клеткой: угол — всегда, трон — когда пуст, для нападающих — всегда) по прямой.
 * Король вооружён — помогает брать. Король взят: Копенгаген, Фетлар — окружён с четырёх сторон (у трона — с трёх и трон);
 * Брандубх — в клещи с двух сторон; Таблут — с двух сторон, а на троне и рядом с ним — со всех четырёх (трон за одну).
 * Копенгаген: «стенка» — ряд из двух и больше чужих фигур вдоль края, закрытый с обоих концов (угол годится) и с каждой
 * фигурой напротив вашей, снимается целиком (король в стенке не снимается).
 * Нет ходов — проигрыш. 300 ходов без исхода — ничья. */
import type { Options } from '../../core/types';

export type Kind = 'copenhagen' | 'fetlar' | 'tablut' | 'brandubh';
export type Look = 'carved' | 'shields';

export interface Cfg {
  kind: Kind;
  look: Look;
}

export function cfgFrom(o: Options): Cfg {
  const k = o.kind;
  return {
    kind: k === 'fetlar' || k === 'tablut' || k === 'brandubh' ? k : 'copenhagen',
    look: o.look === 'shields' ? 'shields' : 'carved',
  };
}

export const ATT = 1;
export const DEF = 2;
export const KING = 3;

export interface Rules {
  n: number;
  corners: boolean;
  /** Как взять короля: 4 — со всех сторон, 2 — в клещи, 'tablut' — по-таблутски. */
  kingCap: 4 | 2 | 'tablut';
  shield: boolean;
}

export const RULES: Record<Kind, Rules> = {
  copenhagen: { n: 11, corners: true, kingCap: 4, shield: true },
  fetlar: { n: 11, corners: true, kingCap: 4, shield: false },
  tablut: { n: 9, corners: false, kingCap: 'tablut', shield: false },
  brandubh: { n: 7, corners: true, kingCap: 2, shield: false },
};

export interface State {
  cfg: Cfg;
  n: number;
  board: number[];
  turn: number;
  ply: number;
  over: boolean;
  winner: number | null;
  last: number[];
  /** Сколько фигур взято у каждого места. */
  lost: [number, number];
}

export type Action = { type: 'move'; from: number; to: number };
export type Event =
  | { type: 'move'; seat: number; from: number; to: number; piece: number; taken: number[] }
  | { type: 'end'; winner: number | null; why: 'escape' | 'king' | 'stuck' | 'long' };

const LIMIT = 300;

function layout(kind: Kind): { att: [number, number][]; def: [number, number][]; n: number } {
  const n = RULES[kind].n;
  const sym = (pts: [number, number][]) => {
    const out: [number, number][] = [];
    for (const [a, b] of pts) out.push([a, b], [a, n - 1 - b], [b, a], [n - 1 - b, a]);
    return out;
  };
  if (kind === 'brandubh')
    return {
      n,
      att: sym([
        [3, 0],
        [3, 1],
      ]),
      def: [
        [3, 2],
        [3, 4],
        [2, 3],
        [4, 3],
      ],
    };
  if (kind === 'tablut')
    return {
      n,
      att: sym([
        [3, 0],
        [4, 0],
        [5, 0],
        [4, 1],
      ]),
      def: [
        [4, 2],
        [4, 3],
        [4, 5],
        [4, 6],
        [2, 4],
        [3, 4],
        [5, 4],
        [6, 4],
      ],
    };
  return {
    n,
    att: sym([
      [3, 0],
      [4, 0],
      [5, 0],
      [6, 0],
      [7, 0],
      [5, 1],
    ]),
    def: [
      [5, 3],
      [5, 4],
      [5, 6],
      [5, 7],
      [3, 5],
      [4, 5],
      [6, 5],
      [7, 5],
      [4, 4],
      [6, 4],
      [4, 6],
      [6, 6],
    ],
  };
}

export function newState(cfg: Cfg): State {
  const L = layout(cfg.kind);
  const n = L.n;
  const board = Array(n * n).fill(0);
  for (const [x, y] of L.att) board[y * n + x] = ATT;
  for (const [x, y] of L.def) board[y * n + x] = DEF;
  board[((n - 1) / 2) * n + (n - 1) / 2] = KING;
  return { cfg, n, board, turn: 0, ply: 0, over: false, winner: null, last: [], lost: [0, 0] };
}

export const setup = (_seats: number[], o: Options) => newState(cfgFrom(o));
export const toAct = (s: State) => (s.over ? [] : [s.turn]);

export const throneOf = (n: number) => ((n - 1) / 2) * n + (n - 1) / 2;
export function isCorner(n: number, p: number): boolean {
  const x = p % n;
  const y = (p - x) / n;
  return (x === 0 || x === n - 1) && (y === 0 || y === n - 1);
}
/** Клетка только для короля. */
export const restricted = (s: State, p: number) => p === throneOf(s.n) || (RULES[s.cfg.kind].corners && isCorner(s.n, p));
const sideOf = (v: number) => (v === ATT ? 0 : v ? 1 : -1);

/** Клетка выхода для короля. */
export function isEscape(s: State, p: number): boolean {
  if (RULES[s.cfg.kind].corners) return isCorner(s.n, p);
  const n = s.n;
  const x = p % n;
  const y = (p - x) / n;
  return x === 0 || y === 0 || x === n - 1 || y === n - 1;
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Ходы фигуры с клетки p. */
export function movesFrom(s: State, p: number): number[] {
  const n = s.n;
  const king = s.board[p] === KING;
  const throne = throneOf(n);
  const out: number[] = [];
  const x0 = p % n;
  const y0 = (p - x0) / n;
  for (const [dx, dy] of DIRS) {
    let x = x0 + dx;
    let y = y0 + dy;
    while (x >= 0 && y >= 0 && x < n && y < n) {
      const q = y * n + x;
      if (s.board[q]) break;
      if (king || !restricted(s, q)) out.push(q);
      else if (q !== throne) break; // через угол не пройти (угол и так на краю)
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

/** Есть ли у стороны хоть один ход (без построения списка). */
function hasMove(s: State, side: number): boolean {
  const n = s.n;
  for (let p = 0; p < n * n; p++) {
    if (sideOf(s.board[p]) !== side) continue;
    const x = p % n;
    const y = (p - x) / n;
    for (const [dx, dy] of DIRS) {
      const q = at(n, x + dx, y + dy);
      if (q < 0 || s.board[q]) continue;
      if (s.board[p] === KING || !restricted(s, q)) return true;
      if (q === throneOf(n) && at(n, x + 2 * dx, y + 2 * dy) >= 0 && !s.board[at(n, x + 2 * dx, y + 2 * dy)]) return true;
    }
  }
  return false;
}

/** Враждебна ли клетка q для фигуры стороны side (как вторая половина клещей). */
function hostile(s: State, q: number, side: number): boolean {
  const v = s.board[q];
  if (v) {
    if (sideOf(v) === side) return false;
    if (v === KING) return true; // король вооружён
    return true;
  }
  if (RULES[s.cfg.kind].corners && isCorner(s.n, q)) return true;
  if (q === throneOf(s.n)) return true;
  return false;
}

function at(n: number, x: number, y: number) {
  return x >= 0 && y >= 0 && x < n && y < n ? y * n + x : -1;
}

/** Взят ли король (после хода нападающих). */
function kingTaken(s: State, mover: number): boolean {
  const n = s.n;
  const k = s.board.indexOf(KING);
  if (k < 0) return true;
  const kx = k % n;
  const ky = (k - kx) / n;
  const throne = throneOf(n);
  const nb = DIRS.map(([dx, dy]) => at(n, kx + dx, ky + dy));
  const enclosed = (q: number) => q >= 0 && (s.board[q] === ATT || (q === throne && !s.board[q]));
  const rule = RULES[s.cfg.kind].kingCap;
  const nearThrone = k === throne || nb.includes(throne);
  if (rule === 4 || (rule === 'tablut' && nearThrone)) return nb.every(enclosed);
  // в клещи: ходившая фигура и напротив неё — нападающий или враждебная клетка
  const mx = mover % n;
  const my = (mover - mx) / n;
  const dx = kx - mx;
  const dy = ky - my;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return false;
  const far = at(n, kx + dx, ky + dy);
  if (far < 0) return false;
  return s.board[far] === ATT || (!s.board[far] && (far === throne || (RULES[s.cfg.kind].corners && isCorner(n, far))));
}

/** Применить ход без проверки. */
export function step(s0: State, a: Action): { state: State; events: Event[] } {
  const n = s0.n;
  const s: State = { ...s0, board: s0.board.slice(), lost: [s0.lost[0], s0.lost[1]] };
  const seat = s0.turn;
  const piece = s.board[a.from];
  s.board[a.from] = 0;
  s.board[a.to] = piece;
  s.last = [a.from, a.to];
  const taken: number[] = [];
  const tx = a.to % n;
  const ty = (a.to - tx) / n;
  for (const [dx, dy] of DIRS) {
    const q = at(n, tx + dx, ty + dy);
    if (q < 0) continue;
    const v = s.board[q];
    if (!v || v === KING || sideOf(v) === seat) continue;
    const b = at(n, tx + 2 * dx, ty + 2 * dy);
    if (b >= 0 && hostile(s, b, 1 - seat)) taken.push(q);
  }
  if (RULES[s.cfg.kind].shield) taken.push(...shieldwall(s, a.to, seat).filter((q) => !taken.includes(q)));
  for (const q of taken) {
    s.board[q] = 0;
    s.lost[1 - seat]++;
  }
  const events: Event[] = [{ type: 'move', seat, from: a.from, to: a.to, piece, taken }];
  s.ply++;
  const end = (winner: number | null, why: 'escape' | 'king' | 'stuck' | 'long') => {
    s.over = true;
    s.winner = winner;
    events.push({ type: 'end', winner, why });
    return { state: s, events };
  };
  if (piece === KING && isEscape(s, a.to)) return end(1, 'escape');
  if (seat === 0 && kingTaken(s, a.to)) return end(0, 'king');
  s.turn = 1 - seat;
  if (!hasMove(s, s.turn)) return end(seat, 'stuck');
  if (s.ply >= LIMIT) return end(null, 'long');
  return { state: s, events };
}

/** Копенгагенская «стенка»: ход на край закрывает ряд чужих фигур вдоль края. */
function shieldwall(s: State, to: number, seat: number): number[] {
  const n = s.n;
  const tx = to % n;
  const ty = (to - tx) / n;
  const out: number[] = [];
  const edges: [number, number, number, number][] = []; // направление вдоль края и «внутрь»
  if (ty === 0 || ty === n - 1) edges.push([1, 0, 0, ty === 0 ? 1 : -1], [-1, 0, 0, ty === 0 ? 1 : -1]);
  if (tx === 0 || tx === n - 1) edges.push([0, 1, tx === 0 ? 1 : -1, 0], [0, -1, tx === 0 ? 1 : -1, 0]);
  const mine = (q: number) => q >= 0 && sideOf(s.board[q]) === seat;
  for (const [dx, dy, ix, iy] of edges) {
    const row: number[] = [];
    let x = tx + dx;
    let y = ty + dy;
    let q = at(n, x, y);
    while (q >= 0 && s.board[q] && sideOf(s.board[q]) === 1 - seat) {
      row.push(q);
      x += dx;
      y += dy;
      q = at(n, x, y);
    }
    if (row.length < 2 || q < 0) continue;
    const closed = mine(q) || (!s.board[q] && RULES[s.cfg.kind].corners && isCorner(n, q));
    if (!closed) continue;
    const faced = row.every((r) => {
      const rx = r % n;
      const ry = (r - rx) / n;
      return mine(at(n, rx + ix, ry + iy));
    });
    if (faced) for (const r of row) if (s.board[r] !== KING) out.push(r);
  }
  return out;
}

export function apply(s: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  if (s.over || seat !== s.turn || !a || a.type !== 'move') return null;
  if (sideOf(s.board[a.from]) !== seat || !movesFrom(s, a.from).includes(a.to)) return null;
  return step(s, a);
}
