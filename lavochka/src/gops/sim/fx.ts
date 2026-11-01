/* Фиксированная точка ГОПС: координаты Q8 (1/256 px), sin/cos Q14 из таблицы, углы в 1/4096 оборота.
 * Только целая арифметика — бит в бит одинаково в любом браузере (docs/gops/CODE.md §2). */
import { SIN_QUARTER } from './trig-table';

export const ONE = 256;
export const TRIG_ONE = 16384;
export const ANG_FULL = 4096;
const QUARTER = 1024;
/** Усечение к нулю без «−0» (−0 портит сравнения и хеш мира). */
export const trunc = (v: number): number => Math.trunc(v) + 0;

export const toFx = (px: number): number => px * ONE;
/** Пол, и для отрицательных тоже. */
export const toPx = (v: number): number => Math.floor(v / ONE);
export const fmul = (a: number, b: number): number => trunc((a * b) / ONE);
export const fdiv = (a: number, b: number): number => trunc((a * ONE) / b);

/** Точный пол корня для 0…2^52: оценка делением пополам по степени, затем Ньютон на целых. */
export function isqrt(n: number): number {
  if (n <= 0) return 0;
  let x = n;
  let y = Math.floor((x + 1) / 2);
  while (y < x) {
    x = y;
    y = Math.floor((x + Math.floor(n / x)) / 2);
  }
  return x;
}

export const len = (dx: number, dy: number): number => isqrt(dx * dx + dy * dy);

export function sinQ(a: number): number {
  const m = ((a % ANG_FULL) + ANG_FULL) % ANG_FULL;
  if (m <= QUARTER) return SIN_QUARTER[m];
  if (m <= 2 * QUARTER) return SIN_QUARTER[2 * QUARTER - m];
  if (m <= 3 * QUARTER) return 0 - SIN_QUARTER[m - 2 * QUARTER];
  return 0 - SIN_QUARTER[ANG_FULL - m];
}

export const cosQ = (a: number): number => sinQ(a + QUARTER);

/** Угол 0…4095. В первом октанте — двоичный поиск t ∈ 0…512 с tan(t) ≈ ay/ax, дальше — симметрии. */
export function atan2Q(y: number, x: number): number {
  if (x === 0 && y === 0) return 0;
  const ax = Math.abs(x), ay = Math.abs(y);
  const lo = Math.min(ax, ay), hi = Math.max(ax, ay);
  // наибольший t, у которого sin(t)·hi ≤ lo·cos(t), и сравнение с соседом — кто ближе
  let a = 0, b = 512;
  while (a < b) {
    const mid = (a + b + 1) >> 1;
    if (sinQ(mid) * hi <= lo * cosQ(mid)) a = mid;
    else b = mid - 1;
  }
  if (a < 512) {
    const e0 = lo * cosQ(a) - sinQ(a) * hi; // ≥ 0
    const e1 = sinQ(a + 1) * hi - lo * cosQ(a + 1); // > 0
    if (e1 < e0) a++;
  }
  let t = ay > ax ? QUARTER - a : a; // первый квадрант
  if (x < 0) t = 2 * QUARTER - t;
  if (y < 0) t = ANG_FULL - t;
  return t % ANG_FULL;
}

export function fromAngle(a: number, speed: number): [number, number] {
  return [trunc((speed * cosQ(a)) / TRIG_ONE), trunc((speed * sinQ(a)) / TRIG_ONE)];
}

export const angleOf = (dx: number, dy: number): number => atan2Q(dy, dx);
