/* Стрелки (сигнпост): разбойники нарисовали мелом стрелки в каждой клетке. Путь идёт по номерам 1…N: следующая
 * клетка — где-то по направлению стрелки (на любом расстоянии), каждая клетка по разу. Часть номеров дана.
 * Генератор: случайный путь «ходами ферзя», стрелки по нему; убираем номера, пока путь единственный. Без DOM. */
import type { Rng } from '../../../core/types';
import { shuffle } from '../../../core/rng';

/** Направления 0–7 по часовой с севера: ↑ ↗ → ↘ ↓ ↙ ← ↖. */
export const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
const D8 = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

export interface StrelkiData {
  n: number;
  /** Направление стрелки у клетки; -1 — финиш (звёздочка). */
  dir: number[];
  /** Данные номера (0 — пусто). */
  given: number[];
}

/** Клетки по направлению стрелки из i. */
function ray(n: number, i: number, dir: number): number[] {
  if (dir < 0) return [];
  const [dx, dy] = D8[dir];
  const out: number[] = [];
  let x = (i % n) + dx;
  let y = ((i / n) | 0) + dy;
  while (x >= 0 && y >= 0 && x < n && y < n) {
    out.push(y * n + x);
    x += dx;
    y += dy;
  }
  return out;
}

function dirTo(n: number, a: number, b: number): number {
  const dx = Math.sign((b % n) - (a % n));
  const dy = Math.sign(((b / n) | 0) - ((a / n) | 0));
  return D8.findIndex(([x, y]) => x === dx && y === dy);
}

/** Число путей (до limit), первый — номера клеток в out. */
export function countStrelki(d: StrelkiData, limit = 2, out?: number[]): number {
  const { n } = d;
  const N = n * n;
  const pos = new Array(N + 1).fill(-1);
  d.given.forEach((v, i) => v && (pos[v] = i));
  const rays = d.dir.map((dir, i) => ray(n, i, dir));
  const num = d.given.slice();
  const used = d.given.map((v) => v > 0);
  // в клетку можно прийти, только если на неё указывает чья-то стрелка — у старта таких может не быть
  let found = 0;
  const go = (k: number, at: number): void => {
    if (found >= limit) return;
    if (k === N) {
      if (!found && out) out.splice(0, N, ...num);
      found++;
      return;
    }
    const k1 = k + 1;
    if (pos[k1] >= 0) {
      if (rays[at].includes(pos[k1])) go(k1, pos[k1]);
      return;
    }
    for (const j of rays[at]) {
      if (used[j]) continue;
      if (k1 === N && d.dir[j] >= 0) continue;
      if (k1 < N && d.dir[j] < 0) continue;
      used[j] = true;
      num[j] = k1;
      go(k1, j);
      used[j] = false;
      num[j] = 0;
      if (found >= limit) return;
    }
  };
  if (pos[1] >= 0) go(1, pos[1]);
  return found;
}

export function solveStrelki(d: StrelkiData): number[] {
  const out = new Array(d.n * d.n).fill(0);
  countStrelki(d, 1, out);
  return out;
}

export function checkStrelki(d: StrelkiData, a: unknown): boolean {
  const N = d.n * d.n;
  if (!Array.isArray(a) || a.length !== N) return false;
  const g = a as number[];
  if (g.some((v, i) => !Number.isInteger(v) || (d.given[i] && d.given[i] !== v))) return false;
  if (new Set(g).size !== N || g.some((v) => v < 1 || v > N)) return false;
  const pos: number[] = [];
  g.forEach((v, i) => (pos[v] = i));
  for (let k = 1; k < N; k++) if (!ray(d.n, pos[k], d.dir[pos[k]]).includes(pos[k + 1])) return false;
  return d.dir[pos[N]] < 0;
}

/** Случайный путь по всем клеткам ходами ферзя (с откатом). */
function randomPath(n: number, rng: Rng): number[] | null {
  const N = n * n;
  const used = new Array(N).fill(false);
  const path = [rng.int(N)];
  used[path[0]] = true;
  let budget = 30000;
  const go = (): boolean => {
    if (path.length === N) return true;
    if (--budget < 0) return false;
    const at = path[path.length - 1];
    const cand = shuffle(
      [...Array(8).keys()].flatMap((dir) => ray(n, at, dir)).filter((j) => !used[j]),
      rng,
    );
    for (const j of cand.slice(0, 6)) {
      used[j] = true;
      path.push(j);
      if (go()) return true;
      path.pop();
      used[j] = false;
    }
    return false;
  };
  return go() ? path : null;
}

/** Уровень: 0 — 4×4, 1 — 5×5, 2 — 6×6. */
export function genStrelki(level: number, rng: Rng): { data: StrelkiData; sol: number[] } {
  const n = level + 4;
  const N = n * n;
  for (let attempt = 0; attempt < 100; attempt++) {
    const path = randomPath(n, rng);
    if (!path) continue;
    const sol = new Array(N).fill(0);
    path.forEach((c, k) => (sol[c] = k + 1));
    const dir = new Array(N).fill(-1);
    for (let k = 0; k < N - 1; k++) dir[path[k]] = dirTo(n, path[k], path[k + 1]);
    // начинаем с 1, N и половины номеров; убираем лишние
    const given = new Array(N).fill(0);
    given[path[0]] = 1;
    given[path[N - 1]] = N;
    for (let k = 1; k < N - 1; k++) if (rng.next() < 0.5) given[path[k]] = k + 1;
    const d: StrelkiData = { n, dir, given };
    if (countStrelki(d) !== 1) {
      for (let k = 1; k < N - 1 && countStrelki(d) !== 1; k++) given[path[k]] = k + 1;
      if (countStrelki(d) !== 1) continue;
    }
    const keepMin = [0.35, 0.22, 0.15][level] * N;
    for (const c of shuffle(path.slice(1, -1), rng)) {
      if (given.filter(Boolean).length <= keepMin) break;
      const v = given[c];
      if (!v) continue;
      given[c] = 0;
      if (countStrelki(d) !== 1) given[c] = v;
    }
    return { data: d, sol };
  }
  throw new Error('стрелки: не сложилось');
}
