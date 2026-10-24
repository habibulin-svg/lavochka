/* Деберц, клабор и белот — боты. Видят свою руку, открытую карту, взятки на столе и сыгранные карты.
 *   Лёгкий — торгуется наугад по числу козырей, ходит любой допустимой картой;
 *   Средний — оценивает руку (валет и девятка козыря, тузы), берёт взятку дёшево, когда на столе очки, сносит пустое,
 *             «смазывает» напарнику, заходит тузами;
 *   Сложный — торгуется так же, а в розыгрыше перебирает свои ходы на разыгранных раскладах (чужие руки — наугад
 *             из невидимых карт), доигрывая сдачу средними ботами. */
import type { Rng } from '../../core/types';
import { SeededRng } from '../../core/rng';
import { makeDeck, sameCard, SUITS, type Card, type Suit } from '../../cards/deck';
import { apply, canSwap, legal, pairs, points, power, teamOf, trickWinner, type Action, type State, type View } from './engine';

/** Сила руки при козыре suit. */
function strength(hand: Card[], suit: Suit): number {
  let v = 0;
  for (const c of hand) {
    if (c.s === suit) v += c.r === 11 ? 3.5 : c.r === 9 ? 2.6 : c.r === 14 ? 1.6 : c.r === 10 ? 1.2 : 0.5;
    else if (c.r === 14) v += 1.1;
    else if (c.r === 10 && hand.some((x) => x.s === c.s && x.r === 14)) v += 0.6;
  }
  return v;
}

function bid(v: View, seat: number, level: number, rng: Rng): Action {
  const hand = v.hands[seat];
  const up = v.up!;
  const need = (pairs(v) ? 5 : 6) * (hand.length / 6);
  if (v.phase === 'bid1') {
    const h = v.cfg.rules === 'belote' ? [...hand, up] : hand;
    const st = strength(h, up.s);
    if (level === 0) return { type: 'bid', play: h.filter((c) => c.s === up.s).length >= 3 || rng.next() < 0.1 };
    return { type: 'bid', play: st >= need - (level === 2 ? 0.3 : 0) };
  }
  const suits = SUITS.filter((s) => s !== up.s);
  const best = suits.sort((a, b) => strength(hand, b) - strength(hand, a))[0];
  const forced = v.cfg.rules === 'klabor' && seat === v.dealer;
  if (forced) return { type: 'bid', play: true, suit: best };
  if (level === 0) return rng.next() < 0.2 ? { type: 'bid', play: true, suit: best } : { type: 'bid', play: false };
  return strength(hand, best) >= need ? { type: 'bid', play: true, suit: best } : { type: 'bid', play: false };
}

function medium(v: View | State, seat: number): Card {
  const T = v.trump!;
  const moves = legal(v, seat);
  const cost = (c: Card) => points(c, T) + (c.s === T ? 15 + power(c, T) / 10 : 0);
  const cheap = (cs: Card[]) => cs.slice().sort((a, b) => cost(a) - cost(b))[0];
  if (!v.trick.length) {
    const aces = moves.filter((c) => c.r === 14 && c.s !== T);
    if (aces.length) return aces[0];
    // заказчик выбивает козыри валетом/девяткой
    const top = moves.filter((c) => c.s === T && (c.r === 11 || c.r === 9));
    if (v.taker != null && teamOf(v, v.taker) === teamOf(v, seat) && top.length) return top[0];
    return cheap(moves);
  }
  const w = trickWinner(v.trick, T);
  const partner = pairs(v) && teamOf(v, w) === teamOf(v, seat);
  const onTable = v.trick.reduce((x, t) => x + points(t.card, T), 0);
  const lastToPlay = v.trick.length === v.seats.length - 1;
  if (partner && (lastToPlay || power(v.trick.find((t) => t.seat === w)!.card, T) >= 107)) {
    const fat = moves.filter((c) => c.s !== T).sort((a, b) => points(b, T) - points(a, T))[0];
    if (fat && points(fat, T) >= 10) return fat;
    return cheap(moves);
  }
  const winners = moves.filter((c) => trickWinner([...v.trick, { seat, card: c }], T) === seat);
  if (winners.length && (onTable >= 3 || lastToPlay)) return cheap(winners);
  return moves.slice().sort((a, b) => points(a, T) - points(b, T) || cost(a) - cost(b))[0];
}

/** Невидимые карты. */
function unseen(v: View, seat: number): Card[] {
  const known = [...v.hands[seat], ...v.gone, ...v.trick.map((t) => t.card), ...(v.up ? [v.up] : [])];
  return makeDeck(32).filter((c) => !known.some((k) => sameCard(k, c)));
}

function world(v: View, seat: number, rng: Rng): State {
  const pool = unseen(v, seat);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const hands = v.hands.map((h, x) => (x === seat ? h.slice() : pool.splice(0, v.counts[x])));
  const { counts: _c, deckLeft: _d, ...rest } = v;
  return { ...(rest as Omit<State, 'deck'>), hands, deck: pool } as State;
}

function hard(v: View, seat: number, rng: Rng): Card {
  const moves = legal(v, seat);
  if (moves.length === 1) return moves[0];
  const me = teamOf(v, seat);
  const totals = moves.map(() => 0);
  for (let w = 0; w < 24; w++) {
    const sim = new SeededRng((rng.int(1 << 30) ^ (w * 7919)) | 0);
    const s0 = world(v, seat, sim);
    moves.forEach((m, i) => {
      let s = s0;
      let r = apply(s, seat, { type: 'play', card: m }, sim);
      let guard = 0;
      while (r && guard++ < 60) {
        s = r.state;
        if (r.events.some((e) => e.type === 'hand' || e.type === 'end')) break;
        const who = s.turn;
        r = apply(s, who, { type: 'play', card: medium(s, who) }, sim);
      }
      // разница очков взяток своей стороны и лучшего соперника
      const hand = r?.events.find((e) => e.type === 'hand') as { add: number[] } | undefined;
      const add = hand ? hand.add : s.pts;
      const opp = Math.max(...add.filter((_, t) => t !== me));
      totals[i] += add[me] - opp;
    });
  }
  let bi = 0;
  totals.forEach((t, i) => t > totals[bi] && (bi = i));
  return moves[bi];
}

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (v.over || v.turn !== seat) return null;
  if (v.phase === 'bid1' || v.phase === 'bid2') return bid(v, seat, level, rng);
  if (canSwap(v, seat) && level > 0) return { type: 'swap' };
  if (level === 0) {
    const m = legal(v, seat);
    return { type: 'play', card: m[rng.int(m.length)] };
  }
  return { type: 'play', card: level === 2 ? hard(v, seat, rng) : medium(v, seat) };
}
