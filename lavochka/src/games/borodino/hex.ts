/* «Бородино» — геометрия и местность карты: соседи, расстояние, стороны клеток (дороги, реки, редуты), цена движения. Без DOM. */
import { GRID, LEVEL, REDOUBTS, RIVER, ROAD, TERR, VILLAGES } from './terrain';

export const COLS = 40;
export const ROWS = 30;
export const N = COLS * ROWS;
export const col = (n: number) => Math.floor(n / ROWS) + 1;
export const row = (n: number) => (n % ROWS) + 1;
export const hexAt = (c: number, r: number) => (c >= 1 && c <= COLS && r >= 1 && r <= ROWS ? (c - 1) * ROWS + (r - 1) : -1);
export const exists = (n: number) => n >= 0 && n < N && LEVEL[n] >= 0;
/** Номер клетки, как на карте: ССРР. */
export const label = (n: number) => String(col(n)).padStart(2, '0') + String(row(n)).padStart(2, '0');
export const byLabel = (s: string) => hexAt(Number(s.slice(0, 2)), Number(s.slice(2)));

export function center(n: number): { x: number; y: number } {
  const c = col(n);
  return { x: GRID.x0 + (c - 1) * GRID.dx, y: GRID.y0 + (row(n) - 1) * GRID.dy + (c % 2 === 0 ? GRID.dy / 2 : 0) };
}

const NB: number[][] = [];
for (let n = 0; n < N; n++) {
  const c = col(n);
  const r = row(n);
  const list =
    c % 2 === 1
      ? [
          [c, r - 1],
          [c + 1, r - 1],
          [c + 1, r],
          [c, r + 1],
          [c - 1, r],
          [c - 1, r - 1],
        ]
      : [
          [c, r - 1],
          [c + 1, r],
          [c + 1, r + 1],
          [c, r + 1],
          [c - 1, r + 1],
          [c - 1, r],
        ];
  NB.push(list.map(([a, b]) => hexAt(a, b)).filter((m) => m >= 0 && exists(m) && exists(n)));
}
export const neighbors = (n: number) => NB[n];

function cube(n: number): [number, number, number] {
  const q = col(n) - 1;
  const z = row(n) - 1 - (q - (q & 1)) / 2;
  return [q, -q - z, z];
}
export function dist(a: number, b: number): number {
  const [x1, y1, z1] = cube(a);
  const [x2, y2, z2] = cube(b);
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2), Math.abs(z1 - z2));
}
function fromCube(x: number, z: number): number {
  const q = x;
  const r = z + (q - (q & 1)) / 2;
  return hexAt(q + 1, r + 1);
}
/** Клетки на прямой между a и b (без концов). */
export function line(a: number, b: number): number[] {
  const A = cube(a);
  const B = cube(b);
  const d = dist(a, b);
  const out: number[] = [];
  for (let i = 1; i < d; i++) {
    const t = i / d;
    let x = A[0] + (B[0] - A[0]) * t + 1e-6;
    let y = A[1] + (B[1] - A[1]) * t + 2e-6;
    let z = A[2] + (B[2] - A[2]) * t - 3e-6;
    let rx = Math.round(x);
    let ry = Math.round(y);
    let rz = Math.round(z);
    const dx = Math.abs(rx - x);
    const dy = Math.abs(ry - y);
    const dz = Math.abs(rz - z);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (dy > dz) ry = -rx - rz;
    else rz = -rx - ry;
    x = rx;
    z = rz;
    out.push(fromCube(x, z));
  }
  return out;
}

const key = (a: number, b: number) => (a < b ? a * N + b : b * N + a);
const ROADS = new Set(ROAD.map(([a, b]) => key(a, b)));
const RIVERS = new Set(RIVER.map(([a, b]) => key(a, b)));
export const isRoad = (a: number, b: number) => ROADS.has(key(a, b));
export const isRiver = (a: number, b: number) => RIVERS.has(key(a, b)) && !ROADS.has(key(a, b));
export const isBridge = (a: number, b: number) => RIVERS.has(key(a, b)) && ROADS.has(key(a, b));
export const ROAD_HEX = new Set(ROAD.flat());
export const level = (n: number) => LEVEL[n];
export const isForest = (n: number) => TERR[n] === 1;
export const isShrub = (n: number) => TERR[n] === 2;
export const isVillage = (n: number) => TERR[n] === 3;
export const isRedoubt = (n: number) => n in REDOUBTS;
/** Укреплённая сторона редута: обращённая на запад (к соседу в столбце левее). */
export const redoubtSide = (a: number, b: number) => (isRedoubt(a) && col(b) < col(a)) || (isRedoubt(b) && col(a) < col(b));
export const isSlope = (a: number, b: number) => LEVEL[a] !== LEVEL[b];
export const villageName = (n: number) => Object.keys(VILLAGES).find((k) => VILLAGES[k].includes(n)) ?? null;
export function terrainName(n: number): string {
  const t = ['чистая местность', 'лес', 'кустарник', 'деревня'][TERR[n]];
  return `${t}${isRedoubt(n) ? ', редут' : ''}, ${['низина', 'средний уровень', 'возвышенность'][LEVEL[n]]}`;
}

export type MoveKind = 'inf' | 'cav' | 'wheels' | 'cmd';
/** Цена входа из a в соседнюю b; Infinity — нельзя. */
export function stepCost(a: number, b: number, k: MoveKind): number {
  const slope = isSlope(a, b) ? 2 : 0;
  if (isRoad(a, b)) return 1 + slope + (isBridge(a, b) ? 1 : 0);
  if (k === 'wheels' && (isForest(b) || isShrub(b))) return Infinity;
  let c = isForest(b) ? 2 : isShrub(b) ? 3 : 1;
  c += slope;
  if (isRiver(a, b)) {
    if (k === 'wheels') return Infinity;
    c += 4;
  }
  if (redoubtSide(a, b)) {
    if (k === 'cav' || k === 'wheels') return Infinity;
    c += 3;
  }
  return c;
}
