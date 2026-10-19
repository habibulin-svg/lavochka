/* «2048» — боты. Лёгкий двигает почти наугад (любит низ и лево), средний смотрит на ход вперёд,
 * сложный — «ожидание на два хода»: перебирает свой ход, где может выпасть новая плитка, и свой следующий ход.
 * Оценка доски — пустые клетки, гладкость, монотонность рядов и крупная плитка в углу. */
import type { Rng } from '../../core/types';
import { boardOf, canMove, slide, type Action, type Dir, type State } from './engine';

const PACE = [0.35, 0.6, 0.9];
const DIRS: Dir[] = [0, 1, 2, 3];
const lg = (v: number) => (v > 0 ? Math.log2(v) : 0);

function evaluate(c: number[], n: number): number {
  let empty = 0;
  let smooth = 0;
  let mono = 0;
  let max = 0;
  for (let i = 0; i < c.length; i++) {
    const v = c[i];
    if (v === 0) empty++;
    if (v > max) max = v;
  }
  for (let y = 0; y < n; y++) {
    let inc = 0;
    let dec = 0;
    let incC = 0;
    let decC = 0;
    for (let x = 0; x < n - 1; x++) {
      const a = lg(Math.max(0, c[y * n + x]));
      const b = lg(Math.max(0, c[y * n + x + 1]));
      if (a && b) smooth -= Math.abs(a - b);
      if (a > b) dec += a - b;
      else inc += b - a;
      const p = lg(Math.max(0, c[x * n + y]));
      const q = lg(Math.max(0, c[(x + 1) * n + y]));
      if (p && q) smooth -= Math.abs(p - q);
      if (p > q) decC += p - q;
      else incC += q - p;
    }
    mono -= Math.min(inc, dec) + Math.min(incC, decC);
  }
  const corners = [0, n - 1, n * (n - 1), n * n - 1];
  const corner = corners.some((i) => c[i] === max) ? lg(max) : 0;
  return empty * 2.7 + mono * 1.0 + smooth * 0.1 + corner * 1.5;
}

function chance(c: number[], n: number, depth: number): number {
  const empty: number[] = [];
  c.forEach((v, i) => v === 0 && empty.push(i));
  if (!empty.length) return evaluate(c, n);
  // много пустых — проверяем не все клетки (ради скорости)
  const pick = empty.length > 6 ? empty.filter((_, k) => k % Math.ceil(empty.length / 6) === 0) : empty;
  let sum = 0;
  for (const i of pick) {
    for (const [v, p] of [
      [2, 0.9],
      [4, 0.1],
    ] as const) {
      const d = c.slice();
      d[i] = v;
      sum += p * best(d, n, depth - 1);
    }
  }
  return sum / pick.length;
}

function best(c: number[], n: number, depth: number): number {
  if (depth <= 0) return evaluate(c, n);
  let top = -1e9;
  for (const dir of DIRS) {
    const r = slide(c, n, dir);
    if (!r.moved) continue;
    top = Math.max(top, chance(r.cells, n, depth) + Math.log2(1 + r.gain) * 0.3);
  }
  return top === -1e9 ? -1e6 : top;
}

export function choose(v: State, seat: number, level: number, rng: Rng): Action {
  const L = Math.max(0, Math.min(2, level));
  if (rng.next() >= PACE[L]) return { type: 'think' };
  const b = v.boards[boardOf(v, seat)];
  const n = v.cfg.n;
  if (!canMove(b.cells, n)) return { type: 'think' };
  const legal = DIRS.filter((d) => slide(b.cells, n, d).moved);
  if (!legal.length) return { type: 'think' };
  if (L === 0) {
    // вниз и влево — почаще, вверх — только если иначе нельзя
    const pref = legal.filter((d) => d !== 0);
    const pool = pref.length ? pref : legal;
    const w = pool.map((d) => (d === 2 || d === 3 ? 3 : 1));
    let r = rng.next() * w.reduce((a, x) => a + x, 0);
    for (let k = 0; k < pool.length; k++) if ((r -= w[k]) < 0) return { type: 'move', dir: pool[k] };
    return { type: 'move', dir: pool[0] };
  }
  let pick = legal[0];
  let top = -Infinity;
  for (const d of legal) {
    const r = slide(b.cells, n, d);
    const score = L === 1 ? evaluate(r.cells, n) + Math.log2(1 + r.gain) * 0.3 : chance(r.cells, n, n > 4 ? 1 : 2);
    if (score > top) {
      top = score;
      pick = d;
    }
  }
  return { type: 'move', dir: pick };
}
