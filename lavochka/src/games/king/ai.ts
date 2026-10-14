/* Кинг — боты. Видят свою руку и взятку на столе.
 *   Лёгкий — контракт и карты почти наугад (по правилам);
 *   Средний — в отрицательных не берёт взятки со штрафом, сбрасывает опасное (короля червей, дам, вальтов, старшие), в положительных
 *   берёт самой дешёвой бьющей картой; козырь — самая длинная масть;
 *   Сложный — ещё и заказывает контракт, где у него меньше всего риска, и избавляется от старших карт коротких мастей заранее. */
import type { Rng } from '../../core/types';
import { SUITS, type Card, type Suit } from '../../cards/deck';
import { KH, legal, NEGATIVE, trickPts, trickWinner, type Contract, type View } from './engine';
import type { Action } from './engine';

/** Насколько карта опасна в этом контракте (сбрасывать первой). */
function danger(k: Contract, c: Card): number {
  let v = c.r;
  if ((k === 'king' || k === 'erash') && KH(c)) v += 100;
  if ((k === 'girls' || k === 'erash') && c.r === 12) v += 40;
  if ((k === 'boys' || k === 'erash') && c.r === 11) v += 40;
  if ((k === 'hearts' || k === 'erash') && c.s === 'H') v += 20;
  return v;
}

/** Риск руки для контракта — для заказа. */
function risk(k: Contract, hand: Card[]): number {
  const high = hand.filter((c) => c.r >= 13).length;
  switch (k) {
    case 'tricks':
    case 'last2':
      return high * 3 + hand.filter((c) => c.r === 12).length;
    case 'hearts':
      return hand.filter((c) => c.s === 'H').reduce((a, c) => a + c.r - 6, 0) / 2;
    case 'boys':
      return hand.filter((c) => c.r === 11).length * 4 + high;
    case 'girls':
      return hand.filter((c) => c.r === 12).length * 4 + high;
    case 'king': {
      const h = hand.filter((c) => c.s === 'H');
      return hand.some(KH) ? 20 - h.length * 3 : h.some((c) => c.r === 14) ? 6 : 2;
    }
    case 'erash':
      return high * 4 + hand.filter((c) => c.r === 11 || c.r === 12).length * 3 + (hand.some(KH) ? 10 : 0);
    default:
      return 0;
  }
}

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (v.phase === 'over' || v.turn !== seat) return null;
  const hand = v.hands[seat];
  if (v.phase === 'order') {
    const left = NEGATIVE.filter((k) => !v.used.includes(k));
    if (level === 0) return { type: 'order', contract: left[rng.int(left.length)] };
    const best = left.map((k) => ({ k, r: risk(k, hand) + rng.next() * (level === 1 ? 4 : 0.5) })).sort((a, b) => a.r - b.r)[0];
    return { type: 'order', contract: best.k };
  }
  if (v.phase === 'trump') {
    const val = (s: Suit) => hand.filter((c) => c.s === s).reduce((a, c) => a + 2 + Math.max(0, c.r - 10), 0);
    const best = SUITS.slice().sort((a, b) => val(b) - val(a))[0];
    const aces = hand.filter((c) => c.r === 14).length;
    if (level === 2 && aces >= 3 && val(best) < 12) return { type: 'trump', suit: null };
    return { type: 'trump', suit: level === 0 ? SUITS[rng.int(4)] : best };
  }
  const moves = legal(v, seat);
  if (moves.length === 1 || level === 0) return { type: 'play', card: moves[rng.int(moves.length)] };
  const k = v.contract;
  const trump = k === 'plus' ? v.trump : null;
  const byR = (a: Card, b: Card) => a.r - b.r;
  /** Возьмёт ли взятку эта карта (если положить её сейчас — относительно того, что уже лежит). */
  const wins = (c: Card) => trickWinner([...v.trick, { seat, card: c }], trump) === seat;

  if (k === 'plus') {
    if (!v.trick.length) {
      const aces = moves.filter((c) => c.r === 14 && c.s !== trump);
      if (aces.length) return { type: 'play', card: aces[0] };
      const tr = moves.filter((c) => c.s === trump).sort(byR);
      if (level === 2 && tr.length >= 3) return { type: 'play', card: tr[tr.length - 1] };
      return { type: 'play', card: moves.slice().sort(byR)[0] };
    }
    const winning = moves.filter(wins).sort((a, b) => (a.s === trump ? 20 : 0) + a.r - ((b.s === trump ? 20 : 0) + b.r));
    if (winning.length) return { type: 'play', card: winning[0] };
    return { type: 'play', card: moves.slice().sort(byR)[0] };
  }

  // отрицательные
  if (!v.trick.length) {
    // заходить мелкими картами; сложный — сначала старшие короткой масти, пока у других она ещё есть
    if (level === 2 && v.played < 3) {
      const short = moves.filter((c) => c.r >= 13 && hand.filter((x) => x.s === c.s).length <= 2 && danger(k, c) < 60);
      if (short.length) return { type: 'play', card: short[0] };
    }
    return { type: 'play', card: moves.slice().sort((a, b) => danger(k, a) - danger(k, b))[0] };
  }
  const suit = v.trick[0].card.s;
  if (moves[0].s === suit) {
    const losing = moves.filter((c) => !wins(c)).sort(byR);
    if (losing.length) return { type: 'play', card: losing[losing.length - 1] };
    // взять придётся: последним и без штрафа — самой старшей (избавиться), иначе самой младшей
    const pts = trickPts(v.cfg, k, [...v.trick.map((t) => t.card), moves[0]], v.played);
    const last = v.trick.length === 3;
    const sorted = moves.slice().sort(byR);
    return { type: 'play', card: last && pts >= -2 && k !== 'tricks' ? sorted[sorted.length - 1] : sorted[0] };
  }
  // сброс: самое опасное
  return { type: 'play', card: moves.slice().sort((a, b) => danger(k, b) - danger(k, a))[0] };
}
