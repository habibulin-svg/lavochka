/* Камисадо — боты. Альфа-бета по ходам; ход почти всегда принудительный (одна башня), поэтому ветвление малое
 * и смотреть можно глубоко. Оценка: очки серии и ранги сумо (дорого), башни со свободной дорогой до цели
 * и продвижение; та, что ходит и может дойти до цели, — почти выигрыш.
 *   Лёгкий — на 2 полухода с шумом; Средний — на 4; Сложный — на 8, сколько успеет в пределах лимита узлов.
 * Выбор расстановки нового раунда — тем же перебором (на конце раунда перебор останавливается). */
import { bestMove, type SearchGame } from '../../core/minimax';
import type { Rng } from '../../core/types';
import { fwd, goalRow, legal, N, REACH, seatOf, step, towerId, where, X, Y, type Action, type State } from './engine';

/** Может ли башня с клетки p дойти до цели одним ходом. */
function runner(s: State, p: number): boolean {
  const id = s.board[p];
  const seat = seatOf(id);
  const dy = fwd(seat);
  const need = Math.abs(goalRow(seat) - Y(p));
  if (need > REACH[Math.min(3, s.rank[id])]) return false;
  for (const dx of [0, -1, 1]) {
    let ok = true;
    for (let k = 1; k <= need && ok; k++) {
      const x = X(p) + dx * k;
      if (x < 0 || x >= N || s.board[(Y(p) + dy * k) * N + x] >= 0) ok = false;
    }
    if (ok) return true;
  }
  return false;
}

function score(s: State, me: number): number {
  const op = 1 - me;
  if (s.over) return s.winner === me ? 10000 - s.ply : -10000 + s.ply;
  let v = (s.score[me] - s.score[op]) * 1500;
  for (let id = 0; id < 16; id++) v += (seatOf(id) === me ? 1 : -1) * s.rank[id] * 120;
  if (s.phase === 'fill') return v;
  // ходящая башня дойдёт — раунд почти выигран
  if (s.forced >= 0) {
    const p = where(s, towerId(s.turn, s.forced));
    if (p >= 0 && runner(s, p)) return v + (s.turn === me ? 3000 : -3000);
  }
  for (let p = 0; p < N * N; p++) {
    const id = s.board[p];
    if (id < 0) continue;
    const seat = seatOf(id);
    const sign = seat === me ? 1 : -1;
    const adv = seat === 0 ? N - 1 - Y(p) : Y(p);
    let t = adv * 3;
    if (runner(s, p)) t += 40;
    v += sign * t;
  }
  return v;
}

const game: SearchGame<State, Action> = {
  moves: legal,
  play: (s, m) => step(s, m).state,
  side: (s) => s.turn,
  over: (s) => s.over || s.phase === 'fill',
  score,
  order: (s, m) => (m.type === 'move' ? (Y(m.to) === goalRow(s.turn) ? 100 : 0) + Math.abs(Y(m.to) - Y(m.from)) : 0),
};

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over || s.turn !== seat) return null;
  const acts = legal(s);
  if (!acts.length) return null;
  if (acts.length === 1) return acts[0];
  if (level <= 0 && s.phase === 'fill') return acts[rng.int(acts.length)];
  const depth = level <= 0 ? 2 : level === 1 ? 4 : 8;
  return bestMove(game, s, depth, rng, level <= 0 ? 400 : level === 1 ? 20 : 0) ?? acts[rng.int(acts.length)];
}

