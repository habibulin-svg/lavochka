/* Блоки — правила (без DOM). У каждого цвета 21 фигурка (полимино из 1–5 клеток, всего 89 клеток).
 *
 * Классика: поле 20×20, четыре цвета ходят по кругу (синий, жёлтый, красный, зелёный), каждый начинает со своего угла.
 *   вчетвером — у каждого свой цвет; вдвоём — у каждого по два цвета (синий + красный, жёлтый + зелёный);
 *   втроём — у каждого свой цвет, а зелёный ходят все по очереди (его очки не считаются).
 * Дуо: поле 14×14, два цвета, начальные клетки — 5-5 и 10-10 (ближе к центру).
 * Первая фигурка цвета накрывает его начальную клетку; дальше каждая новая касается своих только уголком — и ни одной стороной.
 * Чужих можно касаться как угодно. Ходить некуда — цвет выбывает. Конец — когда не ходит ни один цвет.
 * Счёт: минус клетка за каждую невыложенную клетку; выложил всё — +15, а если последней была одиночная клетка — ещё +5.
 */
import type { Options } from '../../core/types';

export type Mode = 'classic' | 'three' | 'duo';

/** 21 фигурка: клетки [строка, столбец]. Порядок — по размеру (как в коробке). */
export const PIECES: [number, number][][] = [
  [[0, 0]], // 1
  [[0, 0], [0, 1]], // 2
  [[0, 0], [0, 1], [0, 2]], // I3
  [[0, 0], [0, 1], [1, 0]], // V3
  [[0, 0], [0, 1], [0, 2], [0, 3]], // I4
  [[0, 0], [0, 1], [0, 2], [1, 0]], // L4
  [[0, 0], [0, 1], [0, 2], [1, 1]], // T4
  [[0, 0], [0, 1], [1, 0], [1, 1]], // O4
  [[0, 0], [0, 1], [1, 1], [1, 2]], // Z4
  [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]], // I5
  [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0]], // L5
  [[0, 0], [0, 1], [0, 2], [1, 2], [1, 3]], // N5
  [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1]], // P5
  [[0, 0], [0, 1], [0, 2], [1, 1], [2, 1]], // T5
  [[0, 0], [0, 2], [1, 0], [1, 1], [1, 2]], // U5
  [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]], // V5
  [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2]], // W5
  [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]], // X5
  [[0, 0], [0, 1], [0, 2], [0, 3], [1, 1]], // Y5
  [[0, 0], [0, 1], [1, 1], [2, 1], [2, 2]], // Z5
  [[0, 1], [1, 0], [1, 1], [1, 2], [2, 2]], // F5
];
export const PIECE_SIZE = PIECES.map((p) => p.length);
export const TOTAL = PIECE_SIZE.reduce((a, b) => a + b, 0);

/** Все различные повороты и отражения фигурки (клетки нормализованы к 0,0 и отсортированы). */
export const ORIENTS: [number, number][][][] = PIECES.map((cells) => {
  const out: [number, number][][] = [];
  const seen = new Set<string>();
  let cur = cells;
  for (let flip = 0; flip < 2; flip++) {
    for (let rot = 0; rot < 4; rot++) {
      const r0 = Math.min(...cur.map((c) => c[0]));
      const c0 = Math.min(...cur.map((c) => c[1]));
      const norm = cur.map(([r, c]) => [r - r0, c - c0] as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const k = norm.join(';');
      if (!seen.has(k)) seen.add(k), out.push(norm);
      cur = cur.map(([r, c]) => [c, -r] as [number, number]); // поворот на 90°
    }
    cur = cells.map(([r, c]) => [r, -c] as [number, number]); // отражение
  }
  return out;
});

export interface Cfg {
  mode: Mode;
  n: number;
  /** Какие цвета в игре (0 синий, 1 жёлтый, 2 красный, 3 зелёный). */
  colors: number[];
  /** Начальная клетка каждого цвета. */
  start: Record<number, number>;
}

export function cfgFrom(o: Options): Cfg {
  const mode: Mode = o.mode === 'duo' ? 'duo' : o.mode === 'three' ? 'three' : 'classic';
  if (mode === 'duo') {
    const n = 14;
    return { mode, n, colors: [0, 1], start: { 0: 4 * n + 4, 1: 9 * n + 9 } };
  }
  const n = 20;
  return { mode, n, colors: [0, 1, 2, 3], start: { 0: 0, 1: n - 1, 2: n * n - 1, 3: (n - 1) * n } };
}

export interface State {
  cfg: Cfg;
  /** Игроков за столом. */
  players: number;
  /** Клетка → цвет (-1 пусто). */
  board: number[];
  /** Оставшиеся фигурки каждого цвета (номера). */
  hand: Record<number, number[]>;
  /** Цвет выбыл (некуда ходить). */
  out: Record<number, boolean>;
  /** Последняя выложенная фигурка цвета (для бонуса за одиночную клетку). */
  lastPiece: Record<number, number | null>;
  /** Чей цвет ходит (индекс в cfg.colors). */
  ci: number;
  /** Втроём: кто ходит общим (зелёным) цветом в следующий раз. */
  shared: number;
  ply: number;
  last: { color: number; cells: number[] } | null;
  over: boolean;
  scores: number[] | null;
}

export type View = State;
export type Action = { type: 'place'; piece: number; cells: number[] } | { type: 'pass' };
export type Event =
  | { type: 'place'; seat: number; color: number; piece: number; cells: number[] }
  | { type: 'out'; color: number }
  | { type: 'end'; scores: number[] };

export function newState(cfg: Cfg, players: number): State {
  const hand: Record<number, number[]> = {};
  const out: Record<number, boolean> = {};
  const lastPiece: Record<number, number | null> = {};
  for (const c of cfg.colors) (hand[c] = PIECES.map((_, i) => i)), (out[c] = false), (lastPiece[c] = null);
  return { cfg, players, board: new Array(cfg.n * cfg.n).fill(-1), hand, out, lastPiece, ci: 0, shared: 0, ply: 0, last: null, over: false, scores: null };
}

/** Игроков за столом: в Дуо всегда двое, «на троих» — трое (лишние места просто не ходят). */
export function setup(opts: Options, players: number): State {
  const cfg = cfgFrom(opts);
  return newState(cfg, cfg.mode === 'duo' ? 2 : cfg.mode === 'three' ? 3 : Math.min(4, Math.max(2, players)));
}

export const color = (s: State) => s.cfg.colors[s.ci];

/** Чей цвет: место игрока, который им ходит сейчас. */
export function ownerOf(s: State, col: number): number {
  if (s.cfg.mode === 'duo') return col;
  if (s.players === 4) return col;
  if (s.players === 2) return col % 2;
  return col === 3 ? s.shared : col; // втроём зелёный — по очереди
}

/** Цвета, которые считаются игроку (втроём общий зелёный — ничей). */
export function colorsOf(s: State, seat: number): number[] {
  if (s.cfg.mode === 'duo' || s.players === 4) return [seat];
  if (s.players === 2) return [seat, seat + 2];
  return [seat];
}

export const toAct = (s: State): number[] => (s.over ? [] : [ownerOf(s, color(s))]);

const nb4 = (n: number, c: number) => {
  const r = Math.floor(c / n);
  const k = c % n;
  const o: number[] = [];
  if (r > 0) o.push(c - n);
  if (r < n - 1) o.push(c + n);
  if (k > 0) o.push(c - 1);
  if (k < n - 1) o.push(c + 1);
  return o;
};
const diag = (n: number, c: number) => {
  const r = Math.floor(c / n);
  const k = c % n;
  const o: number[] = [];
  for (const [dr, dk] of [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ]) {
    const rr = r + dr;
    const kk = k + dk;
    if (rr >= 0 && rr < n && kk >= 0 && kk < n) o.push(rr * n + kk);
  }
  return o;
};

/** Клетки, от которых цвет может расти: пустые, касающиеся своих уголком и ни одной стороной (или начальная клетка). */
export function anchors(s: State, col: number): number[] {
  const n = s.cfg.n;
  const st = s.cfg.start[col];
  if (s.hand[col].length === PIECES.length) return s.board[st] === -1 ? [st] : [];
  const out = new Set<number>();
  for (let c = 0; c < n * n; c++) {
    if (s.board[c] !== col) continue;
    for (const d of diag(n, c)) if (s.board[d] === -1 && !nb4(n, d).some((x) => s.board[x] === col)) out.add(d);
  }
  return [...out];
}

/** Можно ли положить фигурку цвета col на эти клетки. */
export function fits(s: State, col: number, cells: number[]): boolean {
  const n = s.cfg.n;
  for (const c of cells) {
    if (c < 0 || c >= n * n || s.board[c] !== -1) return false;
    if (nb4(n, c).some((x) => s.board[x] === col)) return false;
  }
  const an = new Set(anchors(s, col));
  return cells.some((c) => an.has(c));
}

/** Клетки фигурки p в положении o, если её клетку k поставить на клетку at (или null — вылезает за край). */
export function cellsAt(n: number, p: number, o: number, k: number, at: number): number[] | null {
  const sh = ORIENTS[p][o];
  const [kr, kc] = sh[k];
  const ar = Math.floor(at / n);
  const ac = at % n;
  const out: number[] = [];
  for (const [r, c] of sh) {
    const rr = ar + r - kr;
    const cc = ac + c - kc;
    if (rr < 0 || rr >= n || cc < 0 || cc >= n) return null;
    out.push(rr * n + cc);
  }
  return out;
}

/** Все ходы цвета (без повторов по набору клеток). limit — для быстрой проверки «есть ли ход». */
export function moves(s: State, col: number, limit = Infinity, only?: number[]): Action[] {
  const n = s.cfg.n;
  const an = anchors(s, col);
  if (!an.length) return [];
  const out: Action[] = [];
  const seen = new Set<string>();
  for (const p of only ?? s.hand[col]) {
    for (let o = 0; o < ORIENTS[p].length; o++) {
      const sh = ORIENTS[p][o];
      for (const at of an) {
        for (let k = 0; k < sh.length; k++) {
          const cells = cellsAt(n, p, o, k, at);
          if (!cells) continue;
          let ok = true;
          for (const c of cells) {
            if (s.board[c] !== -1 || nb4(n, c).some((x) => s.board[x] === col)) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
          const key = `${p}:${[...cells].sort((a, b) => a - b).join(',')}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ type: 'place', piece: p, cells });
          if (out.length >= limit) return out;
        }
      }
    }
  }
  return out;
}

export function legal(s: State): Action[] {
  if (s.over) return [];
  const m = moves(s, color(s));
  return m.length ? m : [{ type: 'pass' }];
}

/** Счёт каждого места. */
export function score(s: State): number[] {
  const out = new Array(s.players).fill(0);
  for (let seat = 0; seat < s.players; seat++)
    for (const col of colorsOf(s, seat)) {
      const left = s.hand[col].reduce((a, p) => a + PIECE_SIZE[p], 0);
      out[seat] += left ? -left : 15 + (s.lastPiece[col] === 0 ? 5 : 0);
    }
  return out;
}

/** Передать ход следующему цвету, который ещё в игре (выбывшие пропускаются; у кого нет хода — выбывает). */
function advance(s: State, events: Event[]) {
  const k = s.cfg.colors.length;
  for (let i = 0; i < k; i++) {
    s.ci = (s.ci + 1) % k;
    const col = color(s);
    if (s.out[col]) continue;
    if (!s.hand[col].length || !moves(s, col, 1).length) {
      s.out[col] = true;
      events.push({ type: 'out', color: col });
      continue;
    }
    return;
  }
  s.over = true;
  s.scores = score(s);
  events.push({ type: 'end', scores: s.scores });
}

export function apply(s0: State, a: Action): { state: State; events: Event[] } {
  const s: State = { ...s0, board: [...s0.board], hand: { ...s0.hand }, out: { ...s0.out }, lastPiece: { ...s0.lastPiece } };
  const col = color(s);
  const seat = ownerOf(s, col);
  const events: Event[] = [];
  if (a.type === 'place') {
    for (const c of a.cells) s.board[c] = col;
    s.hand[col] = s.hand[col].filter((p) => p !== a.piece);
    s.lastPiece[col] = a.piece;
    s.last = { color: col, cells: a.cells };
    events.push({ type: 'place', seat, color: col, piece: a.piece, cells: a.cells });
  } else {
    s.out[col] = true;
    events.push({ type: 'out', color: col });
  }
  if (col === 3 && s.players === 3) s.shared = (s.shared + 1) % 3;
  s.ply++;
  advance(s, events);
  return { state: s, events };
}

export function step(s: State, a: Action): { state: State; events: Event[] } | null {
  if (s.over) return null;
  const col = color(s);
  if (a.type === 'pass') return moves(s, col, 1).length ? null : apply(s, a);
  if (!s.hand[col].includes(a.piece) || a.cells.length !== PIECE_SIZE[a.piece]) return null;
  // клетки должны быть этой фигуркой в каком-то положении
  const key = [...a.cells].sort((x, y) => x - y).join(',');
  const okShape = moves(s, col, Infinity, [a.piece]).some((m) => m.type === 'place' && [...m.cells].sort((x, y) => x - y).join(',') === key);
  if (!okShape || !fits(s, col, a.cells)) return null;
  return apply(s, a);
}
