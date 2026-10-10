/* 101 — боты. Видят свою руку, верх сброса и сколько карт у остальных.
 *   Лёгкий — кладёт любую подходящую карту, даму — на любую масть;
 *   Средний — сбрасывает дорогие карты, придерживает дам, наказывает следующего семёркой и пиковым королём;
 *   Сложный — ещё и кончает на даме (минус 20), бьёт спецкартами того, у кого мало карт, заказывает свою длинную масть. */
import type { Rng } from '../../core/types';
import type { Card, Suit } from '../../cards/deck';
import { handCount, nextOf, playable, POINTS, stockLeft, type Action, type State } from './engine';

const SUITS: Suit[] = ['S', 'C', 'D', 'H'];

function bestSuit(hand: Card[], exclude?: Card): Suit {
  const cnt = new Map<Suit, number>();
  for (const c of hand) if (c !== exclude && c.r !== 12) cnt.set(c.s, (cnt.get(c.s) ?? 0) + 1 + POINTS(c) / 20);
  let best: Suit = 'H';
  let v = -1;
  for (const s of SUITS)
    if ((cnt.get(s) ?? 0) > v) {
      v = cnt.get(s) ?? 0;
      best = s;
    }
  return best;
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.phase === 'over' || s.turn !== seat) return null;
  const hand = s.hands[seat];
  const can = playable(s, hand);
  if (!can.length) {
    const canDraw = stockLeft(s) > 0 || s.pile.length > 1;
    if (canDraw && !(s.cfg.drawOne && s.drew && !s.cover)) return { type: 'draw' };
    return { type: 'pass' };
  }
  const play = (c: Card): Action => (c.r === 12 ? { type: 'play', card: c, suit: level === 0 ? SUITS[rng.int(4)] : bestSuit(hand, c) } : { type: 'play', card: c });
  if (level === 0) return play(can[rng.int(can.length)]);
  const next = nextOf(s, seat);
  const nextLeft = handCount(s, next);
  const scored = can.map((c) => {
    let v = POINTS(c);
    // даму бережём на потом: ею можно закончить и сменить масть
    if (c.r === 12) v -= level === 2 ? 14 : 8;
    // наказания следующему — особенно если у него мало карт
    const hurt = c.r === 7 ? 2 : c.r === 8 ? 1 : c.r === 13 && c.s === 'S' ? 4 : c.r === 14 ? 0.5 : 0;
    v += hurt * (level === 2 && nextLeft <= 2 ? 6 : 3);
    // шестёрку кладём, только если есть чем покрыть
    if (c.r === 6) {
      const rest = hand.filter((x) => x !== c);
      v += rest.some((x) => x.s === c.s || x.r === 6 || x.r === 12) ? 2 : -12;
    }
    // сложный: последней картой — дама (минус 20 себе)
    if (level === 2 && hand.length === 2 && hand.some((x) => x.r === 12) && c.r !== 12) v += 10;
    if (level === 2 && hand.length === 1 && c.r === 12) v += 30;
    return { c, v: v + rng.next() };
  });
  scored.sort((a, b) => b.v - a.v);
  return play(scored[0].c);
}
