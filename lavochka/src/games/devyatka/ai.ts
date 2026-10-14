/* Девятка — боты. Видят свою руку и ряды на столе.
 *   Лёгкий — любая допустимая карта;
 *   Средний — ходит туда, где следующая по ряду карта тоже своя (цепочка);
 *   Сложный — ещё и «зажимает»: не развивает ряд, где дальше идут чужие карты, держит карты-связки до последнего. */
import type { Rng } from '../../core/types';
import type { Card } from '../../cards/deck';
import { baseRank, legal, lowRank, type Action, type View } from './engine';

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (v.over || v.turn !== seat) return null;
  const moves = legal(v, seat);
  if (!moves.length) return null;
  if (level === 0 || moves.length === 1) return { type: 'play', card: moves[rng.int(moves.length)] };
  const hand = v.hands[seat];
  const mine = (s: string, r: number) => hand.some((c) => c.s === s && c.r === r);
  const base = baseRank(v.cfg);
  const lo = lowRank(v.cfg);
  /** Сколько своих карт подряд откроет ход в направлении dir, и сколько чужих карт откроется за ними. */
  const run = (c: Card, dir: 1 | -1) => {
    let r = c.r + dir;
    let own = 0;
    while (r >= lo && r <= 14 && mine(c.s, r)) (own++, (r += dir));
    const open = r >= lo && r <= 14 ? 1 : 0;
    return { own, open };
  };
  const score = (c: Card) => {
    const dirs: (1 | -1)[] = c.r === base ? [1, -1] : c.r > base ? [1] : [-1];
    let own = 0;
    let open = 0;
    for (const d of dirs) {
      const x = run(c, d);
      own += x.own;
      open += x.open;
    }
    if (level === 1) return own * 2 - open * 0.5 + rng.next();
    // сложный: открывать соперникам дорогу — плохо, особенно новую масть, где у самого пусто
    const suitLeft = hand.filter((x) => x.s === c.s).length - 1;
    return own * 3 - open * 2 + (c.r === base && suitLeft === 0 ? -3 : 0) + rng.next() * 0.3;
  };
  const best = moves.map((c) => ({ c, v: score(c) })).sort((a, b) => b.v - a.v)[0];
  return { type: 'play', card: best.c };
}
