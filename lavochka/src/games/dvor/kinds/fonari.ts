/* Фонари (Light Up): вечером двор надо осветить. Фонарь светит по строке и столбцу до стены (тёмной клетки);
 * два фонаря не должны светить друг на друга. Число на стене — сколько фонарей стоит рядом с ней (сбоку, сверху,
 * снизу). Осветить все белые клетки. Генератор: стены, жадная расстановка фонарей, числа; лишние числа убираем,
 * пока решение единственное. Без DOM. */
import type { Rng } from '../../../core/types';
import { shuffle } from '../../../core/rng';

export interface FonariData {
  n: number;
  /** -2 — стена без числа, 0–4 — стена с числом, -1 — белая клетка. */
  cells: number[];
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

/** Белые клетки, которые видит клетка i (по строке и столбцу до стены), включая её саму. */
function sight(d: FonariData, i: number): number[] {
  const { n } = d;
  const out = [i];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    let x = (i % n) + dx;
    let y = ((i / n) | 0) + dy;
    while (x >= 0 && y >= 0 && x < n && y < n && d.cells[y * n + x] === -1) {
      out.push(y * n + x);
      x += dx;
      y += dy;
    }
  }
  return out;
}

/** Число расстановок (до limit); первая — в out (1 — фонарь). */
export function countFonari(d: FonariData, limit = 2, out?: number[]): number {
  const { n } = d;
  const N = n * n;
  const SEE = d.cells.map((v, i) => (v === -1 ? sight(d, i) : []));
  const bulb = new Array(N).fill(0);
  const lit = new Array(N).fill(0);
  const banned = new Array(N).fill(0); // нельзя: рядом со стеной «0» или стена уже набрала своё
  const walls = d.cells.map((v, i) => (v >= 0 ? i : -1)).filter((i) => i >= 0);
  const near = (w: number) => orth(n, w).filter((j) => d.cells[j] === -1);
  for (const w of walls) if (d.cells[w] === 0) for (const j of near(w)) banned[j]++;
  let found = 0;
  const wallOk = (final: boolean) =>
    walls.every((w) => {
      const nb = near(w);
      const have = nb.filter((j) => bulb[j]).length;
      const can = nb.filter((j) => !bulb[j] && !lit[j] && !banned[j]).length;
      return have <= d.cells[w] && (final ? have === d.cells[w] : have + can >= d.cells[w]);
    });
  const put = (i: number, v: number) => {
    bulb[i] += v;
    for (const j of SEE[i]) lit[j] += v;
  };
  const go = (): void => {
    if (found >= limit) return;
    if (!wallOk(false)) return;
    // неосвещённая клетка с наименьшим числом мест для фонаря, который её осветит
    let best = -1;
    let bestOpts: number[] = [];
    for (let i = 0; i < N; i++) {
      if (d.cells[i] !== -1 || lit[i]) continue;
      const opts = SEE[i].filter((j) => !lit[j] && !banned[j]);
      if (best < 0 || opts.length < bestOpts.length) {
        best = i;
        bestOpts = opts;
        if (opts.length <= 1) break;
      }
    }
    if (best < 0) {
      if (!wallOk(true)) return;
      if (!found && out) out.splice(0, N, ...bulb);
      found++;
      return;
    }
    // ветвимся: фонарь в одном из мест; чтобы не считать одно решение дважды, отвергнутые места запрещаем дальше
    const undo: number[] = [];
    for (const j of bestOpts) {
      put(j, 1);
      go();
      put(j, -1);
      if (found >= limit) break;
      banned[j]++;
      undo.push(j);
    }
    for (const j of undo) banned[j]--;
  };
  go();
  return found;
}

export function solveFonari(d: FonariData): number[] {
  const out = new Array(d.n * d.n).fill(0);
  countFonari(d, 1, out);
  return out;
}

export function checkFonari(d: FonariData, a: unknown): boolean {
  const { n } = d;
  if (!Array.isArray(a) || a.length !== n * n) return false;
  const b = a.map((v) => (v ? 1 : 0));
  const lit = new Array(n * n).fill(0);
  for (let i = 0; i < n * n; i++) {
    if (!b[i]) continue;
    if (d.cells[i] !== -1) return false;
    const s = sight(d, i);
    if (s.some((j) => j !== i && b[j])) return false;
    s.forEach((j) => lit[j]++);
  }
  if (d.cells.some((v, i) => v === -1 && !lit[i])) return false;
  return d.cells.every((v, i) => v < 0 || orth(n, i).filter((j) => b[j]).length === v);
}

/** Уровень: 0 — 6×6, 1 — 7×7, 2 — 8×8. */
export function genFonari(level: number, rng: Rng): { data: FonariData; sol: number[] } {
  const n = 6 + level;
  const N = n * n;
  for (let attempt = 0; attempt < 300; attempt++) {
    // стены — симметрично центру, ~20 %
    const cells = new Array(N).fill(-1);
    for (let i = 0; i < N / 2; i++) if (rng.next() < 0.2) cells[i] = cells[N - 1 - i] = -2;
    const d: FonariData = { n, cells };
    // жадно ставим фонари, пока всё не освещено
    const bulb = new Array(N).fill(0);
    const lit = new Array(N).fill(0);
    for (const i of shuffle([...Array(N).keys()], rng)) {
      if (cells[i] !== -1 || lit[i]) continue;
      bulb[i] = 1;
      sight(d, i).forEach((j) => lit[j]++);
    }
    // числа на всех стенах
    for (let i = 0; i < N; i++) if (cells[i] === -2) cells[i] = orth(n, i).filter((j) => bulb[j]).length;
    if (countFonari(d) !== 1) continue;
    // убираем числа, пока единственность держится
    for (const i of shuffle([...Array(N).keys()], rng)) {
      if (cells[i] < 0) continue;
      const v = cells[i];
      cells[i] = -2;
      if (countFonari(d) !== 1) cells[i] = v;
    }
    return { data: d, sol: bulb };
  }
  throw new Error('фонари: не сложилось');
}
