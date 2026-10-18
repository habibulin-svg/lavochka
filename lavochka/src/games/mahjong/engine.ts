/* Пасьянс маджонг — движок без DOM: свободные кости, пары, решаемая раздача, перемешивание, «соединялка».
 * Доска — массив по местам раскладки: номер кости (0–143) или −1, если место уже пусто. */
import type { Rng } from '../../core/types';
import { shuffle } from '../../core/rng';
import { isFlower, isSeason, kindOf, matches } from './tiles';
import type { Layout } from './layouts';

export interface Geo {
  n: number;
  connect: boolean;
  /** 3D: что лежит сверху (с перекрытием), соседи слева и справа на том же этаже. */
  above: number[][];
  left: number[][];
  right: number[][];
  /** Соединялка: клетка поля (столбец, строка) и размеры. */
  col: number[];
  row: number[];
  cols: number;
  rows: number;
}

const geoCache = new Map<string, Geo>();

export function geoOf(l: Layout): Geo {
  const hit = geoCache.get(l.id);
  if (hit) return hit;
  const p = l.pos;
  const n = p.length;
  const connect = l.id === 'connect';
  const above: number[][] = [];
  const left: number[][] = [];
  const right: number[][] = [];
  for (let i = 0; i < n; i++) {
    above.push([]);
    left.push([]);
    right.push([]);
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const dx = p[j].x - p[i].x;
      const dy = p[j].y - p[i].y;
      if (Math.abs(dy) >= 2) continue;
      if (p[j].z > p[i].z && Math.abs(dx) < 2) above[i].push(j);
      if (p[j].z === p[i].z && dx === -2) left[i].push(j);
      if (p[j].z === p[i].z && dx === 2) right[i].push(j);
    }
  }
  const col = p.map((q) => q.x / 2);
  const row = p.map((q) => q.y / 2);
  const g: Geo = { n, connect, above, left, right, col, row, cols: Math.max(...col) + 1, rows: Math.max(...row) + 1 };
  geoCache.set(l.id, g);
  return g;
}

// ---------------------------------------------------------------- свободные кости

export function isFree(g: Geo, t: number[], i: number): boolean {
  if (t[i] < 0) return false;
  if (g.connect) return true;
  for (const j of g.above[i]) if (t[j] >= 0) return false;
  return g.left[i].every((j) => t[j] < 0) || g.right[i].every((j) => t[j] < 0);
}

export function freeList(g: Geo, t: number[]): number[] {
  const r: number[] = [];
  for (let i = 0; i < g.n; i++) if (isFree(g, t, i)) r.push(i);
  return r;
}

/** Соединялка: путь из клетки a в клетку b по пустым клеткам (можно выйти за край на одну клетку) не больше чем с двумя поворотами.
 * Возвращает ломаную в клетках поля (с запасом по краю: −1 … cols) или null. */
export function linkPath(g: Geo, t: number[], a: number, b: number): [number, number][] | null {
  const W = g.cols + 2;
  const H = g.rows + 2;
  const occ = new Uint8Array(W * H);
  for (let i = 0; i < g.n; i++) if (t[i] >= 0) occ[(g.row[i] + 1) * W + g.col[i] + 1] = 1;
  const sx = g.col[a] + 1;
  const sy = g.row[a] + 1;
  const tx = g.col[b] + 1;
  const ty = g.row[b] + 1;
  const DX = [1, -1, 0, 0];
  const DY = [0, 0, 1, -1];
  // поиск по поворотам: от каждой клетки луч в 4 стороны
  const best = new Int8Array(W * H * 4).fill(99);
  const prev = new Int32Array(W * H * 4).fill(-1);
  type Node = { x: number; y: number; d: number; turns: number };
  let frontier: Node[] = [];
  for (let d = 0; d < 4; d++) frontier.push({ x: sx, y: sy, d, turns: 0 });
  for (let turns = 0; turns <= 2; turns++) {
    const next: Node[] = [];
    for (const nd of frontier) {
      let x = nd.x;
      let y = nd.y;
      let from = (y * W + x) * 4 + nd.d;
      for (;;) {
        x += DX[nd.d];
        y += DY[nd.d];
        if (x < 0 || y < 0 || x >= W || y >= H) break;
        const key = (y * W + x) * 4 + nd.d;
        if (x === tx && y === ty) {
          prev[key] = from;
          return trace(key, sx, sy, W, prev);
        }
        if (occ[y * W + x]) break;
        if (best[key] <= turns) break;
        best[key] = turns;
        prev[key] = from;
        from = key;
        if (turns < 2) for (let d2 = 0; d2 < 4; d2++) if (d2 !== nd.d && (d2 ^ 1) !== nd.d) next.push({ x, y, d: d2, turns: turns + 1 });
      }
    }
    frontier = next;
  }
  return null;
}

function trace(key: number, sx: number, sy: number, W: number, prev: Int32Array): [number, number][] {
  const all: [number, number][] = [];
  for (let k = key; k >= 0; k = prev[k]) {
    const c = Math.floor(k / 4);
    const x = c % W;
    const y = Math.floor(c / W);
    all.push([x - 1, y - 1]);
    if (x === sx && y === sy) break;
  }
  // оставить концы и углы
  const out = all.filter((p, i) => {
    if (i === 0 || i === all.length - 1) return true;
    const [ax, ay] = all[i - 1];
    const [bx, by] = all[i + 1];
    return !((ax === p[0] && bx === p[0]) || (ay === p[1] && by === p[1]));
  });
  return out.reverse();
}

/** Можно ли снять пару мест a и b. */
export function canPair(g: Geo, t: number[], a: number, b: number): boolean {
  if (a === b || a < 0 || b < 0 || a >= g.n || b >= g.n) return false;
  if (t[a] < 0 || t[b] < 0 || !matches(kindOf(t[a]), kindOf(t[b]))) return false;
  if (g.connect) return !!linkPath(g, t, a, b);
  return isFree(g, t, a) && isFree(g, t, b);
}

/** Все пары, которые можно снять сейчас. */
export function pairsOf(g: Geo, t: number[]): [number, number][] {
  const r: [number, number][] = [];
  if (g.connect) {
    const live: number[] = [];
    for (let i = 0; i < g.n; i++) if (t[i] >= 0) live.push(i);
    for (let x = 0; x < live.length; x++)
      for (let y = x + 1; y < live.length; y++) {
        const a = live[x];
        const b = live[y];
        if (matches(kindOf(t[a]), kindOf(t[b])) && linkPath(g, t, a, b)) r.push([a, b]);
      }
    return r;
  }
  const f = freeList(g, t);
  for (let x = 0; x < f.length; x++) for (let y = x + 1; y < f.length; y++) if (matches(kindOf(t[f[x]]), kindOf(t[f[y]]))) r.push([f[x], f[y]]);
  return r;
}

export const left = (t: number[]) => t.reduce((s, x) => s + (x >= 0 ? 1 : 0), 0);

// ---------------------------------------------------------------- раздача

/** Группа для пары: вид кости; все цветы — одна группа, все сезоны — другая. */
export const groupOf = (id: number) => {
  const k = kindOf(id);
  return isFlower(k) ? 34 : isSeason(k) ? 38 : k;
};

/** Разбить кости на пары (одной группы). */
function pairUp(ids: number[]): [number, number][] {
  const by = new Map<number, number[]>();
  for (const id of ids) {
    const g = groupOf(id);
    if (!by.has(g)) by.set(g, []);
    by.get(g)!.push(id);
  }
  const r: [number, number][] = [];
  for (const list of by.values()) for (let i = 0; i + 1 < list.length; i += 2) r.push([list[i], list[i + 1]]);
  return r;
}

/** Порядок снятия «задом наперёд»: на заполненной доске раз за разом выбираем две свободные (или соединимые) кости. */
function removalOrder(g: Geo, places: number[], rng: Rng): [number, number][] | null {
  const t = new Array(g.n).fill(-1);
  for (const p of places) t[p] = 0;
  const order: [number, number][] = [];
  let live = places.length;
  while (live > 0) {
    let pair: [number, number] | null = null;
    if (g.connect) {
      const cand = shuffle(
        places.filter((p) => t[p] >= 0),
        rng
      );
      for (const a of cand) {
        const reach = cand.filter((b) => b !== a && linkPath(g, t, a, b));
        if (reach.length) {
          pair = [a, reach[rng.int(reach.length)]];
          break;
        }
      }
    } else {
      const f = places.filter((p) => isFree(g, t, p));
      if (f.length >= 2) {
        const i = rng.int(f.length);
        const j = (i + 1 + rng.int(f.length - 1)) % f.length;
        pair = [f[i], f[j]];
      }
    }
    if (!pair) return null;
    t[pair[0]] = -1;
    t[pair[1]] = -1;
    live -= 2;
    order.push(pair);
  }
  return order;
}

/** Решаемая раскладка костей ids по местам places (ids — чётное число, разбиваются на пары). */
export function solvableDeal(g: Geo, places: number[], ids: number[], rng: Rng): number[] {
  const t = new Array(g.n).fill(-1);
  const pairs = shuffle(pairUp(ids), rng);
  for (let tries = 0; tries < 300; tries++) {
    const order = removalOrder(g, places, rng);
    if (!order) continue;
    order.forEach(([a, b], k) => {
      const [x, y] = pairs[k];
      t[a] = x;
      t[b] = y;
    });
    return t;
  }
  // не вышло — как ляжет
  const sh = shuffle(ids.slice(), rng);
  places.forEach((p, k) => (t[p] = sh[k]));
  return t;
}

/** Набор костей на n мест: n/2 случайных пар из полного набора 144. */
export function tileSet(n: number, rng: Rng): number[] {
  const all = Array.from({ length: 144 }, (_, i) => i);
  if (n >= 144) return all;
  const pairs = shuffle(pairUp(all), rng).slice(0, n / 2);
  return pairs.flat();
}

/** Перемешать оставшиеся кости по оставшимся местам — так, чтобы раскладка сходилась. */
export function reshuffle(g: Geo, t: number[], rng: Rng): number[] {
  const places: number[] = [];
  const ids: number[] = [];
  for (let i = 0; i < g.n; i++)
    if (t[i] >= 0) {
      places.push(i);
      ids.push(t[i]);
    }
  return solvableDeal(g, places, ids, rng);
}

// ---------------------------------------------------------------- поиск решения (бот и подсказка)

/** Сколько мест освобождает снятие кости i (над ней и рядом). */
function unlocks(g: Geo, t: number[], i: number): number {
  if (g.connect) return 0;
  let n = 0;
  for (const j of [...g.left[i], ...g.right[i]]) if (t[j] >= 0) n++;
  // под ней: кто держит её сверху — в обратную сторону
  for (let j = 0; j < g.n; j++) if (t[j] >= 0 && g.above[j].includes(i)) n += 2;
  return n;
}

/** Оценка пары: чем выше, тем лучше ходить. */
export function pairScore(g: Geo, t: number[], a: number, b: number): number {
  const ga = groupOf(t[a]);
  // остальные кости этой группы: если обе тоже свободны — пару можно брать смело
  let rest = 0;
  let restFree = 0;
  for (let i = 0; i < g.n; i++)
    if (i !== a && i !== b && t[i] >= 0 && groupOf(t[i]) === ga) {
      rest++;
      if (isFree(g, t, i)) restFree++;
    }
  let s = unlocks(g, t, a) + unlocks(g, t, b);
  if (rest === 0 || rest === restFree) s += 6;
  // три свободных одной группы, а четвёртая заперта: нужно взять «правильные» две — те, что сами что-то держат
  if (rest === 2 && restFree === 1) s -= 1;
  return s;
}

/** Поиск в глубину: есть ли путь до пустой доски. Возвращает первый ход или null. */
export function solve(g: Geo, t0: number[], budget: number): [number, number] | null {
  let nodes = 0;
  const seen = new Set<string>();
  const t = t0.slice();
  const rec = (live: number): [number, number] | true | null => {
    if (live === 0) return true;
    if (++nodes > budget) return null;
    const key = t.map((x) => (x >= 0 ? 1 : 0)).join('');
    if (seen.has(key)) return null;
    seen.add(key);
    const ps = pairsOf(g, t).sort((p, q) => pairScore(g, t, q[0], q[1]) - pairScore(g, t, p[0], p[1]));
    for (const [a, b] of ps) {
      const x = t[a];
      const y = t[b];
      t[a] = -1;
      t[b] = -1;
      const r = rec(live - 2);
      t[a] = x;
      t[b] = y;
      if (r) return [a, b];
      if (nodes > budget) return null;
    }
    return null;
  };
  const r = rec(left(t));
  return Array.isArray(r) ? r : null;
}
