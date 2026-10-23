/* Мельница — боты. Оценка: разница фишек (дорого), «полумельницы» — две свои в ряд при пустой третьей,
 * подвижность и запертый соперник; в малой мельнице — угроза выстроить ряд.
 *   Лёгкий — на 1 полуход с шумом; Средний — на 3; Сложный — до 5 (в пределах лимита перебора). Снятие фишки — отдельный полуход. */
import { bestMove, type SearchGame } from '../../core/minimax';
import type { Rng } from '../../core/types';
import { count, geo, legal, step, type Action, type State } from './engine';

function score(s: State, me: number): number {
  if (s.over) return s.winner == null ? 0 : s.winner === me ? 10000 - s.ply : -10000 + s.ply;
  const G = geo(s.cfg);
  const a = me + 1;
  const b = 2 - me;
  let v = (count(s, me) - count(s, 1 - me)) * 100;
  for (const m of G.mills) {
    let x = 0;
    let y = 0;
    let e = 0;
    for (const p of m) {
      if (s.board[p] === a) x++;
      else if (s.board[p] === b) y++;
      else e++;
    }
    if (x === 2 && e === 1) v += 14;
    if (y === 2 && e === 1) v -= 14;
    if (x === 3) v += 6;
    if (y === 3) v -= 6;
  }
  if (s.take > 0) v += s.turn === me ? 80 : -80;
  if (s.hand[0] + s.hand[1] === 0) {
    let mm = 0;
    let om = 0;
    s.board.forEach((w, p) => {
      if (w === a) mm += G.adj[p].filter((q) => !s.board[q]).length;
      else if (w === b) om += G.adj[p].filter((q) => !s.board[q]).length;
    });
    v += (mm - om) * 3;
  }
  return v;
}

const game: SearchGame<State, Action> = {
  moves: legal,
  play: (s, m) => step(s, m).state,
  side: (s) => s.turn,
  over: (s) => s.over,
  score,
};

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over || s.turn !== seat) return null;
  const depth = level <= 0 ? 1 : level === 1 ? 3 : 5;
  return bestMove(game, s, depth, rng, level <= 0 ? 90 : level === 1 ? 8 : 0);
}
