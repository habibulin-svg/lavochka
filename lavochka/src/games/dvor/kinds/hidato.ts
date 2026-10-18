/* Классики (хидато): поле с дырками, числа 1…N идут цепочкой через соседние клетки (и по диагонали).
 * Часть чисел дана — вписать остальные. Генератор: случайный путь (Варнсдорф с откатом), потом снимаем числа,
 * пока решение единственное. Без DOM. */
import type { Rng } from '../../../core/types';
import { shuffle } from '../../../core/rng';

export interface HidatoData {
  w: number;
  h: number;
  /** -1 — дырка (нет клетки), 0 — пусто, >0 — данное число. */
  cells: number[];
}

const DIRS = [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => [dx, dy])).filter(([dx, dy]) => dx || dy);

function neigh(w: number, h: number, i: number): number[] {
  const x = i % w;
  const y = (i / w) | 0;
  const r: number[] = [];
  for (const [dx, dy] of DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < w && ny < h) r.push(ny * w + nx);
  }
  return r;
}

/** Случайный гамильтонов путь по клеткам open (Варнсдорф: сначала соседи с меньшим числом выходов). */
function randomPath(w: number, h: number, open: boolean[], rng: Rng): number[] | null {
  const n = open.filter(Boolean).length;
  const nb = open.map((_, i) => neigh(w, h, i).filter((j) => open[j]));
  const starts = shuffle(open.map((o, i) => (o ? i : -1)).filter((i) => i >= 0), rng);
  for (const st of starts.slice(0, 6)) {
    const used = open.map(() => false);
    const path = [st];
    used[st] = true;
    let budget = 20000;
    const go = (): boolean => {
      if (path.length === n) return true;
      if (--budget < 0) return false;
      const cur = path[path.length - 1];
      const cand = shuffle(nb[cur].filter((j) => !used[j]), rng);
      cand.sort((a, b) => nb[a].filter((k) => !used[k]).length - nb[b].filter((k) => !used[k]).length);
      for (const j of cand) {
        used[j] = true;
        path.push(j);
        if (go()) return true;
        path.pop();
        used[j] = false;
      }
      return false;
    };
    if (go()) return path;
  }
  return null;
}

/** Число решений (до limit). */
export function countHidato(d: HidatoData, limit = 2, out?: number[]): number {
  const { w, h, cells } = d;
  const n = cells.filter((c) => c >= 0).length;
  const pos = new Array<number>(n + 1).fill(-1);
  cells.forEach((c, i) => c > 0 && (pos[c] = i));
  if (pos[1] < 0 && pos[n] < 0) {
    /* ни 1, ни N не даны — пусть генератор так не делает */
  }
  const nb = cells.map((_, i) => (cells[i] < 0 ? [] : neigh(w, h, i).filter((j) => cells[j] >= 0)));
  const given = pos.map((p) => p >= 0);
  // следующее данное число после k — для отсечения по расстоянию
  const nextGiven = new Array<number>(n + 2).fill(-1);
  for (let k = n; k >= 1; k--) nextGiven[k] = given[k] ? k : nextGiven[k + 1] ?? -1;
  const dist = (a: number, b: number) => Math.max(Math.abs((a % w) - (b % w)), Math.abs(((a / w) | 0) - ((b / w) | 0)));
  const used = cells.map((c) => c > 0);
  const path = new Array<number>(n + 1).fill(-1);
  let found = 0;
  const place = (k: number, at: number): void => {
    if (found >= limit) return;
    if (k === n) {
      path[k] = at;
      if (!found && out) {
        out.length = 0;
        cells.forEach((c) => out.push(c < 0 ? -1 : 0));
        for (let v = 1; v <= n; v++) out[path[v]] = v;
      }
      found++;
      return;
    }
    path[k] = at;
    const k1 = k + 1;
    if (given[k1]) {
      if (nb[at].includes(pos[k1])) place(k1, pos[k1]);
      return;
    }
    const ng = nextGiven[k1];
    for (const j of nb[at]) {
      if (used[j]) continue;
      if (ng > 0 && dist(j, pos[ng]) > ng - k1) continue;
      used[j] = true;
      place(k1, j);
      used[j] = false;
      if (found >= limit) return;
    }
  };
  if (given[1]) place(1, pos[1]);
  else
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] !== 0) continue;
      const ng = nextGiven[2];
      if (ng > 0 && dist(i, pos[ng]) > ng - 1) continue;
      used[i] = true;
      place(1, i);
      used[i] = false;
      if (found >= limit) break;
    }
  return found;
}

export interface HidatoPuzzle {
  data: HidatoData;
  /** Полное поле: число в каждой клетке, -1 — дырка. */
  sol: number[];
}

/** Уровень 0 — 5×5, 1 — 6×6, 2 — 7×7; на трудном меньше данных чисел. */
export function genHidato(level: number, rng: Rng): HidatoPuzzle {
  const size = [5, 6, 7][level] ?? 6;
  for (let attempt = 0; attempt < 40; attempt++) {
    const w = size;
    const h = size;
    const open = new Array(w * h).fill(true);
    // несколько дырок для формы «классиков»
    const holes = rng.int(size - 2) + (level ? 2 : 1);
    for (let k = 0; k < holes; k++) open[rng.int(w * h)] = false;
    const path = randomPath(w, h, open, rng);
    if (!path) continue;
    const sol: number[] = open.map((o) => (o ? 0 : -1));
    path.forEach((c, k) => (sol[c] = k + 1));
    const n = path.length;
    const cells = sol.slice();
    // снимаем числа в случайном порядке, концы оставляем
    const keep = [0.45, 0.33, 0.25][level] ?? 0.33;
    const order = shuffle(path.slice(1, -1), rng);
    let left = n;
    for (const c of order) {
      if (left <= Math.ceil(n * keep)) break;
      const v = cells[c];
      cells[c] = 0;
      if (countHidato({ w, h, cells }, 2) !== 1) cells[c] = v;
      else left--;
    }
    return { data: { w, h, cells }, sol };
  }
  throw new Error('хидато: не сложилось');
}

/** Ответ — поле чисел (-1 для дырок). Верно, если это цепочка 1…N с данными числами на местах. */
export function checkHidato(d: HidatoData, ans: number[]): boolean {
  if (!Array.isArray(ans) || ans.length !== d.cells.length) return false;
  const n = d.cells.filter((c) => c >= 0).length;
  const pos = new Array<number>(n + 1).fill(-1);
  for (let i = 0; i < ans.length; i++) {
    if (d.cells[i] < 0) continue;
    const v = ans[i];
    if (!Number.isInteger(v) || v < 1 || v > n || pos[v] >= 0) return false;
    if (d.cells[i] > 0 && d.cells[i] !== v) return false;
    pos[v] = i;
  }
  for (let k = 1; k < n; k++) if (!neigh(d.w, d.h, pos[k]).includes(pos[k + 1])) return false;
  return true;
}

export function solveHidato(d: HidatoData): number[] {
  const out: number[] = [];
  countHidato(d, 1, out);
  return out;
}
