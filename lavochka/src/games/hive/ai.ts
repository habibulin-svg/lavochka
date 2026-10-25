/* Улей — боты: альфа-бета (core/minimax) с оценкой позиции.
 *   Лёгкий — на один ход с большим разбросом;
 *   Средний — на один ход;
 *   Сложный — на два полухода (видит ответ соперника: не подставляет пчелу).
 * Оценка: занятые соседи пчёл (своей — плохо, чужой — хорошо, чем ближе к шести, тем дороже), сколько фишек могут ходить
 * (не прижаты «одним ульем» и не под жуком), жук или комар на чужой пчеле, запас муравьёв. */
import type { Rng } from '../../core/types';
import { bestMove, type SearchGame } from '../../core/minimax';
import { apply, around, legal, pinned, queenAt, type Action, type State } from './engine';

const PRESS = [0, 2, 5, 10, 20, 45, 1000];

function freePieces(s: State, seat: number, pin: Set<string>): number {
  let n = 0;
  for (const k in s.cells) {
    const st = s.cells[k];
    const p = st[st.length - 1];
    if (p.o === seat && !pin.has(k)) n += p.b === 'A' ? 2 : p.b === 'Q' ? 0.5 : 1;
    // фишки, прижатые жуком сверху, — минус хозяину
    for (let i = 0; i < st.length - 1; i++) if (st[i].o === seat) n -= 1.5;
  }
  return n;
}

function score(s: State, me: number): number {
  const op = 1 - me;
  if (s.over) return s.winner === me ? 10000 - s.ply : s.winner == null ? -50 : -10000 + s.ply;
  const pin = pinned(s);
  let v = 0;
  for (const [seat, sign] of [
    [op, 1],
    [me, -1.15],
  ] as [number, number][]) {
    const q = queenAt(s, seat);
    if (!q) continue;
    const n = around(q).filter((x) => s.cells[x]).length;
    v += sign * PRESS[n];
    const st = s.cells[q];
    if (st.length > 1 && st[st.length - 1].o !== seat) v += sign * 12; // на пчеле сидит чужой
  }
  v += (freePieces(s, me, pin) - freePieces(s, op, pin)) * 1.2;
  v += (s.hand[me].A - s.hand[op].A) * 0.3;
  // пчела в запасе поздно — опасно, рано ставить её тоже не надо
  if (s.hand[me].Q && s.placed[me] >= 2) v -= 3;
  return v;
}

function near(s: State, a: Action): number {
  if (a.type === 'pass') return 0;
  const to = a.type === 'place' ? a.at : a.to;
  const q = queenAt(s, 1 - s.turn);
  if (!q) return a.type === 'place' ? 1 : 0;
  return around(q).includes(to) ? 3 : a.type === 'move' ? 1 : 0;
}

const game: SearchGame<State, Action> = {
  moves: (s) => legal(s),
  play: (s, m) => apply(s, m).state,
  side: (s) => s.turn,
  over: (s) => s.over,
  score,
  order: (s, m) => near(s, m),
};

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over || s.turn !== seat) return null;
  const ms = legal(s);
  if (ms.length === 1) return ms[0];
  // начало: ставим что-нибудь живое, без перебора
  if (s.ply < 2) {
    const pool = ms.filter((m) => m.type === 'place' && (m.bug === 'G' || m.bug === 'S' || m.bug === 'A' || m.bug === 'B'));
    const from = pool.length ? pool : ms;
    return from[rng.int(from.length)];
  }
  return bestMove(game, s, level === 2 ? 2 : 1, rng, level === 0 ? 40 : level === 1 ? 2 : 0);
}
