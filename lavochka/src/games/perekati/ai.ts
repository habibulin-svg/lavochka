/* Перекати-поле — боты. Альфа-бета по перекатам; оценка — сколько перекатов осталось каждой стороне:
 * для каждого кубика — ближайшая свободная финишная клетка, на которую он встанет шляпкой вверх (таблица
 * расстояний без учёта других кубиков). Доплаты за финиш, занятый чужим, нет: с ней боты возвращали кубики домой,
 * чтобы «загородить» сопернику финиш, и топтались на месте.
 *   Лёгкий — на 1 полуход с шумом; Средний — на 3 с небольшим шумом; Сложный — на 4. */
import { bestMove, type SearchGame } from '../../core/minimax';
import type { Rng } from '../../core/types';
import { at, distTable, done, goalRow, legal, locked, seatOf, step, type Action, type State } from './engine';

/** Перекатов до конца у места seat (приблизительно). */
export function cost(s: State, seat: number): number {
  const c = s.cfg;
  const t = distTable(c);
  const gy = goalRow(c, seat);
  const free: number[] = [];
  for (let x = 0; x < c.w; x++) {
    const p = at(c, x, gy);
    if (!locked(s, p)) free.push(p);
  }
  let sum = 0;
  for (let p = 0; p < s.board.length; p++) {
    const id = s.board[p];
    if (id < 0 || seatOf(id) !== seat || locked(s, p)) continue;
    let best = 99;
    for (const q of free) {
      const d = t[q][p * 6 + s.face[id]];
      if (d < best) best = d;
    }
    sum += best;
  }
  return sum;
}

function score(s: State, me: number): number {
  if (s.over) return s.winner === me ? 10000 - s.ply : s.winner == null ? 0 : -10000 + s.ply;
  const op = 1 - me;
  return (cost(s, op) - cost(s, me)) * 10 + (done(s, me) - done(s, op)) * 4;
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
  const acts = legal(s);
  if (!acts.length) return null;
  if (acts.length === 1) return acts[0];
  const depth = level <= 0 ? 1 : level === 1 ? 3 : 4;
  return bestMove(game, s, depth, rng, level <= 0 ? 25 : level === 1 ? 8 : 0) ?? acts[rng.int(acts.length)];
}
