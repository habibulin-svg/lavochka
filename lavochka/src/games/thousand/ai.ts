/* Тысяча — боты. Видят свою руку, открытый прикуп, взятки на столе и отданные им карты.
 *   Лёгкий — торгуется осторожно и наугад, ходит простыми правилами;
 *   Средний — оценивает руку (тузы, «десятки при тузе», марьяжи, длина козыря), отдаёт мелочь, объявляет марьяжи;
 *   Сложный — ещё и считает вышедшие карты: знает, когда десятка уже старшая, и подыгрывает второму обороняющемуся. */
import type { Rng } from '../../core/types';
import { sameCard, type Card, type Suit } from '../../cards/deck';
import { GOAL, legalCards, MARRIAGE, marriagesIn, maxBid, POINTS, POWER, round5, trickWinner, type Action, type State } from './engine';

const SUITS: Suit[] = ['H', 'D', 'C', 'S'];

/** Сколько очков рука, скорее всего, наберёт (с прикупом и марьяжами). */
export function estimate(hand: Card[], withPrikup: boolean): number {
  let v = 0;
  for (const s of SUITS) {
    const cs = hand.filter((c) => c.s === s);
    const ace = cs.some((c) => c.r === 14);
    const ten = cs.some((c) => c.r === 10);
    if (ace) v += 11 + 6; // туз и то, что упадёт под него
    if (ace && ten) v += 10 + 4;
    else if (ten && cs.length >= 3) v += 5;
    if (cs.length >= 4) v += (cs.length - 3) * 6;
  }
  for (const s of marriagesIn(hand)) v += MARRIAGE[s] * 0.9;
  if (withPrikup) v += 14;
  return v;
}

/** Что уже вышло (взятки + текущая) — для сложного. */
function seen(s: State): Card[] {
  const out: Card[] = [];
  if (s.trick) for (const x of s.trick.cards) out.push(x.card);
  return out;
}

const higherLeft = (c: Card, gone: Card[], hand: Card[]) =>
  [9, 10, 11, 12, 13, 14].filter((r) => POWER[r] > POWER[c.r] && !gone.some((g) => g.s === c.s && g.r === r) && !hand.some((h) => h.s === c.s && h.r === r)).length;

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.phase === 'over' || s.turn !== seat) return null;
  const hand = s.hands[seat];
  if (s.phase === 'bid') {
    const est = estimate(hand, true) * (level === 0 ? 0.78 + rng.next() * 0.12 : level === 1 ? 0.92 : 1);
    const want = Math.min(maxBid(hand), Math.floor(est / 5) * 5);
    const next = s.bid + s.cfg.step;
    // на бочке нужен заказ не меньше, чем до тысячи: торгуемся смелее, иначе с неё не слезть
    const need = s.cfg.barrel && s.barrel[seat] > 0 ? GOAL - s.scores[seat] : 0;
    const brave = need && est >= need - 30 ? Math.max(want, need) : want;
    if (next <= Math.min(maxBid(hand), brave)) return { type: 'bid', value: next };
    return { type: 'pass' };
  }
  if (s.phase === 'give') {
    const to = s.players.find((x) => x !== seat && !s.given.includes(x))!;
    // отдаём мелочь, не ломая марьяжей и не отдавая тузов
    const keep = new Set(marriagesIn(hand));
    const ranked = hand
      .slice()
      .sort((a, b) => (keep.has(a.s) && (a.r === 13 || a.r === 12) ? 50 : 0) + POINTS[a.r] + (a.r === 14 ? 30 : 0) - ((keep.has(b.s) && (b.r === 13 || b.r === 12) ? 50 : 0) + POINTS[b.r] + (b.r === 14 ? 30 : 0)));
    const pick = level === 0 ? hand[rng.int(hand.length)] : ranked[0];
    return { type: 'give', to, card: pick };
  }
  if (s.phase === 'raise') {
    const need = s.cfg.barrel && s.barrel[seat] > 0 ? GOAL - s.scores[seat] : 0;
    const est = round5(estimate(hand, false) * (level === 2 ? 1 : level === 1 ? 0.95 : 0.85));
    // на бочке без нужного заказа с неё не выйти — поднимаем до тысячи, если хоть как-то похоже
    if (need > s.bid && need <= maxBid(hand) && est >= need - 25) return { type: 'raise', value: need };
    if (level === 0) return { type: 'raise', value: s.bid };
    const v = Math.min(maxBid(hand), Math.max(s.bid, est - 10));
    return { type: 'raise', value: Math.max(s.bid, Math.floor(v / 5) * 5) };
  }
  // розыгрыш
  const legal = legalCards(s, seat);
  const leading = !s.trick || !s.trick.cards.length;
  const gone = level === 2 ? seen(s) : [];
  const mar = marriagesIn(hand);
  if (leading) {
    // объявить марьяж: со старшего, кроме первого хода кона
    if (s.tricksPlayed > 0 && mar.length) {
      const best = mar.sort((a, b) => MARRIAGE[b] - MARRIAGE[a])[0];
      const q = hand.find((c) => c.s === best && c.r === 12)!;
      return { type: 'play', card: q, marriage: true };
    }
    if (level === 0 && rng.next() < 0.35) {
      const c = legal[rng.int(legal.length)];
      const can = s.tricksPlayed > 0 && (c.r === 13 || c.r === 12) && mar.includes(c.s);
      return { type: 'play', card: c, marriage: can || undefined };
    }
    // туз — с него; иначе старшая, если она уже старшая в масти; иначе мелочь
    const aces = legal.filter((c) => c.r === 14);
    if (aces.length) return { type: 'play', card: aces[0] };
    if (level === 2) {
      const top = legal.filter((c) => higherLeft(c, gone, hand) === 0 && POINTS[c.r] >= 10);
      if (top.length) return { type: 'play', card: top[0] };
    }
    const low = legal.filter((c) => !(mar.includes(c.s) && (c.r === 13 || c.r === 12))).sort((a, b) => POINTS[a.r] - POINTS[b.r]);
    return { type: 'play', card: (low.length ? low : legal.sort((a, b) => POINTS[a.r] - POINTS[b.r]))[0] };
  }
  // ход вдогонку: можно ли забрать взятку
  const t = s.trick!;
  const current = trickWinner(t, s.trump);
  const partnerWins = seat !== s.bidder && current !== s.bidder;
  const winners = legal.filter((c) => trickWinner({ ...t, cards: [...t.cards, { seat, card: c }] }, s.trump) === seat);
  const last = t.cards.length === s.players.length - 1;
  const pts = t.cards.reduce((a, x) => a + POINTS[x.card.r], 0);
  const cheap = (list: Card[]) => list.slice().sort((a, b) => POINTS[a.r] - POINTS[b.r] || POWER[a.r] - POWER[b.r])[0];
  if (level === 0 && rng.next() < 0.35) return { type: 'play', card: legal[rng.int(legal.length)] };
  if (partnerWins && (last || level === 2)) {
    // второй обороняющийся уже берёт — подкладываем очки
    const rich = legal.slice().sort((a, b) => POINTS[b.r] - POINTS[a.r]);
    if (last || current === nextOf(s, seat, true)) return { type: 'play', card: rich[0] };
  }
  if (winners.length && (pts > 0 || last || seat === s.bidder)) {
    // берём самой дешёвой из берущих (последним — любой; иначе — старшей, чтобы не перебили)
    const pick = last ? cheap(winners) : winners.slice().sort((a, b) => POWER[b.r] - POWER[a.r])[0];
    return { type: 'play', card: pick };
  }
  return { type: 'play', card: cheap(legal.filter((c) => !winners.some((w) => sameCard(w, c))).length ? legal.filter((c) => !winners.some((w) => sameCard(w, c))) : legal) };
}

function nextOf(s: State, seat: number, prev: boolean): number {
  const i = s.players.indexOf(seat);
  return s.players[(i + (prev ? s.players.length - 1 : 1)) % s.players.length];
}
