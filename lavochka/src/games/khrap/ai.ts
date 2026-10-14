/* Храп, Рамс, Горб — боты. Видят свою руку, открытый козырь и стол.
 *   Лёгкий — играет почти с любой рукой, ходит чем попало из допустимого;
 *   Средний — прикидывает, сколько взяток в руке, играет от одной уверенной; меняет мелочь; берёт взятку дешёвой бьющей картой;
 *   Сложный — ещё и смотрит на банк (большой — осторожнее), заказывает храп с почти верной рукой, берёт лапу с пустой рукой,
 *   в горбе после первой взятки не лезет. Последний говорящий, когда все спасовали, всегда играет — банк без игры. */
import type { Rng } from '../../core/types';
import type { Card, Suit } from '../../cards/deck';
import { bidOptions, legal, players, trickWinner, type Action, type Bid, type View } from './engine';

/** Сколько взяток примерно даст карта. */
function cardValue(c: Card, trump: Suit, n: number): number {
  const crowd = n <= 2 ? 1.25 : n === 3 ? 1 : 0.8;
  if (c.s === trump) return Math.min(1, ([0.25, 0.25, 0.3, 0.3, 0.35, 0.45, 0.6, 0.8, 0.95][c.r - 6] ?? 0.3) * crowd + 0.1);
  if (c.r === 14) return 0.7 * crowd;
  if (c.r === 13) return 0.35 * crowd;
  return 0.04;
}

export const handValue = (hand: Card[], trump: Suit, n: number) => hand.reduce((a, c) => a + cardValue(c, trump, n), 0);

function chooseBid(v: View, seat: number, level: number, rng: Rng): Bid {
  const opts = bidOptions(v, seat);
  const hand = v.hands[seat];
  const n = v.seats.length;
  const est = handValue(hand, v.trump, n);
  const unbid = v.seats.filter((p) => v.bids[p] == null && p !== seat).length;
  const anyPlay = v.seats.some((p) => v.bids[p] && v.bids[p] !== 'pass');
  // последний, все спасовали — банк без игры
  if (!unbid && !anyPlay) return 'play';
  if (level === 0) return est > 0.5 || rng.next() < 0.3 ? 'play' : 'pass';
  if (opts.includes('khrap') && est >= v.cfg.hand - (level === 2 ? 0.35 : 0.2) && hand.filter((c) => c.s === v.trump).length >= v.cfg.hand - 1) return 'khrap';
  const risk = level === 2 ? Math.min(0.4, v.bank / Math.max(10, v.chips[seat] * 2)) : 0;
  if (est >= 0.9 + risk) return 'play';
  if (opts.includes('widow') && est < 0.45 && level === 2 && rng.next() < 0.6) return 'widow';
  return 'pass';
}

function chooseSwap(v: View, seat: number, level: number): Card[] {
  const hand = v.hands[seat];
  const max = Math.min(v.cfg.exchange, v.deckCount);
  const n = players(v).length;
  const weak = hand
    .map((c) => ({ c, w: cardValue(c, v.trump, n) }))
    .filter((x) => x.w < (level === 0 ? 0.1 : 0.3))
    .sort((a, b) => a.w - b.w)
    .map((x) => x.c);
  return weak.slice(0, max);
}

function choosePlay(v: View, seat: number, level: number, rng: Rng): Card {
  const moves = legal(v, seat);
  if (moves.length === 1 || level === 0) return moves[rng.int(moves.length)];
  const T = v.trump;
  const rank = (c: Card) => (c.s === T ? 20 : 0) + c.r;
  const low = (cs: Card[]) => cs.slice().sort((a, b) => rank(a) - rank(b))[0];
  const high = (cs: Card[]) => cs.slice().sort((a, b) => rank(b) - rank(a))[0];
  // в горбе после первой взятки взятки не нужны (кроме попытки взять все)
  const want = v.cfg.mode !== 'gorb' || v.tricks[seat] === 0 || level < 2;
  if (!v.trick.length) {
    if (!want) return low(moves);
    const aces = moves.filter((c) => c.r === 14 && c.s !== T);
    if (aces.length) return aces[0];
    const trumps = moves.filter((c) => c.s === T);
    if (level === 2 && trumps.length >= 2) return high(trumps);
    return low(moves);
  }
  const winners = moves.filter((c) => trickWinner([...v.trick, { seat, card: c }], T) === seat);
  const last = v.trick.length === players(v).length - 1;
  if (want && winners.length) {
    // последним — самой дешёвой бьющей; не последним — бьём, если наверняка (туз/старший козырь) или взяток ещё нет
    const cheap = low(winners);
    if (last || v.tricks[seat] === 0 || cheap.r >= 13) return cheap;
  }
  return low(moves);
}

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (v.phase === 'over' || v.turn !== seat) return null;
  if (v.phase === 'bid') return { type: 'bid', bid: chooseBid(v, seat, level, rng) };
  if (v.phase === 'swap') return { type: 'swap', cards: chooseSwap(v, seat, level) };
  return { type: 'play', card: choosePlay(v, seat, level, rng) };
}
