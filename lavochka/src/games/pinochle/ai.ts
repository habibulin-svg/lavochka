/* Пинокль — боты. Видят свою руку, мелды всех (после козыря), взятки на столе и сыгранные карты.
 *   Лёгкий — заказывает понемногу и наугад, ходит любой допустимой картой;
 *   Средний — заказывает до «мелд лучшей масти + ожидаемые взятки», козырь — где мелд больше и масть длиннее,
 *             закапывает десятки и короли вне мелдов (они идут в очки), берёт взятку дёшево, когда на столе очки;
 *   Сложный — то же, а в розыгрыше перебирает ходы на разыгранных раскладах. */
import type { Rng } from '../../core/types';
import { SeededRng } from '../../core/rng';
import { makeDeck, SUITS, type Suit } from '../../cards/deck';
import { apply, beats, counter, legal, meldOptions, meldTotal, melds, minBid, pairs, PASS, power, sameP, teamOf, type Action, type PCard, type State, type View } from './engine';

function bestTrump(hand: PCard[]): { suit: Suit; val: number } {
  let best: { suit: Suit; val: number } = { suit: 'S', val: -1 };
  for (const s of SUITS) {
    const len = hand.filter((c) => c.s === s).length;
    const val = meldTotal(hand, s) + len * 8 + hand.filter((c) => c.s === s && (c.r === 14 || c.r === 10)).length * 6;
    if (val > best.val) best = { suit: s, val };
  }
  return best;
}

function maxBid(v: View, seat: number, level: number): number {
  const hand = v.hands[seat];
  const { suit } = bestTrump(hand);
  const meld = meldTotal(hand, suit);
  const aces = hand.filter((c) => c.r === 14).length;
  const trumps = hand.filter((c) => c.s === suit).length;
  const tricks = (pairs(v) ? 90 : 60) + aces * 8 + trumps * 6 + (pairs(v) ? 40 : 0);
  const est = meld + tricks;
  return Math.floor((est * (level === 2 ? 1 : 0.92)) / 10) * 10;
}

function medium(v: View | State, seat: number): PCard {
  const T = v.trump!;
  const moves = legal(v, seat);
  const cost = (c: PCard) => counter(c) + (c.s === T ? 12 + power(c) : 0);
  const cheap = (cs: PCard[]) => cs.slice().sort((a, b) => cost(a) - cost(b))[0];
  if (!v.trick.length) {
    const aces = moves.filter((c) => c.r === 14 && c.s !== T);
    return aces[0] ?? cheap(moves);
  }
  const win = v.trick.reduce((b, t) => (beats(b.card, t.card, T) ? t : b));
  const partner = pairs(v) && teamOf(v, win.seat) === teamOf(v, seat);
  const last = v.trick.length === v.seats.length - 1;
  if (partner && last) {
    const fat = moves.filter((c) => counter(c) > 0 && c.s !== T)[0];
    return fat ?? cheap(moves);
  }
  const winners = moves.filter((c) => beats(win.card, c, T));
  const onTable = v.trick.reduce((x, t) => x + counter(t.card), 0);
  if (winners.length && (onTable > 0 || last)) return cheap(winners);
  return moves.slice().sort((a, b) => counter(a) - counter(b) || cost(a) - cost(b))[0];
}

function world(v: View, seat: number, rng: Rng): State {
  const all: PCard[] = [...makeDeck(24).map((c) => ({ ...c, d: 0 })), ...makeDeck(24).map((c) => ({ ...c, d: 1 }))];
  const known = [...v.hands[seat], ...v.trick.map((t) => t.card), ...v.buried, ...v.gone];
  const pool = all.filter((c) => !known.some((k) => sameP(k, c)));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const hands = v.hands.map((h, x) => (x === seat ? h.slice() : pool.splice(0, v.counts[x])));
  const { counts: _c, ...rest } = v;
  return { ...(rest as State), hands };
}

function hard(v: View, seat: number, rng: Rng): PCard {
  const moves = legal(v, seat);
  if (moves.length === 1) return moves[0];
  const me = teamOf(v, seat);
  const totals = moves.map(() => 0);
  for (let w = 0; w < 16; w++) {
    const sim = new SeededRng((rng.int(1 << 30) ^ (w * 7919)) | 0);
    const s0 = world(v, seat, sim);
    moves.forEach((m, i) => {
      let s = s0;
      let r = apply(s, seat, { type: 'play', card: m }, sim);
      let guard = 0;
      while (r && guard++ < 80) {
        s = r.state;
        if (r.events.some((e) => e.type === 'hand')) break;
        r = apply(s, s.turn, { type: 'play', card: medium(s, s.turn) }, sim);
      }
      totals[i] += s.pts[me] - Math.max(...s.pts.filter((_, t) => t !== me));
    });
  }
  let bi = 0;
  totals.forEach((t, i) => t > totals[bi] && (bi = i));
  return moves[bi];
}

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (v.over || v.turn !== seat) return null;
  if (v.phase === 'bid') {
    const lim = level === 0 ? 250 + rng.int(6) * 10 : maxBid(v, seat, level);
    const n = minBid(v);
    // партнёр уже заказал — не перебиваем его зря
    if (pairs(v) && v.bidder != null && teamOf(v, v.bidder) === teamOf(v, seat) && level > 0) return { type: 'pass' };
    return n <= lim ? { type: 'bid', n } : { type: 'pass' };
  }
  if (v.phase === 'trump') return { type: 'trump', suit: bestTrump(v.hands[seat]).suit };
  if (v.phase === 'meld') {
    // вдвоём: объявить самый дорогой из доступных мелдов (лёгкий — наугад или ничего)
    const opts = meldOptions(v, seat);
    if (!opts.length) return { type: 'meld', i: -1 };
    if (level === 0) return { type: 'meld', i: rng.int(opts.length + 1) - 1 };
    let best = 0;
    opts.forEach((m, i) => {
      if (m.pts > opts[best].pts) best = i;
    });
    return { type: 'meld', i: best };
  }
  if (v.phase === 'pass' || v.phase === 'return') {
    // обмен: напарник отдаёт козыри и тузы (то, что пригодится заказчику), заказчик возвращает мелочь не из мелдов
    const hand = v.hands[seat].slice();
    const T = v.trump!;
    const keep = (c: PCard) => (c.s === T ? 30 : 0) + (c.r === 14 ? 20 : 0) + (c.r === 10 ? 8 : 0) + (c.r === 13 || c.r === 12 ? 4 : 0);
    if (v.phase === 'pass') hand.sort((x, y) => keep(y) - keep(x));
    else {
      const inMeld = (c: PCard) => meldTotal(v.hands[seat], T) > meldTotal(v.hands[seat].filter((x) => x !== c), T);
      hand.sort((x, y) => (inMeld(x) ? 100 : 0) + keep(x) - ((inMeld(y) ? 100 : 0) + keep(y)));
    }
    return { type: 'give', cards: (level === 0 ? hand.sort(() => rng.next() - 0.5) : hand).slice(0, PASS) };
  }
  if (v.phase === 'bury') {
    const hand = v.hands[seat];
    const T = v.trump!;
    const before = melds(hand, T).reduce((x, m) => x + m.pts, 0);
    // не трогать мелд и козыри: закапываем очковые карты коротких мастей
    const cands = hand
      .filter((c) => c.s !== T)
      .map((c) => {
        const rest = hand.filter((x) => x !== c);
        const loss = before - melds(rest, T).reduce((x, m) => x + m.pts, 0);
        return { c, score: loss * 10 - counter(c) * (level ? 1 : 0) + hand.filter((x) => x.s === c.s).length };
      })
      .sort((a, b) => a.score - b.score);
    const pick = (cands.length >= 3 ? cands : hand.map((c) => ({ c, score: 0 }))).slice(0, 3).map((x) => x.c);
    return { type: 'bury', cards: pick };
  }
  if (level === 0) {
    const m = legal(v, seat);
    return { type: 'play', card: m[rng.int(m.length)] };
  }
  return { type: 'play', card: level === 2 ? hard(v, seat, rng) : medium(v, seat) };
}
