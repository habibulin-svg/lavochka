/* «Головоломки» — общий движок без DOM: одна головоломка, которую решают все за столом вместе (или один).
 * Головоломка целиком задаётся видом, размером, уровнем и сидом — поэтому сохранить и продолжить её может любой участник:
 * хватает настроек и строки введённого (`fill`). Ходят все одновременно; боты — помощники, изредка вписывают верную клетку. */
import { SeededRng } from '../../core/rng';
import type { Options, Rng } from '../../core/types';
import * as sudoku from './sudoku';
import * as picross from './picross';

export type Kind = 'sudoku' | 'picross';

export const KIND_LABEL: Record<Kind, string> = { sudoku: 'Судоку', picross: 'Пикросс' };
export const SUDOKU_LEVELS = ['Лёгкий', 'Средний', 'Сложный', 'Эксперт'];
export const PICROSS_LEVELS = ['Лёгкий', 'Средний', 'Сложный'];
export const PICROSS_SIZES = ['5x5', '10x10', '15x15', '20x20', '25x25'];

export interface PicrossData {
  rows: number[][];
  cols: number[][];
}

export interface State {
  kind: Kind;
  /** Уровень 1… и размер «10x10»; сид — номер головоломки. */
  level: number;
  size: string;
  seed: number;
  seats: number[];
  w: number;
  h: number;
  /** Решение по клеткам ('1'–'9' в судоку, '#'/'.' в пикроссе). В view — пусто, пока не решено. */
  sol: string[];
  /** Клетки условия (их не меняют). */
  fixed: boolean[];
  /** Введённое: судоку — цифра или ''; пикросс — '#', 'x' или ''. */
  cells: string[];
  /** Кто вписал клетку (-1 — никто или условие). */
  who: number[];
  /** Пометки карандашом в судоку: биты цифр. */
  notes: number[];
  data: PicrossData | null;
  /** Курсор каждого места (-1 — нет). */
  cur: number[];
  /** Ошибки, найденные последней проверкой (пропадают, когда клетку исправят). */
  wrong: number[];
  hints: number;
  checks: number;
  moves: number;
  /** Верных клеток на счету каждого места. */
  credit: number[];
  done: boolean;
}

export type Action =
  | { type: 'set'; is: number[]; v: string }
  | { type: 'note'; i: number; d: number }
  | { type: 'cur'; i: number }
  | { type: 'hint'; i?: number }
  | { type: 'check' }
  | { type: 'think' };

export type Event =
  | { type: 'set'; seat: number; is: number[]; v: string }
  | { type: 'hint'; seat: number; i: number }
  | { type: 'check'; seat: number; wrong: number }
  | { type: 'solved'; hints: number; moves: number };

export const sizeOf = (size: string) => {
  const [w, h] = size.split('x').map(Number);
  return { w: w || 10, h: h || w || 10 };
};

/** Игровые настройки → параметры головоломки (без сида). */
export function paramsOf(o: Options): { kind: Kind; level: number; size: string } {
  const kind: Kind = o.kind === 'picross' ? 'picross' : 'sudoku';
  if (kind === 'sudoku') return { kind, level: clamp(Number(o.sLevel) || 2, 1, 4), size: '9x9' };
  const size = PICROSS_SIZES.includes(String(o.pSize)) ? String(o.pSize) : '10x10';
  return { kind, level: clamp(Number(o.pLevel) || 2, 1, 3), size };
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function newState(kind: Kind, level: number, size: string, seed: number, seats: number[], fill?: string): State {
  const rng = new SeededRng(seed);
  let w = 9;
  let h = 9;
  let sol: string[];
  let fixed: boolean[];
  let cells: string[];
  let data: PicrossData | null = null;
  if (kind === 'sudoku') {
    const p = sudoku.generate(rng, level);
    sol = p.solution.map(String);
    fixed = p.puzzle.map((d) => d > 0);
    cells = p.puzzle.map((d) => (d ? String(d) : ''));
  } else {
    ({ w, h } = sizeOf(size));
    const p = picross.generate(rng, w, h, level);
    sol = p.solution.map((v) => (v ? '#' : '.'));
    fixed = sol.map((_, i) => p.given.includes(i));
    cells = sol.map((v, i) => (fixed[i] ? (v === '#' ? '#' : 'x') : ''));
    data = { rows: p.rows, cols: p.cols };
  }
  const n = w * h;
  const s: State = {
    kind,
    level,
    size,
    seed,
    seats,
    w,
    h,
    sol,
    fixed,
    cells,
    who: new Array(n).fill(-1),
    notes: new Array(n).fill(0),
    data,
    cur: new Array(6).fill(-1),
    wrong: [],
    hints: 0,
    checks: 0,
    moves: 0,
    credit: new Array(6).fill(0),
    done: false,
  };
  if (fill) restoreFill(s, fill);
  s.done = solved(s);
  return s;
}

/** Строка введённого для сохранения: по символу на клетку ('.' — пусто). */
export function fillOf(s: State): string {
  return s.cells.map((c) => c || '.').join('');
}

function restoreFill(s: State, fill: string) {
  if (fill.length !== s.cells.length) return;
  for (let i = 0; i < fill.length; i++) {
    if (s.fixed[i]) continue;
    const c = fill[i];
    if (valid(s, c)) s.cells[i] = c;
  }
}

const valid = (s: State, v: string) => (s.kind === 'sudoku' ? /^[1-9]$/.test(v) : v === '#' || v === 'x');

/** Клетка вписана верно (в пикроссе крестик на пустой — тоже верно, пустая на пустой — не в счёт). */
const right = (s: State, i: number) => (s.kind === 'sudoku' ? s.cells[i] === s.sol[i] : s.sol[i] === '#' ? s.cells[i] === '#' : s.cells[i] !== '#');

export function solved(s: State): boolean {
  if (s.kind === 'sudoku') return s.cells.every((c, i) => c === s.sol[i]);
  return s.sol.every((v, i) => (v === '#') === (s.cells[i] === '#'));
}

/** Доля заполненного — для списка «Недорешённые» и строки статуса (решения у клиента нет, поэтому не «верного», а вписанного). */
export function progress(s: State): number {
  if (s.done) return 1;
  if (s.kind === 'picross') {
    const need = s.data ? s.data.rows.reduce((a, r) => a + r.reduce((x, y) => x + y, 0), 0) : 0;
    const have = s.cells.filter((c) => c === '#').length;
    return need ? Math.min(1, have / need) : 1;
  }
  let all = 0;
  let have = 0;
  s.cells.forEach((c, i) => {
    if (s.fixed[i]) return;
    all++;
    if (c) have++;
  });
  return all ? have / all : 1;
}

export function setup(seats: number[], o: Options, rng: Rng): State {
  const { kind, level, size } = paramsOf(o);
  const seed = Number(o.seed) > 0 ? Number(o.seed) : 1 + rng.int(999_999);
  return newState(kind, level, size, seed, seats, typeof o.fill === 'string' ? o.fill : undefined);
}

/** Ходят все сразу; порядок сдвигается с каждым ходом, чтобы боты-помощники ходили по очереди. */
export function toAct(s: State): number[] {
  if (s.done) return [];
  const k = s.moves % s.seats.length;
  return [...s.seats.slice(k), ...s.seats.slice(0, k)];
}

function clone(s: State): State {
  return { ...s, fixed: s.fixed.slice(), cells: s.cells.slice(), who: s.who.slice(), notes: s.notes.slice(), cur: s.cur.slice(), wrong: s.wrong.slice(), credit: s.credit.slice() };
}

function finish(s: State, ev: Event[]) {
  if (!s.done && solved(s)) {
    s.done = true;
    s.cur = s.cur.map(() => -1);
    ev.push({ type: 'solved', hints: s.hints, moves: s.moves });
  }
}

/** Цифра стала верной — вычеркнуть её из пометок соседей (как делают карандашом). */
function clearNotes(s: State, i: number) {
  const d = Number(s.cells[i]);
  if (!d) return;
  for (const p of sudoku.PEERS[i]) s.notes[p] &= ~(1 << (d - 1));
  s.notes[i] = 0;
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.done || !s0.seats.includes(seat)) return null;
  const n = s0.cells.length;
  const s = clone(s0);
  const ev: Event[] = [];
  switch (a?.type) {
    case 'think':
      s.moves++;
      return { state: s, events: [] };
    case 'cur':
      if (!Number.isInteger(a.i) || a.i < -1 || a.i >= n) return null;
      s.cur[seat] = a.i;
      return { state: s, events: [] };
    case 'set': {
      if (!Array.isArray(a.is) || !a.is.length || a.is.length > n) return null;
      if (a.v !== '' && !valid(s, a.v)) return null;
      const is = [...new Set(a.is)].filter((i) => Number.isInteger(i) && i >= 0 && i < n && !s.fixed[i]);
      if (!is.length) return null;
      for (const i of is) {
        const was = s.cells[i] !== '' && right(s, i);
        s.cells[i] = a.v;
        s.who[i] = a.v ? seat : -1;
        const now = a.v !== '' && right(s, i);
        if (now && !was) s.credit[seat]++;
        s.wrong = s.wrong.filter((w) => w !== i);
        if (s.kind === 'sudoku' && a.v) s.notes[i] = 0;
      }
      s.moves++;
      if (is.length === 1) s.cur[seat] = is[0];
      ev.push({ type: 'set', seat, is, v: a.v });
      finish(s, ev);
      return { state: s, events: ev };
    }
    case 'note': {
      if (s.kind !== 'sudoku' || !Number.isInteger(a.i) || a.i < 0 || a.i >= n || s.fixed[a.i] || s.cells[a.i]) return null;
      if (!Number.isInteger(a.d) || a.d < 1 || a.d > 9) return null;
      s.notes[a.i] ^= 1 << (a.d - 1);
      s.cur[seat] = a.i;
      return { state: s, events: [] };
    }
    case 'hint': {
      // своя клетка под курсором, если она не решена; иначе — следующая по логике (судоку) или любая нерешённая
      let i = Number.isInteger(a.i) && a.i! >= 0 && a.i! < n && !s.fixed[a.i!] && !right(s, a.i!) ? a.i! : -1;
      if (i < 0 || (s.kind === 'sudoku' && s.cells[i] === s.sol[i])) i = hintCell(s, rng);
      if (i < 0) return null;
      s.cells[i] = s.kind === 'sudoku' ? s.sol[i] : s.sol[i] === '#' ? '#' : 'x';
      s.who[i] = -1;
      s.fixed[i] = true;
      if (s.kind === 'sudoku') clearNotes(s, i);
      s.wrong = s.wrong.filter((w) => w !== i);
      s.hints++;
      s.moves++;
      ev.push({ type: 'hint', seat, i });
      finish(s, ev);
      return { state: s, events: ev };
    }
    case 'check': {
      s.wrong = [];
      for (let i = 0; i < n; i++) if (!s.fixed[i] && s.cells[i] && !right(s, i)) s.wrong.push(i);
      s.checks++;
      s.moves++;
      ev.push({ type: 'check', seat, wrong: s.wrong.length });
      return { state: s, events: ev };
    }
  }
  return null;
}

/** Клетка для подсказки: в судоку — та, что решается следующей по логике; в пикроссе — неверная или незакрашенная. */
function hintCell(s: State, rng: Rng): number {
  const open: number[] = [];
  for (let i = 0; i < s.cells.length; i++) if (!s.fixed[i] && !right(s, i) && (s.kind === 'sudoku' || s.sol[i] === '#' || s.cells[i] === '#')) open.push(i);
  if (!open.length) return -1;
  if (s.kind === 'sudoku') {
    const wrong = open.find((i) => s.cells[i]);
    if (wrong != null) return wrong;
    const grid = s.cells.map((c, i) => (c && c === s.sol[i] ? Number(c) : 0));
    const st = sudoku.nextLogicalStep(grid, 3);
    if (st?.cell != null) return st.cell;
  }
  return open[rng.int(open.length)];
}

/** Что видят игроки: всё, кроме решения (оно открывается, когда головоломка решена). */
export function view(s: State): State {
  return s.done ? s : { ...s, sol: [] };
}
