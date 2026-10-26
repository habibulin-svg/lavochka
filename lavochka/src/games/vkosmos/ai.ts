/* «В космос» — боты. Знания (верный ответ на вопрос): 55 / 75 / 92 %. Маршрут: посадка — сразу; иначе ближе к нужной
 * планете с учётом того, куда она сдвинется; средний и сложный обходят дурные кружки (метеориты, связь, невесомость),
 * сложный ещё ищет хорошие (топливо, ускорение), бережёт топливо (ускоряется только для посадки) и считает планету на
 * два круга вперёд. */
import type { Rng } from '../../core/types';
import { BIG, distances, legal, rightOf, targets, type Action, type Planet, type State } from './engine';
import { NODES } from './map';

const SURE = [0.55, 0.75, 0.92];
const BAD: Record<number, number> = { 3: 3, 4: 2, 6: 4, 12: 2, 14: 3, 15: 2, 18: 3, 17: 1 };
const GOOD: Record<number, number> = { 1: 3, 2: 2, 5: 2, 7: 1, 10: 3, 13: 2, 19: 2 };

const DIST = new Map<number, number[]>();
const dist = (n: number) => {
  let d = DIST.get(n);
  if (!d) DIST.set(n, (d = distances(n)));
  return d;
};

export function choose(v: State, seat: number, level: number, rng: Rng): Action | null {
  const acts = legal(v, seat);
  if (!acts.length) return null;
  if (v.phase === 'question' && v.question) {
    const right = rightOf(v.question);
    if (rng.next() < (SURE[level] ?? 0.75) || right < 0) return { type: 'answer', i: Math.max(0, right) };
    const wrong = v.question.options.map((_, i) => i).filter((i) => i !== right);
    return { type: 'answer', i: wrong[rng.int(wrong.length)] };
  }
  if (v.phase === 'roll') return acts.find((a) => a.type === 'roll') ?? acts[0];
  const sh = v.ships[seat];
  const tg = targets(sh);
  const ahead = level >= 2 ? 2 : 1;
  /** Где будут нужные планеты через 0…ahead кругов. */
  const spots: number[] = tg.flatMap((pl: Planet) => Array.from({ length: ahead + 1 }, (_, k) => BIG[pl][(v.planets[pl] + k) % BIG[pl].length]));
  let best = 0;
  let bv = -Infinity;
  v.routes.forEach((r, i) => {
    const end = r.path[r.path.length - 1];
    let sc = 0;
    if (r.land) sc = 1000;
    else {
      const d = dist(end);
      sc = -Math.min(...spots.map((p) => d[p]));
      const inc = NODES[end].incident ?? 0;
      if (level >= 1) sc -= (BAD[inc] ?? 0) * 2;
      if (level >= 2) sc += (GOOD[inc] ?? 0) * 1.5;
      if (r.boost) sc -= level >= 2 ? 3 : 1;
    }
    sc += rng.next() * (level === 0 ? 8 : 0.5);
    if (sc > bv) {
      bv = sc;
      best = i;
    }
  });
  return { type: 'move', i: best };
}
