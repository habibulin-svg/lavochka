/* Крестики-нолики — боты. Классика: лёгкий почти наугад, средний выигрывает и закрывает, сложный играет идеально (минимакс).
 * Ультимативные: лёгкий наугад, средний смотрит на ход вперёд (куда отправит соперника), сложный — альфа-бета с оценкой. */
import type { Rng } from '../../core/types';
import { clone, legal, LINES, lineWinner, markInPlace, type Action, type State } from './engine';

const pick = <T>(xs: T[], rng: Rng) => xs[rng.int(xs.length)];

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.phase === 'between') return { type: 'next' };
  const moves = legal(s);
  if (!moves.length) return null;
  const p = s.mode === 'classic' ? classic(s, seat, level, moves, rng) : ultimate(s, seat, level, moves, rng);
  return { type: 'mark', p };
}

// ---------------------------------------------------------------- классика

/** Клетка, которой seat замыкает тройку, или −1. */
function finishing(cells: number[], seat: number): number {
  for (const l of LINES) {
    const mine = l.filter((i) => cells[i] === seat).length;
    const empty = l.filter((i) => cells[i] === -1);
    if (mine === 2 && empty.length === 1) return empty[0];
  }
  return -1;
}

function minimax(cells: number[], turn: number, me: number, depth: number): number {
  const w = lineWinner((i) => cells[i]);
  if (w) return w.who === me ? 10 - depth : depth - 10;
  if (!cells.includes(-1)) return 0;
  let best = turn === me ? -99 : 99;
  for (let i = 0; i < 9; i++) {
    if (cells[i] !== -1) continue;
    cells[i] = turn;
    const v = minimax(cells, 1 - turn, me, depth + 1);
    cells[i] = -1;
    best = turn === me ? Math.max(best, v) : Math.min(best, v);
  }
  return best;
}

function classic(s: State, seat: number, level: number, moves: number[], rng: Rng): number {
  const win = finishing(s.cells, seat);
  const block = finishing(s.cells, 1 - seat);
  if (level === 0) {
    if (win >= 0 && rng.next() < 0.6) return win;
    if (block >= 0 && rng.next() < 0.3) return block;
    return pick(moves, rng);
  }
  if (level === 1) {
    if (win >= 0) return win;
    if (block >= 0 && rng.next() < 0.85) return block;
    if (s.cells[4] === -1 && rng.next() < 0.6) return 4;
    return pick(moves, rng);
  }
  // идеальная игра; среди равных ходов — случайный, чтобы партии не повторялись
  const cells = s.cells.slice();
  let best = -99;
  let bestMoves: number[] = [];
  for (const m of moves) {
    cells[m] = seat;
    const v = minimax(cells, 1 - seat, seat, 1);
    cells[m] = -1;
    if (v > best) {
      best = v;
      bestMoves = [m];
    } else if (v === best) bestMoves.push(m);
  }
  return pick(bestMoves, rng);
}

// ---------------------------------------------------------------- ультимативные

/** Сколько «двоек» (две свои, третья пустая) у seat в малом поле b. */
function twos(s: State, b: number, seat: number): number {
  let n = 0;
  for (const l of LINES) {
    let mine = 0;
    let empty = 0;
    for (const i of l) {
      const v = s.cells[b * 9 + i];
      if (v === seat) mine++;
      else if (v === -1) empty++;
    }
    if (mine === 2 && empty === 1) n++;
  }
  return n;
}

const W = [1.2, 1, 1.2, 1, 1.5, 1, 1.2, 1, 1.2];

/** Оценка позиции для me: поля, их «двойки» и тройки полей на большом поле. */
function evaluate(s: State, me: number): number {
  if (s.roundResult != null) return s.roundResult === me ? 1000 : s.roundResult === 2 ? 0 : -1000;
  const v = s.boards.map((o, b) => (o === me ? 1 : o === 1 - me ? -1 : o === 2 ? 0 : Math.max(-0.7, Math.min(0.7, 0.25 * (twos(s, b, me) - twos(s, b, 1 - me))))));
  let score = 0;
  for (let b = 0; b < 9; b++) score += v[b] * W[b] * 10;
  for (const l of LINES) {
    const xs = l.map((i) => v[i]);
    if (xs.every((x) => x > -0.5)) score += 6 * xs.reduce((a, x) => a + Math.max(0, x), 0) ** 2;
    if (xs.every((x) => x < 0.5)) score -= 6 * xs.reduce((a, x) => a + Math.max(0, -x), 0) ** 2;
  }
  // свобода выбора поля у соперника — подарок ему
  if (s.next === -1) score += s.turn === me ? 4 : -4;
  return score;
}

function search(s: State, depth: number, alpha: number, beta: number, me: number): number {
  if (depth === 0 || s.roundResult != null) return evaluate(s, me);
  const moves = legal(s);
  if (!moves.length) return evaluate(s, me);
  const maxing = s.turn === me;
  for (const m of moves) {
    const t = clone(s);
    markInPlace(t, s.turn, m);
    const v = search(t, depth - 1, alpha, beta, me);
    if (maxing) alpha = Math.max(alpha, v);
    else beta = Math.min(beta, v);
    if (alpha >= beta) break;
  }
  return maxing ? alpha : beta;
}

function ultimate(s: State, seat: number, level: number, moves: number[], rng: Rng): number {
  if (level === 0) {
    // иногда замечает, что малое поле можно взять сразу
    if (rng.next() < 0.4) {
      const take = moves.filter((m) => {
        const t = clone(s);
        markInPlace(t, seat, m);
        return t.boards[Math.floor(m / 9)] === seat;
      });
      if (take.length) return pick(take, rng);
    }
    return pick(moves, rng);
  }
  const depth = level === 1 ? 1 : moves.length > 20 ? 2 : moves.length > 9 ? 3 : 4;
  let best = -Infinity;
  let bestMoves: number[] = [];
  for (const m of moves) {
    const t = clone(s);
    markInPlace(t, seat, m);
    const v = search(t, depth - 1, -Infinity, Infinity, seat) + rng.next() * 0.5; // шум против одинаковых партий
    if (v > best + 1e-9) {
      best = v;
      bestMoves = [m];
    } else if (Math.abs(v - best) < 1e-9) bestMoves.push(m);
  }
  return pick(bestMoves, rng);
}
