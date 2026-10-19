/* Волна 9 «А у нас во дворе»: очередь (порядок по условиям), кто выше (футоси), шифровка (криптарифм),
 * какурасу. Без DOM. */
import type { Rng } from '../../../core/types';
import { shuffle } from '../../../core/rng';
import { latin } from './stopki';

// ---------------------------------------------------------------- очередь

type QClue =
  | { t: 'after'; a: number; b: number } // a стоит сразу за b
  | { t: 'before'; a: number; b: number } // a где-то раньше b
  | { t: 'pos'; a: number; p: number } // a стоит p-м
  | { t: 'notEnd'; a: number } // a не первый и не последний
  | { t: 'gap'; a: number; b: number; k: number }; // между a и b ровно k человек

export interface OcheredData {
  names: string[];
  clues: QClue[];
  texts: string[];
}

const ORD = ['первым', 'вторым', 'третьим', 'четвёртым', 'пятым', 'шестым'];
const ORD_F = ['первой', 'второй', 'третьей', 'четвёртой', 'пятой', 'шестой'];
const FEM = new Set(['Ленка', 'Танька', 'Оля', 'Светка', 'Маринка']);

function holds(c: QClue, pos: number[]): boolean {
  switch (c.t) {
    case 'after':
      return pos[c.a] === pos[c.b] + 1;
    case 'before':
      return pos[c.a] < pos[c.b];
    case 'pos':
      return pos[c.a] === c.p;
    case 'notEnd':
      return pos[c.a] > 0 && pos[c.a] < pos.length - 1;
    case 'gap':
      return Math.abs(pos[c.a] - pos[c.b]) === c.k + 1;
  }
}

function text(c: QClue, names: string[]): string {
  const n = (i: number) => names[i];
  switch (c.t) {
    case 'after':
      return `${n(c.a)} стоит сразу за ${tvor(n(c.b))}.`;
    case 'before':
      return `${n(c.a)} стоит где-то впереди ${genOf(n(c.b))}.`;
    case 'pos':
      return `${n(c.a)} стоит ${FEM.has(n(c.a)) ? ORD_F[c.p] : ORD[c.p]}.`;
    case 'notEnd':
      return `${n(c.a)} не первый и не последний — где-то в середине.`.replace('не первый', FEM.has(n(c.a)) ? 'не первая' : 'не первый').replace('не последний', FEM.has(n(c.a)) ? 'не последняя' : 'не последний');
    case 'gap':
      return `Между ${tvor(n(c.a))} и ${tvor(n(c.b))} ${c.k === 1 ? 'стоит ровно один человек' : c.k === 2 ? 'стоят ровно двое' : 'стоят ровно трое'}.`;
  }
}

const GEN: Record<string, string> = { Вовка: 'Вовки', Ленка: 'Ленки', Серёга: 'Серёги', Танька: 'Таньки', Димка: 'Димки', Оля: 'Оли', Жека: 'Жеки', Светка: 'Светки', Колян: 'Коляна', Маринка: 'Маринки' };
const TVOR: Record<string, string> = { Вовка: 'Вовкой', Ленка: 'Ленкой', Серёга: 'Серёгой', Танька: 'Танькой', Димка: 'Димкой', Оля: 'Олей', Жека: 'Жекой', Светка: 'Светкой', Колян: 'Коляном', Маринка: 'Маринкой' };
const genOf = (s: string) => GEN[s] ?? s;
const tvor = (s: string) => TVOR[s] ?? s;

function perms(n: number): number[][] {
  if (n === 1) return [[0]];
  return perms(n - 1).flatMap((p) => Array.from({ length: n }, (_, i) => [...p.slice(0, i), n - 1, ...p.slice(i)]));
}

/** Порядок: order[место] = номер ребёнка. */
const fitsQ = (clues: QClue[], order: number[]) => {
  const pos: number[] = [];
  order.forEach((c, p) => (pos[c] = p));
  return clues.every((c) => holds(c, pos));
};

export function solveOchered(d: OcheredData): number[] {
  return perms(d.names.length).find((o) => fitsQ(d.clues, o)) ?? [];
}

export const checkOchered = (d: OcheredData, a: unknown) =>
  Array.isArray(a) && a.length === d.names.length && new Set(a).size === a.length && a.every((x) => Number.isInteger(x) && x >= 0 && x < d.names.length) && fitsQ(d.clues, a as number[]);

/** Уровень: 0 — четверо; 1 — пятеро; 2 — шестеро. */
export function genOchered(level: number, names0: string[], rng: Rng): { data: OcheredData; sol: number[] } {
  const n = level + 4;
  const all = perms(n);
  for (let attempt = 0; attempt < 200; attempt++) {
    const names = shuffle(names0, rng).slice(0, n);
    const order = shuffle([...Array(n).keys()], rng);
    const pos: number[] = [];
    order.forEach((c, p) => (pos[c] = p));
    const clues: QClue[] = [];
    let cand = all;
    for (let t = 0; t < 60 && cand.length > 1; t++) {
      const a = rng.int(n);
      let b = rng.int(n - 1);
      if (b >= a) b++;
      const r = rng.next();
      let c: QClue;
      if (r < 0.25) c = pos[a] === pos[b] + 1 ? { t: 'after', a, b } : { t: 'before', a: pos[a] < pos[b] ? a : b, b: pos[a] < pos[b] ? b : a };
      else if (r < 0.5) c = { t: 'before', a: pos[a] < pos[b] ? a : b, b: pos[a] < pos[b] ? b : a };
      else if (r < 0.65) c = { t: 'pos', a, p: pos[a] };
      else if (r < 0.8 && pos[a] > 0 && pos[a] < n - 1) c = { t: 'notEnd', a };
      else {
        const k = Math.abs(pos[a] - pos[b]) - 1;
        if (k < 1 || k > 3) continue;
        c = { t: 'gap', a, b, k };
      }
      // «сразу за» — по соседству в очереди
      const j = order[pos[a] - 1];
      if (r < 0.12 && j != null) c = { t: 'after', a, b: j };
      const next = cand.filter((o) => fitsQ([c], o));
      if (next.length === cand.length) continue;
      if (level === 0 ? false : c.t === 'pos' && clues.filter((x) => x.t === 'pos').length >= 1) continue;
      clues.push(c);
      cand = next;
    }
    if (cand.length !== 1) continue;
    return { data: { names, clues, texts: clues.map((c) => text(c, names)) }, sol: order };
  }
  throw new Error('очередь: не сложилось');
}

// ---------------------------------------------------------------- кто выше (футоси)

export interface FutoData {
  n: number;
  given: number[];
  /** Знаки между соседями: [клетка, сосед справа или снизу, 1 — первая больше, -1 — меньше]. */
  signs: [number, number, number][];
}

export function countFuto(d: FutoData, limit = 2, out?: number[]): number {
  const { n } = d;
  const N = n * n;
  const g = d.given.slice();
  const rows = Array.from({ length: n }, () => new Array(n + 1).fill(false));
  const cols = Array.from({ length: n }, () => new Array(n + 1).fill(false));
  for (let i = 0; i < N; i++) if (g[i]) (rows[(i / n) | 0][g[i]] = true), (cols[i % n][g[i]] = true);
  const signsAt: [number, number][][] = Array.from({ length: N }, () => []);
  for (const [a, b, s] of d.signs) signsAt[a].push([b, s]), signsAt[b].push([a, -s]);
  let found = 0;
  const go = (i: number): void => {
    if (found >= limit) return;
    if (i === N) {
      if (!found && out) out.splice(0, N, ...g);
      found++;
      return;
    }
    const ok = (v: number) => signsAt[i].every(([j, s]) => !g[j] || (s > 0 ? v > g[j] : v < g[j]));
    if (d.given[i]) {
      if (ok(g[i])) go(i + 1);
      return;
    }
    const r = (i / n) | 0;
    const c = i % n;
    for (let v = 1; v <= n; v++) {
      if (rows[r][v] || cols[c][v] || !ok(v)) continue;
      g[i] = v;
      rows[r][v] = cols[c][v] = true;
      go(i + 1);
      rows[r][v] = cols[c][v] = false;
      g[i] = 0;
      if (found >= limit) return;
    }
  };
  go(0);
  return found;
}

export function solveFuto(d: FutoData): number[] {
  const out: number[] = [];
  countFuto(d, 1, out);
  return out;
}

export function checkFuto(d: FutoData, a: unknown): boolean {
  const { n } = d;
  if (!Array.isArray(a) || a.length !== n * n) return false;
  const g = a as number[];
  if (g.some((v, i) => !Number.isInteger(v) || v < 1 || v > n || (d.given[i] && d.given[i] !== v))) return false;
  for (let k = 0; k < n; k++) {
    if (new Set(g.slice(k * n, k * n + n)).size !== n) return false;
    if (new Set(Array.from({ length: n }, (_, r) => g[r * n + k])).size !== n) return false;
  }
  return d.signs.every(([x, y, s]) => (s > 0 ? g[x] > g[y] : g[x] < g[y]));
}

/** Уровень: 0 — 4×4; 1 — 5×5; 2 — 6×6. */
export function genFuto(level: number, rng: Rng): { data: FutoData; sol: number[] } {
  const n = level + 4;
  const N = n * n;
  for (let attempt = 0; attempt < 100; attempt++) {
    const sol = latin(n, rng);
    const pairs: [number, number][] = [];
    for (let i = 0; i < N; i++) {
      if (i % n < n - 1) pairs.push([i, i + 1]);
      if (i + n < N) pairs.push([i, i + n]);
    }
    const signs: [number, number, number][] = shuffle(pairs, rng)
      .slice(0, Math.round(pairs.length * 0.45))
      .map(([a, b]) => [a, b, sol[a] > sol[b] ? 1 : -1]);
    const d: FutoData = { n, given: new Array(N).fill(0), signs };
    for (const i of shuffle([...Array(N).keys()], rng)) {
      if (countFuto(d) === 1) break;
      d.given[i] = sol[i];
    }
    if (countFuto(d) !== 1) continue;
    // сначала убираем лишние цифры (знаки — главное в этой задаче), потом лишние знаки
    for (const i of shuffle([...Array(N).keys()], rng)) {
      const v = d.given[i];
      if (!v) continue;
      d.given[i] = 0;
      if (countFuto(d) !== 1) d.given[i] = v;
    }
    for (const s of shuffle(d.signs.slice(), rng)) {
      if (d.signs.length <= pairs.length * 0.25) break;
      const keep = d.signs;
      d.signs = keep.filter((x) => x !== s);
      if (countFuto(d) !== 1) d.signs = keep;
    }
    return { data: d, sol };
  }
  throw new Error('кто выше: не сложилось');
}

// ---------------------------------------------------------------- шифровка (криптарифм)

export interface KriptData {
  a: string;
  b: string;
  c: string;
  /** Буквы задачи по порядку. */
  letters: string[];
  /** Открытые заранее буквы: [номер буквы, цифра]. */
  known: [number, number][];
}

const KR_WORDS = ['КОТ', 'ГОЛ', 'МЯЧ', 'ТИР', 'ДОМ', 'ЛУЖА', 'ДВОР', 'МЕЛ', 'КЛАД', 'ЛЕТО', 'ШАР', 'СОК', 'ТОРТ', 'ПОЛЕ', 'ЛЕС', 'РАК', 'ЛУК', 'КРАН', 'СЛОН', 'ВОЛК'];

const valOf = (w: string, m: Map<string, number>) => [...w].reduce((v, ch) => v * 10 + m.get(ch)!, 0);

/** Все отображения букв в разные цифры, при которых A + B = C (до limit): по столбцам справа, с переносом. */
function kriptSolutions(d: KriptData, limit = 2): Map<string, number>[] {
  const lead = new Set([d.a[0], d.b[0], d.c[0]]);
  const len = d.c.length;
  const at = (w: string, i: number) => (i < w.length ? w[w.length - 1 - i] : null);
  const out: Map<string, number>[] = [];
  const m = new Map<string, number>();
  const used = new Array(10).fill(false);
  for (const [i, v] of d.known) {
    if (used[v]) return out;
    m.set(d.letters[i], v);
    used[v] = true;
  }
  // перебрать значения букв из списка, потом продолжить
  const assign = (ls: string[], k: number, then: () => void) => {
    if (k === ls.length) return then();
    const l = ls[k];
    if (m.has(l)) return assign(ls, k + 1, then);
    for (let v = lead.has(l) ? 1 : 0; v <= 9; v++) {
      if (used[v]) continue;
      used[v] = true;
      m.set(l, v);
      assign(ls, k + 1, then);
      used[v] = false;
      m.delete(l);
      if (out.length >= limit) return;
    }
  };
  const col = (i: number, carry: number): void => {
    if (out.length >= limit) return;
    if (i === len) {
      if (!carry && d.letters.every((l) => m.has(l))) out.push(new Map(m));
      return;
    }
    const la = at(d.a, i);
    const lb = at(d.b, i);
    const lc = at(d.c, i)!;
    assign([la, lb].filter(Boolean) as string[], 0, () => {
      const s = (la ? m.get(la)! : 0) + (lb ? m.get(lb)! : 0) + carry;
      const want = s % 10;
      if (m.has(lc)) {
        if (m.get(lc) === want) col(i + 1, Math.floor(s / 10));
        return;
      }
      if (used[want] || (want === 0 && lead.has(lc))) return;
      used[want] = true;
      m.set(lc, want);
      col(i + 1, Math.floor(s / 10));
      used[want] = false;
      m.delete(lc);
    });
  };
  if (d.c.length < Math.max(d.a.length, d.b.length)) return out;
  col(0, 0);
  return out;
}

export function solveKript(d: KriptData): number[] {
  const s = kriptSolutions(d, 1)[0];
  return d.letters.map((l) => s?.get(l) ?? 0);
}

export function checkKript(d: KriptData, a: unknown): boolean {
  if (!Array.isArray(a) || a.length !== d.letters.length || new Set(a).size !== a.length) return false;
  if (a.some((v) => !Number.isInteger(v) || v < 0 || v > 9)) return false;
  const m = new Map(d.letters.map((l, i) => [l, a[i] as number]));
  if ([d.a, d.b, d.c].some((w) => !m.get(w[0]))) return false;
  if (d.known.some(([i, v]) => a[i] !== v)) return false;
  return valOf(d.a, m) + valOf(d.b, m) === valOf(d.c, m);
}

/** Уровень: 0 — короткие слова (3+3); 1 — 3+4 или 4+4; 2 — 4+4 с переносом в пятый разряд. Буквы суммы — свои. */
export function genKript(level: number, rng: Rng): { data: KriptData; sol: number[] } {
  const pool = KR_WORDS.filter((w) => (level === 0 ? w.length === 3 : true));
  const SPARE = [...'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЭЮЯ'];
  for (let attempt = 0; attempt < 2000; attempt++) {
    const a = pool[rng.int(pool.length)];
    const b = pool[rng.int(pool.length)];
    if (a === b || (level === 2 && (a.length < 4 || b.length < 4))) continue;
    const ab = [...new Set([...a, ...b])];
    if (ab.length > 7) continue;
    const digits = shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], rng);
    const m = new Map(ab.map((l, i) => [l, digits[i]]));
    if (!m.get(a[0]) || !m.get(b[0])) continue;
    const sum = String(valOf(a, m) + valOf(b, m));
    if (level === 2 && sum.length <= Math.max(a.length, b.length)) continue;
    // буквы суммы: цифра уже есть у буквы — та буква, иначе новая
    const byDigit = new Map([...m].map(([l, v]) => [v, l]));
    const spare = shuffle(SPARE.filter((l) => !m.has(l)), rng);
    let c = '';
    for (const ch of sum) {
      const v = Number(ch);
      if (!byDigit.has(v)) {
        const l = spare.pop()!;
        byDigit.set(v, l);
        m.set(l, v);
      }
      c += byDigit.get(v);
    }
    const letters = [...new Set([...a, ...b, ...c])];
    if (letters.length > 8) continue;
    const d: KriptData = { a, b, c, letters, known: [] };
    const sol = letters.map((l) => m.get(l)!);
    // открываем буквы, пока решение не единственное (не больше половины; на лёгкой — щедрее)
    const maxKnown = Math.floor(letters.length * [0.6, 0.45, 0.35][level]);
    for (const i of shuffle([...letters.keys()], rng)) {
      if (kriptSolutions(d).length === 1) break;
      d.known.push([i, sol[i]]);
    }
    if (kriptSolutions(d).length !== 1 || d.known.length > maxKnown) continue;
    return { data: d, sol };
  }
  throw new Error('шифровка: не сложилось');
}

// ---------------------------------------------------------------- какурасу

export interface KakurasuData {
  n: number;
  /** Сумма номеров столбцов закрашенных клеток строки. */
  rows: number[];
  /** Сумма номеров строк закрашенных клеток столбца. */
  cols: number[];
}

export function countKakurasu(d: KakurasuData, limit = 2, out?: number[]): number {
  const { n } = d;
  const subsets = (target: number) => {
    const res: number[][] = [];
    for (let m = 0; m < 1 << n; m++) {
      let s = 0;
      for (let k = 0; k < n; k++) if (m & (1 << k)) s += k + 1;
      if (s === target) res.push([...Array(n).keys()].map((k) => (m & (1 << k) ? 1 : 0)));
    }
    return res;
  };
  const opts = d.rows.map(subsets);
  const colSum = new Array(n).fill(0);
  const g: number[][] = [];
  let found = 0;
  // сколько ещё могут добавить строки ниже r: (r+2)+…+n
  const rest = (r: number) => {
    let s = 0;
    for (let k = r + 2; k <= n; k++) s += k;
    return s;
  };
  const go = (r: number): void => {
    if (found >= limit) return;
    if (r === n) {
      if (colSum.every((v, c) => v === d.cols[c])) {
        if (!found && out) out.splice(0, n * n, ...g.flat());
        found++;
      }
      return;
    }
    for (const row of opts[r]) {
      let ok = true;
      for (let c = 0; c < n; c++) {
        const s = colSum[c] + row[c] * (r + 1);
        if (s > d.cols[c] || s + rest(r) < d.cols[c]) ok = false;
      }
      if (!ok) continue;
      row.forEach((v, c) => (colSum[c] += v * (r + 1)));
      g.push(row);
      go(r + 1);
      g.pop();
      row.forEach((v, c) => (colSum[c] -= v * (r + 1)));
      if (found >= limit) return;
    }
  };
  go(0);
  return found;
}

export function solveKakurasu(d: KakurasuData): number[] {
  const out: number[] = [];
  countKakurasu(d, 1, out);
  return out;
}

export function checkKakurasu(d: KakurasuData, a: unknown): boolean {
  const { n } = d;
  if (!Array.isArray(a) || a.length !== n * n) return false;
  const g: number[] = a.map((v) => (v ? 1 : 0));
  for (let r = 0; r < n; r++) if (g.slice(r * n, r * n + n).reduce((t: number, v, c) => t + v * (c + 1), 0) !== d.rows[r]) return false;
  for (let c = 0; c < n; c++) if (Array.from({ length: n }, (_, r) => g[r * n + c] * (r + 1)).reduce((t, v) => t + v, 0) !== d.cols[c]) return false;
  return true;
}

/** Уровень: 0 — 4×4; 1 — 5×5; 2 — 6×6. */
export function genKakurasu(level: number, rng: Rng): { data: KakurasuData; sol: number[] } {
  const n = level + 4;
  for (let attempt = 0; attempt < 500; attempt++) {
    const g: number[] = Array.from({ length: n * n }, () => (rng.next() < 0.45 ? 1 : 0));
    const rows = Array.from({ length: n }, (_, r) => g.slice(r * n, r * n + n).reduce((t, v, c) => t + v * (c + 1), 0));
    const cols = Array.from({ length: n }, (_, c) => Array.from({ length: n }, (_, r) => g[r * n + c] * (r + 1)).reduce((t, v) => t + v, 0));
    if (rows.some((v) => !v) || cols.some((v) => !v)) continue;
    const d: KakurasuData = { n, rows, cols };
    if (countKakurasu(d) !== 1) continue;
    return { data: d, sol: g };
  }
  throw new Error('какурасу: не сложилось');
}
