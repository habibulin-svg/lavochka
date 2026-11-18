/* Манкала — боты: перебор с отсечением (минимакс), оценка — разница взятого/домов.
 *   Лёгкий — на 1 ход вперёд, иногда случайно; Средний — 4 хода; Сложный — 7 ходов (в оваре — 6).
 *   В тогыз кумалаке ходов и камней больше — Средний 3, Сложный 5; в бао и катре (ход — лунка и направление,
 *   посев «реле» длинный) — Средний 2, Сложный 4; оценка там — разница камней на своих сторонах. */
import type { Rng } from '../../core/types';
import { actions, apply, isFour, type Action, type State } from './engine';

function search(s: State, me: number, depth: number, a: number, b: number): number {
  if (s.over || depth === 0) return s.store[me] - s.store[1 - me] + (s.over ? (s.winner === me ? 1000 : s.winner == null ? 0 : -1000) : 0);
  const moves = actions(s, s.turn);
  if (!moves.length) return s.store[me] - s.store[1 - me];
  const maxing = s.turn === me;
  let best = maxing ? -Infinity : Infinity;
  for (const p of moves) {
    const r = apply(s, s.turn, p)!;
    // повторный ход в калахе не тратит глубину
    const v = search(r.state, me, r.state.turn === s.turn ? depth : depth - 1, a, b);
    if (maxing) {
      best = Math.max(best, v);
      a = Math.max(a, v);
    } else {
      best = Math.min(best, v);
      b = Math.min(b, v);
    }
    if (b <= a) break;
  }
  return best;
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over || s.turn !== seat) return null;
  const moves = actions(s, seat);
  if (!moves.length) return null;
  if (level === 0 && rng.next() < 0.3) return moves[rng.int(moves.length)];
  const togyz = s.cfg.variant === 'togyz';
  const four = isFour(s.cfg.variant);
  const depth = level === 0 ? 1 : level === 1 ? (four ? 2 : togyz ? 3 : 4) : four ? 4 : togyz ? 5 : s.cfg.variant === 'oware' ? 6 : 7;
  let best = moves[0];
  let bv = -Infinity;
  for (const p of moves) {
    const r = apply(s, seat, p)!;
    const v = search(r.state, seat, r.state.turn === seat ? depth : depth - 1, -Infinity, Infinity) + rng.next() * 0.01;
    if (v > bv) {
      bv = v;
      best = p;
    }
  }
  return best;
}
