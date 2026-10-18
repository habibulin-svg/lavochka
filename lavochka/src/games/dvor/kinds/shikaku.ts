/* Ножички (шикаку): «в ножички» землю делят ножом на участки. Поле надо разрезать на прямоугольники: в каждом
 * ровно одно число, и оно равно площади прямоугольника. Генератор: случайное разбиение на прямоугольники,
 * число в случайной клетке каждого; берём, если разбиение единственное. Без DOM. */
import type { Rng } from '../../../core/types';

export interface ShikakuData {
  w: number;
  h: number;
  /** Число (площадь) или 0. */
  nums: number[];
}

export type Rect = { x: number; y: number; w: number; h: number };

/** Прямоугольники, которые может занять число в клетке c. */
function rectsFor(d: ShikakuData, c: number): Rect[] {
  const n = d.nums[c];
  const cx = c % d.w;
  const cy = (c / d.w) | 0;
  const out: Rect[] = [];
  for (let rw = 1; rw <= n; rw++) {
    if (n % rw) continue;
    const rh = n / rw;
    if (rw > d.w || rh > d.h) continue;
    for (let x = Math.max(0, cx - rw + 1); x <= Math.min(cx, d.w - rw); x++)
      for (let y = Math.max(0, cy - rh + 1); y <= Math.min(cy, d.h - rh); y++) {
        let ok = true;
        for (let yy = y; yy < y + rh && ok; yy++) for (let xx = x; xx < x + rw && ok; xx++) if (yy * d.w + xx !== c && d.nums[yy * d.w + xx]) ok = false;
        if (ok) out.push({ x, y, w: rw, h: rh });
      }
  }
  return out;
}

const cellsOf = (d: { w: number }, r: Rect) => {
  const out: number[] = [];
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push(y * d.w + x);
  return out;
};

/** Число разбиений (до limit); первое — в out: номер клетки-числа для каждой клетки. */
export function countShikaku(d: ShikakuData, limit = 2, out?: number[]): number {
  const N = d.w * d.h;
  const clues = d.nums.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  if (clues.reduce((t, c) => t + d.nums[c], 0) !== N) return 0;
  const opts = new Map(clues.map((c) => [c, rectsFor(d, c).map((r) => cellsOf(d, r))]));
  const owner = new Array(N).fill(-1);
  let found = 0;
  const go = (left: number[]): void => {
    if (found >= limit) return;
    if (!left.length) {
      if (!found && out) out.splice(0, N, ...owner);
      found++;
      return;
    }
    // число с наименьшим выбором
    let best = -1;
    let bestOpts: number[][] = [];
    for (const c of left) {
      const fit = opts.get(c)!.filter((cs) => cs.every((i) => owner[i] < 0));
      if (best < 0 || fit.length < bestOpts.length) {
        best = c;
        bestOpts = fit;
        if (fit.length <= 1) break;
      }
    }
    if (!bestOpts.length) return;
    const rest = left.filter((c) => c !== best);
    for (const cs of bestOpts) {
      cs.forEach((i) => (owner[i] = best));
      go(rest);
      cs.forEach((i) => (owner[i] = -1));
      if (found >= limit) return;
    }
  };
  go(clues);
  return found;
}

export function solveShikaku(d: ShikakuData): number[] {
  const out = new Array(d.w * d.h).fill(-1);
  countShikaku(d, 1, out);
  return out;
}

/** Ответ: для каждой клетки — номер клетки-числа её участка. */
export function checkShikaku(d: ShikakuData, a: unknown): boolean {
  const N = d.w * d.h;
  if (!Array.isArray(a) || a.length !== N) return false;
  const g = a as number[];
  const groups = new Map<number, number[]>();
  for (let i = 0; i < N; i++) {
    const c = g[i];
    if (!Number.isInteger(c) || !d.nums[c]) return false;
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c)!.push(i);
  }
  if (groups.size !== d.nums.filter(Boolean).length) return false;
  for (const [c, cs] of groups) {
    if (!cs.includes(c) || cs.length !== d.nums[c]) return false;
    const xs = cs.map((i) => i % d.w);
    const ys = cs.map((i) => (i / d.w) | 0);
    const bw = Math.max(...xs) - Math.min(...xs) + 1;
    const bh = Math.max(...ys) - Math.min(...ys) + 1;
    if (bw * bh !== cs.length) return false;
  }
  return true;
}

/** Уровень: 0 — 5×5, 1 — 7×7, 2 — 9×9. */
export function genShikaku(level: number, rng: Rng): { data: ShikakuData; sol: number[] } {
  const n = [5, 7, 9][level] ?? 7;
  const maxA = [6, 8, 10][level] ?? 8;
  for (let attempt = 0; attempt < 400; attempt++) {
    const owner = new Array(n * n).fill(-1);
    const nums = new Array(n * n).fill(0);
    let ok = true;
    for (let i = 0; i < n * n && ok; i++) {
      if (owner[i] >= 0) continue;
      const x = i % n;
      const y = (i / n) | 0;
      // случайный прямоугольник от свободной клетки вправо-вниз
      const cand: Rect[] = [];
      for (let rw = 1; x + rw <= n; rw++)
        for (let rh = 1; y + rh <= n; rh++) {
          if (rw * rh > maxA || (rw * rh === 1 && level > 0)) continue;
          const r = { x, y, w: rw, h: rh };
          if (cellsOf({ w: n }, r).every((c) => owner[c] < 0)) cand.push(r);
        }
      if (!cand.length) {
        ok = false;
        break;
      }
      // крупные — чаще
      const r = cand[rng.int(cand.length)];
      const cs = cellsOf({ w: n }, r);
      const clue = cs[rng.int(cs.length)];
      cs.forEach((c) => (owner[c] = clue));
      nums[clue] = cs.length;
    }
    if (!ok) continue;
    if (nums.filter((v) => v === 1).length > 2) continue;
    const d: ShikakuData = { w: n, h: n, nums };
    if (countShikaku(d) !== 1) continue;
    return { data: d, sol: owner };
  }
  throw new Error('ножички: не сложилось');
}
