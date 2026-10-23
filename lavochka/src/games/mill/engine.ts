/* Мельница — правила без DOM. Доски:
 *   3 — малая (3×3 точки с диагоналями, по 3 фишки): кто первым выстроит три в ряд — выиграл;
 *   6 — два квадрата (16 точек, по 6 фишек), полёта нет;
 *   9 — три квадрата (24 точки, по 9 фишек), с тремя фишками можно «летать» на любую пустую точку;
 *   12 — три квадрата с диагоналями в углах (по 12 фишек); заполнили доску расстановкой — ничья.
 * Сначала фишки по очереди ставят на пустые точки, потом ходят на соседнюю точку по линии. Три своих в ряд по линии —
 * «мельница»: снимаешь фишку соперника (не из его мельниц, если есть другие); две мельницы разом — две фишки.
 * Проигрывает тот, у кого осталось две фишки или нет хода. 50 ходов подряд без снятия — ничья.
 * Советская расстановка (коробка с буквами А–Ж): по 9 фишек уже стоят на своей половине доски с диагоналями, расстановки нет. */
import type { Options } from '../../core/types';

export type Look = 'soviet' | 'wood' | 'stone';
export type Kind = 3 | 6 | 9 | 12;

export interface Cfg {
  men: Kind;
  /** Полёт с тремя фишками. */
  fly: boolean;
  /** Фишки сразу стоят на своих половинах (советская коробка). */
  set: boolean;
  /** Диагонали в углах (у 12 — всегда). */
  diag: boolean;
  look: Look;
}

export function cfgFrom(o: Options): Cfg {
  const m = Number(o.men);
  const men: Kind = m === 3 || m === 6 || m === 12 ? m : 9;
  const set = o.set === true && (men === 9 || men === 12);
  return {
    men,
    fly: men >= 9 && o.fly !== false,
    set,
    diag: men === 12 || (men === 9 && o.diag === true) || men === 3,
    look: o.look === 'soviet' ? 'soviet' : o.look === 'stone' ? 'stone' : 'wood',
  };
}

export interface Geo {
  /** Координаты точек на сетке g×g. */
  xy: [number, number][];
  g: number;
  adj: number[][];
  mills: number[][];
  /** Линии доски для рисования: пары точек. */
  edges: [number, number][];
}

const geoCache = new Map<string, Geo>();

/** Геометрия доски. */
export function geo(cfg: Cfg): Geo {
  const k = `${cfg.men}:${cfg.diag}`;
  const c = geoCache.get(k);
  if (c) return c;
  let g: Geo;
  if (cfg.men === 3) {
    const xy: [number, number][] = [];
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) xy.push([x, y]);
    const edges: [number, number][] = [];
    const id = (x: number, y: number) => y * 3 + x;
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 3; x++) {
        if (x < 2) edges.push([id(x, y), id(x + 1, y)]);
        if (y < 2) edges.push([id(x, y), id(x, y + 1)]);
      }
    edges.push([0, 4], [4, 8], [2, 4], [4, 6]);
    const mills = [
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
      [0, 3, 6],
      [1, 4, 7],
      [2, 5, 8],
      [0, 4, 8],
      [2, 4, 6],
    ];
    g = { xy, g: 3, adj: adjOf(9, edges), mills, edges };
  } else {
    const rings = cfg.men === 6 ? 2 : 3;
    const c0 = rings; // центр сетки
    const xy: [number, number][] = [];
    const rel = [
      [-1, -1],
      [0, -1],
      [1, -1],
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
      [-1, 0],
    ];
    for (let r = 0; r < rings; r++) {
      const d = rings - r;
      for (const [dx, dy] of rel) xy.push([c0 + dx * d, c0 + dy * d]);
    }
    const edges: [number, number][] = [];
    const mills: number[][] = [];
    for (let r = 0; r < rings; r++) {
      for (let i = 0; i < 8; i++) edges.push([r * 8 + i, r * 8 + ((i + 1) % 8)]);
      for (const i of [0, 2, 4, 6]) mills.push([r * 8 + i, r * 8 + i + 1, r * 8 + ((i + 2) % 8)]);
    }
    for (let r = 0; r + 1 < rings; r++) {
      for (const i of [1, 3, 5, 7]) edges.push([r * 8 + i, (r + 1) * 8 + i]);
      if (cfg.diag) for (const i of [0, 2, 4, 6]) edges.push([r * 8 + i, (r + 1) * 8 + i]);
    }
    if (rings === 3) {
      for (const i of [1, 3, 5, 7]) mills.push([i, 8 + i, 16 + i]);
      if (cfg.diag) for (const i of [0, 2, 4, 6]) mills.push([i, 8 + i, 16 + i]);
    }
    g = { xy, g: 2 * rings + 1, adj: adjOf(rings * 8, edges), mills, edges };
  }
  geoCache.set(k, g);
  return g;
}

function adjOf(n: number, edges: [number, number][]): number[][] {
  const a: number[][] = Array.from({ length: n }, () => []);
  for (const [p, q] of edges) {
    a[p].push(q);
    a[q].push(p);
  }
  return a;
}

export interface State {
  cfg: Cfg;
  /** 0 — пусто, 1 — место 0, 2 — место 1. */
  board: number[];
  turn: number;
  /** Фишек ещё не поставлено. */
  hand: [number, number];
  /** Сколько фишек осталось снять по мельнице (ход того же игрока). */
  take: number;
  /** Ходов подряд без снятия (в фазе ходов). */
  quiet: number;
  ply: number;
  over: boolean;
  winner: number | null;
  last: number[];
}

export type Action = { type: 'place'; to: number } | { type: 'move'; from: number; to: number } | { type: 'take'; at: number };
export type Event =
  | { type: 'place'; seat: number; to: number; mills: number }
  | { type: 'move'; seat: number; from: number; to: number; mills: number; fly: boolean }
  | { type: 'take'; seat: number; at: number }
  | { type: 'end'; winner: number | null; why: 'mill' | 'few' | 'blocked' | 'full' | 'quiet' };

const QUIET = 50;
const LIMIT = 400;

export function newState(cfg: Cfg): State {
  const G = geo(cfg);
  const board = Array(G.xy.length).fill(0);
  let hand: [number, number] = [cfg.men, cfg.men];
  if (cfg.set) {
    // верхняя половина — место 1 (дальняя сторона), нижняя — место 0; средний ряд пуст
    const mid = (G.g - 1) / 2;
    G.xy.forEach(([, y], p) => {
      if (y < mid) board[p] = 2;
      else if (y > mid) board[p] = 1;
    });
    hand = [0, 0];
  }
  return { cfg, board, turn: 0, hand, take: 0, quiet: 0, ply: 0, over: false, winner: null, last: [] };
}

export const setup = (_seats: number[], o: Options) => newState(cfgFrom(o));
export const toAct = (s: State) => (s.over ? [] : [s.turn]);
const mine = (seat: number) => seat + 1;

export function count(s: State, seat: number): number {
  let n = s.hand[seat];
  for (const v of s.board) if (v === mine(seat)) n++;
  return n;
}

/** Сколько мельниц проходит через p для цвета c. */
export function millsAt(b: number[], G: Geo, p: number, c: number): number {
  let n = 0;
  for (const m of G.mills) if (m.includes(p) && m.every((q) => b[q] === c)) n++;
  return n;
}

const inMill = (b: number[], G: Geo, p: number) => millsAt(b, G, p, b[p]) > 0;

/** Можно ли «летать». */
export const flying = (s: State, seat: number) => s.cfg.fly && s.hand[seat] === 0 && count(s, seat) === 3;

export function legal(s: State): Action[] {
  if (s.over) return [];
  const G = geo(s.cfg);
  const seat = s.turn;
  const me = mine(seat);
  const out: Action[] = [];
  if (s.take > 0) {
    const opp = mine(1 - seat);
    const all = s.board.map((v, p) => (v === opp ? p : -1)).filter((p) => p >= 0);
    const free = all.filter((p) => !inMill(s.board, G, p));
    for (const p of free.length ? free : all) out.push({ type: 'take', at: p });
    return out;
  }
  if (s.hand[seat] > 0) {
    s.board.forEach((v, p) => {
      if (!v) out.push({ type: 'place', to: p });
    });
    return out;
  }
  const fly = flying(s, seat);
  s.board.forEach((v, p) => {
    if (v !== me) return;
    const to = fly ? s.board.map((w, q) => (w ? -1 : q)).filter((q) => q >= 0) : G.adj[p].filter((q) => !s.board[q]);
    for (const q of to) out.push({ type: 'move', from: p, to: q });
  });
  return out;
}

/** Применить ход без проверки. */
export function step(s0: State, a: Action): { state: State; events: Event[] } {
  const G = geo(s0.cfg);
  const s: State = { ...s0, board: s0.board.slice(), hand: [s0.hand[0], s0.hand[1]], last: [] };
  const seat = s0.turn;
  const me = mine(seat);
  const events: Event[] = [];
  let made = 0;
  if (a.type === 'take') {
    s.board[a.at] = 0;
    s.take--;
    s.quiet = 0;
    s.last = [a.at];
    events.push({ type: 'take', seat, at: a.at });
  } else if (a.type === 'place') {
    s.board[a.to] = me;
    s.hand[seat]--;
    made = millsAt(s.board, G, a.to, me);
    s.last = [a.to];
    events.push({ type: 'place', seat, to: a.to, mills: made });
  } else {
    const fly = flying(s0, seat);
    s.board[a.from] = 0;
    s.board[a.to] = me;
    made = millsAt(s.board, G, a.to, me);
    s.last = [a.from, a.to];
    if (s.hand[0] + s.hand[1] === 0) s.quiet++;
    events.push({ type: 'move', seat, from: a.from, to: a.to, mills: made, fly });
  }
  s.ply++;
  const end = (winner: number | null, why: 'mill' | 'few' | 'blocked' | 'full' | 'quiet') => {
    s.over = true;
    s.winner = winner;
    s.take = 0;
    events.push({ type: 'end', winner, why });
    return { state: s, events };
  };
  if (s.cfg.men === 3) {
    if (made) return end(seat, 'mill');
  } else if (made) {
    const opp = mine(1 - seat);
    const have = s.board.filter((v) => v === opp).length;
    s.take = Math.min(made, have);
    if (s.take > 0) return { state: s, events };
  }
  if (a.type === 'take' && s.take > 0) {
    if (legal(s).length) return { state: s, events };
    s.take = 0;
  }
  // ход переходит
  const opp = 1 - seat;
  if (s.cfg.men !== 3 && count(s, opp) < 3) return end(seat, 'few');
  if (s.cfg.men === 12 && s.hand[0] + s.hand[1] === 0 && s.board.every((v) => v) && a.type === 'place') return end(null, 'full');
  s.turn = opp;
  if (!legal(s).length) {
    // в фазе расстановки ходов нет только на полной доске
    if (s.hand[opp] > 0 || s.hand[seat] > 0) {
      s.turn = seat;
      if (legal(s).length) return { state: s, events };
      return end(null, 'full');
    }
    return end(seat, 'blocked');
  }
  if (s.quiet >= QUIET || s.ply >= LIMIT) return end(null, 'quiet');
  return { state: s, events };
}

export function apply(s: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  if (s.over || seat !== s.turn || !a) return null;
  const ok = legal(s).some(
    (m) => m.type === a.type && (m.type === 'take' ? a.type === 'take' && m.at === a.at : a.type !== 'take' && m.to === a.to && (m.type === 'place' || (a.type === 'move' && m.from === a.from)))
  );
  return ok ? step(s, a) : null;
}
