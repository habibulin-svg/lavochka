/* Волна 8 «А у нас во дворе»: путь по кратным, зеркало (симметрия), раскраска по соседству, какуро. Без DOM. */
import type { Rng } from '../../../core/types';
import { shuffle } from '../../../core/rng';

const orth = (w: number, h: number, i: number) => {
  const x = i % w;
  const y = (i / w) | 0;
  const r: number[] = [];
  if (y > 0) r.push(i - w);
  if (x < w - 1) r.push(i + 1);
  if (y < h - 1) r.push(i + w);
  if (x > 0) r.push(i - 1);
  return r;
};

// ---------------------------------------------------------------- по кратным

export interface KratData {
  n: number;
  k: number;
  nums: number[];
  start: number;
  end: number;
}

/** Путь по клеткам, кратным k, от старта до финиша (поиск в ширину). */
export function solveKrat(d: KratData): number[] {
  const ok = (i: number) => d.nums[i] % d.k === 0;
  const prev = new Array(d.n * d.n).fill(-1);
  prev[d.start] = d.start;
  const q = [d.start];
  while (q.length) {
    const a = q.shift()!;
    for (const b of orth(d.n, d.n, a)) if (ok(b) && prev[b] < 0) (prev[b] = a), q.push(b);
  }
  if (prev[d.end] < 0) return [];
  const path = [d.end];
  while (path[0] !== d.start) path.unshift(prev[path[0]]);
  return path;
}

export function checkKrat(d: KratData, a: unknown): boolean {
  if (!Array.isArray(a) || a[0] !== d.start || a[a.length - 1] !== d.end || new Set(a).size !== a.length) return false;
  return a.every((c, i) => Number.isInteger(c) && d.nums[c] % d.k === 0 && (i === 0 || orth(d.n, d.n, a[i - 1]).includes(c)));
}

/** Уровень: 0 — 5×5, кратные 3; 1 — 6×6, кратные 4 или 6; 2 — 7×7, кратные 7 или 8, с тупиками. */
export function genKrat(level: number, rng: Rng): { data: KratData; sol: number[] } {
  const n = level + 5;
  const k = [[3], [4, 6], [7, 8]][level][rng.int(level ? 2 : 1)];
  const N = n * n;
  const start = 0;
  const end = N - 1;
  for (let attempt = 0; attempt < 500; attempt++) {
    // случайный путь без самокасаний (соседние по стороне клетки пути — только соседние по порядку)
    const path = [start];
    const on = new Set(path);
    let ok = false;
    for (let step = 0; step < 4 * N; step++) {
      const cur = path[path.length - 1];
      if (cur === end) {
        ok = true;
        break;
      }
      const cand = shuffle(orth(n, n, cur), rng).filter((c) => !on.has(c) && orth(n, n, c).every((j) => j === cur || !on.has(j)));
      if (!cand.length) break;
      // тянемся к финишу, но с блужданием
      const dist = (c: number) => n - 1 - (c % n) + (n - 1 - ((c / n) | 0));
      const next = rng.next() < 0.6 ? cand.reduce((a, b) => (dist(b) < dist(a) ? b : a)) : cand[0];
      path.push(next);
      on.add(next);
    }
    if (!ok || path.length < n * 1.6) continue;
    const mult = () => k * (1 + rng.int(Math.floor(99 / k)));
    const non = () => {
      for (;;) {
        const x = 2 + rng.int(97);
        if (x % k) return x;
      }
    };
    const nums = Array.from({ length: N }, (_, i) => (on.has(i) ? mult() : non()));
    // тупики на трудной: короткие отростки кратных, касающиеся пути одной клеткой
    if (level === 2)
      for (const c of shuffle([...Array(N).keys()], rng).slice(0, N)) {
        if (on.has(c) || nums[c] % k === 0) continue;
        const nb = orth(n, n, c);
        const touchPath = nb.filter((j) => on.has(j)).length;
        const touchMult = nb.filter((j) => nums[j] % k === 0).length;
        if (touchPath <= 1 && touchMult <= 1 && rng.next() < 0.3) nums[c] = mult();
      }
    const d: KratData = { n, k, nums, start, end };
    const sol = solveKrat(d);
    // путь должен быть единственным: все кратные, кроме тупиков, — на нём, и тупики не замыкают обход
    if (sol.join() !== path.join()) continue;
    return { data: d, sol };
  }
  throw new Error('кратные: не сложилось');
}

// ---------------------------------------------------------------- зеркало (симметрия)

export interface MirrorData {
  n: number;
  /** 'v' — зеркало посередине по вертикали; 'vh' — две оси (снежинка на четыре части); 'd' — по диагонали. */
  axis: 'v' | 'vh' | 'd';
  /** Нарисованная часть: 1 — закрашено; -1 — клетку нужно дорисовать самому. */
  given: number[];
}

const mirrorsOf = (d: MirrorData, i: number): number[] => {
  const { n } = d;
  const x = i % n;
  const y = (i / n) | 0;
  if (d.axis === 'v') return [y * n + (n - 1 - x)];
  if (d.axis === 'd') return [x * n + y];
  return [y * n + (n - 1 - x), (n - 1 - y) * n + x, (n - 1 - y) * n + (n - 1 - x)];
};

export function solveMirror(d: MirrorData): number[] {
  const g = d.given.map((v) => (v === 1 ? 1 : 0));
  d.given.forEach((v, i) => v === 1 && mirrorsOf(d, i).forEach((j) => (g[j] = 1)));
  return g;
}

export const checkMirror = (d: MirrorData, a: unknown) => Array.isArray(a) && a.length === d.n * d.n && solveMirror(d).every((v, i) => (a[i] ? 1 : 0) === v);

/** Уровень: 0 — 8×8, одна ось; 1 — 8×8, по диагонали; 2 — 10×10, снежинка на четыре части. */
export function genMirror(level: number, rng: Rng): { data: MirrorData; sol: number[] } {
  const n = level === 2 ? 10 : 8;
  const axis: MirrorData['axis'] = level === 0 ? 'v' : level === 1 ? 'd' : 'vh';
  for (let attempt = 0; attempt < 100; attempt++) {
    const given = new Array(n * n).fill(0);
    // данная часть: левая половина / под диагональю (с ней) / левая верхняя четверть
    const src = [...Array(n * n).keys()].filter((i) => {
      const x = i % n;
      const y = (i / n) | 0;
      return axis === 'v' ? x < n / 2 : axis === 'd' ? x <= y : x < n / 2 && y < n / 2;
    });
    for (const i of src) if (rng.next() < 0.42) given[i] = 1;
    const d: MirrorData = { n, axis, given };
    // остальное — «дорисовать»
    const own = new Set(src);
    for (let i = 0; i < n * n; i++) if (!own.has(i)) given[i] = -1;
    const sol = solveMirror(d);
    if (sol.filter(Boolean).length < n * n * 0.3) continue;
    return { data: d, sol };
  }
  throw new Error('зеркало: не сложилось');
}

// ---------------------------------------------------------------- раскраска по соседству

export interface RaskData {
  w: number;
  h: number;
  /** Номер области у клетки. */
  reg: number[];
  /** Сколько цветов. */
  colors: number;
  /** Заранее покрашенные области: [область, цвет 1…colors]. */
  given: [number, number][];
}

export function adjOf(d: RaskData): Set<number>[] {
  const n = Math.max(...d.reg) + 1;
  const adj = Array.from({ length: n }, () => new Set<number>());
  d.reg.forEach((r, i) => orth(d.w, d.h, i).forEach((j) => d.reg[j] !== r && adj[r].add(d.reg[j])));
  return adj;
}

/** Число раскрасок (до limit); первая — в out. */
export function countRask(d: RaskData, limit = 2, out?: number[]): number {
  const adj = adjOf(d);
  const n = adj.length;
  const col = new Array(n).fill(0);
  d.given.forEach(([r, c]) => (col[r] = c));
  const order = [...Array(n).keys()].filter((r) => !col[r]).sort((a, b) => adj[b].size - adj[a].size);
  for (const [r] of d.given) if ([...adj[r]].some((j) => col[j] === col[r])) return 0;
  let found = 0;
  const go = (k: number): void => {
    if (found >= limit) return;
    if (k === order.length) {
      if (!found && out) out.splice(0, n, ...col);
      found++;
      return;
    }
    const r = order[k];
    for (let c = 1; c <= d.colors; c++) {
      if ([...adj[r]].some((j) => col[j] === c)) continue;
      col[r] = c;
      go(k + 1);
      col[r] = 0;
      if (found >= limit) return;
    }
  };
  go(0);
  return found;
}

export function solveRask(d: RaskData): number[] {
  const out: number[] = [];
  countRask(d, 1, out);
  return out;
}

export function checkRask(d: RaskData, a: unknown): boolean {
  const adj = adjOf(d);
  if (!Array.isArray(a) || a.length !== adj.length) return false;
  if (a.some((c) => !Number.isInteger(c) || c < 1 || c > d.colors)) return false;
  if (d.given.some(([r, c]) => a[r] !== c)) return false;
  return adj.every((s, r) => [...s].every((j) => a[j] !== a[r]));
}

/** Уровень: 0 — 8 областей; 1 — 12; 2 — 16. Цветов три: с четырьмя раскраска почти никогда не единственная. */
export function genRask(level: number, rng: Rng): { data: RaskData; sol: number[] } {
  const [w, h, n, colors] = [[8, 6, 8, 3], [9, 7, 12, 3], [10, 8, 16, 3]][level] ?? [9, 7, 12, 3];
  for (let attempt = 0; attempt < 300; attempt++) {
    // области — рост от случайных семян
    const reg = new Array(w * h).fill(-1);
    shuffle([...Array(w * h).keys()], rng)
      .slice(0, n)
      .forEach((s, k) => (reg[s] = k));
    for (let guard = 0; reg.includes(-1) && guard < 10000; guard++) {
      const i = rng.int(w * h);
      if (reg[i] < 0) continue;
      const nb = orth(w, h, i).filter((j) => reg[j] < 0);
      if (nb.length) reg[nb[rng.int(nb.length)]] = reg[i];
    }
    if (reg.includes(-1)) continue;
    const d: RaskData = { w, h, reg, colors, given: [] };
    const sol: number[] = [];
    if (!countRask(d, 1, sol)) continue;
    // красим заранее, пока раскраска не станет единственной; потом убираем лишнее
    for (const r of shuffle([...Array(n).keys()], rng)) {
      if (countRask(d) === 1) break;
      d.given.push([r, sol[r]]);
    }
    if (countRask(d) !== 1) continue;
    for (const g of shuffle(d.given.slice(), rng)) {
      const keep = d.given;
      d.given = keep.filter((x) => x !== g);
      if (countRask(d) !== 1) d.given = keep;
    }
    if (d.given.length < 2 || d.given.length > n * 0.5) continue;
    return { data: d, sol };
  }
  throw new Error('раскраска: не сложилось');
}

// ---------------------------------------------------------------- какуро

export interface KakuroData {
  w: number;
  h: number;
  /** -1 — стена; 0 — клетка для цифры; >0 — данная цифра. */
  cells: number[];
  /** Суммы: для стены — [вправо, вниз] (0 — нет). */
  sums: Record<number, [number, number]>;
}

function runsOf(d: { w: number; h: number; cells: number[] }) {
  const runs: { cells: number[]; clue: number; dir: 0 | 1 }[] = [];
  for (let i = 0; i < d.w * d.h; i++) {
    if (d.cells[i] !== -1) continue;
    const x = i % d.w;
    const y = (i / d.w) | 0;
    const right: number[] = [];
    for (let xx = x + 1; xx < d.w && d.cells[y * d.w + xx] !== -1; xx++) right.push(y * d.w + xx);
    const down: number[] = [];
    for (let yy = y + 1; yy < d.h && d.cells[yy * d.w + x] !== -1; yy++) down.push(yy * d.w + x);
    if (right.length) runs.push({ cells: right, clue: i, dir: 0 });
    if (down.length) runs.push({ cells: down, clue: i, dir: 1 });
  }
  return runs;
}

/** Число решений (до limit); первое — в out. */
export function countKakuro(d: KakuroData, limit = 2, out?: number[]): number {
  const runs = runsOf(d).map((r) => ({ ...r, sum: d.sums[r.clue][r.dir] }));
  const runsAt: number[][] = d.cells.map(() => []);
  runs.forEach((r, k) => r.cells.forEach((c) => runsAt[c].push(k)));
  const g = d.cells.map((v) => (v > 0 ? v : 0));
  const free = d.cells.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);
  let found = 0;
  const runOk = (k: number) => {
    const r = runs[k];
    const vs = r.cells.map((c) => g[c]).filter(Boolean);
    if (new Set(vs).size !== vs.length) return false;
    const s = vs.reduce((a, b) => a + b, 0);
    const left = r.cells.length - vs.length;
    if (!left) return s === r.sum;
    // минимум и максимум того, что ещё можно добрать
    let lo = 0;
    let hi = 0;
    for (let q = 0; q < left; q++) (lo += q + 1), (hi += 9 - q);
    return s + lo <= r.sum && s + hi >= r.sum;
  };
  const go = (k: number): void => {
    if (found >= limit) return;
    if (k === free.length) {
      if (!found && out) out.splice(0, g.length, ...g);
      found++;
      return;
    }
    const c = free[k];
    for (let v = 1; v <= 9; v++) {
      g[c] = v;
      if (runsAt[c].every(runOk)) go(k + 1);
      g[c] = 0;
      if (found >= limit) return;
    }
  };
  go(0);
  return found;
}

export function solveKakuro(d: KakuroData): number[] {
  const out: number[] = [];
  countKakuro(d, 1, out);
  return out;
}

export function checkKakuro(d: KakuroData, a: unknown): boolean {
  if (!Array.isArray(a) || a.length !== d.cells.length) return false;
  const g = a as number[];
  if (d.cells.some((v, i) => (v === -1 ? false : !Number.isInteger(g[i]) || g[i] < 1 || g[i] > 9 || (v > 0 && g[i] !== v)))) return false;
  return runsOf(d).every((r) => {
    const vs = r.cells.map((c) => g[c]);
    return new Set(vs).size === vs.length && vs.reduce((x, y) => x + y, 0) === d.sums[r.clue][r.dir];
  });
}

/** Шаблоны: «#» — стена, «.» — клетка. Первая строка и столбец — стены. */
const KAKURO_TPL = [
  ['###', '#..', '#..'],
  ['####', '#..#', '#...', '##..'],
  ['####', '#...', '#...', '#...'],
  ['#####', '#..##', '#...#', '##...', '###..'],
  ['#####', '#.#..', '#....', '#..#.', '##...'],
  ['######', '#..#..', '#.....', '##.#..', '#.....', '#..#..'],
];

/** Уровень: 0 — 2×2…3×3; 1 — 4×4; 2 — 5×5. */
export function genKakuro(level: number, rng: Rng): { data: KakuroData; sol: number[] } {
  const pool = [[0, 2], [1, 3], [4, 5]][level] ?? [1, 3];
  for (let attempt = 0; attempt < 400; attempt++) {
    const tpl = KAKURO_TPL[pool[rng.int(pool.length)]];
    const h = tpl.length;
    const w = tpl[0].length;
    const cells: number[] = tpl.join('').split('').map((ch) => (ch === '#' ? -1 : 0));
    const base = { w, h, cells };
    const runs = runsOf(base);
    // случайная расстановка без повторов в отрезках
    const g = cells.slice();
    const free = cells.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);
    const fill = (k: number): boolean => {
      if (k === free.length) return true;
      const c = free[k];
      for (const v of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rng)) {
        if (runs.some((r) => r.cells.includes(c) && r.cells.some((x) => x !== c && g[x] === v))) continue;
        g[c] = v;
        if (fill(k + 1)) return true;
        g[c] = 0;
      }
      return false;
    };
    if (!fill(0)) continue;
    const sums: Record<number, [number, number]> = {};
    for (const r of runs) {
      sums[r.clue] ??= [0, 0];
      sums[r.clue][r.dir] = r.cells.reduce((s, c) => s + g[c], 0);
    }
    const d: KakuroData = { w, h, cells: cells.slice(), sums };
    // добавляем данные цифры, пока решение не единственное
    for (const c of shuffle(free, rng)) {
      if (countKakuro(d) === 1) break;
      d.cells[c] = g[c];
    }
    if (countKakuro(d) !== 1) continue;
    if (d.cells.filter((v) => v > 0).length > Math.max(1, free.length / 3)) continue;
    return { data: d, sol: g };
  }
  throw new Error('какуро: не сложилось');
}
