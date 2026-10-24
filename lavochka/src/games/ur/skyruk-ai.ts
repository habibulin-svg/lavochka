/* Ур по Скирюку — боты. Лёгкий: наугад, но рубит и встаёт на «звезду», если видит; средний — по оценке позиции после хода;
 * сложный — ещё и ожидание по броскам соперника (у пирамидок 1 и 2 очка выпадают втрое чаще, чем 3 и 4). */
import type { Rng } from '../../core/types';
import { cellOf, DEPOT, EXIT, FINISH, SAFE, sapply, slegal, TETRA_ODDS, type SAction, type SState } from './skyruk';

const fixed = (v: number): Rng => ({ next: () => 0, int: () => 0, getState: () => v });

/** Оценка позиции для стороны side. */
export function sevaluate(s: SState, side: number): number {
  const one = (me: number) => {
    const opp = 1 - me;
    let v = 0;
    for (const x of s.pieces) {
      if (x.side !== me) continue;
      if (x.p === EXIT) {
        v += 30;
        continue;
      }
      if (x.p === 0) continue;
      v += x.p + (x.marked ? 2 : 0);
      const c = cellOf(me, x.p, x.loop);
      if (SAFE.includes(c) || c === DEPOT || (c === FINISH && x.marked)) {
        v += 2;
        continue;
      }
      // опасность: фишки соперника того же вида на 1–4 клетки сзади (на общем пути)
      if (x.p >= 5) {
        let risk = 0;
        for (const y of s.pieces) {
          if (y.side !== opp || y.p === 0 || y.p >= EXIT || y.marked !== x.marked) continue;
          for (let d = 1; d <= 4; d++) {
            if (y.p + d >= 5 && cellOf(opp, y.p + d, y.loop ?? x.loop) === c) risk += TETRA_ODDS[d];
          }
        }
        v -= Math.min(1, risk) * (x.p + 2) * 0.7;
      }
    }
    return v;
  };
  return one(side) - one(1 - side);
}

function afterMove(s: SState, a: SAction): SState | null {
  const r = sapply(s, s.seats[s.cur], a, fixed(0));
  return r ? r.state : null;
}

export function schoose(v: SState, level: number, rng: Rng): SAction | null {
  if (v.phase === 'start' || v.phase === 'roll') return { type: 'roll' };
  if (v.phase !== 'move') return null;
  const moves = slegal(v);
  if (!moves.length) return null;
  const side = v.cur;
  if (level === 0) {
    const good = moves.filter((m) => m.hit || m.star || m.to === EXIT);
    const list = good.length && rng.next() < 0.7 ? good : moves;
    return list[rng.int(list.length)].a;
  }
  let best = moves[0].a;
  let bs = -Infinity;
  for (const m of moves) {
    const n = afterMove(v, m.a);
    if (!n) continue;
    let sc: number;
    if (n.phase === 'over') sc = 1000;
    else if (level === 1 || n.cur === side) sc = sevaluate(n, side) + (n.cur === side ? 4 : 0);
    else {
      // ожидание по броску соперника: он выберет лучший для себя ход
      sc = 0;
      for (let d = 1; d <= 4; d++) {
        const t: SState = { ...n, phase: 'move', value: d, cells: n.cells, pieces: n.pieces };
        const opp = slegal(t);
        let worst = sevaluate(n, side);
        if (opp.length) {
          worst = Infinity;
          for (const om of opp) {
            const k = afterMove(t, om.a);
            if (!k) continue;
            const e = k.phase === 'over' ? -1000 : sevaluate(k, side);
            if (e < worst) worst = e;
          }
        }
        sc += TETRA_ODDS[d] * worst;
      }
    }
    sc += rng.next() * 0.01;
    if (sc > bs) {
      bs = sc;
      best = m.a;
    }
  }
  return best;
}

