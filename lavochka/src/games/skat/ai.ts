/* Скат — боты. Видят свою руку, торги, сыгранные карты (играющий — ещё и свой снос).
 *   Лёгкий — торгуется до 18–20 с хорошей рукой, играет любой допустимой картой;
 *   Средний — оценивает каждую игру (вальты, козыри, тузы, «десятки с тузом»), торгуется до цены лучшей из играбельных,
 *             берёт скат, сносит очки из мастей без туза и одиночки, объявляет лучшую игру;
 *   Сложный — ещё и играет с руки при очень сильной руке, а в розыгрыше перебирает ходы на разыгранных раскладах. */
import type { Rng } from '../../core/types';
import { SeededRng } from '../../core/rng';
import { makeDeck, sameCard, SUITS, type Card, type Suit } from '../../cards/deck';
import { apply, BASE, legal, matadors, nextBid, POINTS, power, suitOf, trickWinner, type Action, type Contract, type GameKind, type State, type View } from './engine';

interface Eval {
  kind: GameKind;
  strength: number;
  value: number;
}

/** Сила руки под игру (условные «взятки»): играбельно, если ≥ 7 для масти, ≥ 7 для гранда. */
function evaluate(hand: Card[], kind: GameKind, hand10: boolean): Eval {
  const jacks = hand.filter((c) => c.r === 11);
  if (kind === 'null') {
    // нуль: в каждой масти мелкие карты, нет старших без мелких
    let bad = 0;
    for (const s of SUITS) {
      const cs = hand.filter((c) => c.s === s).map((c) => c.r).sort((a, b) => a - b);
      if (cs.length && cs[0] > 9) bad += 2;
      if (cs.some((r) => r >= 13) && cs.length < 3) bad++;
    }
    return { kind, strength: bad === 0 ? 9 : 4 - bad, value: hand10 ? 35 : 23 };
  }
  const trumps = hand.filter((c) => c.r === 11 || (kind !== 'grand' && c.s === kind));
  let st = jacks.length * 1.6 + trumps.length * 0.9;
  for (const s of SUITS) {
    if (kind !== 'grand' && s === kind) continue;
    const cs = hand.filter((c) => c.s === s && c.r !== 11);
    if (cs.some((c) => c.r === 14)) st += 1.2;
    if (cs.some((c) => c.r === 14) && cs.some((c) => c.r === 10)) st += 0.8;
    if (!cs.length) st += 0.4;
  }
  if (kind === 'grand') st = jacks.length * 2 + hand.filter((c) => c.r === 14).length * 1.5 + hand.filter((c) => c.r === 10 && hand.some((x) => x.s === c.s && x.r === 14)).length;
  const m = Math.abs(matadors(hand, kind)) + 1 + (hand10 ? 1 : 0);
  return { kind, strength: st, value: BASE[kind] * m };
}

function bestGame(hand: Card[], hand10: boolean): Eval {
  const opts = [...SUITS.map((s) => evaluate(hand, s, hand10)), evaluate(hand, 'grand', hand10), evaluate(hand, 'null', hand10)];
  const playable = opts.filter((e) => e.strength >= (e.kind === 'grand' ? 8 : 7));
  return (playable.length ? playable : opts).sort((a, b) => (playable.length ? b.value - a.value : b.strength - a.strength))[0];
}

function chooseDiscard(hand: Card[], kind: GameKind): Card[] {
  // сносим: десятки и короли в мастях без туза, одиночки; не козыри
  const score = (c: Card) => {
    if (c.r === 11 || (kind !== 'grand' && kind !== 'null' && c.s === kind)) return -100;
    const suit = hand.filter((x) => x.s === c.s && x.r !== 11);
    let v = POINTS[c.r];
    if (suit.some((x) => x.r === 14) && c.r !== 14) v -= 8;
    if (c.r === 14) v -= 20;
    if (suit.length <= 2) v += 4;
    return v;
  };
  return hand.slice().sort((a, b) => score(b) - score(a)).slice(0, 2);
}

function medium(v: View | State, seat: number): Card {
  const k = v.contract!.kind;
  const moves = legal(v, seat);
  const decl = v.declarer === seat;
  const cost = (c: Card) => (k === 'null' ? -power(c, k) : POINTS[c.r] + (suitOf(c, k) === 'T' ? 10 + power(c, k) / 20 : 0));
  const cheap = (cs: Card[]) => cs.slice().sort((a, b) => cost(a) - cost(b))[0];
  if (k === 'null') {
    // играющий — сбрасывает самые старшие из тех, что не берут; защитники — пытаются заставить взять
    if (!v.trick.length) return decl ? moves.slice().sort((a, b) => power(a, k) - power(b, k))[0] : moves.slice().sort((a, b) => power(a, k) - power(b, k))[0];
    const under = moves.filter((c) => trickWinner([...v.trick, { seat, card: c }], k) !== seat);
    if (decl) return (under.length ? under : moves).slice().sort((a, b) => power(b, k) - power(a, k))[0];
    return moves.slice().sort((a, b) => power(a, k) - power(b, k))[0];
  }
  if (!v.trick.length) {
    if (decl) {
      const tr = moves.filter((c) => suitOf(c, k) === 'T').sort((a, b) => power(b, k) - power(a, k));
      if (tr.length >= 2) return tr[0];
    }
    const aces = moves.filter((c) => c.r === 14 && suitOf(c, k) !== 'T');
    return aces[0] ?? cheap(moves);
  }
  const w = trickWinner(v.trick, k);
  const friend = !decl && w !== v.declarer;
  const onTable = v.trick.reduce((x, t) => x + POINTS[t.card.r], 0);
  const last = v.trick.length === 2;
  if (friend && last) {
    const fat = moves.filter((c) => suitOf(c, k) !== 'T').sort((a, b) => POINTS[b.r] - POINTS[a.r])[0];
    return fat ?? cheap(moves);
  }
  const winners = moves.filter((c) => trickWinner([...v.trick, { seat, card: c }], k) === seat);
  if (winners.length && (onTable >= 4 || last)) return cheap(winners);
  return moves.slice().sort((a, b) => POINTS[a.r] - POINTS[b.r] || cost(a) - cost(b))[0];
}

function world(v: View, seat: number, rng: Rng): State {
  const known = [...v.hands[seat], ...v.gone, ...v.trick.map((t) => t.card), ...v.put];
  const pool = makeDeck(32).filter((c) => !known.some((k) => sameCard(k, c)));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const hands = v.hands.map((h, x) => (x === seat || (h.length && x === v.declarer && v.contract?.ouvert) ? h.slice() : pool.splice(0, v.counts[x])));
  const { counts: _c, ...rest } = v;
  return { ...(rest as State), hands, put: v.put.length ? v.put : pool.splice(0, 2) };
}

function hard(v: View, seat: number, rng: Rng): Card {
  const moves = legal(v, seat);
  if (moves.length === 1) return moves[0];
  const decl = v.declarer === seat;
  const totals = moves.map(() => 0);
  for (let w = 0; w < 20; w++) {
    const sim = new SeededRng((rng.int(1 << 30) ^ (w * 7919)) | 0);
    const s0 = world(v, seat, sim);
    moves.forEach((m, i) => {
      let s = s0;
      let r = apply(s, seat, { type: 'play', card: m }, sim);
      let guard = 0;
      let result: { won: boolean; value: number } | null = null;
      while (r && guard++ < 40) {
        s = r.state;
        const h = r.events.find((e) => e.type === 'hand') as { won: boolean; value: number } | undefined;
        if (h) {
          result = h;
          break;
        }
        r = apply(s, s.turn, { type: 'play', card: medium(s, s.turn) }, sim);
      }
      const win = result ? result.won : false;
      totals[i] += decl === win ? 1 : -1;
    });
  }
  let bi = 0;
  totals.forEach((t, i) => t > totals[bi] && (bi = i));
  return moves[bi];
}

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (v.over || v.turn !== seat) return null;
  const hand = v.hands[seat];
  if (v.phase === 'bid') {
    const best = bestGame(hand, false);
    const lim = level === 0 ? (best.strength >= 7 ? 20 : 0) : best.strength >= (best.kind === 'grand' ? 8 : 7) ? best.value : 0;
    if (v.bidStage === 3) return lim >= 18 ? { type: 'bid', n: 18 } : { type: 'pass' };
    if (seat === v.asker) {
      const n = nextBid(v);
      return n <= lim ? { type: 'bid', n } : { type: 'pass' };
    }
    return v.bid <= lim ? { type: 'hold' } : { type: 'pass' };
  }
  if (v.phase === 'skat') {
    const best = bestGame(hand, true);
    const strong = level === 2 && best.kind !== 'null' && best.strength >= 11 && best.value >= v.bid;
    return { type: 'skat', take: !strong };
  }
  if (v.phase === 'discard') {
    const best = bestGame(hand, false);
    return { type: 'discard', cards: level === 0 ? hand.slice(0, 2) : chooseDiscard(hand, best.kind) };
  }
  if (v.phase === 'declare') {
    const hand10 = v.handGame;
    const opts = [...SUITS.map((s) => evaluate(hand, s as Suit, hand10)), evaluate(hand, 'grand', hand10), evaluate(hand, 'null', hand10)];
    // игра, которая покрывает заявку и сильнее всего
    const ok = opts.filter((e) => e.value >= v.bid && (e.kind !== 'null' || e.strength >= 8));
    const pick = (ok.length ? ok : opts).sort((a, b) => b.strength - a.strength)[0];
    const contract: Contract = { kind: pick.kind, hand: hand10 };
    return { type: 'declare', contract };
  }
  if (level === 0) {
    const m = legal(v, seat);
    return { type: 'play', card: m[rng.int(m.length)] };
  }
  return { type: 'play', card: level === 2 ? hard(v, seat, rng) : medium(v, seat) };
}
