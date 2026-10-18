/* Грядки (латинский квадрат с областями): огород у бабушки разбит на грядки. В каждой строке, каждом столбце и на
 * каждой грядке — все овощи по одному. Часть посажена — досадить остальное. Генератор: случайные связные грядки,
 * решение перебором, лишние данные убираем, пока решение единственное. Без DOM. */
import type { Rng } from '../../../core/types';
import { shuffle } from '../../../core/rng';

export const VEG = ['🥕', '🥔', '🧅', '🥒', '🍅', '🌽'];
export const VEG_NAMES = ['морковь', 'картошка', 'лук', 'огурец', 'помидор', 'кукуруза'];

export interface GryadkiData {
  n: number;
  /** Номер грядки у клетки. */
  reg: number[];
  /** Посажено: 1…n (номер овоща) или 0. */
  given: number[];
}

/** Число решений (до limit); первое — в out. */
export function countGryadki(d: GryadkiData, limit = 2, out?: number[]): number {
  const { n } = d;
  const N = n * n;
  const g = d.given.slice();
  const row = Array.from({ length: n }, () => new Array(n + 1).fill(false));
  const col = Array.from({ length: n }, () => new Array(n + 1).fill(false));
  const reg = Array.from({ length: n }, () => new Array(n + 1).fill(false));
  for (let i = 0; i < N; i++) {
    const v = g[i];
    if (!v) continue;
    const r = (i / n) | 0;
    const c = i % n;
    if (row[r][v] || col[c][v] || reg[d.reg[i]][v]) return 0;
    row[r][v] = col[c][v] = reg[d.reg[i]][v] = true;
  }
  let found = 0;
  const go = (): void => {
    if (found >= limit) return;
    // пустая клетка с наименьшим числом вариантов
    let best = -1;
    let bestV: number[] = [];
    for (let i = 0; i < N; i++) {
      if (g[i]) continue;
      const r = (i / n) | 0;
      const c = i % n;
      const vs: number[] = [];
      for (let v = 1; v <= n; v++) if (!row[r][v] && !col[c][v] && !reg[d.reg[i]][v]) vs.push(v);
      if (best < 0 || vs.length < bestV.length) {
        best = i;
        bestV = vs;
        if (vs.length <= 1) break;
      }
    }
    if (best < 0) {
      if (!found && out) out.splice(0, N, ...g);
      found++;
      return;
    }
    const r = (best / n) | 0;
    const c = best % n;
    const k = d.reg[best];
    for (const v of bestV) {
      g[best] = v;
      row[r][v] = col[c][v] = reg[k][v] = true;
      go();
      row[r][v] = col[c][v] = reg[k][v] = false;
      g[best] = 0;
      if (found >= limit) return;
    }
  };
  go();
  return found;
}

export function solveGryadki(d: GryadkiData): number[] {
  const out = new Array(d.n * d.n).fill(0);
  countGryadki(d, 1, out);
  return out;
}

export function checkGryadki(d: GryadkiData, a: unknown): boolean {
  const { n } = d;
  if (!Array.isArray(a) || a.length !== n * n) return false;
  const g = a as number[];
  if (g.some((v, i) => !Number.isInteger(v) || v < 1 || v > n || (d.given[i] && d.given[i] !== v))) return false;
  for (let k = 0; k < n; k++) {
    if (new Set(g.slice(k * n, k * n + n)).size !== n) return false;
    if (new Set(Array.from({ length: n }, (_, r) => g[r * n + k])).size !== n) return false;
    if (new Set(g.filter((_, i) => d.reg[i] === k)).size !== n) return false;
  }
  return true;
}

/** Случайные n связных грядок по n клеток (рост от семян с откатом попыток). */
function regions(n: number, rng: Rng): number[] | null {
  const N = n * n;
  const nb = (i: number) => {
    const x = i % n;
    const y = (i / n) | 0;
    return [y > 0 ? i - n : -1, x < n - 1 ? i + 1 : -1, y < n - 1 ? i + n : -1, x > 0 ? i - 1 : -1].filter((j) => j >= 0);
  };
  for (let t = 0; t < 200; t++) {
    const reg = new Array(N).fill(-1);
    const size = new Array(n).fill(0);
    const seeds = shuffle([...Array(N).keys()], rng).slice(0, n);
    seeds.forEach((s, k) => ((reg[s] = k), (size[k] = 1)));
    let stuck = false;
    while (!stuck && size.some((s) => s < n)) {
      stuck = true;
      for (const k of shuffle([...Array(n).keys()], rng)) {
        if (size[k] >= n) continue;
        const front = [...Array(N).keys()].filter((i) => reg[i] === k).flatMap(nb).filter((j) => reg[j] < 0);
        if (!front.length) continue;
        reg[front[rng.int(front.length)]] = k;
        size[k]++;
        stuck = false;
      }
    }
    if (size.every((s) => s === n)) return reg;
  }
  return null;
}

/** Уровень: 0 — 4×4, 1 — 5×5, 2 — 6×6. */
export function genGryadki(level: number, rng: Rng): { data: GryadkiData; sol: number[] } {
  const n = level + 4;
  const N = n * n;
  for (let attempt = 0; attempt < 300; attempt++) {
    const reg = regions(n, rng);
    if (!reg) continue;
    // случайное решение: перебор с перемешанным порядком значений
    const d0: GryadkiData = { n, reg, given: new Array(N).fill(0) };
    const sol = new Array(N).fill(0);
    const order = shuffle([...Array(N).keys()], rng);
    for (const i of order.slice(0, n)) {
      // пара случайных затравок, чтобы решения были разными
      d0.given[i] = 1 + rng.int(n);
      if (countGryadki(d0, 1) === 0) d0.given[i] = 0;
    }
    if (!countGryadki(d0, 1, sol)) continue;
    const given = sol.slice();
    const d: GryadkiData = { n, reg, given };
    for (const i of shuffle([...Array(N).keys()], rng)) {
      const v = given[i];
      given[i] = 0;
      if (countGryadki(d) !== 1) given[i] = v;
    }
    // на лёгкой — оставим чуть больше посаженного
    if (level === 0) for (const i of shuffle([...Array(N).keys()], rng).slice(0, 2)) given[i] = sol[i];
    return { data: d, sol };
  }
  throw new Error('грядки: не сложилось');
}
