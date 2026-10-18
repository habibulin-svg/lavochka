/* «Кто где» — логическая сетка (загадка Эйнштейна). Ребята × 2–3 признака (где прятался, каким водил, что принёс).
 * Генератор: случайный ответ, потом подсказки до единственности, потом выкидываем лишние. Подсказки — структуры;
 * текст собирается из «сказуемых» признаков в настоящем времени (оно без рода: «Ленка водит третьей» не нужно —
 * «Ленка водит раньше, чем тот, кто прячется в подвале»). Без DOM. */
import type { Rng } from '../../../core/types';
import { shuffle } from '../../../core/rng';

export interface ZCat {
  /** Заголовок столбца таблицы: «Где прятался». */
  title: string;
  /** Короткие подписи значений для таблицы: «в подвале». */
  vals: string[];
  /** Сказуемые: «прячется в подвале». */
  preds: string[];
  /** Порядковый признак: сравнение «{a} водит раньше, чем {b}». */
  before?: string;
}

export interface ZebraData {
  names: string[];
  cats: ZCat[];
  clues: string[];
  /** Те же подсказки структурой (для решателя бота), в том же порядке. */
  raw: Clue[];
  /** Вступление-повод. */
  intro: string;
}

/** Ссылка на «кого-то»: c = -1 — по имени (v — номер ребёнка), иначе по значению признака. */
type Ref = { c: number; v: number };
export type Clue =
  | { t: 'is'; s: Ref; c: number; v: number }
  | { t: 'not'; s: Ref; c: number; v: number }
  | { t: 'either'; s: Ref; c: number; v: number; w: number }
  | { t: 'before'; a: Ref; b: Ref; c: number };

/** perm[c][i] — значение признака c у ребёнка i (-1 — ещё не знаем). */
type Perm = number[][];

function who(p: Perm, r: Ref): number | undefined {
  if (r.c < 0) return r.v;
  const i = p[r.c].indexOf(r.v);
  return i < 0 ? undefined : i;
}

/** true / false / undefined (пока не известно). */
function holds(cl: Clue, p: Perm): boolean | undefined {
  if (cl.t === 'before') {
    const a = who(p, cl.a);
    const b = who(p, cl.b);
    if (a == null || b == null) return undefined;
    const va = p[cl.c][a];
    const vb = p[cl.c][b];
    if (va < 0 || vb < 0) return undefined;
    return va < vb;
  }
  const s = who(p, cl.s);
  if (s == null) {
    // если значение cl.v уже занято другим, о котором известно, что он не s — проверять рано; ждём
    return undefined;
  }
  const x = p[cl.c][s];
  if (x < 0) return undefined;
  if (cl.t === 'is') return x === cl.v;
  if (cl.t === 'not') return x !== cl.v;
  return x === cl.v || x === cl.w;
}

/** Сколько решений (до limit). Дети фиксированы, перебираем значения признаков по клеткам. */
function count(n: number, k: number, clues: Clue[], limit = 2, out?: number[][]): number {
  const p: Perm = Array.from({ length: k }, () => new Array(n).fill(-1));
  const used = Array.from({ length: k }, () => new Array(n).fill(false));
  let found = 0;
  const go = (cell: number) => {
    if (found >= limit) return;
    if (cell === n * k) {
      if (clues.every((cl) => holds(cl, p) === true)) {
        if (!found && out) out.splice(0, out.length, ...p.map((r) => r.slice()));
        found++;
      }
      return;
    }
    const c = (cell / n) | 0;
    const i = cell % n;
    for (let v = 0; v < n; v++) {
      if (used[c][v]) continue;
      p[c][i] = v;
      used[c][v] = true;
      if (clues.every((cl) => holds(cl, p) !== false)) go(cell + 1);
      used[c][v] = false;
      p[c][i] = -1;
      if (found >= limit) return;
    }
  };
  go(0);
  return found;
}

function refText(r: Ref, names: string[], cats: ZCat[]): string {
  return r.c < 0 ? names[r.v] : `тот, кто ${cats[r.c].preds[r.v]}`;
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function clueText(cl: Clue, names: string[], cats: ZCat[]): string {
  if (cl.t === 'before') return cap(cats[cl.c].before!.replace('{a}', refText(cl.a, names, cats) + (cl.a.c >= 0 ? ',' : '')).replace('{b}', refText(cl.b, names, cats))) + '.';
  const s = cap(refText(cl.s, names, cats));
  const comma = cl.s.c >= 0 ? ',' : '';
  const pr = cats[cl.c].preds;
  if (cl.t === 'is') return `${s}${comma} ${pr[cl.v]}.`;
  if (cl.t === 'not') return `${s}${comma} не ${pr[cl.v]}.`;
  // общий глагол выносим: «либо прячется в подвале, либо за гаражами»
  const a = pr[cl.v].split(' ');
  const b = pr[cl.w].split(' ');
  if (a.length > 1 && b.length > 1 && a[0] === b[0]) return `${s}${comma} ${a[0]} либо ${a.slice(1).join(' ')}, либо ${b.slice(1).join(' ')}.`;
  return `${s}${comma} либо ${pr[cl.v]}, либо ${pr[cl.w]}.`;
}

export interface ZebraTheme {
  intro: string;
  cats: ZCat[];
}

export interface ZebraPuzzle {
  data: ZebraData;
  /** sol[c][i] — значение признака c у ребёнка i. */
  sol: number[][];
}

/** Уровень 0 — 4 ребёнка × 2 признака, 1 — 4 × 3, 2 — 5 × 3. theme.cats — по n значений и больше (лишние отрежем). */
export function genZebra(level: number, names0: string[], theme: ZebraTheme, rng: Rng): ZebraPuzzle {
  const n = level >= 2 ? 5 : 4;
  const k = level === 0 ? 2 : 3;
  for (let attempt = 0; attempt < 30; attempt++) {
    const names = shuffle(names0, rng).slice(0, n);
    // берём k признаков (порядковый — если есть, обязательно), значения — первые n после перемешивания (порядковые — по порядку)
    const ordCats = theme.cats.filter((c) => c.before);
    const other = shuffle(theme.cats.filter((c) => !c.before), rng);
    const pick = [...ordCats.slice(0, 1), ...other].slice(0, k);
    const cats: ZCat[] = pick.map((c) => {
      const idx = c.before ? c.vals.map((_, i) => i).slice(0, n) : shuffle(c.vals.map((_, i) => i), rng).slice(0, n);
      return { ...c, vals: idx.map((i) => c.vals[i]), preds: idx.map((i) => c.preds[i]) };
    });
    const sol = cats.map(() => shuffle([...Array(n).keys()], rng));
    const p: Perm = sol;
    const refs: Ref[] = [...names.map((_, v) => ({ c: -1, v })), ...cats.flatMap((_, c) => [...Array(n).keys()].map((v) => ({ c, v })))];
    const pool: Clue[] = [];
    for (const s of refs) {
      const si = who(p, s)!;
      for (let c = 0; c < k; c++) {
        if (c === s.c) continue;
        const x = p[c][si];
        pool.push({ t: 'is', s, c, v: x });
        for (let v = 0; v < n; v++) if (v !== x) pool.push({ t: 'not', s, c, v });
        const w = (x + 1 + rng.int(n - 1)) % n;
        pool.push(rng.next() < 0.5 ? { t: 'either', s, c, v: x, w } : { t: 'either', s, c, v: w, w: x });
      }
    }
    for (let c = 0; c < k; c++) {
      if (!cats[c].before) continue;
      for (const a of refs)
        for (const b of refs) {
          if (a.c === c || b.c === c) continue;
          const ia = who(p, a)!;
          const ib = who(p, b)!;
          if (ia === ib || (a.c === b.c && a.c < 0 && false)) continue;
          if (p[c][ia] < p[c][ib]) pool.push({ t: 'before', a, b, c });
        }
    }
    // «is» слишком щедрые — их меньше; порядковые и «либо» интереснее
    const weight = (cl: Clue) => (cl.t === 'is' ? 0.5 : cl.t === 'before' ? 2.5 : cl.t === 'either' ? 1.5 : 1);
    const order = pool.map((cl) => ({ cl, r: rng.next() / weight(cl) })).sort((a, b) => a.r - b.r).map((x) => x.cl);
    const clues: Clue[] = [];
    for (const cl of order) {
      clues.push(cl);
      if (clues.length >= 3 && count(n, k, clues, 2) === 1) break;
      if (clues.length > 40) break;
    }
    if (count(n, k, clues, 2) !== 1) continue;
    // выкидываем лишние
    for (let i = clues.length - 1; i >= 0; i--) {
      const rest = clues.filter((_, j) => j !== i);
      if (count(n, k, rest, 2) === 1) clues.splice(i, 1);
    }
    const mixed = shuffle(clues, rng);
    const data: ZebraData = { names, cats, clues: mixed.map((cl) => clueText(cl, names, cats)), raw: mixed, intro: theme.intro };
    return { data, sol: sol.map((r) => r.slice()) };
  }
  throw new Error('кто где: не сложилось');
}

/** Ответ: ans[c][i] — значение признака c у ребёнка i. */
export function checkZebra(sol: number[][], ans: number[][]): boolean {
  return Array.isArray(ans) && sol.every((row, c) => Array.isArray(ans[c]) && row.every((v, i) => ans[c][i] === v));
}

export function solveZebra(d: ZebraData): number[][] {
  const out: number[][] = [];
  count(d.names.length, d.cats.length, d.raw, 1, out);
  return out;
}
