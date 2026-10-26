/* Фидхел — боты. С королём: оценка для кости — фишки (кость — за две, бронза — за одну), открытые пути короля к выходу
 * (одна — почти выигрыш, две — выигрыш), расстояние до выхода, свобода короля, бронза вплотную к королю.
 * Без короля — разница фишек, фишки под угрозой клещей и подвижность.
 *   Лёгкий — на 1 полуход с большим шумом; Средний — на 1 с малым; Сложный — на 2. */
import { bestMove, type SearchGame } from '../../core/minimax';
import type { Rng } from '../../core/types';
import { at, BONE, BRONZE, isEscape, KING, legal, movesFrom, N, RULES, sideOf, step, type Action, type State } from './engine';

/** Сколько фишек стороны side можно взять одним ходом соперника (грубо: соседняя вражеская и пустая клетка напротив). */
function exposed(s: State, side: number): number {
  let c = 0;
  for (let p = 0; p < N * N; p++) {
    const v = s.board[p];
    if (sideOf(v) !== side || v === KING) continue;
    const x = p % N;
    const y = (p - x) / N;
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
    ]) {
      const a = at(x - dx, y - dy);
      const b = at(x + dx, y + dy);
      if (a < 0 || b < 0) continue;
      const ea = sideOf(s.board[a]) === 1 - side;
      const eb = sideOf(s.board[b]) === 1 - side;
      if ((ea && !s.board[b]) || (eb && !s.board[a])) {
        c++;
        break;
      }
    }
  }
  return c;
}

/** Оценка с точки зрения кости (место 1). */
function boneScore(s: State): number {
  if (s.over) return s.winner === 1 ? 10000 - s.ply : s.winner === 0 ? -10000 + s.ply : 0;
  let b = 0;
  let w = 0;
  let k = -1;
  s.board.forEach((v, p) => {
    if (v === BRONZE) b++;
    else if (v === BONE) w++;
    else if (v === KING) k = p;
  });
  const r = RULES[s.cfg.kind];
  if (!r.king) {
    let v = (w - b) * 40;
    v += (exposed(s, 0) - exposed(s, 1)) * (s.turn === 1 ? 10 : 4);
    return v;
  }
  let v = w * 20 - b * 10;
  v += exposed(s, 0) * (s.turn === 1 ? 8 : 2) - exposed(s, 1) * (s.turn === 0 ? 16 : 4);
  if (k >= 0) {
    const ms = movesFrom(s, k);
    let exits = ms.filter((q) => isEscape(s, q)).length;
    // король, что ходит по шагу: пути — прямые линии до угла
    if (r.kingStep) {
      const kx = k % N;
      const ky = (k - kx) / N;
      exits = 0;
      for (const [cx, cy] of [
        [0, 0],
        [N - 1, 0],
        [0, N - 1],
        [N - 1, N - 1],
      ]) {
        const d = Math.abs(cx - kx) + Math.abs(cy - ky);
        if (d === 1) exits++;
      }
    }
    if (exits) v += s.turn === 1 ? 5000 : exits >= 2 ? 3000 : 150;
    const kx = k % N;
    const ky = (k - kx) / N;
    const dist = r.escape === 'corner' ? Math.min(kx, N - 1 - kx) + Math.min(ky, N - 1 - ky) : Math.min(kx, ky, N - 1 - kx, N - 1 - ky);
    v -= dist * (r.kingStep ? 14 : 6);
    v += ms.length * 2;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const q = at(kx + dx, ky + dy);
      if (q >= 0 && s.board[q] === BRONZE) v -= 18;
    }
  }
  return v;
}

const game: SearchGame<State, Action> = {
  moves: legal,
  play: (s, m) => step(s, m).state,
  side: (s) => s.turn,
  over: (s) => s.over,
  score: (s, me) => (me === 1 ? boneScore(s) : -boneScore(s)),
  order: (s, m) => (s.board[m.from] === KING ? 5 : 0),
};

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over || s.turn !== seat) return null;
  const depth = level <= 1 ? 1 : 2;
  return bestMove(game, s, depth, rng, level <= 0 ? 60 : level === 1 ? 10 : 0);
}
