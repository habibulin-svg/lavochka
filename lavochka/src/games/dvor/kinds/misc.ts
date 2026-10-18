/* Волна 6 «А у нас во дворе»: картинка по клеткам (нонограмма — генератор из «Головоломок»), найди одиночку,
 * матрица 3×3 (что дальше), кружки (диаграмма Венна). Без DOM. */
import type { Rng } from '../../../core/types';
import { shuffle } from '../../../core/rng';
import { cluesOf, generate as genPicross, lineSolve, type Clues } from '../../puzzles/picross';

// ---------------------------------------------------------------- картинка (нонограмма)

export interface KartinkaData {
  w: number;
  h: number;
  rows: Clues;
  cols: Clues;
  /** Открытые клетки: [номер, 0/1]. */
  open: [number, number][];
}

export function genKartinka(level: number, rng: Rng): { data: KartinkaData; sol: number[] } {
  const [w, h] = [[5, 5], [8, 8], [10, 10]][level] ?? [8, 8];
  const p = genPicross(rng, w, h, level + 1);
  return { data: { w, h, rows: p.rows, cols: p.cols, open: p.given.map((i) => [i, p.solution[i]]) }, sol: p.solution };
}

export function solveKartinka(d: KartinkaData): number[] {
  const known = new Array(d.w * d.h).fill(-1);
  d.open.forEach(([i, v]) => (known[i] = v));
  return (lineSolve(d.w, d.h, d.rows, d.cols, known) ?? known).map((v) => (v === 1 ? 1 : 0));
}

/** Любая картинка с теми же числами — верная. */
export function checkKartinka(d: KartinkaData, a: unknown): boolean {
  if (!Array.isArray(a) || a.length !== d.w * d.h) return false;
  const g = a.map((v) => (v === 1 ? 1 : 0));
  for (let r = 0; r < d.h; r++) if (cluesOf(g.slice(r * d.w, r * d.w + d.w)).join() !== d.rows[r].join()) return false;
  for (let c = 0; c < d.w; c++) if (cluesOf(Array.from({ length: d.h }, (_, r) => g[r * d.w + c])).join() !== d.cols[c].join()) return false;
  return true;
}

// ---------------------------------------------------------------- найди одиночку

/** Значки: вещи из детства во дворе. */
export const ICONS = ['⚽', '🏀', '🪀', '🪁', '🚲', '🛴', '🧸', '🎈', '🍬', '🍭', '🍦', '🍎', '🍐', '🍒', '🥕', '🐱', '🐶', '🐦', '🐞', '🌻', '🌳', '🍄', '⭐', '🌙', '☀️', '🔑', '🎲', '🧩', '📻', '⏰', '🔦', '🧲'];

export interface OdinData {
  /** Значки по клеткам. */
  cells: string[];
  cols: number;
}

export function genOdin(level: number, rng: Rng): { data: OdinData; sol: number } {
  const pairs = [7, 12, 17][level] ?? 12;
  const icons = shuffle(ICONS, rng).slice(0, pairs + 1);
  const single = icons[pairs];
  // на трудной некоторые значки встречаются по 4 раза — так одиночку дольше искать
  const bag = icons.slice(0, pairs).flatMap((x, i) => (level === 2 && i < 3 ? [x, x, x, x] : [x, x]));
  bag.push(single);
  const cells = shuffle(bag, rng);
  const cols = [5, 6, 7][level] ?? 6;
  return { data: { cells, cols }, sol: cells.indexOf(single) };
}

export const solveOdin = (d: OdinData) => d.cells.findIndex((x) => d.cells.filter((y) => y === x).length === 1);

// ---------------------------------------------------------------- матрица 3×3

export interface Fig {
  shape: number;
  color: number;
  count: number;
}

export const SHAPES = ['круг', 'квадрат', 'треугольник', 'ромб'];
export const COLORS = ['#b3261e', '#23408f', '#2a7a3a', '#d08a10'];

export interface MatrixData {
  /** 8 клеток по строкам (девятая — «?»). */
  cells: Fig[];
  options: Fig[];
}

const ATTRS = ['shape', 'color', 'count'] as const;
const ATTR_N = { shape: 4, color: 4, count: 3 };
const figKey = (f: Fig) => `${f.shape}${f.color}${f.count}`;

/** Подходит ли фигура на место «?»: признак, одинаковый внутри первых двух строк, одинаков и в третьей;
 * признак, разный внутри строк, в третьей строке — те же три значения, что в первой. */
export function fitsMatrix(cells: Fig[], f: Fig): boolean {
  const rows = [cells.slice(0, 3), cells.slice(3, 6), [...cells.slice(6, 8), f]];
  return ATTRS.every((a) => {
    const same = rows.slice(0, 2).every((r) => new Set(r.map((x) => x[a])).size === 1);
    const last = rows[2].map((x) => x[a]);
    if (same) return new Set(last).size === 1;
    return new Set(last).size === 3 && [...new Set(rows[0].map((x) => x[a]))].sort().join() === [...new Set(last)].sort().join();
  });
}

/** Уровень: 0 — по строке меняется один признак; 1 — два; 2 — два, а постоянный признак свой в каждой строке. */
export function genMatrix(level: number, rng: Rng): { data: MatrixData; sol: number } {
  for (let attempt = 0; attempt < 400; attempt++) {
    const vary = shuffle([...ATTRS], rng).slice(0, level === 0 ? 1 : 2);
    const grid: Fig[] = [];
    const vals: Record<string, number[]> = {};
    for (const a of ATTRS) vals[a] = shuffle([...Array(ATTR_N[a]).keys()], rng).slice(0, 3);
    const shift = shuffle([0, 1, 2], rng);
    const shift2 = shuffle([0, 1, 2], rng);
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) {
        const f = {} as Fig;
        ATTRS.forEach((a, k) => {
          if (vary.includes(a)) f[a] = vals[a][(c + (k % 2 ? shift2[r] : shift[r])) % 3];
          else f[a] = level === 2 ? vals[a][r] : vals[a][0];
        });
        grid.push(f);
      }
    if (new Set(grid.map(figKey)).size < 3) continue;
    const ans = grid[8];
    const opts: Fig[] = [ans];
    for (let t = 0; t < 300 && opts.length < 6; t++) {
      const f = { ...ans };
      for (const a of shuffle([...ATTRS], rng).slice(0, 1 + rng.int(2))) f[a] = rng.int(ATTR_N[a]);
      if (opts.some((o) => figKey(o) === figKey(f)) || fitsMatrix(grid, f)) continue;
      opts.push(f);
    }
    if (opts.length < 6 || !fitsMatrix(grid, ans)) continue;
    const options = shuffle(opts, rng);
    return { data: { cells: grid.slice(0, 8), options }, sol: options.findIndex((o) => figKey(o) === figKey(ans)) };
  }
  throw new Error('матрица: не сложилось');
}

export const solveMatrix = (d: MatrixData) => d.options.findIndex((o) => fitsMatrix(d.cells, o));

// ---------------------------------------------------------------- кружки (Венн)

export interface VennData {
  /** Названия кружков (2 или 3). */
  sets: string[];
  facts: string[];
  ask: string;
  /** Что спрашивают и числа — для бота. */
  q: 'none' | 'one' | 'onlyA';
  p: number[];
}

const CLUBS = [
  ['ходят на футбол', 'футбол'],
  ['ходят в шахматный кружок', 'шахматы'],
  ['ходят в авиамодельный', 'авиамодельный'],
  ['ходят на плавание', 'плавание'],
  ['ходят в художку', 'художка'],
  ['ходят в музыкалку', 'музыкалка'],
];

export function solveVenn(d: VennData): number {
  const p = d.p;
  if (d.q === 'none') return p[0] - (p[1] + p[2] - p[3]);
  if (d.q === 'one') return p[0] + p[1] - 2 * p[2];
  // a, ab, ac, abc → только A
  return p[0] - p[1] - p[2] + p[3];
}

/** Уровень: 0 — два кружка, сколько никуда не ходит; 1 — два кружка, сколько только в одном; 2 — три кружка. */
export function genVenn(level: number, rng: Rng): { data: VennData; sol: number } {
  for (;;) {
    if (level < 2) {
      const [A, B] = shuffle(CLUBS, rng);
      const both = 2 + rng.int(5);
      const a = both + 2 + rng.int(8);
      const b = both + 2 + rng.int(8);
      const total = a + b - both + 1 + rng.int(10);
      const d: VennData =
        level === 0
          ? { sets: [A[1], B[1]], facts: [`Всего во дворе ${total} ребят.`, `${a} ${A[0]}.`, `${b} ${B[0]}.`, `${both} ходят и туда, и туда.`], ask: 'Сколько ребят не ходит ни в один из этих кружков?', q: 'none', p: [total, a, b, both] }
          : { sets: [A[1], B[1]], facts: [`${a} ${A[0]}.`, `${b} ${B[0]}.`, `${both} ходят и туда, и туда.`], ask: 'Сколько ребят ходит только в один из этих кружков?', q: 'one', p: [a, b, both] };
      return { data: d, sol: solveVenn(d) };
    }
    const [A, B, C] = shuffle(CLUBS, rng);
    const abc = 1 + rng.int(3);
    const ab = abc + 1 + rng.int(3);
    const ac = abc + 1 + rng.int(3);
    const bc = abc + 1 + rng.int(3);
    const onlyA = 1 + rng.int(6);
    const a = onlyA + ab + ac - abc;
    const b = ab + bc - abc + 1 + rng.int(6);
    const c = ac + bc - abc + 1 + rng.int(6);
    const d: VennData = {
      sets: [A[1], B[1], C[1]],
      facts: [`${a} ${A[0]}, ${b} ${B[0]}, ${c} ${C[0]}.`, `«${A[1]}» и «${B[1]}» сразу — ${ab}; «${A[1]}» и «${C[1]}» — ${ac}; «${B[1]}» и «${C[1]}» — ${bc}.`, `Во все три ходят ${abc}.`],
      ask: `Сколько ребят ходит только в «${A[1]}» — и больше никуда из этих трёх?`,
      q: 'onlyA',
      p: [a, ab, ac, abc],
    };
    return { data: d, sol: solveVenn(d) };
  }
}
