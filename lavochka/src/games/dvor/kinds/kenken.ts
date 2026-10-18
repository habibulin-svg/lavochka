/* Квадрат (кен-кен): в каждой строке и столбце числа 1…n по разу; поле разбито на загоны, у загона —
 * результат и действие (+ − × :). Генератор: случайный латинский квадрат, случайные загоны по 1–3 клетки,
 * действие по числам; берём, только если решение единственное. Без DOM. */
import type { Rng } from '../../../core/types';
import { shuffle } from '../../../core/rng';
import { latin } from './stopki';

export type Op = '+' | '-' | '*' | '/' | '=';

export interface Cage {
  cells: number[];
  op: Op;
  v: number;
}

export interface KenkenData {
  n: number;
  cages: Cage[];
}

export function cageOk(c: Cage, vals: number[]): boolean {
  switch (c.op) {
    case '=':
      return vals[0] === c.v;
    case '+':
      return vals.reduce((a, b) => a + b, 0) === c.v;
    case '*':
      return vals.reduce((a, b) => a * b, 1) === c.v;
    case '-':
      return Math.abs(vals[0] - vals[1]) === c.v;
    case '/':
      return Math.max(vals[0], vals[1]) === c.v * Math.min(vals[0], vals[1]);
  }
}

/** Число решений (до limit); первое — в out. */
export function countKenken(d: KenkenData, limit = 2, out?: number[]): number {
  const { n } = d;
  const g = new Array(n * n).fill(0);
  const cageOf = new Array(n * n).fill(-1);
  d.cages.forEach((c, k) => c.cells.forEach((i) => (cageOf[i] = k)));
  // загон проверяем, когда заполнена его последняя (по порядку обхода) клетка; сумму и произведение — и раньше
  const lastOf = d.cages.map((c) => Math.max(...c.cells));
  const rowUsed = Array.from({ length: n }, () => new Array(n + 1).fill(false));
  const colUsed = Array.from({ length: n }, () => new Array(n + 1).fill(false));
  let found = 0;
  const go = (i: number): void => {
    if (found >= limit) return;
    if (i === n * n) {
      if (!found && out) out.splice(0, out.length, ...g);
      found++;
      return;
    }
    const r = (i / n) | 0;
    const c = i % n;
    const k = cageOf[i];
    const cage = d.cages[k];
    for (let v = 1; v <= n; v++) {
      if (rowUsed[r][v] || colUsed[c][v]) continue;
      g[i] = v;
      let ok = true;
      if (lastOf[k] === i) ok = cageOk(cage, cage.cells.map((j) => g[j]));
      else if (cage.op === '+') ok = cage.cells.reduce((t, j) => t + g[j], 0) < cage.v;
      else if (cage.op === '*') ok = cage.v % cage.cells.reduce((t, j) => t * (g[j] || 1), 1) === 0;
      if (ok) {
        rowUsed[r][v] = colUsed[c][v] = true;
        go(i + 1);
        rowUsed[r][v] = colUsed[c][v] = false;
      }
      g[i] = 0;
      if (found >= limit) return;
    }
  };
  go(0);
  return found;
}

export function solveKenken(d: KenkenData): number[] {
  const out: number[] = [];
  countKenken(d, 1, out);
  return out;
}

export function checkKenken(d: KenkenData, a: unknown): boolean {
  const { n } = d;
  if (!Array.isArray(a) || a.length !== n * n) return false;
  const g = a as number[];
  if (g.some((v) => !Number.isInteger(v) || v < 1 || v > n)) return false;
  for (let i = 0; i < n; i++) {
    if (new Set(g.slice(i * n, i * n + n)).size !== n) return false;
    if (new Set(Array.from({ length: n }, (_, r) => g[r * n + i])).size !== n) return false;
  }
  return d.cages.every((c) => cageOk(c, c.cells.map((j) => g[j])));
}

/** Случайные загоны по 1–max клеток (связные), одиночек немного. */
function cagesOf(n: number, max: number, singles: number, rng: Rng): number[][] {
  const free = new Array(n * n).fill(true);
  const out: number[][] = [];
  let ones = 0;
  for (const s of shuffle([...Array(n * n).keys()], rng)) {
    if (!free[s]) continue;
    free[s] = false;
    const cage = [s];
    const want = 1 + rng.int(max) + (rng.next() < 0.3 ? 0 : 1);
    while (cage.length < Math.min(max, want)) {
      const nb = cage.flatMap((i) => [i - n, i + n, i % n ? i - 1 : -1, (i + 1) % n ? i + 1 : -1]).filter((j) => j >= 0 && j < n * n && free[j]);
      if (!nb.length) break;
      const j = nb[rng.int(nb.length)];
      free[j] = false;
      cage.push(j);
    }
    if (cage.length === 1) ones++;
    out.push(cage);
  }
  return ones > singles ? [] : out;
}

/** Уровень: 0 — 4×4, только + и −; 1 — 4×4, все действия; 2 — 5×5, все действия. */
export function genKenken(level: number, rng: Rng): { data: KenkenData; sol: number[] } {
  const n = level === 2 ? 5 : 4;
  for (let attempt = 0; attempt < 400; attempt++) {
    const sol = latin(n, rng);
    const parts = cagesOf(n, 3, level === 0 ? 3 : 2, rng);
    if (!parts.length) continue;
    const cages: Cage[] = parts.map((cells) => {
      cells.sort((a, b) => a - b);
      const vals = cells.map((i) => sol[i]);
      if (cells.length === 1) return { cells, op: '=', v: vals[0] };
      const hi = Math.max(...vals);
      const lo = Math.min(...vals);
      if (cells.length === 2) {
        if (level > 0 && hi % lo === 0 && hi !== lo && rng.next() < 0.5) return { cells, op: '/', v: hi / lo };
        const r = rng.next();
        if (r < 0.45) return { cells, op: '-', v: hi - lo };
        if (level > 0 && r < 0.7) return { cells, op: '*', v: hi * lo };
        return { cells, op: '+', v: hi + lo };
      }
      if (level > 0 && rng.next() < 0.45) return { cells, op: '*', v: vals.reduce((a, b) => a * b, 1) };
      return { cells, op: '+', v: vals.reduce((a, b) => a + b, 0) };
    });
    const d: KenkenData = { n, cages };
    if (countKenken(d) !== 1) continue;
    return { data: d, sol };
  }
  throw new Error('квадрат: не сложилось');
}

export const OP_SIGN: Record<Op, string> = { '+': '+', '-': '−', '*': '×', '/': ':', '=': '' };
