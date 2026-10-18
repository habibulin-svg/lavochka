/* Стопки кирпичей (небоскрёбы, «кого видно первым»): в каждой строке и столбце стопки высотой 1…n по разу.
 * Число с края — сколько стопок видно оттуда (высокая заслоняет те, что ниже, за ней). Генератор: случайный
 * латинский квадрат, все подсказки, потом убираем лишние, пока решение единственное. Без DOM. */
import type { Rng } from '../../../core/types';
import { shuffle } from '../../../core/rng';

export interface StopkiData {
  n: number;
  /** Подсказки по краям (0 — нет): сверху и снизу — по столбцам, слева и справа — по строкам. */
  top: number[];
  bottom: number[];
  left: number[];
  right: number[];
  /** Данные стопки (0 — пусто), n·n. */
  given: number[];
}

export function seen(line: number[]): number {
  let max = 0;
  let k = 0;
  for (const v of line) if (v > max) (max = v), k++;
  return k;
}

const row = (g: number[], n: number, r: number) => g.slice(r * n, r * n + n);
const col = (g: number[], n: number, c: number) => Array.from({ length: n }, (_, r) => g[r * n + c]);

function cluesOf(g: number[], n: number) {
  const top: number[] = [];
  const bottom: number[] = [];
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = col(g, n, i);
    const r = row(g, n, i);
    top.push(seen(c));
    bottom.push(seen(c.slice().reverse()));
    left.push(seen(r));
    right.push(seen(r.slice().reverse()));
  }
  return { top, bottom, left, right };
}

function perms(n: number): number[][] {
  if (n === 0) return [[]];
  return perms(n - 1).flatMap((p) => Array.from({ length: n }, (_, i) => [...p.slice(0, i), n, ...p.slice(i)]));
}
const PERMS: Record<number, number[][]> = {};

/** Число решений (до limit); первое — в out. Перебор строками: строки — перестановки, подходящие к подсказкам слева,
 * справа и данным стопкам; столбцы проверяем по ходу (без повторов, видно сверху не больше нужного) и в конце. */
export function countStopki(d: StopkiData, limit = 2, out?: number[]): number {
  const { n } = d;
  const all = (PERMS[n] ??= perms(n));
  const rows = Array.from({ length: n }, (_, r) =>
    all.filter(
      (p) =>
        (!d.left[r] || seen(p) === d.left[r]) &&
        (!d.right[r] || seen(p.slice().reverse()) === d.right[r]) &&
        p.every((v, c) => !d.given[r * n + c] || d.given[r * n + c] === v),
    ),
  );
  const colUsed = Array.from({ length: n }, () => new Array(n + 1).fill(false));
  const colMax = new Array(n).fill(0);
  const colSeen = new Array(n).fill(0);
  const pick: number[][] = [];
  let found = 0;
  const go = (r: number): void => {
    if (found >= limit) return;
    if (r === n) {
      for (let c = 0; c < n; c++) {
        const cl = pick.map((p) => p[c]);
        if (d.top[c] && seen(cl) !== d.top[c]) return;
        if (d.bottom[c] && seen(cl.reverse()) !== d.bottom[c]) return;
      }
      if (!found && out) out.splice(0, out.length, ...pick.flat());
      found++;
      return;
    }
    for (const p of rows[r]) {
      let ok = true;
      for (let c = 0; c < n && ok; c++) if (colUsed[c][p[c]] || (d.top[c] && colSeen[c] + (p[c] > colMax[c] ? 1 : 0) > d.top[c])) ok = false;
      if (!ok) continue;
      const saveMax = colMax.slice();
      const saveSeen = colSeen.slice();
      for (let c = 0; c < n; c++) {
        colUsed[c][p[c]] = true;
        if (p[c] > colMax[c]) (colMax[c] = p[c]), colSeen[c]++;
      }
      pick.push(p);
      go(r + 1);
      pick.pop();
      for (let c = 0; c < n; c++) colUsed[c][p[c]] = false;
      colMax.splice(0, n, ...saveMax);
      colSeen.splice(0, n, ...saveSeen);
      if (found >= limit) return;
    }
  };
  go(0);
  return found;
}

export function solveStopki(d: StopkiData): number[] {
  const out: number[] = [];
  countStopki(d, 1, out);
  return out;
}

export function checkStopki(d: StopkiData, a: unknown): boolean {
  const { n } = d;
  if (!Array.isArray(a) || a.length !== n * n) return false;
  const g = a as number[];
  if (g.some((v, i) => !Number.isInteger(v) || v < 1 || v > n || (d.given[i] && d.given[i] !== v))) return false;
  for (let i = 0; i < n; i++) {
    const r = row(g, n, i);
    const c = col(g, n, i);
    if (new Set(r).size !== n || new Set(c).size !== n) return false;
    if (d.left[i] && seen(r) !== d.left[i]) return false;
    if (d.right[i] && seen(r.slice().reverse()) !== d.right[i]) return false;
    if (d.top[i] && seen(c) !== d.top[i]) return false;
    if (d.bottom[i] && seen(c.slice().reverse()) !== d.bottom[i]) return false;
  }
  return true;
}

/** Случайный латинский квадрат n×n (числа 1…n): перебор с откатом в случайном порядке. */
export function latin(n: number, rng: Rng): number[] {
  const g = new Array(n * n).fill(0);
  const go = (i: number): boolean => {
    if (i === n * n) return true;
    const r = (i / n) | 0;
    const c = i % n;
    for (const v of shuffle([...Array(n).keys()].map((x) => x + 1), rng)) {
      let ok = true;
      for (let k = 0; k < n && ok; k++) if (g[r * n + k] === v || g[k * n + c] === v) ok = false;
      if (!ok) continue;
      g[i] = v;
      if (go(i + 1)) return true;
      g[i] = 0;
    }
    return false;
  };
  go(0);
  return g;
}

/** Уровень: 0 — 4×4, подсказок с запасом; 1 — 4×4, поменьше; 2 — 5×5. */
export function genStopki(level: number, rng: Rng): { data: StopkiData; sol: number[] } {
  const n = level === 2 ? 5 : 4;
  for (let attempt = 0; attempt < 200; attempt++) {
    const sol = latin(n, rng);
    const d: StopkiData = { n, ...cluesOf(sol, n), given: new Array(n * n).fill(0) };
    if (countStopki(d) !== 1) {
      // одних подсказок с краю мало — дадим пару стопок
      const cells = shuffle([...Array(n * n).keys()], rng);
      for (const i of cells) {
        d.given[i] = sol[i];
        if (countStopki(d) === 1) break;
      }
      if (countStopki(d) !== 1 || d.given.filter(Boolean).length > (level === 0 ? 3 : 2)) continue;
    }
    // убираем лишние подсказки с краю
    const slots = shuffle(
      (['top', 'bottom', 'left', 'right'] as const).flatMap((side) => [...Array(n).keys()].map((i) => [side, i] as const)),
      rng,
    );
    const keep = Math.ceil(slots.length * [0.6, 0.4, 0.3][level]);
    let left = slots.length;
    for (const [side, i] of slots) {
      if (left <= keep) break;
      const v = d[side][i];
      d[side][i] = 0;
      if (countStopki(d) !== 1) d[side][i] = v;
      else left--;
    }
    return { data: d, sol };
  }
  throw new Error('стопки: не сложилось');
}
