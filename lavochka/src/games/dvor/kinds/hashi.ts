/* Лужи и мостки (хаси): острова-кирпичи с числами; соединить их досками по горизонтали/вертикали,
 * между двумя островами не больше двух досок, доски не пересекаются, всё связано в одну сеть,
 * у острова ровно столько досок, сколько написано. Генератор: растим связную сеть, считаем числа,
 * проверяем единственность решателем. Без DOM. */
import type { Rng } from '../../../core/types';
import { shuffle } from '../../../core/rng';

export interface HashiData {
  w: number;
  h: number;
  /** Острова: клетка и число. */
  isl: { at: number; n: number }[];
}

/** Возможная перемычка между островами a<b (по индексам isl) и клетки под ней. */
export interface Span {
  a: number;
  b: number;
  cells: number[];
}

export function spansOf(d: HashiData): Span[] {
  const at = new Map(d.isl.map((s, k) => [s.at, k]));
  const r: Span[] = [];
  for (let k = 0; k < d.isl.length; k++) {
    const c = d.isl[k].at;
    const x = c % d.w;
    const y = (c / d.w) | 0;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const cells: number[] = [];
      let nx = x + dx;
      let ny = y + dy;
      while (nx < d.w && ny < d.h) {
        const i = ny * d.w + nx;
        const j = at.get(i);
        if (j != null) {
          if (cells.length) r.push({ a: k, b: j, cells });
          break;
        }
        cells.push(i);
        nx += dx;
        ny += dy;
      }
    }
  }
  return r;
}

function crosses(p: Span, q: Span): boolean {
  if (p.a === q.a || p.a === q.b || p.b === q.a || p.b === q.b) return false;
  const s = new Set(p.cells);
  return q.cells.some((c) => s.has(c));
}

function connected(n: number, spans: Span[], val: number[]): boolean {
  const seen = new Array(n).fill(false);
  const st = [0];
  seen[0] = true;
  let cnt = 1;
  while (st.length) {
    const k = st.pop()!;
    spans.forEach((sp, i) => {
      if (!val[i]) return;
      const o = sp.a === k ? sp.b : sp.b === k ? sp.a : -1;
      if (o >= 0 && !seen[o]) {
        seen[o] = true;
        cnt++;
        st.push(o);
      }
    });
  }
  return cnt === n;
}

/** Число решений (до limit): перебор по перемычкам с отсечением по остаткам. */
export function countHashi(d: HashiData, limit = 2, out?: number[]): number {
  const spans = spansOf(d);
  const n = d.isl.length;
  const cross = spans.map((p) => spans.map((q, j) => (crosses(p, q) ? j : -1)).filter((j) => j >= 0));
  const need = d.isl.map((s) => s.n);
  const val = spans.map(() => 0);
  // для каждого острова — его перемычки; порядок обхода: перемычки по островам
  const bySp = d.isl.map((_, k) => spans.map((sp, i) => (sp.a === k || sp.b === k ? i : -1)).filter((i) => i >= 0));
  const lastOf = d.isl.map((_, k) => Math.max(-1, ...bySp[k]));
  let found = 0;
  const cap = (k: number, from: number) => bySp[k].filter((i) => i >= from).length * 2;
  const go = (i: number) => {
    if (found >= limit) return;
    if (i === spans.length) {
      if (need.every((x) => x === 0) && connected(n, spans, val)) {
        if (!found && out) out.splice(0, out.length, ...val);
        found++;
      }
      return;
    }
    const sp = spans[i];
    const blocked = cross[i].some((j) => j < i && val[j] > 0);
    for (let v = blocked ? 0 : Math.min(2, need[sp.a], need[sp.b]); v >= 0; v--) {
      need[sp.a] -= v;
      need[sp.b] -= v;
      val[i] = v;
      let ok = true;
      for (const k of [sp.a, sp.b]) {
        if (lastOf[k] === i && need[k] !== 0) ok = false;
        else if (need[k] > cap(k, i + 1)) ok = false;
      }
      if (ok) go(i + 1);
      need[sp.a] += v;
      need[sp.b] += v;
      val[i] = 0;
      if (found >= limit) return;
    }
  };
  // остров, у которого вообще не хватает перемычек, отсекаем сразу
  if (d.isl.some((s, k) => s.n > cap(k, 0) || s.n < 1)) return 0;
  go(0);
  return found;
}

export interface HashiPuzzle {
  data: HashiData;
  /** Число досок по каждой перемычке spansOf(data). */
  sol: number[];
}

/** Уровень 0 — 7×7, ~8 островов; 1 — 9×9, ~13; 2 — 11×11, ~20. */
export function genHashi(level: number, rng: Rng): HashiPuzzle {
  const size = [7, 9, 11][level] ?? 9;
  const want = [8, 13, 20][level] ?? 13;
  for (let attempt = 0; attempt < 200; attempt++) {
    const w = size;
    const h = size;
    const occ = new Array(w * h).fill(0); // 1 — остров, 2 — доска
    const isl: number[] = [];
    const bridges: { a: number; b: number; cells: number[]; v: number }[] = [];
    const first = rng.int(w * h);
    occ[first] = 1;
    isl.push(first);
    let tries = 0;
    while (isl.length < want && tries++ < 500) {
      const from = isl[rng.int(isl.length)];
      const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][rng.int(4)];
      const len = 2 + rng.int(Math.max(1, (size >> 1) - 1));
      const x0 = from % w;
      const y0 = (from / w) | 0;
      const tx = x0 + dx * len;
      const ty = y0 + dy * len;
      if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
      const cells: number[] = [];
      let ok = true;
      for (let k = 1; k < len; k++) {
        const c = (y0 + dy * k) * w + x0 + dx * k;
        if (occ[c]) ok = false;
        cells.push(c);
      }
      const t = ty * w + tx;
      if (!ok || occ[t]) continue;
      // соседство островов вплотную запрещаем (иначе путаница на глаз)
      const tooClose = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([ex, ey]) => {
        const ax = tx + ex;
        const ay = ty + ey;
        return ax >= 0 && ay >= 0 && ax < w && ay < h && occ[ay * w + ax] === 1;
      });
      if (tooClose) continue;
      occ[t] = 1;
      cells.forEach((c) => (occ[c] = 2));
      isl.push(t);
      bridges.push({ a: from, b: t, cells, v: 1 + rng.int(2) });
    }
    if (isl.length < want - 2) continue;
    // иногда добавим перемычку между уже стоящими островами (циклы делают задачу интереснее)
    const sorted = isl.slice().sort((a, b) => a - b);
    const tmp: HashiData = { w, h, isl: sorted.map((at) => ({ at, n: 0 })) };
    const spans = spansOf(tmp);
    const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);
    const has = new Map(bridges.map((b) => [key(b.a, b.b), b]));
    for (const sp of shuffle(spans, rng)) {
      const A = sorted[sp.a];
      const B = sorted[sp.b];
      if (has.has(key(A, B)) || rng.next() < 0.6) continue;
      if (sp.cells.some((c) => occ[c])) continue;
      sp.cells.forEach((c) => (occ[c] = 2));
      const br = { a: A, b: B, cells: sp.cells, v: 1 + rng.int(2) };
      bridges.push(br);
      has.set(key(A, B), br);
    }
    const sol = spans.map((sp) => has.get(key(sorted[sp.a], sorted[sp.b]))?.v ?? 0);
    const nOf = sorted.map((_, k) => spans.reduce((s, sp, i) => s + (sp.a === k || sp.b === k ? sol[i] : 0), 0));
    const data: HashiData = { w, h, isl: sorted.map((at, k) => ({ at, n: nOf[k] })) };
    if (countHashi(data, 2) !== 1) continue;
    return { data, sol };
  }
  throw new Error('хаси: не сложилось');
}

/** Ответ — число досок по каждой перемычке spansOf(data). */
export function checkHashi(d: HashiData, ans: number[]): boolean {
  const spans = spansOf(d);
  if (!Array.isArray(ans) || ans.length !== spans.length) return false;
  if (ans.some((v) => v !== 0 && v !== 1 && v !== 2)) return false;
  for (let i = 0; i < spans.length; i++) for (let j = i + 1; j < spans.length; j++) if (ans[i] && ans[j] && crosses(spans[i], spans[j])) return false;
  for (let k = 0; k < d.isl.length; k++) {
    const s = spans.reduce((t, sp, i) => t + (sp.a === k || sp.b === k ? ans[i] : 0), 0);
    if (s !== d.isl[k].n) return false;
  }
  return connected(d.isl.length, spans, ans);
}

export function solveHashi(d: HashiData): number[] {
  const out: number[] = [];
  countHashi(d, 1, out);
  return out;
}
