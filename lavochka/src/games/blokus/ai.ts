/* Блоки — боты: оценка каждого хода без перебора вглубь (ходов сотни, глубина не окупается).
 *   Лёгкий — крупная фигурка куда попало (из пяти лучших по размеру — наугад);
 *   Средний — размер фигурки + сколько новых своих уголков открывает + рост к центру в начале;
 *   Сложный — ещё и подвижность: сколько ходов останется у своего цвета и сколько отнято у соперников.
 * Лучшие по быстрой оценке (12, у сложного 24) пересчитываются точно — по позиции после хода. */
import type { Rng } from '../../core/types';
import { anchors, apply, color, legal, moves, ownerOf, PIECE_SIZE, type Action, type State } from './engine';

/** Предел подсчёта ходов (иначе в начале партии их тысячи). */
const CAP = 400;

function quick(s: State, a: Extract<Action, { type: 'place' }>, early: boolean): number {
  const n = s.cfg.n;
  let v = PIECE_SIZE[a.piece] * 10;
  if (early) {
    // к центру: средняя близость клеток фигурки
    const mid = (n - 1) / 2;
    let d = 0;
    for (const c of a.cells) d += Math.abs(Math.floor(c / n) - mid) + Math.abs((c % n) - mid);
    v -= (d / a.cells.length) * 2.2;
  }
  return v;
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over) return null;
  const ms = legal(s);
  if (ms.length === 1 || ms[0].type === 'pass') return ms[0];
  const col = color(s);
  const early = s.hand[col].length > 14;
  const places = ms as Extract<Action, { type: 'place' }>[];
  if (level === 0) {
    const big = Math.max(...places.map((m) => PIECE_SIZE[m.piece]));
    const pool = places.filter((m) => PIECE_SIZE[m.piece] >= big - 1);
    return pool[rng.int(pool.length)];
  }
  const ranked = places.map((m) => ({ m, v: quick(s, m, early) + rng.next() * 0.5 })).sort((a, b) => b.v - a.v);
  const top = ranked.slice(0, level === 2 ? 24 : 12);
  const rivals = s.cfg.colors.filter((c) => c !== col && !s.out[c] && ownerOf(s, c) !== seat);
  const before = level === 2 ? rivals.map((c) => moves(s, c, CAP).length) : [];
  const mine0 = anchors(s, col).length;
  let best = top[0].m;
  let bv = -Infinity;
  for (const { m, v } of top) {
    const t = apply(s, m).state;
    let val = v + (anchors(t, col).length - mine0) * 3;
    if (level === 2) {
      // подвижность: сколько ходов останется своим и сколько отнято у соперников
      val += Math.min(moves(t, col, CAP).length, CAP) * 0.15;
      rivals.forEach((c, i) => (val += (before[i] - moves(t, c, CAP).length) * 0.12));
    }
    if (val > bv) (bv = val), (best = m);
  }
  return best;
}
