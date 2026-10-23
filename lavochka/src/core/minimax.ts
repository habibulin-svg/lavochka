/* Перебор с альфа-бета отсечением для ботов абстрактных игр (Баг-Чал, мельница, крест, тафл). Без DOM.
 * Игра даёт ходы, применение хода, кто ходит и оценку позиции с точки зрения места me. */
import type { Rng } from './types';

export interface SearchGame<P, M> {
  moves(p: P): M[];
  play(p: P, m: M): P;
  /** Чей ход (место). */
  side(p: P): number;
  /** Конец партии. */
  over(p: P): boolean;
  /** Оценка для места me: больше — лучше. На конце партии — большие числа (±10000). */
  score(p: P, me: number): number;
  /** Порядок ходов для лучших отсечений (по желанию): больше — раньше. */
  order?(p: P, m: M): number;
}

/** Предел узлов на одно решение, чтобы бот не думал вечно. */
const NODE_CAP = 80000;

function search<P, M>(g: SearchGame<P, M>, p: P, depth: number, alpha: number, beta: number, me: number, cnt: { n: number }): number {
  cnt.n++;
  if (depth <= 0 || g.over(p) || cnt.n > NODE_CAP) return g.score(p, me);
  const ms = g.moves(p);
  if (!ms.length) return g.score(p, me);
  if (g.order) ms.sort((a, b) => g.order!(p, b) - g.order!(p, a));
  const maxi = g.side(p) === me;
  let best = maxi ? -Infinity : Infinity;
  for (const m of ms) {
    const v = search(g, g.play(p, m), depth - 1, alpha, beta, me, cnt);
    if (maxi) {
      if (v > best) best = v;
      if (best > alpha) alpha = best;
    } else {
      if (v < best) best = v;
      if (best < beta) beta = best;
    }
    if (alpha >= beta) break;
  }
  return best;
}

/** Лучший ход на глубину depth (полуходов) — итеративно: уровень, не успевший досчитаться до предела узлов, отбрасывается,
 * и берётся результат предыдущего (иначе часть ходов оценилась бы без просмотра). noise — разброс оценки для слабых ботов;
 * среди равных — случайный. */
export function bestMove<P, M>(g: SearchGame<P, M>, p: P, depth: number, rng: Rng, noise = 0): M | null {
  const ms = g.moves(p);
  if (!ms.length) return null;
  if (ms.length === 1) return ms[0];
  const me = g.side(p);
  if (g.order) ms.sort((a, b) => g.order!(p, b) - g.order!(p, a));
  const jitter = ms.map(() => (noise ? (rng.next() - 0.5) * noise : 0));
  let result: M[] = [ms[0]];
  for (let d = 1; d <= depth; d++) {
    const cnt = { n: 0 };
    const vals: number[] = [];
    for (const m of ms) vals.push(search(g, g.play(p, m), d - 1, -Infinity, Infinity, me, cnt));
    if (cnt.n > NODE_CAP && d > 1) break;
    let bestV = -Infinity;
    let best: M[] = [];
    vals.forEach((v0, i) => {
      const v = v0 + jitter[i];
      if (v > bestV + 1e-9) {
        bestV = v;
        best = [ms[i]];
      } else if (Math.abs(v - bestV) <= 1e-9) best.push(ms[i]);
    });
    result = best;
    if (bestV >= 9000) break; // выигрыш найден
  }
  return result[rng.int(result.length)];
}
