/* Баг-Чал — боты. Оценка с точки зрения тигров: съеденные козы (дорого), козы под ударом, подвижность тигров,
 * запертые тигры (плохо); для коз — то же с обратным знаком.
 *   Лёгкий — на 1 полуход с шумом; Средний — на 3; Сложный — до 5 (сколько успеет в пределах лимита перебора). */
import { bestMove, type SearchGame } from '../../core/minimax';
import type { Rng } from '../../core/types';
import { GOAT, GOATS, legal, LINES, N, step, TIGER, TIGERS, trapped, type Action, type State } from './engine';

function threats(s: State): number {
  let n = 0;
  for (let p = 0; p < N * N; p++) {
    if (s.board[p] !== TIGER) continue;
    for (const [a, b] of LINES[p]) if (s.board[a] === GOAT && b >= 0 && !s.board[b]) n++;
  }
  return n;
}

function mobility(s: State): number {
  let n = 0;
  for (let p = 0; p < N * N; p++) if (s.board[p] === TIGER) for (const [a] of LINES[p]) if (!s.board[a]) n++;
  return n;
}

function tigerScore(s: State): number {
  if (s.over) return s.winner === TIGERS ? 10000 - s.ply : s.winner === GOATS ? -10000 + s.ply : 0;
  const calm = s.cfg.calm && s.hand > 0;
  return s.eaten * 120 + (calm ? 0 : threats(s) * (s.turn === TIGERS ? 40 : 12)) + mobility(s) * 3 - trapped(s) * 35;
}

const game: SearchGame<State, Action> = {
  moves: legal,
  play: (s, m) => step(s, m).state,
  side: (s) => s.turn,
  over: (s) => s.over,
  score: (s, me) => (me === TIGERS ? tigerScore(s) : -tigerScore(s)),
  order: (s, m) => (m.type === 'move' && s.board[m.from] === TIGER && !LINES[m.from].some(([a]) => a === m.to) ? 10 : 0),
};

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over || s.turn !== seat) return null;
  const depth = level <= 0 ? 1 : level === 1 ? 3 : 5;
  return bestMove(game, s, depth, rng, level <= 0 ? 60 : level === 1 ? 6 : 0);
}
