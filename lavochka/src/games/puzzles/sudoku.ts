/* Судоку — генератор и решатель без DOM. Поле 9×9 строкой из 81 цифры ('0' — пусто).
 * Сложность — по приёмам, которые нужны для решения «по-человечески»:
 * 1 — одиночки (последний кандидат, единственное место); 2 — + блокировка в квадрате/ряду, открытые и скрытые пары;
 * 3 — + тройки и «крестокрыл» (X-wing); 4 — логикой не решается, нужен перебор (такие игроку не даём). */
import type { Rng } from '../../core/types';

const ALL = 0x1ff;
const bit = (d: number) => 1 << (d - 1);
const bitCount = (m: number) => {
  let c = 0;
  while (m) {
    m &= m - 1;
    c++;
  }
  return c;
};
const firstDigit = (m: number) => 31 - Math.clz32(m & -m) + 1;
const digitsOf = (m: number) => {
  const r: number[] = [];
  for (let d = 1; d <= 9; d++) if (m & bit(d)) r.push(d);
  return r;
};

/** 27 групп: 9 строк, 9 столбцов, 9 квадратов. */
export const UNITS: number[][] = (() => {
  const u: number[][] = [];
  for (let r = 0; r < 9; r++) u.push(Array.from({ length: 9 }, (_, c) => r * 9 + c));
  for (let c = 0; c < 9; c++) u.push(Array.from({ length: 9 }, (_, r) => r * 9 + c));
  for (let b = 0; b < 9; b++) {
    const r0 = Math.floor(b / 3) * 3;
    const c0 = (b % 3) * 3;
    u.push(Array.from({ length: 9 }, (_, k) => (r0 + Math.floor(k / 3)) * 9 + c0 + (k % 3)));
  }
  return u;
})();
const UNITS_OF: number[][] = Array.from({ length: 81 }, (_, i) => UNITS.map((u, k) => (u.includes(i) ? k : -1)).filter((k) => k >= 0));
export const PEERS: number[][] = Array.from({ length: 81 }, (_, i) => {
  const s = new Set<number>();
  for (const k of UNITS_OF[i]) for (const j of UNITS[k]) if (j !== i) s.add(j);
  return [...s];
});
const boxOf = (i: number) => Math.floor(Math.floor(i / 9) / 3) * 3 + Math.floor((i % 9) / 3);

// ---------------------------------------------------------------- перебор

/** Число решений (не больше limit) и первое найденное решение. */
export function countSolutions(grid: number[], limit = 2): { count: number; solution: number[] | null } {
  const g = grid.slice();
  let count = 0;
  let solution: number[] | null = null;
  const rows = new Array(9).fill(0);
  const cols = new Array(9).fill(0);
  const boxes = new Array(9).fill(0);
  for (let i = 0; i < 81; i++) {
    const d = g[i];
    if (!d) continue;
    const b = bit(d);
    const r = Math.floor(i / 9);
    const c = i % 9;
    if ((rows[r] | cols[c] | boxes[boxOf(i)]) & b) return { count: 0, solution: null };
    rows[r] |= b;
    cols[c] |= b;
    boxes[boxOf(i)] |= b;
  }
  const rec = (): boolean => {
    // клетка с наименьшим числом вариантов
    let best = -1;
    let bestMask = 0;
    let bestN = 10;
    for (let i = 0; i < 81; i++) {
      if (g[i]) continue;
      const m = ALL & ~(rows[Math.floor(i / 9)] | cols[i % 9] | boxes[boxOf(i)]);
      const n = bitCount(m);
      if (n < bestN) {
        best = i;
        bestMask = m;
        bestN = n;
        if (n <= 1) break;
      }
    }
    if (best < 0) {
      count++;
      if (!solution) solution = g.slice();
      return count >= limit;
    }
    if (!bestN) return false;
    const r = Math.floor(best / 9);
    const c = best % 9;
    const bx = boxOf(best);
    for (const d of digitsOf(bestMask)) {
      const b = bit(d);
      g[best] = d;
      rows[r] |= b;
      cols[c] |= b;
      boxes[bx] |= b;
      if (rec()) return true;
      rows[r] &= ~b;
      cols[c] &= ~b;
      boxes[bx] &= ~b;
    }
    g[best] = 0;
    return false;
  };
  rec();
  return { count, solution };
}

/** Случайное полностью заполненное поле. */
function randomFull(rng: Rng): number[] {
  const g = new Array(81).fill(0);
  const rows = new Array(9).fill(0);
  const cols = new Array(9).fill(0);
  const boxes = new Array(9).fill(0);
  const rec = (i: number): boolean => {
    if (i === 81) return true;
    const r = Math.floor(i / 9);
    const c = i % 9;
    const bx = boxOf(i);
    const ds = digitsOf(ALL & ~(rows[r] | cols[c] | boxes[bx]));
    for (let k = ds.length - 1; k > 0; k--) {
      const j = rng.int(k + 1);
      [ds[k], ds[j]] = [ds[j], ds[k]];
    }
    for (const d of ds) {
      const b = bit(d);
      g[i] = d;
      rows[r] |= b;
      cols[c] |= b;
      boxes[bx] |= b;
      if (rec(i + 1)) return true;
      rows[r] &= ~b;
      cols[c] &= ~b;
      boxes[bx] &= ~b;
    }
    g[i] = 0;
    return false;
  };
  rec(0);
  return g;
}

// ---------------------------------------------------------------- логика

/** Кандидаты по заполненным клеткам. null — противоречие. */
function candidates(grid: number[]): number[] | null {
  const cand = new Array(81).fill(ALL);
  for (let i = 0; i < 81; i++) {
    const d = grid[i];
    if (!d) continue;
    if (!(cand[i] & bit(d))) return null;
    cand[i] = bit(d);
    for (const p of PEERS[i]) cand[p] &= ~bit(d);
  }
  return cand;
}

export interface Step {
  /** Клетка и цифра, если шаг ставит цифру. */
  cell?: number;
  digit?: number;
  level: number;
  name: string;
}

class Logic {
  g: number[];
  cand: number[];
  constructor(grid: number[]) {
    this.g = grid.slice();
    this.cand = candidates(grid) ?? new Array(81).fill(0);
  }
  place(i: number, d: number) {
    this.g[i] = d;
    this.cand[i] = bit(d);
    for (const p of PEERS[i]) this.cand[p] &= ~bit(d);
  }
  /** Убрать кандидатов; true — что-то изменилось. */
  strip(i: number, mask: number): boolean {
    if (this.g[i] || !(this.cand[i] & mask)) return false;
    this.cand[i] &= ~mask;
    return true;
  }
  broken() {
    for (let i = 0; i < 81; i++) if (!this.g[i] && !this.cand[i]) return true;
    return false;
  }
  solved() {
    return this.g.every((d) => d);
  }

  nakedSingle(): Step | null {
    for (let i = 0; i < 81; i++) if (!this.g[i] && bitCount(this.cand[i]) === 1) return { cell: i, digit: firstDigit(this.cand[i]), level: 1, name: 'последний кандидат' };
    return null;
  }
  hiddenSingle(): Step | null {
    for (const u of UNITS)
      for (let d = 1; d <= 9; d++) {
        let at = -1;
        let n = 0;
        for (const i of u) {
          if (this.g[i] === d) {
            n = 2;
            break;
          }
          if (!this.g[i] && this.cand[i] & bit(d)) {
            at = i;
            n++;
          }
        }
        if (n === 1) return { cell: at, digit: d, level: 1, name: 'единственное место' };
      }
    return null;
  }
  /** Блокировка: цифра в квадрате только в одной строке/столбце — и наоборот. */
  locked(): boolean {
    for (let b = 18; b < 27; b++)
      for (let d = 1; d <= 9; d++) {
        const cells = UNITS[b].filter((i) => !this.g[i] && this.cand[i] & bit(d));
        if (cells.length < 2) continue;
        for (const line of [0, 9]) {
          const k = line === 0 ? Math.floor(cells[0] / 9) : cells[0] % 9;
          if (!cells.every((i) => (line === 0 ? Math.floor(i / 9) : i % 9) === k)) continue;
          let ch = false;
          for (const i of UNITS[line + k]) if (!UNITS[b].includes(i)) ch = this.strip(i, bit(d)) || ch;
          if (ch) return true;
        }
      }
    for (let u = 0; u < 18; u++)
      for (let d = 1; d <= 9; d++) {
        const cells = UNITS[u].filter((i) => !this.g[i] && this.cand[i] & bit(d));
        if (cells.length < 2) continue;
        const bx = boxOf(cells[0]);
        if (!cells.every((i) => boxOf(i) === bx)) continue;
        let ch = false;
        for (const i of UNITS[18 + bx]) if (!UNITS[u].includes(i)) ch = this.strip(i, bit(d)) || ch;
        if (ch) return true;
      }
    return false;
  }
  /** Открытые подмножества: k клеток группы с k кандидатами на всех. */
  nakedSubset(k: number): boolean {
    for (const u of UNITS) {
      const free = u.filter((i) => !this.g[i] && bitCount(this.cand[i]) <= k);
      for (const combo of combos(free, k)) {
        const m = combo.reduce((a, i) => a | this.cand[i], 0);
        if (bitCount(m) !== k) continue;
        let ch = false;
        for (const i of u) if (!combo.includes(i)) ch = this.strip(i, m) || ch;
        if (ch) return true;
      }
    }
    return false;
  }
  /** Скрытые подмножества: k цифр группы стоят только в k клетках. */
  hiddenSubset(k: number): boolean {
    for (const u of UNITS) {
      const ds: number[] = [];
      for (let d = 1; d <= 9; d++) {
        const n = u.filter((i) => !this.g[i] && this.cand[i] & bit(d)).length;
        if (n >= 2 && n <= k && !u.some((i) => this.g[i] === d)) ds.push(d);
      }
      for (const combo of combos(ds, k)) {
        const m = combo.reduce((a, d) => a | bit(d), 0);
        const cells = u.filter((i) => !this.g[i] && this.cand[i] & m);
        if (cells.length !== k) continue;
        let ch = false;
        for (const i of cells) ch = this.strip(i, ALL & ~m) || ch;
        if (ch) return true;
      }
    }
    return false;
  }
  /** Крестокрыл: цифра в двух строках стоит только в одних и тех же двух столбцах (и наоборот). */
  xwing(): boolean {
    for (const rowsFirst of [true, false])
      for (let d = 1; d <= 9; d++) {
        const lines: { k: number; pos: number[] }[] = [];
        for (let k = 0; k < 9; k++) {
          const u = UNITS[rowsFirst ? k : 9 + k];
          const pos = u.filter((i) => !this.g[i] && this.cand[i] & bit(d)).map((i) => (rowsFirst ? i % 9 : Math.floor(i / 9)));
          if (pos.length === 2) lines.push({ k, pos });
        }
        for (let a = 0; a < lines.length; a++)
          for (let b = a + 1; b < lines.length; b++) {
            const A = lines[a];
            const B = lines[b];
            if (A.pos[0] !== B.pos[0] || A.pos[1] !== B.pos[1]) continue;
            let ch = false;
            for (const p of A.pos)
              for (const i of UNITS[rowsFirst ? 9 + p : p]) {
                const line = rowsFirst ? Math.floor(i / 9) : i % 9;
                if (line !== A.k && line !== B.k) ch = this.strip(i, bit(d)) || ch;
              }
            if (ch) return true;
          }
      }
    return false;
  }

  /** Следующий шаг, ставящий цифру, приёмами не выше maxLevel (исключения кандидатов делаются по дороге). */
  next(maxLevel: number): Step | null {
    let used = 1;
    for (;;) {
      if (this.broken()) return null;
      const s = this.nakedSingle() ?? this.hiddenSingle();
      if (s) return { ...s, level: Math.max(s.level, used) };
      if (maxLevel >= 2 && (this.locked() || this.nakedSubset(2) || this.hiddenSubset(2))) {
        used = Math.max(used, 2);
        continue;
      }
      if (maxLevel >= 3 && (this.nakedSubset(3) || this.hiddenSubset(3) || this.xwing())) {
        used = Math.max(used, 3);
        continue;
      }
      return null;
    }
  }
}

function combos<T>(arr: T[], k: number): T[][] {
  const out: T[][] = [];
  const rec = (start: number, acc: T[]) => {
    if (acc.length === k) {
      out.push(acc.slice());
      return;
    }
    for (let i = start; i < arr.length; i++) {
      acc.push(arr[i]);
      rec(i + 1, acc);
      acc.pop();
    }
  };
  if (arr.length >= k) rec(0, []);
  return out;
}

/** Самый сложный приём, без которого не решить; 4 — логикой (до крестокрыла) не решается. */
export function grade(grid: number[]): number {
  const L = new Logic(grid);
  let hardest = 1;
  while (!L.solved()) {
    const s = L.next(3);
    if (!s || s.cell == null) return 4;
    hardest = Math.max(hardest, s.level);
    L.place(s.cell, s.digit!);
  }
  return hardest;
}

/** Подсказка-ход: какую цифру поставить следующей по логике (для бота и кнопки «подсказка»). */
export function nextLogicalStep(grid: number[], maxLevel = 3): Step | null {
  const L = new Logic(grid);
  if (L.solved()) return null;
  return L.next(maxLevel);
}

// ---------------------------------------------------------------- генератор

export interface Sudoku {
  /** Условие: 81 цифра, 0 — пусто. */
  puzzle: number[];
  solution: number[];
  level: number;
}

/** Сколько открытых цифр оставлять не меньше: чем меньше, тем дольше ищутся «одиночки». */
const MIN_GIVENS = [0, 36, 32, 26, 20];
/** Уровень игры → какие приёмы допустимы при выкапывании (решение пользователя: перебора в судоку нет):
 * 1 «Лёгкий», 2 «Средний», 3 «Сложный» — только одиночки, открытых цифр всё меньше;
 * 4 «Эксперт» — пары, блокировки, тройки, крестокрыл (логикой решается всегда). */
const DIG = [0, 1, 1, 1, 3];
const fits = (level: number, got: number) => (level <= 3 ? got === 1 : got === 2 || got === 3);

/**
 * Судоку уровня level (1–4). Убираем клетки парами симметрично центру, пока головоломка решается
 * приёмами не сложнее уровня. Если вышло проще — пробуем снова.
 * Для «Эксперта» сначала копаем до единственности, а если вышел перебор — возвращаем пары, пока не решится логикой:
 * так тройки и крестокрыл попадаются часто, а не раз в десять попыток.
 */
export function generate(rng: Rng, level: number): Sudoku {
  let best: Sudoku | null = null;
  for (let attempt = 0; attempt < 80; attempt++) {
    const solution = randomFull(rng);
    const g = solution.slice();
    const order = Array.from({ length: 41 }, (_, i) => i);
    for (let k = order.length - 1; k > 0; k--) {
      const j = rng.int(k + 1);
      [order[k], order[j]] = [order[j], order[k]];
    }
    const pairOf = (i: number) => (i === 40 ? [40] : [i, 80 - i]);
    let givens = 81;
    for (const i of order) {
      const pair = pairOf(i);
      if (givens - pair.length < MIN_GIVENS[level]) continue;
      const keep = pair.map((p) => g[p]);
      pair.forEach((p) => (g[p] = 0));
      const ok = DIG[level] <= 2 ? grade(g) <= DIG[level] : countSolutions(g, 2).count === 1;
      if (ok) givens -= pair.length;
      else pair.forEach((p, n) => (g[p] = keep[n]));
    }
    if (level === 4)
      for (const i of order) {
        if (grade(g) <= 3) break;
        const pair = pairOf(i);
        if (g[pair[0]]) continue;
        pair.forEach((p) => (g[p] = solution[p]));
      }
    const got = grade(g);
    const res = { puzzle: g, solution, level };
    if (fits(level, got)) return res;
    // запасной вариант — только решаемый логикой
    if (got <= 3) best ??= res;
  }
  return best!;
}
