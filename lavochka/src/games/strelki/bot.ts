/* «Стрелки» — боты. Видят поле целиком (оно открытое), но «замечают» свободную стрелку не всегда:
 * лёгкий часто тычет наугад и теряет сердца, средний ошибается изредка, сложный — почти никогда. Уровень ещё и темп. */
import type { Rng } from '../../core/types';
import { boardOf, freeArrows, type Action, type State } from './engine';

const PACE = [0.3, 0.5, 0.8];
/** Вероятность увидеть свободную стрелку (иначе — тычок в случайную). */
const SHARP = [0.6, 0.88, 0.99];

export function choose(v: State, seat: number, level: number, rng: Rng): Action {
  const L = Math.max(0, Math.min(2, level));
  if (rng.next() >= PACE[L]) return { type: 'think' };
  const b = v.boards[boardOf(v, seat)];
  if (b.done || b.failed) return { type: 'think' };
  const alive = v.arrows.map((_, k) => k).filter((k) => !b.gone[k]);
  if (!alive.length) return { type: 'think' };
  // последнее сердце бережём: на нём бот осторожнее
  const sharp = b.lives === 1 ? Math.max(SHARP[L], 0.95) : SHARP[L];
  if (rng.next() < sharp) {
    const free = freeArrows(v, b.gone);
    if (free.length) return { type: 'tap', a: free[rng.int(free.length)] };
  }
  return { type: 'tap', a: alive[rng.int(alive.length)] };
}
