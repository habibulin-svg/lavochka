/* Шатра (алтайские шахматы) — правила (без DOM). Сводка источников и расхождений — docs/analysis/rules-shatra.md.
 *
 * Доска — 62 поля: большое поле 7×6 (ров делит его пополам), с каждой стороны — крепость 3×3 и ворота между ней и полем.
 * У каждого: бий (князь), батыр, 2 туры, 2 ялкына, 11 шатр. Белые внизу, ходят первыми.
 *
 * Ходы: бий — на 1 в любую сторону; батыр — как ферзь; тура — как ладья; ялкын — по диагонали на любое число полей.
 * Шатра на своей половине — вперёд на 1 (из начального ряда — можно на 2); у рва — вперёд или вперёд наискось;
 * за рвом — на 1 в любую сторону.
 * Взятие — шашечным прыжком через чужую фигуру на свободное поле за ней (бий и шатра — через соседнюю в любую сторону,
 * дальнобойные — по своим линиям с любого расстояния, встать можно на любое свободное поле за фигурой). Взятие обязательно
 * для всех, кроме бия; серию доводят до конца; одну фигуру дважды не перепрыгивают; ветку выбирает берущий.
 * Резерв: фигуры в своей крепости и воротах не ходят — за ход одну можно выставить на любое свободное поле своей половины
 * большого поля. Пока резерв не пуст, в свою крепость и ворота заходить нельзя; опустел — это обычные поля.
 * Превращение: шатра, вставшая на дальний ряд чужой крепости, становится любой своей уже срубленной фигурой (кроме бия);
 * срубленных нет — остаётся шатрой.
 * Победа — срубить бия или оставить соперника без ходов. Ничья — 60 ходов подряд без взятий или предел ходов.
 */
import type { Options } from '../../core/types';

export type Kind = 'K' | 'Q' | 'R' | 'B' | 'P';
export interface Piece {
  o: number;
  k: Kind;
}

export interface Cfg {
  /** Во что превращается шатра: любая срубленная фигура или всегда батыр. */
  promo: 'any' | 'batyr';
  /** Выставлять резерв по порядку (как у «Вокруг света») или любую фигуру. */
  order: boolean;
}

export function cfgFrom(o: Options): Cfg {
  return { promo: o.promo === 'batyr' ? 'batyr' : 'any', order: !!o.order };
}

export const COLS = 7;
export const ROWS = 14;
/** Поля по номерам 1…62 (индекс — номер − 1): x — столбец 0…6, y — ряд 0…13 (0 — сверху, у чёрных). */
export const CELLS: { x: number; y: number }[] = [];
for (let y = 0; y < 3; y++) for (let x = 2; x <= 4; x++) CELLS.push({ x, y });
CELLS.push({ x: 3, y: 3 });
for (let y = 4; y < 10; y++) for (let x = 0; x < 7; x++) CELLS.push({ x, y });
CELLS.push({ x: 3, y: 10 });
for (let y = 11; y < 14; y++) for (let x = 2; x <= 4; x++) CELLS.push({ x, y });
export const N = CELLS.length; // 62
const GRID = new Map<string, number>(CELLS.map((c, i) => [`${c.x},${c.y}`, i]));
export const at = (x: number, y: number) => GRID.get(`${x},${y}`) ?? -1;
/** Номер поля, как в описаниях: 1…62. */
export const num = (i: number) => i + 1;
export const cell = (n: number) => n - 1;

export const DIRS8: [number, number][] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];
const ORTHO = [0, 2, 4, 6];
const DIAG = [1, 3, 5, 7];
export const step = (i: number, d: number) => at(CELLS[i].x + DIRS8[d][0], CELLS[i].y + DIRS8[d][1]);

/** Крепость и ворота стороны: 0 — белые (низ), 1 — чёрные (верх). */
export const fortress = (seat: number, i: number) => (seat === 0 ? CELLS[i].y >= 10 : CELLS[i].y <= 3);
/** Своя половина большого поля. */
export const ownHalf = (seat: number, i: number) => (seat === 0 ? CELLS[i].y >= 7 && CELLS[i].y <= 9 : CELLS[i].y >= 4 && CELLS[i].y <= 6);
const enemyHalf = (seat: number, i: number) => ownHalf(1 - seat, i) || fortress(1 - seat, i);
/** Дальний ряд чужой крепости — превращение. */
export const promoRow = (seat: number, i: number) => (seat === 0 ? CELLS[i].y === 0 : CELLS[i].y === 13);
const fwd = (seat: number) => (seat === 0 ? -1 : 1);

export interface State {
  cfg: Cfg;
  board: (Piece | null)[];
  /** Фигуры, ещё стоящие в резерве (в своей крепости и воротах с начала партии). */
  reserve: [number[], number[]];
  /** Срубленные фигуры каждой стороны (виды). */
  lost: [Kind[], Kind[]];
  turn: number;
  ply: number;
  quiet: number;
  /** Шатра встала на поле превращения — ждём выбора (поле). */
  promote: number;
  last: number[] | null;
  over: boolean;
  winner: number | null;
}

export type View = State;
export type Action = { type: 'move'; path: number[] } | { type: 'drop'; from: number; to: number } | { type: 'promote'; kind: Kind };
export type Event =
  | { type: 'move'; seat: number; path: number[]; taken: number[]; kind: Kind }
  | { type: 'drop'; seat: number; from: number; to: number; kind: Kind }
  | { type: 'promote'; seat: number; at: number; kind: Kind }
  | { type: 'end'; winner: number | null; reason: 'king' | 'stuck' | 'draw' };

export const MAX_PLY = 400;
export const QUIET = 120;

function initial(): (Piece | null)[] {
  const b: (Piece | null)[] = new Array(N).fill(null);
  const put = (o: number, k: Kind, nums: number[]) => nums.forEach((n) => (b[cell(n)] = { o, k }));
  put(1, 'K', [10]);
  put(1, 'Q', [2]);
  put(1, 'R', [5, 8]);
  put(1, 'B', [7, 9]);
  put(1, 'P', [1, 3, 4, 6, 11, 12, 13, 14, 15, 16, 17]);
  put(0, 'K', [53]);
  put(0, 'Q', [61]);
  put(0, 'R', [55, 58]);
  put(0, 'B', [54, 56]);
  put(0, 'P', [57, 59, 60, 62, 46, 47, 48, 49, 50, 51, 52]);
  return b;
}

/** Порядок выставления при строгом порядке: белые 54, 55, 56…; чёрные 9, 8, 7… (ворота — последними). */
const ORDER: [number[], number[]] = [
  [54, 55, 56, 57, 58, 59, 60, 61, 62, 53].map(cell),
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 10].map(cell),
];

export function newState(cfg: Cfg): State {
  const board = initial();
  const reserve: [number[], number[]] = [[], []];
  for (let i = 0; i < N; i++) {
    const p = board[i];
    if (p && fortress(p.o, i)) reserve[p.o].push(i);
  }
  return { cfg, board, reserve, lost: [[], []], turn: 0, ply: 0, quiet: 0, promote: -1, last: null, over: false, winner: null };
}

export const setup = (opts: Options): State => newState(cfgFrom(opts));
export const toAct = (s: State): number[] => (s.over ? [] : [s.turn]);

const inReserve = (s: State, i: number) => s.reserve[0].includes(i) || s.reserve[1].includes(i);
/** Можно ли этой стороне встать на поле (своя крепость закрыта, пока есть резерв). */
const canEnter = (s: State, seat: number, i: number) => !(fortress(seat, i) && s.reserve[seat].length > 0);

/** Тихие ходы фигуры с поля i. */
function quietMoves(s: State, i: number, out: Action[]) {
  const p = s.board[i]!;
  const me = p.o;
  const slide = (dirs: number[]) => {
    for (const d of dirs)
      for (let t = step(i, d); t >= 0 && !s.board[t]; t = step(t, d)) {
        if (canEnter(s, me, t)) out.push({ type: 'move', path: [i, t] });
        else break;
      }
  };
  if (p.k === 'K') {
    for (let d = 0; d < 8; d++) {
      const t = step(i, d);
      if (t >= 0 && !s.board[t] && canEnter(s, me, t)) out.push({ type: 'move', path: [i, t] });
    }
  } else if (p.k === 'Q') slide([0, 1, 2, 3, 4, 5, 6, 7]);
  else if (p.k === 'R') slide(ORTHO);
  else if (p.k === 'B') slide(DIAG);
  else {
    const f = fwd(me);
    const y = CELLS[i].y;
    const dirs: number[] = [];
    if (enemyHalf(me, i)) dirs.push(0, 1, 2, 3, 4, 5, 6, 7);
    else {
      dirs.push(f < 0 ? 0 : 4);
      // у рва (последний ряд своей половины) — ещё вперёд наискось
      if ((me === 0 && y === 7) || (me === 1 && y === 6)) dirs.push(...(f < 0 ? [1, 7] : [3, 5]));
    }
    for (const d of dirs) {
      const t = step(i, d);
      if (t >= 0 && !s.board[t] && canEnter(s, me, t)) out.push({ type: 'move', path: [i, t] });
    }
    // из начального ряда — на два вперёд
    const startRow = me === 0 ? 9 : 4;
    if (y === startRow) {
      const a = step(i, f < 0 ? 0 : 4);
      const b = a >= 0 ? step(a, f < 0 ? 0 : 4) : -1;
      if (a >= 0 && b >= 0 && !s.board[a] && !s.board[b]) out.push({ type: 'move', path: [i, b] });
    }
  }
}

/** Все серии взятий фигурой с поля i (пути из полей приземления). */
function captures(s: State, i: number): number[][] {
  const p = s.board[i]!;
  const me = p.o;
  const out: number[][] = [];
  const long = p.k === 'Q' || p.k === 'R' || p.k === 'B';
  const dirs = p.k === 'R' ? ORTHO : p.k === 'B' ? DIAG : [0, 1, 2, 3, 4, 5, 6, 7];
  const rec = (pos: number, path: number[], jumped: Set<number>) => {
    let any = false;
    for (const d of dirs) {
      let t = step(pos, d);
      if (long) while (t >= 0 && (!s.board[t] || t === i) && !jumped.has(t)) t = step(t, d);
      if (t < 0) continue;
      const v = s.board[t];
      if (!v || v.o === me || jumped.has(t) || t === i) continue;
      // за фигурой — свободные поля
      for (let land = step(t, d); land >= 0 && (!s.board[land] || land === i) && !jumped.has(land); land = step(land, d)) {
        if (!canEnter(s, me, land)) break;
        any = true;
        const nj = new Set(jumped);
        nj.add(t);
        rec(land, [...path, land], nj);
        if (!long) break;
      }
    }
    if (!any && path.length > 1) out.push(path);
  };
  rec(i, [i], new Set());
  return out;
}

/** Все ходы стороны. Взятие обязательно для всех, кроме бия. */
export function legal(s: State): Action[] {
  if (s.over) return [];
  const me = s.turn;
  if (s.promote >= 0) return promoKinds(s).map((k) => ({ type: 'promote', kind: k }) as Action);
  const caps: Action[] = [];
  const kingCaps: Action[] = [];
  const quiet: Action[] = [];
  for (let i = 0; i < N; i++) {
    const p = s.board[i];
    if (!p || p.o !== me || inReserve(s, i)) continue;
    for (const path of captures(s, i)) (p.k === 'K' ? kingCaps : caps).push({ type: 'move', path });
    quietMoves(s, i, quiet);
  }
  if (caps.length) return [...caps, ...kingCaps].sort((a, b) => (b.type === 'move' ? b.path.length : 0) - (a.type === 'move' ? a.path.length : 0));
  const res = s.reserve[me];
  const drops: Action[] = [];
  if (res.length) {
    const from = s.cfg.order ? [ORDER[me].find((c) => res.includes(c))!] : res;
    for (const f of from) for (let t = 0; t < N; t++) if (!s.board[t] && ownHalf(me, t)) drops.push({ type: 'drop', from: f, to: t });
  }
  return [...kingCaps, ...quiet, ...drops];
}

/** Есть обязательное взятие (у фигур, кроме бия). */
export function forcedCapture(s: State): boolean {
  for (let i = 0; i < N; i++) {
    const p = s.board[i];
    if (p && p.o === s.turn && p.k !== 'K' && !inReserve(s, i) && captures(s, i).length) return true;
  }
  return false;
}

/** Во что может превратиться шатра сейчас. */
export function promoKinds(s: State): Kind[] {
  const me = s.turn;
  if (s.cfg.promo === 'batyr') return ['Q'];
  const kinds = [...new Set(s.lost[me].filter((k) => k !== 'P' && k !== 'K'))];
  const order: Kind[] = ['Q', 'R', 'B'];
  return order.filter((k) => (kinds as Kind[]).includes(k));
}

const sameAct = (a: Action, b: Action) => JSON.stringify(a) === JSON.stringify(b);

function clone(s0: State): State {
  return { ...s0, board: s0.board.slice(), reserve: [s0.reserve[0].slice(), s0.reserve[1].slice()], lost: [s0.lost[0].slice(), s0.lost[1].slice()] };
}

function finishTurn(s: State, ev: Event[]) {
  s.turn = 1 - s.turn;
  s.ply++;
  if (!legal(s).length) {
    s.over = true;
    s.winner = 1 - s.turn;
    ev.push({ type: 'end', winner: s.winner, reason: 'stuck' });
  } else if (s.quiet >= QUIET || s.ply >= MAX_PLY) {
    s.over = true;
    s.winner = null;
    ev.push({ type: 'end', winner: null, reason: 'draw' });
  }
}

export function apply(s0: State, a: Action): { state: State; events: Event[] } | null {
  if (s0.over || !a || !legal(s0).some((x) => sameAct(x, a))) return null;
  return play(s0, a);
}

/** Ход без проверки (только для ходов из legal — перебор ботов). */
export function play(s0: State, a: Action): { state: State; events: Event[] } {
  const s = clone(s0);
  const me = s.turn;
  const ev: Event[] = [];
  if (a.type === 'promote') {
    s.board[s.promote] = { o: me, k: a.kind };
    ev.push({ type: 'promote', seat: me, at: s.promote, kind: a.kind });
    s.promote = -1;
    finishTurn(s, ev);
    return { state: s, events: ev };
  }
  if (a.type === 'drop') {
    const p = s.board[a.from]!;
    s.board[a.to] = p;
    s.board[a.from] = null;
    s.reserve[me] = s.reserve[me].filter((c) => c !== a.from);
    s.last = [a.from, a.to];
    s.quiet++;
    ev.push({ type: 'drop', seat: me, from: a.from, to: a.to, kind: p.k });
    finishTurn(s, ev);
    return { state: s, events: ev };
  }
  const path = a.path;
  const from = path[0];
  const p = s.board[from]!;
  const taken: number[] = [];
  // взятые — поля между приземлениями (у дальнобойных — единственная чужая фигура на отрезке)
  for (let k = 1; k < path.length; k++) {
    const A = CELLS[path[k - 1]];
    const B = CELLS[path[k]];
    const dx = Math.sign(B.x - A.x);
    const dy = Math.sign(B.y - A.y);
    for (let x = A.x + dx, y = A.y + dy; x !== B.x || y !== B.y; x += dx, y += dy) {
      const c = at(x, y);
      const v = c >= 0 ? s.board[c] : null;
      if (v && v.o !== me) taken.push(c);
    }
  }
  s.board[from] = null;
  let kingTaken = false;
  for (const c of taken) {
    const v = s.board[c]!;
    if (v.k === 'K') kingTaken = true;
    s.lost[v.o].push(v.k);
    s.reserve[v.o] = s.reserve[v.o].filter((x) => x !== c);
    s.board[c] = null;
  }
  const to = path[path.length - 1];
  s.board[to] = p;
  s.last = path.slice();
  s.quiet = taken.length ? 0 : s.quiet + 1;
  ev.push({ type: 'move', seat: me, path: path.slice(), taken, kind: p.k });
  if (kingTaken) {
    s.over = true;
    s.winner = me;
    s.ply++;
    ev.push({ type: 'end', winner: me, reason: 'king' });
    return { state: s, events: ev };
  }
  if (p.k === 'P' && promoRow(me, to)) {
    s.promote = to;
    const kinds = promoKinds(s);
    if (kinds.length === 1) {
      s.board[to] = { o: me, k: kinds[0] };
      ev.push({ type: 'promote', seat: me, at: to, kind: kinds[0] });
      s.promote = -1;
    } else if (!kinds.length) s.promote = -1;
    else return { state: s, events: ev }; // ждём выбора того же игрока
  }
  finishTurn(s, ev);
  return { state: s, events: ev };
}
