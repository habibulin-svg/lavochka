/* Верю — не верю — боты. Видят свою руку, размер стопки, заявленный ранг, кто сколько положил, сброшенные четвёрки.
 *   Лёгкий — заходит честно чем попало, проверяет наугад;
 *   Средний — считает: своих карт ранга + заявлено больше четырёх — точно враньё; заходит честно самым частым рангом;
 *   Сложный — ещё и подмешивает к правде одну ненужную карту, на маленькой стопке рискует, на большой — проверяет
 *   при малейшем подозрении, ловит «выход» соперника последними картами. */
import type { Rng } from '../../core/types';
import type { Card } from '../../cards/deck';
import { claimed, countOf, pileOf, type Action, type View } from './engine';

const byRank = (hand: Card[]) => {
  const m = new Map<number, Card[]>();
  for (const c of hand) m.set(c.r, [...(m.get(c.r) ?? []), c]);
  return m;
};

/** Самые «ненужные» карты: из рангов, которых на руке меньше всего. */
function junk(hand: Card[], not: number | null, k: number): Card[] {
  const m = byRank(hand);
  return hand
    .filter((c) => c.r !== not)
    .sort((a, b) => m.get(a.r)!.length - m.get(b.r)!.length || a.r - b.r)
    .slice(0, k);
}

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (v.loser != null || v.turn !== seat) return null;
  const hand = v.hands[seat];
  const groups = byRank(hand);

  // заход
  if (v.rank == null) {
    const best = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || rng.next() - 0.5)[0];
    if (level === 0) {
      const g = [...groups.values()][rng.int(groups.size)];
      return { type: 'lead', cards: g.slice(0, 4), rank: g[0].r };
    }
    const cards = best[1].slice(0, 4);
    // сложный: к честным картам — одна лишняя, пока стопка маленькая и рука большая
    if (level === 2 && cards.length < 4 && hand.length > 4 && rng.next() < 0.5) cards.push(...junk(hand, best[0], 1));
    return { type: 'lead', cards, rank: best[0] };
  }

  const r = v.rank;
  const mine = groups.get(r) ?? [];
  const last = v.last!;
  const lastN = v.plays[v.plays.length - 1]?.n ?? 1;
  const total = claimed(v);
  // сколько карт этого ранга вообще может лежать в стопке
  const room = v.quads.includes(r) ? 0 : 4 - mine.length;
  const pile = pileOf(v);
  const lastOut = countOf(v, last.seat) === 0;

  let pLie: number;
  if (lastN > room) pLie = 1;
  else if (total > room) pLie = 0.85;
  else pLie = Math.min(0.9, 0.15 + (total / Math.max(1, room)) * 0.35 + (lastN >= 3 ? 0.15 : 0));
  if (lastOut) pLie += 0.2;

  const check = (): Action => ({ type: 'check', index: rng.int(lastN) });
  if (level === 0) {
    if (lastN > room || rng.next() < 0.25) return check();
  } else {
    // большая стопка — дороже ошибиться, но и отпускать её дальше опасно; сложный считает размер
    const bar = level === 2 ? (pile > 8 ? 0.45 : 0.6) : 0.6;
    if (pLie >= 1 || pLie > bar + rng.next() * 0.15) return check();
  }

  if (v.cfg.noAdd) return { type: 'believe' };
  // доложить: честно, если есть; иначе — врать одной ненужной картой (или проверять, если врать страшно)
  if (mine.length) {
    const n = level === 0 ? 1 + rng.int(mine.length) : mine.length;
    return { type: 'add', cards: mine.slice(0, n) };
  }
  if (!hand.length) return check();
  if (level >= 1 && pile > 10 && pLie > 0.4) return check();
  return { type: 'add', cards: junk(hand, r, 1) };
}
