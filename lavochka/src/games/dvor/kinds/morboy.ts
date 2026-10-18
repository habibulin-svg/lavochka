/* Морской бой по числам (бимару): флот известен, корабли не касаются даже углами. У каждой строки и столбца —
 * сколько в них палуб. Несколько клеток открыты (вода или палуба). Найти весь флот. Решение единственное. Без DOM. */
import type { Rng } from '../../../core/types';
import { shuffle } from '../../../core/rng';

export interface MorboyData {
  n: number;
  /** Длины кораблей, по убыванию. */
  fleet: number[];
  rows: number[];
  cols: number[];
  /** Открытые клетки: 0 — не открыта, 1 — вода, 2 — палуба. */
  shown: number[];
}

type Ship = { at: number; len: number; vert: boolean };

const cellsOf = (n: number, s: Ship) => Array.from({ length: s.len }, (_, k) => (s.vert ? s.at + k * n : s.at + k));

/** Число расстановок (до limit); первая — в out (1 — палуба). */
export function countMorboy(d: MorboyData, limit = 2, out?: number[]): number {
  const { n } = d;
  const g = new Array(n * n).fill(0); // 1 — палуба
  const block = new Array(n * n).fill(0); // сколько кораблей рядом/под клеткой
  const rowLeft = d.rows.slice();
  const colLeft = d.cols.slice();
  let found = 0;
  const fits = (s: Ship): boolean => {
    const x = s.at % n;
    const y = (s.at / n) | 0;
    if (s.vert ? y + s.len > n : x + s.len > n) return false;
    for (const c of cellsOf(n, s)) if (block[c] || d.shown[c] === 1) return false;
    if (s.vert) {
      if (rowLeft.slice(y, y + s.len).some((v) => v < 1) || colLeft[x] < s.len) return false;
    } else if (rowLeft[y] < s.len || colLeft.slice(x, x + s.len).some((v) => v < 1)) return false;
    return true;
  };
  const mark = (s: Ship, v: number) => {
    const cs = cellsOf(n, s);
    for (const c of cs) {
      g[c] += v;
      rowLeft[(c / n) | 0] -= v;
      colLeft[c % n] -= v;
      const x = c % n;
      const y = (c / n) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < n && ny < n) block[ny * n + nx] += v;
        }
    }
  };
  const go = (k: number, from: number): void => {
    if (found >= limit) return;
    if (k === d.fleet.length) {
      if (rowLeft.some(Boolean) || colLeft.some(Boolean)) return;
      if (d.shown.some((v, i) => v === 2 && !g[i])) return;
      if (!found && out) out.splice(0, n * n, ...g);
      found++;
      return;
    }
    const len = d.fleet[k];
    // одинаковые корабли ставим по возрастанию позиции — без повторов перестановок
    const start = k > 0 && d.fleet[k - 1] === len ? from : 0;
    for (let at = start; at < n * n; at++)
      for (const vert of len === 1 ? [false] : [false, true]) {
        const s = { at, len, vert };
        if (!fits(s)) continue;
        mark(s, 1);
        go(k + 1, at + 1);
        mark(s, -1);
        if (found >= limit) return;
      }
  };
  go(0, 0);
  return found;
}

export function solveMorboy(d: MorboyData): number[] {
  const out = new Array(d.n * d.n).fill(0);
  countMorboy(d, 1, out);
  return out;
}

/** Ответ — палубы (1) по клеткам. Проверяем строки, столбцы, флот и что корабли не касаются. */
export function checkMorboy(d: MorboyData, a: unknown): boolean {
  const { n } = d;
  if (!Array.isArray(a) || a.length !== n * n) return false;
  const g: number[] = a.map((v) => (v ? 1 : 0));
  if (d.shown.some((v, i) => (v === 2 && !g[i]) || (v === 1 && g[i]))) return false;
  for (let i = 0; i < n; i++) {
    if (g.slice(i * n, i * n + n).reduce((t, v) => t + v, 0) !== d.rows[i]) return false;
    if (Array.from({ length: n }, (_, r) => g[r * n + i]).reduce((t, v) => t + v, 0) !== d.cols[i]) return false;
  }
  // диагональные касания запрещены
  for (let i = 0; i < n * n; i++) {
    if (!g[i]) continue;
    const x = i % n;
    const y = (i / n) | 0;
    for (const [dx, dy] of [[1, 1], [-1, 1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < n && ny < n && g[ny * n + nx]) return false;
    }
  }
  // корабли — прямые отрезки нужных длин
  const seen = new Array(n * n).fill(false);
  const lens: number[] = [];
  for (let i = 0; i < n * n; i++) {
    if (!g[i] || seen[i]) continue;
    let len = 0;
    const right = i % n < n - 1 && g[i + 1];
    for (let c = i; c < n * n && g[c] && !seen[c]; c += right ? 1 : n) {
      if (right && (c / n | 0) !== (i / n | 0)) break;
      seen[c] = true;
      len++;
    }
    lens.push(len);
  }
  return lens.sort((p, q) => q - p).join() === d.fleet.join();
}

/** Уровень: 0 — 6×6; 1 — 7×7; 2 — 8×8 с флотом побольше. */
export function genMorboy(level: number, rng: Rng): { data: MorboyData; sol: number[] } {
  const n = 6 + level;
  const fleet = [[3, 2, 2, 1, 1], [3, 3, 2, 2, 1, 1], [4, 3, 2, 2, 1, 1, 1]][level];
  for (let attempt = 0; attempt < 200; attempt++) {
    // случайная расстановка
    const g = new Array(n * n).fill(0);
    const block = new Array(n * n).fill(false);
    let ok = true;
    for (const len of fleet) {
      const opts: Ship[] = [];
      for (let at = 0; at < n * n; at++)
        for (const vert of [false, true]) {
          const x = at % n;
          const y = (at / n) | 0;
          if (vert ? y + len > n : x + len > n) continue;
          const s = { at, len, vert };
          if (cellsOf(n, s).every((c) => !block[c])) opts.push(s);
        }
      if (!opts.length) {
        ok = false;
        break;
      }
      const s = opts[rng.int(opts.length)];
      for (const c of cellsOf(n, s)) {
        g[c] = 1;
        const x = c % n;
        const y = (c / n) | 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < n && ny < n) block[ny * n + nx] = true;
          }
      }
    }
    if (!ok) continue;
    const rows = Array.from({ length: n }, (_, r) => g.slice(r * n, r * n + n).reduce((t, v) => t + v, 0));
    const cols = Array.from({ length: n }, (_, c) => Array.from({ length: n }, (_, r) => g[r * n + c]).reduce((t, v) => t + v, 0));
    const d: MorboyData = { n, fleet, rows, cols, shown: new Array(n * n).fill(0) };
    // открываем клетки, пока решение не станет единственным
    const cells = shuffle([...Array(n * n).keys()], rng);
    let k = 0;
    while (countMorboy(d) !== 1 && k < cells.length) {
      const c = cells[k++];
      d.shown[c] = g[c] ? 2 : 1;
    }
    const maxShown = [6, 5, 5][level];
    if (d.shown.filter(Boolean).length > maxShown) continue;
    // лишние открытые закрываем обратно
    for (const c of shuffle(d.shown.map((v, i) => (v ? i : -1)).filter((i) => i >= 0), rng)) {
      const v = d.shown[c];
      d.shown[c] = 0;
      if (countMorboy(d) !== 1) d.shown[c] = v;
    }
    return { data: d, sol: g };
  }
  throw new Error('морской бой: не сложилось');
}
