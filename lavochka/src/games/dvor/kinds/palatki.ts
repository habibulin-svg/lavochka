/* Палатки: двор пошёл в поход. У каждого дерева — своя палатка в соседней клетке (сбоку, сверху или снизу),
 * палатки не касаются друг друга даже углами. Число у строки и столбца — сколько в них палаток.
 * Генератор: деревья с палатками, подсчёт; берём, если расстановка единственная. Без DOM. */
import type { Rng } from '../../../core/types';
import { shuffle } from '../../../core/rng';

export interface PalatkiData {
  n: number;
  trees: number[];
  rows: number[];
  cols: number[];
}

const orth = (n: number, i: number) => {
  const x = i % n;
  const y = (i / n) | 0;
  const r: number[] = [];
  if (y > 0) r.push(i - n);
  if (x < n - 1) r.push(i + 1);
  if (y < n - 1) r.push(i + n);
  if (x > 0) r.push(i - 1);
  return r;
};
const around = (n: number, i: number) => {
  const x = i % n;
  const y = (i / n) | 0;
  const r: number[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < n && ny < n) r.push(ny * n + nx);
    }
  return r;
};

/** Есть ли у деревьев и палаток пара каждому (паросочетание по соседству). */
function matched(n: number, trees: number[], tents: number[]): boolean {
  const tentOf = new Map<number, number>();
  const tentSet = new Set(tents);
  const tryT = (t: number, seen: Set<number>): boolean => {
    for (const c of orth(n, t)) {
      if (!tentSet.has(c) || seen.has(c)) continue;
      seen.add(c);
      const prev = tentOf.get(c);
      if (prev == null || tryT(prev, seen)) {
        tentOf.set(c, t);
        return true;
      }
    }
    return false;
  };
  return trees.every((t) => tryT(t, new Set()));
}

/** Число расстановок (до limit); первая — в out (1 — палатка). */
export function countPalatki(d: PalatkiData, limit = 2, out?: number[]): number {
  const { n } = d;
  const tree = new Set(d.trees);
  const cand = [...Array(n * n).keys()].filter((i) => !tree.has(i) && orth(n, i).some((j) => tree.has(j)));
  const g = new Array(n * n).fill(0);
  const rowLeft = d.rows.slice();
  const colLeft = d.cols.slice();
  // сколько кандидатов осталось впереди в строке/столбце
  const rowAhead = new Array(n).fill(0);
  const colAhead = new Array(n).fill(0);
  for (const c of cand) rowAhead[(c / n) | 0]++, colAhead[c % n]++;
  let placed = 0;
  let found = 0;
  const go = (k: number): void => {
    if (found >= limit) return;
    if (k === cand.length) {
      if (placed !== d.trees.length || rowLeft.some(Boolean) || colLeft.some(Boolean)) return;
      const tents = cand.filter((c) => g[c]);
      if (!matched(n, d.trees, tents)) return;
      if (!found && out) out.splice(0, n * n, ...g);
      found++;
      return;
    }
    const c = cand[k];
    const r = (c / n) | 0;
    const col = c % n;
    rowAhead[r]--;
    colAhead[col]--;
    for (const v of [1, 0]) {
      if (v) {
        if (!rowLeft[r] || !colLeft[col] || around(n, c).some((j) => g[j])) continue;
      } else if (rowLeft[r] > rowAhead[r] || colLeft[col] > colAhead[col]) continue;
      g[c] = v;
      rowLeft[r] -= v;
      colLeft[col] -= v;
      placed += v;
      go(k + 1);
      g[c] = 0;
      rowLeft[r] += v;
      colLeft[col] += v;
      placed -= v;
      if (found >= limit) break;
    }
    rowAhead[r]++;
    colAhead[col]++;
  };
  go(0);
  return found;
}

export function solvePalatki(d: PalatkiData): number[] {
  const out = new Array(d.n * d.n).fill(0);
  countPalatki(d, 1, out);
  return out;
}

export function checkPalatki(d: PalatkiData, a: unknown): boolean {
  const { n } = d;
  if (!Array.isArray(a) || a.length !== n * n) return false;
  const g = a.map((v) => (v ? 1 : 0));
  const tree = new Set(d.trees);
  const tents = g.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  if (tents.length !== d.trees.length || tents.some((i) => tree.has(i))) return false;
  if (tents.some((i) => around(n, i).some((j) => g[j]))) return false;
  for (let i = 0; i < n; i++) {
    if (g.slice(i * n, i * n + n).reduce((t: number, v) => t + v, 0) !== d.rows[i]) return false;
    if (Array.from({ length: n }, (_, r) => g[r * n + i]).reduce((t: number, v) => t + v, 0) !== d.cols[i]) return false;
  }
  return matched(n, d.trees, tents);
}

/** Уровень: 0 — 6×6, 1 — 7×7, 2 — 8×8. */
export function genPalatki(level: number, rng: Rng): { data: PalatkiData; sol: number[] } {
  const n = 6 + level;
  const want = [6, 9, 12][level] ?? 9;
  for (let attempt = 0; attempt < 400; attempt++) {
    const g = new Array(n * n).fill(0); // 1 — палатка, 2 — дерево
    const trees: number[] = [];
    for (const c of shuffle([...Array(n * n).keys()], rng)) {
      if (trees.length >= want) break;
      if (g[c] || around(n, c).some((j) => g[j] === 1)) continue;
      const spots = shuffle(orth(n, c), rng).filter((t) => !g[t]);
      if (!spots.length) continue;
      g[c] = 1;
      g[spots[0]] = 2;
      trees.push(spots[0]);
    }
    if (trees.length < want) continue;
    const tents: number[] = g.map((v) => (v === 1 ? 1 : 0));
    const rows = Array.from({ length: n }, (_, r) => tents.slice(r * n, r * n + n).reduce((t, v) => t + v, 0));
    const cols = Array.from({ length: n }, (_, c) => Array.from({ length: n }, (_, r) => tents[r * n + c]).reduce((t, v) => t + v, 0));
    const d: PalatkiData = { n, trees: trees.sort((a, b) => a - b), rows, cols };
    if (countPalatki(d) !== 1) continue;
    return { data: d, sol: tents };
  }
  throw new Error('палатки: не сложилось');
}
