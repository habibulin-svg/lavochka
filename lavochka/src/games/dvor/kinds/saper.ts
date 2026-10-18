/* Сапёр: играют в «войнушку» — на поле мины. Часть клеток открыта, в них число — сколько мин вокруг (из восьми
 * соседей). Найти все мины; известно, сколько их всего. Решение единственное — угадывать не нужно. Без DOM. */
import type { Rng } from '../../../core/types';
import { shuffle } from '../../../core/rng';

export interface SaperData {
  w: number;
  h: number;
  /** -1 — закрыта; 0–8 — открыта, число мин вокруг. */
  open: number[];
  mines: number;
}

function neigh(w: number, h: number, i: number): number[] {
  const x = i % w;
  const y = (i / w) | 0;
  const r: number[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) r.push(ny * w + nx);
    }
  return r;
}

/** Число расстановок мин (до limit); первая — в out (1 — мина). */
export function countSaper(d: SaperData, limit = 2, out?: number[]): number {
  const { w, h } = d;
  const N = w * h;
  const NB = Array.from({ length: N }, (_, i) => neigh(w, h, i));
  const closed = d.open.map((v, i) => (v < 0 ? i : -1)).filter((i) => i >= 0);
  // сначала клетки, у которых есть открытые соседи — так ограничения срабатывают раньше
  closed.sort((a, b) => NB[b].filter((j) => d.open[j] >= 0).length - NB[a].filter((j) => d.open[j] >= 0).length);
  const mine = new Array(N).fill(0);
  const left = new Array(N).fill(0); // сколько закрытых соседей ещё не решено
  const have = new Array(N).fill(0); // сколько мин уже вокруг
  for (let i = 0; i < N; i++) if (d.open[i] >= 0) left[i] = NB[i].filter((j) => d.open[j] < 0).length;
  let found = 0;
  let placed = 0;
  const go = (k: number): void => {
    if (found >= limit) return;
    if (placed > d.mines || placed + (closed.length - k) < d.mines) return;
    if (k === closed.length) {
      if (placed !== d.mines) return;
      if (!found && out) out.splice(0, N, ...mine);
      found++;
      return;
    }
    const c = closed[k];
    for (const v of [0, 1]) {
      let ok = true;
      for (const j of NB[c]) {
        if (d.open[j] < 0) continue;
        const hv = have[j] + v;
        if (hv > d.open[j] || hv + left[j] - 1 < d.open[j]) ok = false;
      }
      if (!ok) continue;
      mine[c] = v;
      placed += v;
      for (const j of NB[c]) if (d.open[j] >= 0) (have[j] += v), left[j]--;
      go(k + 1);
      for (const j of NB[c]) if (d.open[j] >= 0) (have[j] -= v), left[j]++;
      placed -= v;
      mine[c] = 0;
      if (found >= limit) return;
    }
  };
  go(0);
  return found;
}

export function solveSaper(d: SaperData): number[] {
  const out = new Array(d.w * d.h).fill(0);
  countSaper(d, 1, out);
  return out.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
}

export function checkSaper(d: SaperData, a: unknown): boolean {
  if (!Array.isArray(a) || a.length !== d.mines || new Set(a).size !== a.length) return false;
  const m = new Set(a as number[]);
  if ([...m].some((i) => !Number.isInteger(i) || d.open[i] !== -1)) return false;
  return d.open.every((v, i) => v < 0 || neigh(d.w, d.h, i).filter((j) => m.has(j)).length === v);
}

/** Уровень: 0 — 6×6, 6 мин; 1 — 7×7, 9 мин; 2 — 8×8, 13 мин. Открытых клеток всё меньше. */
export function genSaper(level: number, rng: Rng): { data: SaperData; sol: number[] } {
  const [w, h, m] = [[6, 6, 6], [7, 7, 9], [8, 8, 13]][level] ?? [7, 7, 9];
  const N = w * h;
  for (let attempt = 0; attempt < 100; attempt++) {
    const mines = new Set(shuffle([...Array(N).keys()], rng).slice(0, m));
    const open = [...Array(N).keys()].map((i) => (mines.has(i) ? -1 : neigh(w, h, i).filter((j) => mines.has(j)).length));
    const d: SaperData = { w, h, open, mines: m };
    // закрываем открытые клетки, пока мины находятся однозначно
    const keep = [0.55, 0.4, 0.3][level] * N;
    for (const i of shuffle([...Array(N).keys()], rng)) {
      if (open.filter((v) => v >= 0).length <= keep) break;
      if (open[i] < 0) continue;
      const v = open[i];
      open[i] = -1;
      if (countSaper(d) !== 1) open[i] = v;
    }
    const sol = [...mines].sort((a, b) => a - b);
    return { data: d, sol };
  }
  throw new Error('сапёр: не сложилось');
}
