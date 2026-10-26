/* Петтейя и латрункули — боты. Оценка: фишки (дукс по Беллу — за три), «подставленные» фишки — враг рядом,
 * а клетка напротив пуста (одним ходом зажмут), фишки у своих (вдвоём не берут), выход из своего ряда, простор дукса у Ковальского.
 * В расстановке — та же оценка на один ход вперёд: ставить рядом со своими, не подставляясь.
 *   Лёгкий — на 1 полуход с большим шумом; Средний — на 2 с малым; Сложный — на 3, когда ходов немного, иначе на 2 без шума. */
import { bestMove, type SearchGame } from '../../core/minimax';
import type { Rng } from '../../core/types';
import { at, DUX, isDux, legal, rulesOf, sideOf, step, type Action, type State } from './engine';

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Оценка для места 0. */
function score0(s: State): number {
  if (s.over) return s.winner === 0 ? 10000 - s.ply : s.winner === 1 ? -10000 + s.ply : 0;
  const R = rulesOf(s);
  let v = 0;
  const w = s.w;
  for (let p = 0; p < s.board.length; p++) {
    const pc = s.board[p];
    if (!pc) continue;
    const me = sideOf(pc);
    const sg = me === 0 ? 1 : -1;
    v += sg * (isDux(pc) ? (R.duxImmune ? 0 : 30) : 10);
    if (R.duxImmune && isDux(pc)) continue;
    const x = p % w;
    const y = (p - x) / w;
    let friends = 0;
    for (const [dx, dy] of DIRS) {
      const q = at(s, x + dx, y + dy);
      if (q < 0) continue;
      const o = s.board[q];
      if (sideOf(o) === me) friends++;
      else if (o && !(R.duxImmune && isDux(o))) {
        // враг рядом — опасно, если напротив пусто
        const r = at(s, x - dx, y - dy);
        if (r >= 0 && !s.board[r]) v -= sg * (s.turn === me ? 2 : 6);
      }
    }
    v += sg * Math.min(friends, 1);
    // выход вперёд: войско, стоящее в своём ряду, никого не зажмёт
    if (s.phase === 'play') v += sg * Math.min(me === 0 ? s.h - 1 - y : y, 3) * 0.6;
  }
  if (R.duxImmune)
    for (const seat of [0, 1]) {
      const p = s.board.indexOf(DUX[seat]);
      if (p < 0) continue;
      const x = p % w;
      const y = (p - x) / w;
      let free = 0;
      for (const [dx, dy] of DIRS) {
        const q = at(s, x + dx, y + dy);
        if (q >= 0 && !s.board[q]) free++;
      }
      v += (seat === 0 ? 1 : -1) * (free <= 1 ? -12 : free);
    }
  return v;
}

/** Ход, ставший рядом с чужой фишкой, — первым (там взятия). */
function order(s: State, m: Action): number {
  if (m.type !== 'move') return 0;
  const x = m.to % s.w;
  const y = (m.to - x) / s.w;
  let n = 0;
  for (const [dx, dy] of DIRS) {
    const q = at(s, x + dx, y + dy);
    if (q >= 0 && sideOf(s.board[q]) === 1 - s.turn) n++;
  }
  return n;
}

const game: SearchGame<State, Action> = {
  moves: legal,
  play: (s, m) => step(s, m).state,
  side: (s) => s.turn,
  over: (s) => s.over,
  score: (s, me) => (me === 0 ? score0(s) : -score0(s)),
  order,
};

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over || s.turn !== seat) return null;
  if (s.phase === 'place') return bestMove(game, s, 1, rng, level <= 0 ? 12 : level === 1 ? 4 : 1);
  // на три полухода — только когда ходов немного (в начале петтейи их 48, у Ковальского — за сотню)
  const depth = level <= 0 ? 1 : level === 1 ? 2 : legal(s).length <= 36 ? 3 : 2;
  return bestMove(game, s, depth, rng, level <= 0 ? 25 : level === 1 ? 4 : 0);
}
