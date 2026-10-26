/* Далдос — боты. Средний и сложный перебирают все розыгрыши броска целиком (обе кости, сложение) и оценивают позицию после хода:
 * фишки на доске (главное), надаленные фишки (им есть чем ходить). Сложный ещё считает, насколько его фишки под ударом:
 * вероятность, что соперник следующим броском встанет на фишку (таблица из en.wikipedia «Daldøs», «Probabilities»),
 * и немного — собственные угрозы. Лёгкий ходит наугад, но взятие замечает через раз. */
import type { Rng } from '../../core/types';
import { applyMove, legalMoves, next, type Action, type State } from './engine';

/** Вероятность встать на фишку, стоящую на d лунок впереди (одна фишка позади, без помех). */
const HIT = [0, 0.44, 0.5, 0.6, 0.67, 0.29, 0.23, 0.14, 0.08];

/** Насколько фишки места seat под ударом соперника (сумма вероятностей потерять каждую). */
function danger(s: State, seat: number): number {
  const opp = 1 - seat;
  const risk = new Map<number, number>();
  s.board.forEach((p, from) => {
    if (!p || p.seat !== opp) return;
    let c = from;
    for (let d = 1; d <= 8; d++) {
      c = next(s.cfg, opp, c);
      const q = s.board[c];
      if (!q) continue;
      if (q.seat === opp) break; // своя фишка соперника дальше не пустит
      const pr = p.dal ? HIT[d] : d === 1 ? 0.44 : d <= 5 ? 0.12 : 0;
      risk.set(c, 1 - (1 - (risk.get(c) ?? 0)) * (1 - pr));
    }
  });
  let sum = 0;
  for (const v of risk.values()) sum += v;
  return sum;
}

function score(s: State, me: number, careful: boolean): number {
  const opp = 1 - me;
  if (s.phase === 'over') return s.winner === me ? 1e6 : s.winner == null ? 0 : -1e6;
  let dal = 0;
  for (const p of s.board) if (p && p.dal) dal += p.seat === me ? 1 : -1;
  let v = (s.count[me] - s.count[opp]) * 100 + dal * 7;
  if (careful) {
    // чей сейчас бросок — тот и бьёт первым
    const myTurn = s.turn === me;
    v -= danger(s, me) * 100 * (myTurn ? 0.35 : 0.85);
    v += danger(s, opp) * 100 * (myTurn ? 0.6 : 0.25);
  }
  return v;
}

/** Все розыгрыши броска: последовательности ходов до конца хода. */
function plays(s: State, me: number): { acts: Action[]; st: State }[] {
  const out: { acts: Action[]; st: State }[] = [];
  const rec = (st: State, acts: Action[]) => {
    const ms = st.phase === 'move' && st.turn === me && acts.length < 2 ? legalMoves(st) : [];
    if (!ms.length) {
      out.push({ acts, st });
      return;
    }
    for (const m of ms) {
      const a: Action = { type: 'move', from: m.from, to: m.to, use: m.use };
      const r = applyMove(st, a as Action & { type: 'move' });
      if (r) rec(r.state, [...acts, a]);
    }
  };
  rec(s, []);
  return out;
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.phase === 'over' || s.turn !== seat) return null;
  if (s.phase === 'roll') return { type: 'roll' };
  const ms = legalMoves(s);
  if (!ms.length) return null;
  if (level <= 0) {
    const takes = ms.filter((m) => m.took.length);
    const pool = takes.length && rng.next() < 0.5 ? takes : ms;
    const m = pool[rng.int(pool.length)];
    return { type: 'move', from: m.from, to: m.to, use: m.use };
  }
  const careful = level >= 2;
  let best: Action | null = null;
  let bv = -Infinity;
  for (const p of plays(s, seat)) {
    if (!p.acts.length) continue;
    const v = score(p.st, seat, careful) + rng.next() * (careful ? 0.5 : 6);
    if (v > bv) {
      bv = v;
      best = p.acts[0];
    }
  }
  return best;
}
