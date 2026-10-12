/* Пикросс (японский кроссворд) — генератор и решатель без DOM. Поле w×h, решение — строка из '1' и '0'.
 * Картинка случайная, но «картинная»: пятна (сглаживание клеточным автоматом) и симметрия у части полей.
 * Годится только то, что решается построчной логикой без угадывания; не вышло — пробуем другую картинку,
 * в крайнем случае открываем пару клеток заранее (они отмечены как данные). */
import type { Rng } from '../../core/types';

export type Clues = number[][];

export function cluesOf(line: number[]): number[] {
  const r: number[] = [];
  let run = 0;
  for (const v of line) {
    if (v === 1) run++;
    else if (run) {
      r.push(run);
      run = 0;
    }
  }
  if (run) r.push(run);
  return r;
}

/**
 * Решение одной линии: known — -1 неизвестно, 0 пусто, 1 закрашено. Возвращает уточнённую линию
 * или null, если подсказки с известным несовместимы. Динамика «может ли префикс уложить первые k блоков».
 */
export function solveLine(clue: number[], known: number[]): number[] | null {
  const n = known.length;
  const k = clue.length;
  // canEmpty[i] / canFill[i] — найдётся ли расклад, где клетка i пуста / закрашена
  const canFill = new Array(n).fill(false);
  const canEmpty = new Array(n).fill(false);
  // fwd[b][i]: первые b блоков можно уложить в клетки [0, i) (i — сразу после пустой или конца)
  const okEmpty = (a: number, b: number) => {
    for (let i = a; i < b; i++) if (known[i] === 1) return false;
    return true;
  };
  const okFill = (a: number, b: number) => {
    if (b > n) return false;
    for (let i = a; i < b; i++) if (known[i] === 0) return false;
    return true;
  };
  const memo = new Map<number, boolean>();
  // можно ли уложить блоки b.. начиная с позиции i (клетка i свободна для начала)
  const can = (b: number, i: number): boolean => {
    const key = b * (n + 2) + i;
    const m = memo.get(key);
    if (m !== undefined) return m;
    let res = false;
    if (b === k) res = okEmpty(i, n);
    else {
      const len = clue[b];
      for (let s = i; s + len <= n; s++) {
        if (s > i && known[s - 1] === 1) break;
        if (!okFill(s, s + len)) continue;
        const after = s + len;
        if (after < n && known[after] === 1) continue;
        if (can(b + 1, Math.min(n, after + 1))) {
          res = true;
          break;
        }
      }
    }
    memo.set(key, res);
    return res;
  };
  if (!can(0, 0)) return null;
  // разметка: проходим все допустимые расклады через ту же рекурсию, помечая клетки (с мемо по достижимости)
  const seen = new Set<number>();
  const mark = (b: number, i: number) => {
    const key = b * (n + 2) + i;
    if (seen.has(key)) return;
    seen.add(key);
    if (b === k) {
      for (let x = i; x < n; x++) canEmpty[x] = true;
      return;
    }
    const len = clue[b];
    for (let s = i; s + len <= n; s++) {
      if (s > i && known[s - 1] === 1) break;
      if (!okFill(s, s + len)) continue;
      const after = s + len;
      if (after < n && known[after] === 1) continue;
      const nx = Math.min(n, after + 1);
      if (!can(b + 1, nx)) continue;
      for (let x = i; x < s; x++) canEmpty[x] = true;
      for (let x = s; x < after; x++) canFill[x] = true;
      if (after < n) canEmpty[after] = true;
      mark(b + 1, nx);
    }
  };
  mark(0, 0);
  return known.map((v, i) => (v !== -1 ? v : canFill[i] && !canEmpty[i] ? 1 : canEmpty[i] && !canFill[i] ? 0 : -1));
}

/** Построчная логика до упора. Возвращает сетку (-1 — не определилось) или null при противоречии. */
export function lineSolve(w: number, h: number, rows: Clues, cols: Clues, start?: number[]): number[] | null {
  const g = start ? start.slice() : new Array(w * h).fill(-1);
  let dirtyR = new Array(h).fill(true);
  let dirtyC = new Array(w).fill(true);
  for (let guard = 0; guard < 1000; guard++) {
    let any = false;
    const nR = new Array(h).fill(false);
    const nC = new Array(w).fill(false);
    for (let y = 0; y < h; y++) {
      if (!dirtyR[y]) continue;
      const line = g.slice(y * w, y * w + w);
      const r = solveLine(rows[y], line);
      if (!r) return null;
      for (let x = 0; x < w; x++)
        if (r[x] !== line[x]) {
          g[y * w + x] = r[x];
          nC[x] = true;
          any = true;
        }
    }
    for (let x = 0; x < w; x++) {
      if (!dirtyC[x] && !nC[x]) continue;
      const line = Array.from({ length: h }, (_, y) => g[y * w + x]);
      const r = solveLine(cols[x], line);
      if (!r) return null;
      for (let y = 0; y < h; y++)
        if (r[y] !== line[y]) {
          g[y * w + x] = r[y];
          nR[y] = true;
          any = true;
        }
    }
    if (!any) break;
    dirtyR = nR;
    dirtyC = new Array(w).fill(false);
  }
  return g;
}

export interface Picross {
  w: number;
  h: number;
  /** 1 — закрашено. */
  solution: number[];
  rows: Clues;
  cols: Clues;
  /** Клетки, открытые заранее (если логикой иначе не решалось). */
  given: number[];
}

/** Плотность и сглаживание по уровню: на лёгком больше закрашенного — длинные блоки, проще считать. */
const DENSITY = [0, 0.56, 0.52, 0.5];

function randomPicture(rng: Rng, w: number, h: number, level: number): number[] {
  let g = Array.from({ length: w * h }, () => (rng.next() < DENSITY[level] ? 1 : 0));
  // сглаживание: клетка берёт большинство соседей — выходят пятна, а не шум
  const passes = 1;
  for (let p = 0; p < passes; p++) {
    const n = g.slice();
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0;
        let c = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const X = x + dx;
            const Y = y + dy;
            if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
            s += g[Y * w + X];
            c++;
          }
        n[y * w + x] = s * 2 > c ? 1 : s * 2 < c ? 0 : g[y * w + x];
      }
    g = n;
  }
  // половина картинок — зеркальные (как бабочка или ваза)
  const sym = rng.int(3);
  if (sym === 1) for (let y = 0; y < h; y++) for (let x = 0; x < w / 2; x++) g[y * w + (w - 1 - x)] = g[y * w + x];
  if (sym === 2) for (let y = 0; y < h / 2; y++) for (let x = 0; x < w; x++) g[(h - 1 - y) * w + x] = g[y * w + x];
  // пустые строки и столбцы неинтересны — подкрасим по клетке
  for (let y = 0; y < h; y++) if (!g.slice(y * w, y * w + w).some((v) => v)) g[y * w + rng.int(w)] = 1;
  for (let x = 0; x < w; x++) if (!Array.from({ length: h }, (_, y) => g[y * w + x]).some((v) => v)) g[rng.int(h) * w + x] = 1;
  return g;
}

export function cluesFor(sol: number[], w: number, h: number) {
  const rows = Array.from({ length: h }, (_, y) => cluesOf(sol.slice(y * w, y * w + w)));
  const cols = Array.from({ length: w }, (_, x) => cluesOf(Array.from({ length: h }, (_, y) => sol[y * w + x])));
  return { rows, cols };
}

/**
 * Насколько головоломка лёгкая: доля клеток, которые определяются одним проходом по строкам и столбцам с пустого поля
 * (каждая линия сама по себе). На лёгком — много, на сложном — почти ничего: дальше только цепочкой рассуждений.
 */
function firstSweep(w: number, h: number, rows: Clues, cols: Clues): number {
  let known = 0;
  for (let y = 0; y < h; y++) known += solveLine(rows[y], new Array(w).fill(-1))!.filter((v) => v !== -1).length;
  const g = new Array(w * h).fill(false);
  for (let y = 0; y < h; y++) solveLine(rows[y], new Array(w).fill(-1))!.forEach((v, x) => (g[y * w + x] = v !== -1));
  for (let x = 0; x < w; x++)
    solveLine(cols[x], new Array(h).fill(-1))!.forEach((v, y) => {
      if (v !== -1 && !g[y * w + x]) known++;
    });
  return known / (w * h);
}

/** Потолок доли «с первого прохода» по уровню (для маленьких полей мягче). */
const SWEEP_MAX = [0, 0.55, 0.35, 0.2];

/** Картинка без «сплошных» линий и с разнообразными блоками. */
function looksGood(w: number, h: number, rows: Clues, cols: Clues): boolean {
  const lines = [...rows.map((r) => ({ r, n: w })), ...cols.map((r) => ({ r, n: h }))];
  const full = lines.filter(({ r, n }) => r.length === 1 && r[0] === n).length;
  const blocks = lines.reduce((a, { r }) => a + r.length, 0) / lines.length;
  return full <= (w >= 10 ? 1 : 2) && blocks >= (w >= 10 ? 1.7 : 1.2);
}

export function generate(rng: Rng, w: number, h: number, level: number): Picross {
  let last: Picross | null = null;
  let lastScore = Infinity;
  const cap = SWEEP_MAX[level] + (w <= 5 ? 0.3 : 0);
  for (let attempt = 0; attempt < 400; attempt++) {
    const solution = randomPicture(rng, w, h, level);
    const { rows, cols } = cluesFor(solution, w, h);
    if (!looksGood(w, h, rows, cols)) continue;
    const g = lineSolve(w, h, rows, cols);
    if (!g || g.some((v) => v === -1)) continue;
    const sweep = firstSweep(w, h, rows, cols);
    const p = { w, h, solution, rows, cols, given: [] as number[] };
    if (sweep <= cap) return p;
    if (sweep < lastScore) {
      last = p;
      lastScore = sweep;
    }
  }
  if (last) return last;
  for (let attempt = 0; attempt < 60; attempt++) {
    const solution = randomPicture(rng, w, h, level);
    const { rows, cols } = cluesFor(solution, w, h);
    last = { w, h, solution, rows, cols, given: [] };
    const g = lineSolve(w, h, rows, cols);
    if (g && g.every((v) => v !== -1)) return last;
  }
  // не вышло — открываем неопределившиеся клетки по одной, пока логика не дорешает
  const p = last!;
  const known = new Array(w * h).fill(-1);
  for (;;) {
    const g = lineSolve(w, h, p.rows, p.cols, known)!;
    const open = g.findIndex((v) => v === -1);
    if (open < 0) break;
    known[open] = p.solution[open];
    p.given.push(open);
  }
  return p;
}
