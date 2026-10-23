/* Сенет — боты. Лёгкий ходит наугад (но выводит фишку, если может); средний — по оценке позиции после хода;
 * сложный — ещё и ожидание по всем броскам соперника. */
import type { Rng } from '../../core/types';
import { again, BEAUTY, legal, move, ODDS, OFF, SAFE, WATER, type Action, type State } from './engine';

export function evaluate(s: State, side: number): number {
  const one = (me: number) => {
    let v = s.off[me] * 40;
    for (let p = 1; p <= 30; p++) {
      if (s.board[p] !== me) continue;
      v += p;
      if (p >= BEAUTY && p !== WATER) v += 4;
      const pair = (p > 1 && s.board[p - 1] === me) || (p < 30 && s.board[p + 1] === me);
      if (pair) v += 1.5;
      else if (!SAFE.includes(p)) {
        // одиночку сзади могут сбить — потеря пути
        let risk = 0;
        for (let d = 1; d <= 5; d++) if (p - d >= 1 && s.board[p - d] === 1 - me) risk += ODDS[d];
        v -= Math.min(1, risk) * 3;
      }
    }
    // стена из трёх подряд мешает сопернику
    for (let p = 1; p <= 28; p++) if (s.board[p] === me && s.board[p + 1] === me && s.board[p + 2] === me) v += 2;
    return v;
  };
  return one(side) - one(1 - side);
}

function after(s: State, from: number, to: number): State {
  const n: State = { ...s, board: s.board.slice(), off: s.off.slice() };
  move(n, s.cur, from, to);
  n.phase = 'roll';
  if (!again(s.value)) n.cur = 1 - s.cur;
  return n;
}

/** Ожидание оценки для side по броску того, кто ходит в s. */
function chance(s: State, side: number): number {
  if (s.off[0] === s.cfg.pieces || s.off[1] === s.cfg.pieces) return evaluate(s, side);
  let sum = 0;
  for (let v = 1; v <= 5; v++) {
    const t: State = { ...s, value: v, phase: 'move' };
    const ms = legal(t);
    if (!ms.length) {
      sum += ODDS[v] * evaluate(s, side);
      continue;
    }
    let best = s.cur === side ? -Infinity : Infinity;
    for (const m of ms) {
      const e = evaluate(after(t, m.from, m.to), side);
      best = s.cur === side ? Math.max(best, e) : Math.min(best, e);
    }
    sum += ODDS[v] * best;
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
    const out = ms.filter((m) => m.to === OFF);
    const pool = out.length ? out : ms;
    return { type: 'move', from: pool[rng.int(pool.length)].from };
  }
  let best = ms[0];
  let bv = -Infinity;
  for (const m of ms) {
    const n = after(s, m.from, m.to);
    const v = (level === 1 ? evaluate(n, side) : chance(n, side)) + rng.next() * 0.01;
    if (v > bv) {
      bv = v;
      best = m;
    }
  }
  return { type: 'move', from: best.from };
}
