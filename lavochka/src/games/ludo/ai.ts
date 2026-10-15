/* Людо и парчис — боты: оценка каждого хода (рубка, центр, выход, безопасная клетка, угроза сзади, продвижение).
 *   Лёгкий — часто ходит наугад; Средний — по оценке без учёта угроз; Сложный — с угрозами (чужие фишки в 1–6/7 клетках сзади). */
import type { Rng } from '../../core/types';
import { cellOf, goalOf, isSafe, legalMoves, type LAction, type LMove, type LState } from './engine';

/** Сколько чужих фишек могут достать клетку одним броском. */
function threat(s: LState, seat: number, cell: number): number {
  const k = s.cfg.kind;
  const N = k === 'ludo' ? 52 : 68;
  const reach = k === 'ludo' ? 6 : 7;
  let n = 0;
  for (const o of s.seats) {
    if (o === seat) continue;
    for (const p of s.pieces[o]) {
      const c = cellOf(k, o, p);
      if (c == null) continue;
      const d = (cell - c + N) % N;
      if (d >= 1 && d <= reach) n++;
    }
  }
  return n;
}

function score(s: LState, seat: number, m: LMove, careful: boolean): number {
  const k = s.cfg.kind;
  const goal = goalOf(k);
  let v = m.steps * 0.6;
  if (m.from === -1) v += 30;
  if (m.to === goal) v += 45;
  const to = cellOf(k, seat, m.to);
  const from = cellOf(k, seat, m.from);
  if (to != null) {
    const victims = s.seats.filter((o) => o !== seat).flatMap((o) => s.pieces[o].map((p) => cellOf(k, o, p)).filter((c) => c === to));
    if (victims.length && !isSafe(k, to)) v += 60;
    if (isSafe(k, to)) v += 12;
    if (careful && !isSafe(k, to)) v -= threat(s, seat, to) * 18;
  } else if (m.to > (k === 'ludo' ? 50 : 63)) v += 20; // в коридоре не срубят
  if (careful && from != null && !isSafe(k, from)) v += threat(s, seat, from) * 14;
  // не тянуть отставших: передняя фишка ближе к дому ценнее
  v += (m.from / goal) * 4;
  return v;
}

export function chooseL(s: LState, seat: number, level: number, rng: Rng): LAction | null {
  if (s.phase === 'over' || s.seats[s.cur] !== seat) return null;
  if (s.phase === 'roll') return { type: 'roll' };
  const moves = legalMoves(s);
  if (!moves.length) return null;
  if (level === 0 && rng.next() < 0.45) return { type: 'move', piece: moves[rng.int(moves.length)].piece };
  let best = moves[0];
  let bv = -Infinity;
  for (const m of moves) {
    const v = score(s, seat, m, level >= 2) + rng.next() * (level === 0 ? 8 : 0.5);
    if (v > bv) {
      bv = v;
      best = m;
    }
  }
  return { type: 'move', piece: best.piece };
}
