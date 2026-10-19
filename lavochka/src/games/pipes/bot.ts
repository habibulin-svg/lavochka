/* «Водопроводчик» — боты. Решают сеть сами (по кускам, что видят), а крутят по одному куску за ход;
 * уровень — как часто бот что-то делает. Закреплённый неверно кусок бот сначала открепляет. */
import type { Rng } from '../../core/types';
import { boardOf, rotCW, type Action, type State } from './engine';
import { solve } from './solver';

const PACE = [0.25, 0.5, 0.85];
const cache = new Map<string, number[] | null>();

export function choose(v: State, seat: number, level: number, rng: Rng): Action {
  if (rng.next() >= PACE[Math.max(0, Math.min(2, level))]) return { type: 'think' };
  const b = v.boards[boardOf(v, seat)];
  const c = v.cfg;
  const key = `${c.w}:${c.wrap}:${c.cross}:${c.level}:${boardOf(v, seat)}`;
  let sol = cache.get(key);
  // решение должно подходить к нынешним кускам (повороты меняют кусок, но не его форму)
  if (sol === undefined || (sol && sol.some((t, i) => !sameShape(t, b.tile[i])))) {
    sol = solve(c, b.tile, v.src);
    if (cache.size > 20) cache.clear();
    cache.set(key, sol);
  }
  if (!sol) return { type: 'think' };
  const wrong = b.tile.map((t, i) => (t !== sol![i] ? i : -1)).filter((i) => i >= 0);
  if (!wrong.length) return { type: 'think' };
  const i = wrong[rng.int(wrong.length)];
  if (b.lock[i]) return { type: 'lock', i };
  // в какую сторону ближе
  return { type: 'rot', i, d: rotCW(rotCW(rotCW(b.tile[i]))) === sol[i] ? -1 : 1 };
}

function sameShape(a: number, b: number): boolean {
  let t = b;
  for (let k = 0; k < 4; k++) {
    if (t === a) return true;
    t = rotCW(t);
  }
  return false;
}
