/* Шен — боты. Ход один, выбор — какой фишкой пойти. Средний оценивает позицию после хода: фишки в игре (главное), продвижение,
 * близость передней фишки к шену, право на вывод новой. Сложный ещё смотрит на шаг вперёд: перебирает свой следующий бросок
 * (с вероятностями палочек) — так он не ставит фишку на хвост «змейки» и держит передней точный заход в шен.
 * Лёгкий ходит наугад, но вход в шен замечает через раз. */
import type { Rng } from '../../core/types';
import { PROB, SHEN, alive, applyMove, applyRoll, legalMoves, type State } from './engine';

/** Позиция с точки зрения места me. */
function evalSide(s: State, me: number): number {
  const c = s.cfg;
  const pegs = s.pegs[me];
  let v = 0;
  if (c.mode === 'shen') {
    v += alive(s, me) * 120;
    v += pegs.length * 6 + Math.min(s.rights[me], s.hand[me]) * 5;
  } else v += s.home[me] * 45;
  for (const h of pegs) {
    v += h * 1.2;
    const d = SHEN - h;
    if (d >= 1 && d <= 5) v += PROB[d] * (c.mode === 'shen' ? 40 : 14);
  }
  return v;
}

function evaluate(s: State, me: number): number {
  if (s.phase === 'over') return s.winner === me ? 1e6 : s.winner == null ? 0 : -1e6;
  return evalSide(s, me) - evalSide(s, 1 - me);
}

/** Ожидание после хода: если ход снова наш (нефер) — лучший следующий ход по всем броскам, иначе — оценка. */
function lookahead(s: State, me: number, depth: number): number {
  if (s.phase === 'over' || depth <= 0) return evaluate(s, me);
  let sum = 0;
  for (let v = 1; v <= 5; v++) {
    const sticks = v === 5 ? [0, 0, 0, 0] : [0, 1, 2, 3].map((i) => (i < v ? 1 : 0));
    const r = applyRoll(s, sticks).state;
    let best: number;
    if (r.phase !== 'move') best = evaluate(r, me);
    else {
      const mine = r.turn === me;
      best = mine ? -Infinity : Infinity;
      for (const m of legalMoves(r)) {
        const n = applyMove(r, m.from);
        if (!n) continue;
        const x = evaluate(n.state, me);
        best = mine ? Math.max(best, x) : Math.min(best, x);
      }
    }
    sum += PROB[v] * best;
  }
  return sum;
}

export function choose(s: State, seat: number, level: number, rng: Rng): { type: 'roll' } | { type: 'move'; from: number } | null {
  if (s.phase === 'over' || s.turn !== seat) return null;
  if (s.phase === 'roll') return { type: 'roll' };
  const ms = legalMoves(s);
  if (!ms.length) return null;
  if (level <= 0) {
    const shen = ms.filter((m) => m.to === SHEN);
    const pool = shen.length && rng.next() < 0.5 ? shen : ms;
    return { type: 'move', from: pool[rng.int(pool.length)].from };
  }
  let best = ms[0].from;
  let bv = -Infinity;
  for (const m of ms) {
    const r = applyMove(s, m.from);
    if (!r) continue;
    let v = level >= 2 ? lookahead(r.state, seat, 1) : evaluate(r.state, seat);
    // средний не видит, куда ведёт «змейка» назад, — путает конец перехода с обычной лункой
    if (level === 1 && m.to < m.land) v += (m.land - m.to) * 1.2;
    v += rng.next() * (level >= 2 ? 0.3 : 3);
    if (v > bv) {
      bv = v;
      best = m.from;
    }
  }
  return { type: 'move', from: best };
}
