/* Королевская игра Ура — боты. Лёгкий ходит наугад, но берёт и встаёт на розетку, если видит; средний — по оценке позиции
 * после хода; сложный — ожидание по всем броскам соперника (expectimax в полтора хода). */
import type { Rng } from '../../core/types';
import { HOME, legal, odds, ROSETTES, SHARED, type Action, type State } from './engine';

/** Оценка позиции для стороны side: путь, розетки, опасность от фишек соперника сзади. */
export function evaluate(s: State, side: number): number {
  const pr = odds(s.cfg.dice);
  const one = (me: number) => {
    const opp = 1 - me;
    let v = 0;
    for (const p of s.pos[me]) {
      if (p === HOME) v += 20;
      else if (p > 0) v += p + 1;
      if (p === 8 && s.cfg.safe) v += 3;
      if (p === 4 || p === 14) v += 0.5;
      if (SHARED(p) && !(p === 8 && s.cfg.safe)) {
        // шанс, что фишку побьют следующим броском
        let risk = 0;
        for (const q of new Set(s.pos[opp])) {
          const d = p - q;
          if (q < p && d <= s.cfg.dice && d > 0 && (q === 0 ? p <= 4 : true)) risk += pr[d] ?? 0;
        }
        v -= Math.min(1, risk) * (p + 1) * 0.8;
      }
    }
    return v;
  };
  return one(side) - one(1 - side) + (s.cfg.stakes ? (s.tokens[side] - s.tokens[1 - side]) * 0.5 : 0);
}

function after(s: State, from: number, to: number): State {
  const n: State = { ...s, pos: [s.pos[0].slice(), s.pos[1].slice()], tokens: s.tokens.slice() };
  const side = s.cur;
  n.pos[side][n.pos[side].indexOf(from)] = to;
  if (to < HOME && SHARED(to)) {
    const j = n.pos[1 - side].indexOf(to);
    if (j >= 0) n.pos[1 - side][j] = 0;
  }
  if (ROSETTES.includes(to)) n.phase = 'roll';
  else {
    n.cur = 1 - side;
    n.phase = 'roll';
  }
  return n;
}

/** Ожидаемая оценка для side, когда в позиции s бросать стороне s.cur; depth — сколько ещё ходов досчитывать. */
function chance(s: State, side: number, depth: number): number {
  if (s.pos[0].every((p) => p === HOME) || s.pos[1].every((p) => p === HOME) || depth <= 0) return evaluate(s, side);
  const pr = odds(s.cfg.dice);
  let sum = 0;
  for (let v = 0; v < pr.length; v++) {
    const t: State = { ...s, value: v, phase: 'move' };
    const ms = legal(t);
    if (!ms.length) {
      sum += pr[v] * evaluate({ ...s, cur: 1 - s.cur }, side);
      continue;
    }
    let best = s.cur === side ? -Infinity : Infinity;
    for (const m of ms) {
      const e = evaluate(after(t, m.from, m.to), side);
      best = s.cur === side ? Math.max(best, e) : Math.min(best, e);
    }
    sum += pr[v] * best;
  }
  return sum;
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.phase === 'over' || s.seats[s.cur] !== seat) return null;
  if (s.phase === 'roll') return { type: 'roll' };
  const ms = legal(s);
  if (!ms.length) return null;
  const side = s.cur;
  if (level <= 0) {
    const good = ms.filter((m) => ROSETTES.includes(m.to) || (SHARED(m.to) && s.pos[1 - side].includes(m.to)));
    const pool = good.length && rng.next() < 0.6 ? good : ms;
    return { type: 'move', from: pool[rng.int(pool.length)].from };
  }
  let best = ms[0];
  let bv = -Infinity;
  for (const m of ms) {
    const n = after(s, m.from, m.to);
    const v = (level === 1 ? evaluate(n, side) : chance(n, side, 1)) + rng.next() * 0.01;
    if (v > bv) {
      bv = v;
      best = m;
    }
  }
  return { type: 'move', from: best.from };
}
