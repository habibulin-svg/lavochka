/* Сенет — движок. Доска 3×10, путь змейкой: 1–10 слева направо, 11–20 справа налево, 21–30 слева направо; 31 — фишка вышла.
 * Бросок — четыре палочки (светлая и тёмная сторона): очки — число светлых, ни одной светлой — 5; на 1, 4 и 5 бросают ещё.
 * Реконструкция Кендалла: фишки стоят через одну на первых клетках; попал на чужую — меняетесь местами; две чужие подряд
 * не бьются, три подряд не перепрыгнуть; на «Дом красоты» (26) обязательно встать; «Вода» (27) отправляет на 15;
 * выход — броском ровно на 31 (с 26 — пятёркой, с 28 — тройкой, с 29 — двойкой, с 30 — единицей).
 * Нет хода вперёд — нужно пойти назад; нет и его — бросок пропадает. */
import type { Options, Rng } from '../../core/types';

export const OFF = 31;
export const BEAUTY = 26;
export const WATER = 27;
export const REBIRTH = 15;
/** Дома с рисунком: стоящую на них фишку не бьют. */
export const SAFE = [15, 26, 28, 29, 30];
/** Столько ходов без конца — партия решается по счёту. */
export const LIMIT = 600;

export interface Cfg {
  pieces: number;
  /** На 26 обязательно встать (не перепрыгнуть). */
  stop: boolean;
  /** Выход только ровно на 31. */
  exact: boolean;
  /** Доска: синий фаянс или слоновая кость (только вид). */
  look: string;
}

export interface State {
  cfg: Cfg;
  seats: number[];
  cur: number;
  phase: 'roll' | 'move' | 'over';
  sticks: number[];
  value: number;
  /** Клетки 1–30: -1 пусто, иначе сторона. Индекс 0 не используется. */
  board: number[];
  off: number[];
  winner: number | null;
  last: { side: number; from: number; to: number } | null;
  moves: number;
}

export type Action = { type: 'roll' } | { type: 'move'; from: number };

export type Event =
  | { type: 'roll'; seat: number; sticks: number[]; value: number; none: boolean; again: boolean }
  | { type: 'move'; seat: number; side: number; from: number; to: number; swap: boolean; water: number; back: boolean; again: boolean }
  | { type: 'end'; winner: number };

export function cfgFrom(o: Options): Cfg {
  return { pieces: Number(o.pieces ?? 5), stop: o.stop !== false, exact: o.exact !== false, look: String(o.look ?? 'faience') };
}

export function newState(cfg: Cfg, seats = [0, 1]): State {
  const board = Array(31).fill(-1);
  for (let i = 0; i < cfg.pieces * 2; i++) board[i + 1] = i % 2;
  return { cfg, seats, cur: 0, phase: 'roll', sticks: [], value: 0, board, off: [0, 0], winner: null, last: null, moves: 0 };
}

export function setup(seats: number[], o: Options): State {
  return newState(cfgFrom(o), seats.length === 2 ? seats : [0, 1]);
}

/** Клетка → столбец и ряд (змейкой). */
export function cell(p: number): [number, number] {
  const r = Math.floor((p - 1) / 10);
  const c = (p - 1) % 10;
  return [r === 1 ? 9 - c : c, r];
}

export function toAct(s: State): number[] {
  return s.phase === 'over' ? [] : [s.seats[s.cur]];
}

export const again = (v: number) => v === 1 || v === 4 || v === 5;

/** Чужая фишка на клетке p защищена: дом с рисунком или рядом по пути стоит ещё одна чужая. */
export function guarded(s: State, p: number): boolean {
  const o = s.board[p];
  if (o < 0) return false;
  if (SAFE.includes(p)) return true;
  return (p > 1 && s.board[p - 1] === o) || (p < 30 && s.board[p + 1] === o);
}

/** Между a и b (не включая) стоят три чужие подряд — стена. */
function wall(s: State, side: number, a: number, b: number): boolean {
  let run = 0;
  for (let p = Math.min(a, b) + 1; p < Math.max(a, b); p++) {
    run = s.board[p] === 1 - side ? run + 1 : 0;
    if (run >= 3) return true;
  }
  return false;
}

/** Куда можно пойти с from: вперёд (back=false) или назад. null — нельзя. */
export function target(s: State, side: number, from: number, v: number, back: boolean): number | null {
  if (s.board[from] !== side) return null;
  let to = back ? from - v : from + v;
  if (back) {
    if (to < 1 || from >= BEAUTY) return null;
  } else {
    if (s.cfg.stop && from < BEAUTY && to > BEAUTY) return null;
    if (to > OFF) {
      if (s.cfg.exact) return null;
      to = OFF;
    }
  }
  if (wall(s, side, from, Math.min(to, OFF))) return null;
  if (to === OFF) return to;
  const o = s.board[to];
  if (o === side) return null;
  if (o === 1 - side && guarded(s, to)) return null;
  return to;
}

export function legal(s: State): { from: number; to: number; back: boolean }[] {
  if (s.phase !== 'move') return [];
  const fwd: { from: number; to: number; back: boolean }[] = [];
  for (let p = 1; p <= 30; p++) {
    const to = target(s, s.cur, p, s.value, false);
    if (to != null) fwd.push({ from: p, to, back: false });
  }
  if (fwd.length) return fwd;
  const bk: { from: number; to: number; back: boolean }[] = [];
  for (let p = 1; p <= 30; p++) {
    const to = target(s, s.cur, p, s.value, true);
    if (to != null) bk.push({ from: p, to, back: true });
  }
  return bk;
}

export function throwSticks(rng: Rng): number[] {
  return [0, 1, 2, 3].map(() => rng.int(2));
}

export function stickValue(sticks: number[]): number {
  const k = sticks.reduce((a, b) => a + b, 0);
  return k === 0 ? 5 : k;
}

/** Вероятности очков 1–5 (индекс — очки). */
export const ODDS = [0, 4 / 16, 6 / 16, 4 / 16, 1 / 16, 1 / 16];

/** Ближайшая свободная клетка от 15 назад (вода смывает фишку в «Дом возрождения»). */
export function rebirth(board: number[]): number {
  for (let p = REBIRTH; p >= 1; p--) if (board[p] < 0) return p;
  for (let p = REBIRTH + 1; p <= 25; p++) if (board[p] < 0) return p;
  return REBIRTH;
}

/** Сделать ход на доске (без смены очереди); возвращает подробности для события. */
export function move(s: State, side: number, from: number, to: number): { swap: boolean; water: number } {
  s.board[from] = -1;
  let swap = false;
  let water = 0;
  if (to === OFF) s.off[side]++;
  else {
    if (s.board[to] === 1 - side) {
      s.board[from] = 1 - side;
      swap = true;
    }
    s.board[to] = side;
    if (to === WATER) {
      s.board[to] = -1;
      water = rebirth(s.board);
      s.board[water] = side;
    }
  }
  return { swap, water };
}

function pass(s: State) {
  s.phase = 'roll';
  if (!again(s.value)) s.cur = 1 - s.cur;
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.phase === 'over' || seat !== s0.seats[s0.cur]) return null;
  const s: State = structuredClone(s0);
  const events: Event[] = [];
  if (a.type === 'roll') {
    if (s.phase !== 'roll') return null;
    s.sticks = throwSticks(rng);
    s.value = stickValue(s.sticks);
    s.phase = 'move';
    const none = legal(s).length === 0;
    events.push({ type: 'roll', seat, sticks: s.sticks, value: s.value, none, again: again(s.value) });
    if (none) pass(s);
    return { state: s, events };
  }
  if (a.type !== 'move' || s.phase !== 'move') return null;
  const m = legal(s).find((x) => x.from === a.from);
  if (!m) return null;
  const side = s.cur;
  const r = move(s, side, m.from, m.to);
  s.last = { side, from: m.from, to: r.water || m.to };
  s.moves++;
  events.push({ type: 'move', seat, side, from: m.from, to: m.to, swap: r.swap, water: r.water, back: m.back, again: again(s.value) });
  if (s.off[side] === s.cfg.pieces) {
    s.phase = 'over';
    s.winner = side;
    events.push({ type: 'end', winner: s.seats[side] });
    return { state: s, events };
  }
  if (s.moves >= LIMIT) {
    // затянулось (фишки ходят назад и вперёд) — побеждает тот, кто вывел больше, при равенстве — кто дальше прошёл
    const score = (x: number) => s.off[x] * 1000 + s.board.reduce((t, v, p) => t + (v === x ? p : 0), 0);
    s.phase = 'over';
    s.winner = score(0) >= score(1) ? 0 : 1;
    events.push({ type: 'end', winner: s.seats[s.winner] });
    return { state: s, events };
  }
  pass(s);
  return { state: s, events };
}
