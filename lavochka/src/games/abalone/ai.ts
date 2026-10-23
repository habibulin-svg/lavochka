/* Абалон — боты: альфа-бета (core/minimax) с оценкой позиции.
 *   Лёгкий — на один ход, с большим разбросом оценки;
 *   Средний — на два полухода;
 *   Сложный — на три полухода (до предела узлов), толчки и выталкивания — первыми.
 * Оценка: вытолкнутые шары (главное), шары ближе к центру, сплочённость (свои соседи), шары на краю под угрозой. */
import type { Rng } from '../../core/types';
import { bestMove, type SearchGame } from '../../core/minimax';
import { legal, N, NB, ring, step, type Action, type State } from './engine';

function score(s: State, me: number): number {
  if (s.over) return s.winner === me ? 10000 - s.ply : s.winner == null ? 0 : -10000 + s.ply;
  let v = (s.lost[1 - me] - s.lost[me]) * 1000;
  for (let c = 0; c < N; c++) {
    const o = s.board[c];
    if (o < 0) continue;
    const sign = o === me ? 1 : -1;
    const rg = ring(c);
    let t = (4 - rg) * 6;
    let nb = 0;
    for (let d = 0; d < 6; d++) {
      const x = NB[c][d];
      if (x >= 0 && s.board[x] === o) nb++;
    }
    t += nb * 2.5;
    if (rg === 4) t -= 8;
    v += sign * t;
  }
  return v;
}

const game: SearchGame<State, Action> = {
  moves: (s) => legal(s),
  play: (s, m) => step(s, m)!.state,
  side: (s) => s.turn,
  over: (s) => s.over,
  score,
  // выталкивание и толчок — первыми, потом тройки
  order: (_s, m) => (m.w ?? 0) * 10 + m.cells.length,
};

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over || s.turn !== seat) return null;
  const depth = [1, 2, 3][level] ?? 2;
  return bestMove(game, s, depth, rng, level === 0 ? 60 : level === 1 ? 4 : 0);
}
