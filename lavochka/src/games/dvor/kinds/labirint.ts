/* Лабиринт: подвал, из которого надо выбраться. Совершенный лабиринт (между любыми клетками ровно один путь) —
 * случайный обход в глубину. Ответ — путь от входа до выхода по клеткам. Без DOM. */
import type { Rng } from '../../../core/types';
import { shuffle } from '../../../core/rng';

export interface LabData {
  w: number;
  h: number;
  /** Стены клетки: биты 1 — сверху, 2 — справа, 4 — снизу, 8 — слева. */
  walls: number[];
  start: number;
  end: number;
}

const DIRS = [
  { b: 1, dx: 0, dy: -1, o: 4 },
  { b: 2, dx: 1, dy: 0, o: 8 },
  { b: 4, dx: 0, dy: 1, o: 1 },
  { b: 8, dx: -1, dy: 0, o: 2 },
];

/** Можно ли пройти из a в b (соседи без стены). */
export function open(d: LabData, a: number, b: number): boolean {
  const ax = a % d.w;
  const ay = (a / d.w) | 0;
  for (const s of DIRS) {
    const nx = ax + s.dx;
    const ny = ay + s.dy;
    if (nx < 0 || ny < 0 || nx >= d.w || ny >= d.h) continue;
    if (ny * d.w + nx === b) return !(d.walls[a] & s.b);
  }
  return false;
}

export function solveLab(d: LabData): number[] {
  const prev = new Array(d.w * d.h).fill(-1);
  prev[d.start] = d.start;
  const q = [d.start];
  while (q.length) {
    const a = q.shift()!;
    if (a === d.end) break;
    const x = a % d.w;
    const y = (a / d.w) | 0;
    for (const s of DIRS) {
      const nx = x + s.dx;
      const ny = y + s.dy;
      if (nx < 0 || ny < 0 || nx >= d.w || ny >= d.h || d.walls[a] & s.b) continue;
      const b = ny * d.w + nx;
      if (prev[b] >= 0) continue;
      prev[b] = a;
      q.push(b);
    }
  }
  const path = [d.end];
  while (path[0] !== d.start) path.unshift(prev[path[0]]);
  return path;
}

export function checkLab(d: LabData, a: unknown): boolean {
  if (!Array.isArray(a) || a.length < 2 || a[0] !== d.start || a[a.length - 1] !== d.end) return false;
  for (let i = 1; i < a.length; i++) if (!Number.isInteger(a[i]) || !open(d, a[i - 1], a[i])) return false;
  return true;
}

/** Уровень: 0 — 7×7, 1 — 10×10, 2 — 14×12. Вход слева сверху, выход справа снизу (с разбросом). */
export function genLab(level: number, rng: Rng): { data: LabData; sol: number[] } {
  const [w, h] = [[7, 7], [10, 10], [14, 12]][level] ?? [10, 10];
  const walls = new Array(w * h).fill(15);
  const seen = new Array(w * h).fill(false);
  const stack = [rng.int(w * h)];
  seen[stack[0]] = true;
  while (stack.length) {
    const a = stack[stack.length - 1];
    const x = a % w;
    const y = (a / w) | 0;
    const next = shuffle(DIRS, rng).filter((s) => {
      const nx = x + s.dx;
      const ny = y + s.dy;
      return nx >= 0 && ny >= 0 && nx < w && ny < h && !seen[ny * w + nx];
    });
    if (!next.length) {
      stack.pop();
      continue;
    }
    const s = next[0];
    const b = (y + s.dy) * w + x + s.dx;
    walls[a] &= ~s.b;
    walls[b] &= ~s.o;
    seen[b] = true;
    stack.push(b);
  }
  const start = rng.int(Math.max(1, (h / 3) | 0)) * w;
  const end = (h - 1 - rng.int(Math.max(1, (h / 3) | 0))) * w + w - 1;
  const d: LabData = { w, h, walls, start, end };
  return { data: d, sol: solveLab(d) };
}
