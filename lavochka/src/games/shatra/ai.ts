/* Шатра — боты: альфа-бета (core/minimax).
 *   Лёгкий — на один ход с разбросом; Средний — на два полухода; Сложный — на три (до предела узлов), взятия — первыми.
 * Оценка: материал (батыр 9, тура 5, ялкын 3,5, шатра 1 и дороже за рвом), фигуры в резерве — чуть дешевле, бий под боем — плохо. */
import type { Rng } from '../../core/types';
import { bestMove, type SearchGame } from '../../core/minimax';
import { CELLS, legal, N, play, type Action, type Kind, type State } from './engine';

const VAL: Record<Kind, number> = { K: 0, Q: 9, R: 5, B: 3.5, P: 1 };

function score(s: State, me: number): number {
  if (s.over) return s.winner === me ? 10000 - s.ply : s.winner == null ? 0 : -10000 + s.ply;
  let v = 0;
  for (let i = 0; i < N; i++) {
    const p = s.board[i];
    if (!p) continue;
    let w = VAL[p.k];
    if (p.k === 'P') {
      const y = CELLS[i].y;
      const adv = p.o === 0 ? 9 - y : y - 4; // сколько рядов прошла
      w += Math.max(0, adv) * 0.12;
    }
    if (s.reserve[p.o].includes(i)) w *= 0.9;
    else if (p.k !== 'K' && p.k !== 'P') w += 0.15; // в деле
    v += p.o === me ? w : -w;
  }
  return v;
}

const game: SearchGame<State, Action> = {
  moves: (s) => legal(s),
  play: (s, m) => play(s, m).state,
  side: (s) => s.turn,
  over: (s) => s.over,
  score,
  // взятия legal() и так отдаёт первыми (сортировка устойчивая); серии длиннее — раньше
  order: (_s, m) => (m.type === 'move' ? m.path.length - 2 : m.type === 'promote' ? 100 : -1),
};

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over || s.turn !== seat) return null;
  const depth = [1, 2, 3][level] ?? 2;
  return bestMove(game, s, depth, rng, level === 0 ? 4 : level === 1 ? 0.3 : 0);
}
