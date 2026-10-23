/* Тафл — боты. Оценка для защитников: фигуры (защитник — за две, нападающий — за одну), открытые линии короля к выходу
 * (одна — почти выигрыш, две — выигрыш), расстояние короля до ближайшего выхода, нападающие вплотную к королю.
 * Нападающим — бонус за заслоны у углов (ходов у тафла много, поэтому глубина невелика).
 *   Лёгкий — на 1 полуход с большим шумом; Средний — на 1 с малым; Сложный — на 2. */
import { bestMove, type SearchGame } from '../../core/minimax';
import type { Rng } from '../../core/types';
import { ATT, DEF, isEscape, KING, legal, movesFrom, RULES, step, type Action, type State } from './engine';

const guards = new Map<number, [number, number][]>();
function GUARDS(n: number): [number, number][] {
  let g = guards.get(n);
  if (!g) {
    g = [];
    for (const [cx, cy] of [
      [0, 0],
      [n - 1, 0],
      [0, n - 1],
      [n - 1, n - 1],
    ]) {
      const sx = cx ? -1 : 1;
      const sy = cy ? -1 : 1;
      g.push([cx + sx, cy + 2 * sy], [cx + 2 * sx, cy + sy], [cx + sx, cy + sy]);
    }
    guards.set(n, g);
  }
  return g;
}

function defScore(s: State): number {
  if (s.over) return s.winner === 1 ? 10000 - s.ply : s.winner === 0 ? -10000 + s.ply : 0;
  const n = s.n;
  let att = 0;
  let def = 0;
  let k = -1;
  s.board.forEach((v, p) => {
    if (v === ATT) att++;
    else if (v === DEF) def++;
    else if (v === KING) k = p;
  });
  let v = def * 20 - att * 10;
  // заслоны у углов: нападающие на клетках, отрезающих угол
  if (RULES[s.cfg.kind].corners)
    for (const [x, y] of GUARDS(n)) if (s.board[y * n + x] === ATT) v -= 8;
  if (k >= 0) {
    const exits = movesFrom(s, k).filter((q) => isEscape(s, q)).length;
    if (exits) v += s.turn === 1 ? 5000 : exits >= 2 ? 3000 : 150;
    const kx = k % n;
    const ky = (k - kx) / n;
    const dist = RULES[s.cfg.kind].corners ? Math.min(kx, n - 1 - kx) + Math.min(ky, n - 1 - ky) : Math.min(kx, ky, n - 1 - kx, n - 1 - ky);
    v -= dist * 6;
    v += movesFrom(s, k).length * 2;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const x = kx + dx;
      const y = ky + dy;
      if (x >= 0 && y >= 0 && x < n && y < n && s.board[y * n + x] === ATT) v -= 18;
    }
  }
  return v;
}

const game: SearchGame<State, Action> = {
  moves: legal,
  play: (s, m) => step(s, m).state,
  side: (s) => s.turn,
  over: (s) => s.over,
  score: (s, me) => (me === 1 ? defScore(s) : -defScore(s)),
  order: (s, m) => (s.board[m.from] === KING ? 5 : 0),
};

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over || s.turn !== seat) return null;
  const depth = level <= 1 ? 1 : 2;
  return bestMove(game, s, depth, rng, level <= 0 ? 60 : level === 1 ? 10 : 0);
}
