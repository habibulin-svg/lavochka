/* Чаупар и пачиси — боты. Видят всю доску (скрытого в игре нет).
 * Лёгкий — чаще всего случайный ход; средний — жадный (рубка, вход, замок, продвижение); сложный — ещё и бережёт фишки
 * от рубки: считает, сколько чужих фишек могут достать клетку одним броском. */
import type { Rng } from '../../core/types';
import { applyCMove, GOAL, isCastle, legalMoves, pairsOn, ringOf, type CAction, type CMove, type CState } from './engine';

/** Сколько чужих фишек стоят позади клетки g на расстоянии одного броска. */
function threat(s: CState, seat: number, g: number, reach: number[]): number {
  if (isCastle(g)) return 0;
  let n = 0;
  for (const pl of s.players) {
    if (pl.seat === seat || (pairsOn(s) && (pl.seat + 2) % 4 === seat)) continue;
    for (const p of pl.pieces) {
      const og = ringOf(pl.seat, p);
      if (og == null) continue;
      const dist = (g - og + 68) % 68;
      if (dist > 0 && reach.includes(dist)) n++;
    }
  }
  return n;
}

function score(s: CState, m: CMove, careful: boolean): number {
  const seat = s.players[s.cur].seat;
  const res = applyCMove(s, m)!;
  const ev = res.event as Extract<typeof res.event, { type: 'move' }>;
  let v = m.to - Math.max(m.from, 0);
  if (m.from < 0) v += 18;
  if (ev.captured.length) v += 30 + ev.captured.reduce((a, c) => a + c.from, 0) / 4;
  if (ev.home) v += 25;
  if (ev.castle) v += 6;
  if (ev.win) v += 1000;
  if (careful) {
    const reach = s.cfg.throws === 'pasa' ? [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12] : [2, 3, 4, 5, 6, 10, 25];
    const gTo = ringOf(seat, m.to);
    const gFrom = ringOf(seat, m.from);
    if (gTo != null) v -= threat(res.state, seat, gTo, reach) * (8 + m.to / 6);
    if (gFrom != null) v += threat(s, seat, gFrom, reach) * (6 + m.from / 6);
    if (m.to > 75 && m.to < GOAL) v += 4; // свой столбец — там не рубят
  }
  return v;
}

export function chooseC(s: CState, seat: number, level: number, rng: Rng): CAction | null {
  if (s.phase === 'over' || s.players[s.cur].seat !== seat) return null;
  if (s.phase === 'roll') return { type: 'roll' };
  const moves = legalMoves(s);
  if (!moves.length) return null;
  let best = moves[0];
  if (level <= 0 && rng.int(10) < 7) best = moves[rng.int(moves.length)];
  else {
    let bv = -Infinity;
    for (const m of moves) {
      const v = score(s, m, level >= 2) + rng.next() * (level >= 2 ? 0.5 : 3);
      if (v > bv) {
        bv = v;
        best = m;
      }
    }
  }
  return { type: 'move', piece: best.piece, die: best.die, to: best.to };
}
