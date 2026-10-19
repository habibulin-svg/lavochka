/* «2048» — движок без DOM. Плитки сдвигаются все разом в одну сторону, две одинаковые при встрече складываются;
 * после каждого хода появляется новая двойка (изредка четвёрка). Камни — неподвижные клетки, через них не проехать.
 * Одному — до цели (или без конца), с отменой хода по желанию; вдвоём и больше — «наперегонки», у каждого своя доска. */
import type { Options, Rng } from '../../core/types';

export interface Cfg {
  n: number;
  /** Цель: плитка, после которой партия выиграна; 0 — без конца. */
  target: number;
  stones: number;
  undo: boolean;
}

export interface Board {
  /** 0 — пусто, -1 — камень, иначе — число на плитке. */
  cells: number[];
  /** Номер плитки в клетке (для анимации сдвигов); 0 — нет плитки. */
  ids: number[];
  score: number;
  top: number;
  moves: number;
  over: boolean;
  won: boolean;
  undo: { cells: number[]; ids: number[]; score: number; top: number } | null;
}

export interface State {
  cfg: Cfg;
  seats: number[];
  boards: Board[];
  nextId: number;
  moves: number;
  done: boolean;
}

/** 0 — вверх, 1 — вправо, 2 — вниз, 3 — влево. */
export type Dir = 0 | 1 | 2 | 3;
export const DIR_NAME = ['вверх', 'вправо', 'вниз', 'влево'];

export type Action = { type: 'move'; dir: Dir } | { type: 'undo' } | { type: 'think' };

export type Event =
  | { type: 'move'; seat: number; b: number; dir: Dir; slides: { id: number; to: number }[]; merges: number[]; spawn: number; gain: number }
  | { type: 'undo'; seat: number; b: number }
  | { type: 'target'; seat: number; b: number; v: number }
  | { type: 'stuck'; seat: number; b: number; score: number; top: number }
  | { type: 'end' };

export function cfgOf(o: Options): Cfg {
  const n = [3, 4, 5, 6].includes(Number(o.n)) ? Number(o.n) : 4;
  const t = Number(o.target);
  const target = t === 0 ? 0 : [512, 1024, 2048, 4096, 8192].includes(t) ? t : 2048;
  const stones = Math.max(0, Math.min(n - 2, Math.round(Number(o.stones) || 0)));
  return { n, target, stones, undo: !!o.undo };
}

/** Клетки линий в порядке «к краю, куда едут плитки». */
const LINES = new Map<string, number[][]>();
export function lines(n: number, dir: Dir): number[][] {
  const key = `${n}:${dir}`;
  const hit = LINES.get(key);
  if (hit) return hit;
  const out: number[][] = [];
  for (let k = 0; k < n; k++) {
    const l: number[] = [];
    for (let j = 0; j < n; j++) {
      if (dir === 0) l.push(j * n + k);
      else if (dir === 2) l.push((n - 1 - j) * n + k);
      else if (dir === 3) l.push(k * n + j);
      else l.push(k * n + (n - 1 - j));
    }
    out.push(l);
  }
  LINES.set(key, out);
  return out;
}

export interface Slide {
  cells: number[];
  ids: number[];
  moved: boolean;
  gain: number;
  slides: { id: number; to: number }[];
  /** Клетки, где сложились плитки (новым плиткам там нужен номер). */
  merges: number[];
}

/** Сдвиг доски. ids можно не давать (боты считают только числа). */
export function slide(cells: number[], n: number, dir: Dir, ids?: number[]): Slide {
  const out: number[] = cells.map((v) => (v === -1 ? -1 : 0));
  const oid = new Array(cells.length).fill(0);
  const slides: { id: number; to: number }[] = [];
  const merges: number[] = [];
  let gain = 0;
  let moved = false;
  for (const line of lines(n, dir)) {
    let seg = 0;
    while (seg < line.length) {
      // отрезок между камнями
      let end = seg;
      while (end < line.length && cells[line[end]] !== -1) end++;
      let put = seg;
      let lastMerge = false;
      for (let j = seg; j < end; j++) {
        const i = line[j];
        const v = cells[i];
        if (!v) continue;
        const prev = put > seg ? line[put - 1] : -1;
        if (prev >= 0 && out[prev] === v && !lastMerge) {
          out[prev] = v * 2;
          gain += v * 2;
          merges.push(prev);
          oid[prev] = 0;
          lastMerge = true;
          moved = true;
          if (ids) slides.push({ id: ids[i], to: prev });
          continue;
        }
        const to = line[put++];
        out[to] = v;
        if (ids) {
          oid[to] = ids[i];
          slides.push({ id: ids[i], to });
        }
        if (to !== i) moved = true;
        lastMerge = false;
      }
      seg = end + 1;
    }
  }
  return { cells: out, ids: oid, moved, gain, slides, merges };
}

export function canMove(cells: number[], n: number): boolean {
  for (let i = 0; i < cells.length; i++) {
    const v = cells[i];
    if (v === 0) return true;
    if (v === -1) continue;
    const x = i % n;
    if (x < n - 1 && cells[i + 1] === v) return true;
    if (i + n < cells.length && cells[i + n] === v) return true;
  }
  return false;
}

function spawn(b: Board, s: State, rng: Rng): number {
  const empty: number[] = [];
  b.cells.forEach((v, i) => v === 0 && empty.push(i));
  if (!empty.length) return -1;
  const i = empty[rng.int(empty.length)];
  b.cells[i] = rng.next() < 0.1 ? 4 : 2;
  b.ids[i] = s.nextId++;
  b.top = Math.max(b.top, b.cells[i]);
  return i;
}

export function setup(seats: number[], o: Options, rng: Rng): State {
  const cfg = cfgOf(o);
  const s: State = { cfg, seats, boards: [], nextId: 1, moves: 0, done: false };
  const N = cfg.n * cfg.n;
  // у всех одинаковое начало: камни и первые две плитки
  const base: Board = { cells: new Array(N).fill(0), ids: new Array(N).fill(0), score: 0, top: 0, moves: 0, over: false, won: false, undo: null };
  for (let k = 0; k < cfg.stones; k++) {
    // камни — не в углах, чтобы доска оставалась играбельной
    const free = base.cells.map((v, i) => i).filter((i) => base.cells[i] === 0 && ![0, cfg.n - 1, N - cfg.n, N - 1].includes(i));
    base.cells[free[rng.int(free.length)]] = -1;
  }
  spawn(base, s, rng);
  spawn(base, s, rng);
  for (const _ of seats) s.boards.push({ ...base, cells: base.cells.slice(), ids: base.ids.slice() });
  // номера плиток у каждой доски свои — анимация не путается
  s.boards.forEach((b, k) => (b.ids = b.ids.map((id) => (id ? id + k * 1e6 : 0))));
  s.nextId = 3;
  return s;
}

export const boardOf = (s: State, seat: number) => s.seats.indexOf(seat);
export const race = (s: State) => s.seats.length > 1;

export function toAct(s: State): number[] {
  if (s.done) return [];
  const live = s.seats.filter((x) => !s.boards[boardOf(s, x)].over);
  const k = s.moves % Math.max(1, live.length);
  return [...live.slice(k), ...live.slice(0, k)];
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.done || !toAct(s0).includes(seat)) return null;
  if (a?.type === 'think') return { state: { ...s0, moves: s0.moves + 1 }, events: [] };
  const bi = boardOf(s0, seat);
  const b0 = s0.boards[bi];
  const s: State = { ...s0, boards: s0.boards.slice(), moves: s0.moves + 1 };
  const ev: Event[] = [];
  const n = s.cfg.n;
  if (a?.type === 'undo') {
    if (!s.cfg.undo || race(s0) || !b0.undo) return null;
    s.boards[bi] = { ...b0, ...b0.undo, cells: b0.undo.cells.slice(), ids: b0.undo.ids.slice(), over: false, undo: null, moves: b0.moves + 1 };
    return { state: s, events: [{ type: 'undo', seat, b: bi }] };
  }
  if (a?.type !== 'move' || ![0, 1, 2, 3].includes(a.dir) || b0.over) return null;
  const r = slide(b0.cells, n, a.dir, b0.ids);
  if (!r.moved) return null;
  const b: Board = { ...b0, cells: r.cells, ids: r.ids, score: b0.score + r.gain, moves: b0.moves + 1, undo: s.cfg.undo && !race(s0) ? { cells: b0.cells, ids: b0.ids, score: b0.score, top: b0.top } : null };
  // номера плиток уникальны в пределах доски: доска k берёт номера k·10⁶ + …
  for (const i of r.merges) {
    b.ids[i] = bi * 1e6 + s.nextId++;
    b.top = Math.max(b.top, b.cells[i]);
  }
  const before = b0.top;
  const sp = spawn(b, s, rng);
  if (sp >= 0) b.ids[sp] = bi * 1e6 + (b.ids[sp] % 1e6);
  s.boards[bi] = b;
  ev.push({ type: 'move', seat, b: bi, dir: a.dir, slides: r.slides, merges: r.merges, spawn: sp, gain: r.gain });
  const t = s.cfg.target;
  if (t && b.top >= t && before < t) {
    b.won = true;
    ev.push({ type: 'target', seat, b: bi, v: t });
  }
  if (!canMove(b.cells, n)) {
    b.over = true;
    ev.push({ type: 'stuck', seat, b: bi, score: b.score, top: b.top });
  }
  if (b.won && t) {
    b.over = true;
    s.done = true;
  } else if (s.boards.every((x) => x.over)) s.done = true;
  if (s.done) ev.push({ type: 'end' });
  return { state: s, events: ev };
}

export function view(s: State): State {
  return s;
}

export function result(s: State): { winners: number[]; text: string; scores: Record<number, number> } | null {
  if (!s.done) return null;
  const scores: Record<number, number> = {};
  s.seats.forEach((x, k) => (scores[x] = s.boards[k].score));
  const wonAt = s.boards.findIndex((b) => b.won);
  if (!race(s)) {
    const b = s.boards[0];
    if (b.won) return { winners: s.seats.slice(), text: `Собрано ${s.cfg.target}! Счёт ${b.score}`, scores };
    return { winners: s.cfg.target ? [] : s.seats.slice(), text: `Ходов больше нет. Счёт ${b.score}, лучшая плитка ${b.top}`, scores };
  }
  if (wonAt >= 0) return { winners: [s.seats[wonAt]], text: `Первым собрал ${s.cfg.target}`, scores };
  const best = Math.max(...s.boards.map((b) => b.score));
  return { winners: s.seats.filter((x, k) => s.boards[k].score === best), text: `Ходов ни у кого нет — больше всех очков: ${best}`, scores };
}
