/* Коридор (Quoridor, Мирко Маркетти, 1997) — правила без DOM.
 * Поле 9×9 (детское — 7×7). Пешки стоят посередине своих краёв; цель — первым дойти до любой клетки противоположного
 * края. Ход — либо шаг пешкой на соседнюю клетку (не по диагонали, не сквозь стенку), либо стенка в паз между клетками:
 * длиной в две клетки, по горизонтали или вертикали. Стенки не пересекаются и не накладываются, и нельзя наглухо
 * отрезать ни одну пешку от её цели. Пешка рядом — через неё прыгают; если за ней стенка или край, можно встать
 * вбок от неё («обход по диагонали»; в строгом варианте его нет). Через две пешки не прыгают: если за пешкой
 * стоит другая, тоже можно встать вбок.
 * Вдвоём — по 10 стенок (на 7×7 — по 8), вчетвером — по 5 (по 4). Места по часовой: 0 — снизу, 1 — слева, 2 — сверху,
 * 3 — справа; вдвоём играют места 0 и 2. */
import type { Options } from '../../core/types';

export type Look = 'walnut' | 'beech';

export interface Cfg {
  n: number;
  /** Обход вбок, когда за пешкой стенка или край. */
  diag: boolean;
  look: Look;
}

export function cfgFrom(o: Options): Cfg {
  return { n: Number(o.size) === 7 ? 7 : 9, diag: o.diag !== false, look: o.look === 'beech' ? 'beech' : 'walnut' };
}

/** Сколько стенок у каждого. */
export const wallsFor = (n: number, players: number) => (n === 7 ? (players > 2 ? 4 : 8) : players > 2 ? 5 : 10);
/** Предел ходов до подсчёта (пешки могут топтаться вечно). */
export const PLY_LIMIT = 600;

export interface State {
  cfg: Cfg;
  /** Места по порядку хода (по часовой). */
  order: number[];
  /** Клетка пешки места (−1 — места нет). */
  pos: number[];
  /** Стенок в запасе. */
  left: number[];
  /** Стенки по узлам (n − 1)²: горизонтальные и вертикальные; значение — место поставившего + 1 (0 — нет). */
  hw: number[];
  vw: number[];
  turn: number;
  ply: number;
  over: boolean;
  winner: number | null;
  why: 'goal' | 'limit' | null;
  /** Последний ход: шаг [откуда, куда] или стенка. */
  last: { from: number; to: number } | { wall: Wall } | null;
}

export interface Wall {
  x: number;
  y: number;
  o: 'h' | 'v';
}
export type Action = { type: 'move'; to: number } | { type: 'wall'; x: number; y: number; o: 'h' | 'v' };
export type Event =
  | { type: 'move'; seat: number; from: number; to: number; jump: boolean }
  | { type: 'wall'; seat: number; x: number; y: number; o: 'h' | 'v'; left: number }
  | { type: 'end'; winner: number; why: 'goal' | 'limit' };

export const at = (n: number, x: number, y: number) => y * n + x;
export const X = (n: number, p: number) => p % n;
export const Y = (n: number, p: number) => (p - (p % n)) / n;

/** Где стоит пешка места в начале и куда ей идти. */
export function home(n: number, seat: number): number {
  const m = (n - 1) / 2;
  return [at(n, m, n - 1), at(n, 0, m), at(n, m, 0), at(n, n - 1, m)][seat];
}
export function isGoal(n: number, seat: number, p: number): boolean {
  return [Y(n, p) === 0, X(n, p) === n - 1, Y(n, p) === n - 1, X(n, p) === 0][seat];
}

/** Места при числе игроков: вдвоём — друг напротив друга. */
export const seatsFor = (count: number) => (count === 2 ? [0, 2] : count === 3 ? [0, 1, 2] : [0, 1, 2, 3]);

export function newState(cfg: Cfg, order: number[]): State {
  const n = cfg.n;
  const pos = [-1, -1, -1, -1];
  const left = [0, 0, 0, 0];
  for (const s of order) {
    pos[s] = home(n, s);
    left[s] = wallsFor(n, order.length);
  }
  const k = (n - 1) * (n - 1);
  return { cfg, order, pos, left, hw: new Array(k).fill(0), vw: new Array(k).fill(0), turn: order[0], ply: 0, over: false, winner: null, why: null, last: null };
}

export const setup = (seats: number[], o: Options) => newState(cfgFrom(o), seats.slice().sort((a, b) => a - b));
export const toAct = (s: State) => (s.over ? [] : [s.turn]);

/** Направления: вверх, вправо, вниз, влево. */
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

/** Закрыт ли проход из клетки p в сторону d стенкой или краем. */
export function blocked(n: number, hw: number[], vw: number[], p: number, d: number): boolean {
  const x = X(n, p);
  const y = Y(n, p);
  const nx = x + DX[d];
  const ny = y + DY[d];
  if (nx < 0 || nx >= n || ny < 0 || ny >= n) return true;
  const m = n - 1;
  if (d === 0 || d === 2) {
    const row = d === 0 ? y - 1 : y;
    return (x > 0 && hw[row * m + x - 1] > 0) || (x < m && hw[row * m + x] > 0);
  }
  const col = d === 3 ? x - 1 : x;
  return (y > 0 && vw[(y - 1) * m + col] > 0) || (y < m && vw[y * m + col] > 0);
}

const step = (n: number, p: number, d: number) => p + DY[d] * n + DX[d];

/** Кратчайший путь места до цели (без учёта пешек); −1 — пути нет. */
export function dist(n: number, hw: number[], vw: number[], seat: number, from: number): number {
  if (isGoal(n, seat, from)) return 0;
  const d = new Int16Array(n * n).fill(-1);
  d[from] = 0;
  const q = [from];
  for (let i = 0; i < q.length; i++) {
    const p = q[i];
    for (let k = 0; k < 4; k++) {
      if (blocked(n, hw, vw, p, k)) continue;
      const r = step(n, p, k);
      if (d[r] >= 0) continue;
      d[r] = d[p] + 1;
      if (isGoal(n, seat, r)) return d[r];
      q.push(r);
    }
  }
  return -1;
}

/** Куда может шагнуть пешка места seat. */
export function pawnMoves(s: State, seat: number): number[] {
  const n = s.cfg.n;
  const p = s.pos[seat];
  const occ = (c: number) => s.pos.some((q, i) => i !== seat && q === c);
  const out = new Set<number>();
  for (let d = 0; d < 4; d++) {
    if (blocked(n, s.hw, s.vw, p, d)) continue;
    const r = step(n, p, d);
    if (!occ(r)) {
      out.add(r);
      continue;
    }
    // прыжок прямо
    if (!blocked(n, s.hw, s.vw, r, d)) {
      const j = step(n, r, d);
      if (!occ(j)) {
        out.add(j);
        continue;
      }
    }
    // за пешкой стенка, край или третья пешка (через две не прыгают) — вбок от неё
    if (!s.cfg.diag) continue;
    for (const side of [(d + 1) % 4, (d + 3) % 4]) {
      if (blocked(n, s.hw, s.vw, r, side)) continue;
      const j = step(n, r, side);
      if (!occ(j) && j !== p) out.add(j);
    }
  }
  return [...out];
}

/** Можно ли поставить стенку (без проверки путей). */
export function wallFits(s: State, w: Wall): boolean {
  const m = s.cfg.n - 1;
  if (!Number.isInteger(w.x) || !Number.isInteger(w.y) || w.x < 0 || w.y < 0 || w.x >= m || w.y >= m) return false;
  const i = w.y * m + w.x;
  if (s.hw[i] || s.vw[i]) return false; // занято или крест
  if (w.o === 'h') return !(w.x > 0 && s.hw[i - 1]) && !(w.x < m - 1 && s.hw[i + 1]);
  return !(w.y > 0 && s.vw[i - m]) && !(w.y < m - 1 && s.vw[i + m]);
}

/** Стенка ставится и у всех остаётся путь. */
export function wallOk(s: State, w: Wall): boolean {
  if (s.left[s.turn] <= 0 || !wallFits(s, w)) return false;
  const m = s.cfg.n - 1;
  const hw = w.o === 'h' ? s.hw.slice() : s.hw;
  const vw = w.o === 'v' ? s.vw.slice() : s.vw;
  (w.o === 'h' ? hw : vw)[w.y * m + w.x] = 1;
  return s.order.every((seat) => dist(s.cfg.n, hw, vw, seat, s.pos[seat]) >= 0);
}

export function legal(s: State): Action[] {
  if (s.over) return [];
  const out: Action[] = pawnMoves(s, s.turn).map((to) => ({ type: 'move', to }));
  if (s.left[s.turn] > 0) {
    const m = s.cfg.n - 1;
    for (let y = 0; y < m; y++)
      for (let x = 0; x < m; x++)
        for (const o of ['h', 'v'] as const) if (wallOk(s, { x, y, o })) out.push({ type: 'wall', x, y, o });
  }
  return out;
}

const nextSeat = (s: State) => s.order[(s.order.indexOf(s.turn) + 1) % s.order.length];

/** Действие без проверки. */
export function apply0(s0: State, a: Action): { state: State; events: Event[] } {
  const n = s0.cfg.n;
  const seat = s0.turn;
  const s: State = { ...s0, pos: s0.pos.slice(), left: s0.left.slice() };
  const events: Event[] = [];
  s.ply++;
  if (a.type === 'move') {
    const from = s.pos[seat];
    s.pos[seat] = a.to;
    const jump = Math.abs(X(n, a.to) - X(n, from)) + Math.abs(Y(n, a.to) - Y(n, from)) > 1;
    s.last = { from, to: a.to };
    events.push({ type: 'move', seat, from, to: a.to, jump });
    if (isGoal(n, seat, a.to)) {
      s.over = true;
      s.winner = seat;
      s.why = 'goal';
      events.push({ type: 'end', winner: seat, why: 'goal' });
      return { state: s, events };
    }
  } else {
    const m = n - 1;
    if (a.o === 'h') (s.hw = s0.hw.slice())[a.y * m + a.x] = seat + 1;
    else (s.vw = s0.vw.slice())[a.y * m + a.x] = seat + 1;
    s.left[seat]--;
    s.last = { wall: { x: a.x, y: a.y, o: a.o } };
    events.push({ type: 'wall', seat, x: a.x, y: a.y, o: a.o, left: s.left[seat] });
  }
  s.turn = nextSeat(s);
  if (s.ply >= PLY_LIMIT) {
    // долго топчутся — побеждает тот, кому ближе до цели (при равенстве — кто ходил раньше)
    let best = s.order[0];
    let bd = Infinity;
    for (const q of s.order) {
      const d = dist(n, s.hw, s.vw, q, s.pos[q]);
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    s.over = true;
    s.winner = best;
    s.why = 'limit';
    events.push({ type: 'end', winner: best, why: 'limit' });
  }
  return { state: s, events };
}

export function apply(s: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  if (s.over || seat !== s.turn || !a) return null;
  if (a.type === 'move') {
    if (!pawnMoves(s, seat).includes(a.to)) return null;
  } else if (a.type === 'wall') {
    if ((a.o !== 'h' && a.o !== 'v') || !wallOk(s, a)) return null;
  } else return null;
  return apply0(s, a);
}
