/* Крестики-нолики — движок без DOM: классика 3×3 и ультимативные (супер-) крестики-нолики на девяти полях.
 * Ультимативные: ход в клетку k малого поля отправляет соперника в малое поле k; если оно уже решено (выиграно
 * или заполнено) — соперник ходит в любое открытое. Малое поле выиграл — оно ваше; три своих поля в ряд — победа.
 * Серия: несколько партий подряд, первый ход переходит по очереди; победитель — по сумме очков (победа 1, ничья ½). */
import type { Options } from '../../core/types';

export type Mode = 'classic' | 'ultimate';

export interface State {
  mode: Mode;
  /** Классика — 9 клеток; ультимативные — 81: клетка = поле·9 + клетка в поле. −1 — пусто, иначе место. */
  cells: number[];
  /** Ультимативные: судьба малых полей — −1 открыто, 0/1 — чьё, 2 — ничья. */
  boards: number[];
  /** Ультимативные: куда обязан ходить следующий (−1 — в любое открытое поле). */
  next: number;
  turn: number;
  /** Кто начинал текущую партию серии. */
  first: number;
  last: number;
  /** Выигрышная линия текущей (последней) партии — индексы клеток (классика) или полей (ультимативные). */
  line: number[] | null;
  round: number;
  rounds: number;
  /** Очки серии в половинках: победа 2, ничья 1. */
  score: [number, number];
  /** Итог текущей партии: место победителя, 2 — ничья, null — идёт. */
  roundResult: number | null;
  phase: 'play' | 'between' | 'over';
}

export type Action = { type: 'mark'; p: number } | { type: 'next' };

export type Event =
  | { type: 'mark'; seat: number; p: number }
  | { type: 'board'; b: number; owner: number }
  | { type: 'round'; result: number; line: number[] | null; round: number }
  | { type: 'newround'; round: number; first: number }
  | { type: 'end'; winners: number[]; score: [number, number] };

export const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

/** Победитель тройки клеток-значений: место или −1. */
export function lineWinner(v: (i: number) => number): { who: number; line: number[] } | null {
  for (const l of LINES) {
    const a = v(l[0]);
    if ((a === 0 || a === 1) && a === v(l[1]) && a === v(l[2])) return { who: a, line: l };
  }
  return null;
}

export function newRound(mode: Mode, first: number): Pick<State, 'cells' | 'boards' | 'next' | 'turn' | 'first' | 'last' | 'line' | 'roundResult'> {
  return {
    cells: Array(mode === 'classic' ? 9 : 81).fill(-1),
    boards: Array(9).fill(-1),
    next: -1,
    turn: first,
    first,
    last: -1,
    line: null,
    roundResult: null,
  };
}

export function setup(opts: Options): State {
  const mode: Mode = opts.mode === 'ultimate' ? 'ultimate' : 'classic';
  const rounds = Math.max(1, Number(opts.rounds) || 1);
  return { mode, rounds, round: 1, score: [0, 0], phase: 'play', ...newRound(mode, 0) };
}

/** Допустимые клетки для хода. */
export function legal(s: State): number[] {
  if (s.phase !== 'play') return [];
  const out: number[] = [];
  if (s.mode === 'classic') {
    for (let i = 0; i < 9; i++) if (s.cells[i] === -1) out.push(i);
    return out;
  }
  for (let b = 0; b < 9; b++) {
    if (s.boards[b] !== -1) continue;
    if (s.next !== -1 && s.next !== b) continue;
    for (let c = 0; c < 9; c++) if (s.cells[b * 9 + c] === -1) out.push(b * 9 + c);
  }
  return out;
}

/** Ход на месте (для ботов и движка): ставит знак и пересчитывает поля. Возвращает события хода. */
export function markInPlace(s: State, seat: number, p: number): Event[] {
  const ev: Event[] = [{ type: 'mark', seat, p }];
  s.cells[p] = seat;
  s.last = p;
  let done: { result: number; line: number[] | null } | null = null;
  if (s.mode === 'classic') {
    const w = lineWinner((i) => s.cells[i]);
    if (w) done = { result: w.who, line: w.line };
    else if (!s.cells.includes(-1)) done = { result: 2, line: null };
  } else {
    const b = Math.floor(p / 9);
    const c = p % 9;
    const w = lineWinner((i) => s.cells[b * 9 + i]);
    if (w) {
      s.boards[b] = w.who;
      ev.push({ type: 'board', b, owner: w.who });
    } else if (![0, 1, 2, 3, 4, 5, 6, 7, 8].some((i) => s.cells[b * 9 + i] === -1)) {
      s.boards[b] = 2;
      ev.push({ type: 'board', b, owner: 2 });
    }
    const big = lineWinner((i) => s.boards[i]);
    if (big) done = { result: big.who, line: big.line };
    else if (!s.boards.includes(-1)) {
      // все поля решены, тройки нет — у кого больше полей, тот и выиграл (так и играют во дворе)
      const n0 = s.boards.filter((x) => x === 0).length;
      const n1 = s.boards.filter((x) => x === 1).length;
      done = { result: n0 === n1 ? 2 : n0 > n1 ? 0 : 1, line: null };
    }
    s.next = s.boards[c] === -1 ? c : -1;
  }
  if (done) {
    s.roundResult = done.result;
    s.line = done.line;
    if (done.result === 2) {
      s.score[0] += 1;
      s.score[1] += 1;
    } else s.score[done.result] += 2;
    ev.push({ type: 'round', result: done.result, line: done.line, round: s.round });
    if (s.round >= s.rounds) {
      s.phase = 'over';
      const [a, b] = s.score;
      ev.push({ type: 'end', winners: a === b ? [0, 1] : a > b ? [0] : [1], score: [a, b] });
    } else s.phase = 'between';
  } else s.turn = 1 - seat;
  return ev;
}

export const clone = (s: State): State => ({ ...s, cells: s.cells.slice(), boards: s.boards.slice(), score: [s.score[0], s.score[1]], line: s.line && s.line.slice() });

export function toAct(s: State): number[] {
  if (s.phase === 'over') return [];
  if (s.phase === 'between') return [1 - s.first]; // следующую партию начинает другой — он и жмёт «Дальше»
  return [s.turn];
}

export function apply(s0: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  if (!toAct(s0).includes(seat)) return null;
  const s = clone(s0);
  if (a.type === 'next') {
    if (s.phase !== 'between') return null;
    s.round += 1;
    Object.assign(s, newRound(s.mode, 1 - s.first));
    s.phase = 'play';
    return { state: s, events: [{ type: 'newround', round: s.round, first: s.first }] };
  }
  if (a.type !== 'mark' || !legal(s).includes(a.p)) return null;
  return { state: s, events: markInPlace(s, seat, a.p) };
}
