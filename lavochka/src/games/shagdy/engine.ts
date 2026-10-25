/* Шагды («двойные ходы») — советская игра (Жмеринка, арт. 10-ВН). Без DOM. Разбор листовки — docs/analysis/shagdy.md.
 *
 * Доска 8×8, у каждого игрока своя нумерация клеток 1…20 (у верхнего — схема ниже, у нижнего — она же, повёрнутая на 180°).
 * Номер — это «шаг» дорожки; у номера одна основная клетка и одна-две «со штрихом»: на них встают, только если основная
 * уже занята своей фишкой. Свои 5…10 лежат в своей крепости, 15…20 — в чужой (цель). Ход — выбрать на своём
 * вспомогательном поле ещё не закрытое сочетание цифр a/b и сделать шаги a и b (дубль — четыре шага; в усложнённом — два),
 * вводя фишки из запаса (0—d) или двигая их вперёд. Пока не введены все 10 фишек, в чужую крепость не заходят и не снимают;
 * потом одинокую фишку соперника снимают, встав на неё (кроме уже дошедших до цели). Цель — завести все 10 фишек
 * в крепость противника; сочетания кончились — выигрывает тот, кто продвинулся дальше. */
import type { Options } from '../../core/types';

export type Variant = 'easy' | 'normal' | 'hard';
export interface Cfg {
  variant: Variant;
}
export const cfgFrom = (o: Options): Cfg => ({ variant: o.variant === 'easy' || o.variant === 'hard' ? o.variant : 'normal' });

export const PIECES = 10;
export const N = 8;

/** Клетки номеров 1…20 у верхнего игрока (место 1): [основная, ′, ″], клетка = ряд * 8 + столбец. */
const TOP: number[][] = (() => {
  const c = (r: number, col: number) => r * N + col;
  const t: number[][] = [[]];
  for (let k = 1; k <= 4; k++) t[k] = [c(6 - k, 6), c(6 - k, 7)];
  t[5] = [c(1, 6), c(1, 7), c(0, 6)];
  for (let k = 6; k <= 9; k++) t[k] = [c(1, 11 - k), c(0, 11 - k)];
  t[10] = [c(1, 1), c(0, 1), c(1, 0)];
  for (let k = 11; k <= 14; k++) t[k] = [c(k - 9, 1), c(k - 9, 0)];
  t[15] = [c(6, 1), c(6, 0), c(7, 1)];
  for (let k = 16; k <= 19; k++) t[k] = [c(5, k - 14), c(6, k - 14), c(4, k - 14)];
  t[20] = [c(6, 6)];
  return t;
})();

const rot = (cell: number) => N * N - 1 - cell;
/** CELLS[место][номер] — клетки номера; место 0 — нижний игрок. */
export const CELLS: number[][][] = [TOP.map((x) => x.map(rot)), TOP];
/** POS[место][клетка] — номер и слот клетки (−1 — не на дорожке). */
export const POS: { pos: number; slot: number }[][] = CELLS.map((tab) => {
  const m = Array.from({ length: N * N }, () => ({ pos: -1, slot: -1 }));
  tab.forEach((cells, pos) => cells.forEach((cell, slot) => (m[cell] = { pos, slot })));
  return m;
});

/** Клетка в крепости противника (цель места): основная 15, все 16…19 и 20. */
export const inGoal = (pos: number, slot: number) => (pos === 15 && slot === 0) || pos >= 16;
/** Клетки крепостей: 0 — своя у нижнего (цель верхнего), 1 — у верхнего. */
export function fortOf(cell: number): number {
  const r = Math.floor(cell / N);
  const c = cell % N;
  if ((r === 1 && c >= 1 && c <= 6) || ((r === 2 || r === 3) && c >= 2 && c <= 5)) return 1;
  if ((r === 6 && c >= 1 && c <= 6) || ((r === 4 || r === 5) && c >= 2 && c <= 5)) return 0;
  return -1;
}

/** Сочетания вспомогательного поля: [a, b], a ≥ b. */
export function combos(v: Variant): [number, number][] {
  const lo = v === 'easy' ? 1 : 0;
  const hi = v === 'hard' ? 7 : 6;
  const out: [number, number][] = [];
  for (let b = lo; b <= hi; b++) for (let a = b; a <= hi; a++) out.push([a, b]);
  return out;
}
/** Все 36 квадратов поля (0…7) — для показа; номер сочетания в варианте ищется по цифрам. */
export const ALL = combos('hard');

export function stepsOf(v: Variant, a: number, b: number): number[] {
  const s = a === b && v !== 'hard' ? [a, a, a, a] : [a, b];
  return s.filter((x) => x > 0);
}

export interface State {
  cfg: Cfg;
  /** 0 — пусто, 1 — фишка места 0, 2 — места 1. */
  board: number[];
  turn: number;
  /** Кто начал партию. */
  first: number;
  /** Фишек в запасе (ещё не введены или сняты). */
  reserve: [number, number];
  /** Сколько раз фишки вводились (все 10 введены — можно в крепость и снимать). */
  entered: [number, number];
  /** Закрытые сочетания (номера в combos(variant)). */
  used: [number[], number[]];
  /** Сделано ходов. */
  moves: [number, number];
  /** Выбранное в этот ход сочетание (−1 — ещё не выбрано) и оставшиеся шаги. */
  pick: number;
  left: number[];
  /** На каком ходу игрок завёл все фишки. */
  done: [number, number];
  over: boolean;
  winner: number | null;
  why: 'fort' | 'both' | 'far' | 'equal' | null;
  last: number[];
  ply: number;
}

export type Action = { type: 'combo'; i: number } | { type: 'step'; from: number; to: number };

export type Event =
  | { type: 'combo'; seat: number; a: number; b: number; steps: number[] }
  | { type: 'step'; seat: number; from: number; to: number; d: number; enter: boolean; took: number }
  | { type: 'pass'; seat: number }
  | { type: 'turn'; seat: number }
  | { type: 'end'; winner: number | null; why: 'fort' | 'both' | 'far' | 'equal' };

/** Откуда вводят фишки: условная «клетка» запаса. */
export const RESERVE = -1;

export function newState(cfg: Cfg, first = 0): State {
  return {
    cfg,
    board: Array(N * N).fill(0),
    turn: first,
    first,
    reserve: [PIECES, PIECES],
    entered: [0, 0],
    used: [[], []],
    moves: [0, 0],
    pick: -1,
    left: [],
    done: [-1, -1],
    over: false,
    winner: null,
    why: null,
    last: [],
    ply: 0,
  };
}

export const setup = (_seats: number[], o: Options) => newState(cfgFrom(o));
export const toAct = (s: State) => (s.over ? [] : [s.turn]);
const own = (seat: number) => seat + 1;

/** Сколько фишек места стоит на номере pos. */
function atPos(s: State, seat: number, pos: number): number {
  let n = 0;
  for (const c of CELLS[seat][pos]) if (s.board[c] === own(seat)) n++;
  return n;
}

/** Куда встанет фишка места на номер q: клетка и снятая фишка (−1 — без снятия); null — нельзя. */
export function landing(s: State, seat: number, q: number): { cell: number; took: number } | null {
  if (q > 20) return null;
  if (q >= 15 && s.entered[seat] < PIECES) return null;
  const cells = CELLS[seat][q];
  const opp = 1 - seat;
  const canTake = (cell: number) => {
    if (s.entered[seat] < PIECES) return false;
    const p = POS[opp][cell];
    if (p.pos < 0 || inGoal(p.pos, p.slot)) return false;
    return atPos(s, opp, p.pos) < 2; // парные не снимаются
  };
  for (let i = 0; i < cells.length; i++) {
    const v = s.board[cells[i]];
    if (v === 0) return { cell: cells[i], took: -1 };
    if (v === own(opp)) return canTake(cells[i]) ? { cell: cells[i], took: cells[i] } : null;
    // своя — пробуем клетку со штрихом
  }
  return null;
}

/** Все свои основные 5…10 заняты — так запирать соперника нельзя. */
function blocksAll(b: number[], seat: number): boolean {
  for (let k = 5; k <= 10; k++) if (b[CELLS[seat][k][0]] !== own(seat)) return false;
  return true;
}

/** Шаги, которые можно сделать сейчас (оставшимися значениями). */
export function stepMoves(s: State): (Action & { type: 'step' })[] {
  const seat = s.turn;
  const out: (Action & { type: 'step' })[] = [];
  const seen = new Set<string>();
  for (const d of new Set(s.left)) {
    const froms: { cell: number; pos: number }[] = [];
    if (s.reserve[seat] > 0) froms.push({ cell: RESERVE, pos: 0 });
    s.board.forEach((v, cell) => {
      if (v === own(seat)) froms.push({ cell, pos: POS[seat][cell].pos });
    });
    for (const f of froms) {
      const l = landing(s, seat, f.pos + d);
      if (!l) continue;
      const b = s.board.slice();
      if (f.cell >= 0) b[f.cell] = 0;
      b[l.cell] = own(seat);
      if (blocksAll(b, seat)) continue;
      const k = `${f.cell}:${l.cell}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ type: 'step', from: f.cell, to: l.cell });
    }
  }
  return out;
}

export function legal(s: State): Action[] {
  if (s.over) return [];
  if (s.pick < 0) {
    const list = combos(s.cfg.variant);
    const used = new Set(s.used[s.turn]);
    return list.flatMap((_, i) => (used.has(i) ? [] : [{ type: 'combo', i } as Action]));
  }
  return stepMoves(s);
}

/** Сколько фишек места в цели. */
export function home(s: State, seat: number): number {
  let n = 0;
  s.board.forEach((v, cell) => {
    if (v !== own(seat)) return;
    const p = POS[seat][cell];
    if (inGoal(p.pos, p.slot)) n++;
  });
  return n;
}

/** Продвижение: сумма номеров своих фишек на поле. */
export function progress(s: State, seat: number): number {
  let n = 0;
  s.board.forEach((v, cell) => {
    if (v === own(seat)) n += POS[seat][cell].pos;
  });
  return n;
}

function stepFor(s: State, from: number, to: number): number {
  const seat = s.turn;
  const p0 = from === RESERVE ? 0 : POS[seat][from].pos;
  return POS[seat][to].pos - p0;
}

export function step(s0: State, a: Action): { state: State; events: Event[] } {
  const s: State = {
    ...s0,
    board: s0.board.slice(),
    reserve: [s0.reserve[0], s0.reserve[1]],
    entered: [s0.entered[0], s0.entered[1]],
    used: [s0.used[0].slice(), s0.used[1].slice()],
    moves: [s0.moves[0], s0.moves[1]],
    done: [s0.done[0], s0.done[1]],
    left: s0.left.slice(),
  };
  const seat = s.turn;
  const ev: Event[] = [];
  if (a.type === 'combo') {
    const [x, y] = combos(s.cfg.variant)[a.i];
    s.pick = a.i;
    s.used[seat].push(a.i);
    s.left = stepsOf(s.cfg.variant, x, y);
    s.last = [];
    ev.push({ type: 'combo', seat, a: x, b: y, steps: s.left.slice() });
  } else {
    const d = stepFor(s, a.from, a.to);
    s.left.splice(s.left.indexOf(d), 1);
    const took = s.board[a.to] === own(1 - seat) ? a.to : -1;
    if (took >= 0) s.reserve[1 - seat]++;
    if (a.from === RESERVE) {
      s.reserve[seat]--;
      s.entered[seat]++;
    } else s.board[a.from] = 0;
    s.board[a.to] = own(seat);
    s.last = a.from === RESERVE ? [a.to] : [a.from, a.to];
    ev.push({ type: 'step', seat, from: a.from, to: a.to, d, enter: a.from === RESERVE, took });
  }
  s.ply++;
  // ход окончен: шаги кончились или ходить нечем
  if (s.pick >= 0 && (!s.left.length || !stepMoves(s).length)) {
    if (s.left.length && a.type === 'combo') ev.push({ type: 'pass', seat });
    endTurn(s, ev);
  }
  return { state: s, events: ev };
}

function endTurn(s: State, ev: Event[]) {
  const seat = s.turn;
  const opp = 1 - seat;
  s.moves[seat]++;
  s.pick = -1;
  s.left = [];
  const finish = (winner: number | null, why: 'fort' | 'both' | 'far' | 'equal') => {
    s.over = true;
    s.winner = winner;
    s.why = why;
    ev.push({ type: 'end', winner, why });
  };
  if (home(s, seat) === PIECES && s.done[seat] < 0) s.done[seat] = s.moves[seat];
  const second = seat !== s.first;
  if (second) {
    // круг закончен: ходов поровну
    if (s.done[seat] >= 0 && s.done[opp] >= 0) return finish(null, 'both');
    if (s.done[seat] >= 0) return finish(seat, 'fort');
    if (s.done[opp] >= 0) return finish(opp, 'fort');
  }
  const total = combos(s.cfg.variant).length;
  if (s.moves[0] >= total && s.moves[1] >= total) {
    const a = progress(s, 0);
    const b = progress(s, 1);
    return finish(a === b ? null : a > b ? 0 : 1, a === b ? 'equal' : 'far');
  }
  s.turn = opp;
  ev.push({ type: 'turn', seat: opp });
}

export function apply(s: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  if (s.over || seat !== s.turn || !a || typeof a !== 'object') return null;
  const ok = legal(s).some((m) => m.type === a.type && (m.type === 'combo' ? a.type === 'combo' && m.i === a.i : a.type === 'step' && m.from === a.from && m.to === a.to));
  return ok ? step(s, a) : null;
}
