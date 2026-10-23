/* Суракарта — боты. Альфа-бета по ходам; оценка: очки серии и разница фишек (дорого), чужие фишки под боем у того,
 * кто ходит, свои фишки под боем у соперника и немного — фишки на кругах (только с них можно брать).
 *   Лёгкий — на 1 ход с шумом; Средний — на 2; Сложный — на 4, сколько успеет в пределах лимита узлов. */
import { bestMove, type SearchGame } from '../../core/minimax';
import type { Rng } from '../../core/types';
import { count, legal, N, own, step, takesFrom, type Action, type State } from './engine';

/** Сколько разных чужих фишек может взять место seat. */
function attacked(s: State, seat: number): number {
  const me = own(seat);
  const hit = new Set<number>();
  for (let p = 0; p < N * N; p++) if (s.board[p] === me) for (const q of takesFrom(s.board, p).keys()) hit.add(q);
  return hit.size;
}

const CORNERS = new Set([0, 5, 30, 35]);

function score(s: State, me: number): number {
  const fin = s.over ? (s.winner == null ? 0 : s.winner === me ? 10000 - s.ply : -10000 + s.ply) : 0;
  if (s.over && s.cfg.games <= 1) return fin;
  let v = (s.score[me] - s.score[1 - me]) * 100;
  if (s.over) return fin + v;
  v += (count(s, me) - count(s, 1 - me)) * 100;
  const mover = s.turn;
  const a = attacked(s, mover);
  const b = attacked(s, 1 - mover);
  // тот, кто ходит, возьмёт одну; у другого под боем — лишь угроза
  const t = (a ? 60 + a * 8 : 0) - b * 12;
  v += mover === me ? t : -t;
  let corner = 0;
  for (const p of CORNERS) if (s.board[p] === own(me)) corner--;
  else if (s.board[p] === own(1 - me)) corner++;
  return v + corner * 4;
}

const game: SearchGame<State, Action> = {
  moves: legal,
  play: (s, m) => step(s, m).state,
  side: (s) => s.turn,
  over: (s) => s.over,
  score,
  order: (s, m) => (s.board[m.to] ? 1 : 0),
};

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over || s.turn !== seat) return null;
  const acts = legal(s);
  if (!acts.length) return null;
  if (acts.length === 1) return acts[0];
  const depth = level <= 0 ? 1 : level === 1 ? 2 : 4;
  return bestMove(game, s, depth, rng, level <= 0 ? 160 : level === 1 ? 10 : 0) ?? acts[rng.int(acts.length)];
}
