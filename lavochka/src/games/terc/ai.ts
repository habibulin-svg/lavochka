/* Терц — боты. Видят свою руку, открытый козырь, объявленные комбинации, взятку на столе и сыгранные карты.
 *   Лёгкий — объявляет и отвечает через раз, ходит любой допустимой картой;
 *   Средний — объявляет старшую комбинацию, всегда «Рост», если есть чем; пока есть колода — сносит пустое, бережёт
 *             козырных валета с девяткой и карты своих последовательностей, бьёт дорогие карты дёшево; в «разборе» — по очкам;
 *   Сложный — пока есть колода, играет как средний, а в «разборе фрица» (чужая рука уже известна по вышедшим картам)
 *             с семи карт на руке считает розыгрыш до конца точным перебором. */
import type { Rng } from '../../core/types';
import { makeDeck, sameCard, type Card } from '../../cards/deck';
import { available, canDeclare, canMarriage, canSwap, combosOf, comboRank, fritz, legal, other, points, power, rostCombo, trickWinner, type Action, type State, type View } from './engine';

/** Ценность карты «для себя»: очки, козырная сила, участие в комбинациях. */
function keep(v: View | State, seat: number, c: Card): number {
  const T = v.trump;
  let k = points(c, T);
  if (c.s === T) k += 8 + power(c, T) - 100;
  const hand = v.hands[seat];
  for (const cb of combosOf(hand)) if (cb.cards.some((x) => sameCard(x, c))) k += cb.pts / 4;
  // пара для будущего терца
  if (hand.some((x) => x !== c && x.s === c.s && Math.abs(x.r - c.r) === 1)) k += 2;
  if (c.s === T && (c.r === 12 || c.r === 13) && hand.some((x) => x.s === T && x.r === 25 - c.r) && !v.marriage[seat]) k += 6;
  return k;
}

function medium(v: View | State, seat: number): Card {
  const T = v.trump;
  const moves = legal(v, seat);
  const cheap = (cs: Card[]) => cs.slice().sort((a, b) => keep(v, seat, a) - keep(v, seat, b))[0];
  if (!v.trick.length) {
    if (fritz(v)) {
      // в разборе — заходим тузами и козырной силой
      const aces = moves.filter((c) => c.r === 14 && c.s !== T);
      if (aces.length) return aces[0];
      return cheap(moves);
    }
    return cheap(moves);
  }
  const lead = v.trick[0].card;
  const onTable = points(lead, T);
  const winners = moves.filter((c) => trickWinner([...v.trick, { seat, card: c }], T) === seat);
  if (winners.length) {
    const best = cheap(winners);
    const cost = keep(v, seat, best);
    // дорогую карту бьём, если выходит дешевле её очков; последние взятки — всегда (последняя +10)
    if (onTable >= 10 && cost <= onTable + 12) return best;
    if (fritz(v) && v.hands[seat].length <= 2) return best;
    if (best.s !== T && cost <= 3) return best;
  }
  // не бьём — сносим самое пустое
  return moves.slice().sort((a, b) => points(a, T) - points(b, T) || keep(v, seat, a) - keep(v, seat, b))[0];
}

function unseen(v: View, seat: number): Card[] {
  const known = [...v.hands[seat], ...v.gone, ...v.trick.map((t) => t.card), ...(v.trumpCard ? [v.trumpCard] : [])];
  return makeDeck(32).filter((c) => !known.some((k) => sameCard(k, c)));
}

/** Разбор фрица: колоды нет, рука соперника — ровно невидимые карты. Точный перебор (минимакс с памятью) по разнице очков взяток. */
function exact(v: View, seat: number): Card {
  const opp = other(v, seat);
  const T = v.trump;
  const hands: Card[][] = [];
  hands[seat] = v.hands[seat].slice();
  hands[opp] = unseen(v, seat);
  const memo = new Map<string, number>();
  const key = (turn: number, lead: Card | null) => `${turn}|${lead ? lead.s + lead.r : ''}|${hands[seat].map((c) => c.s + c.r).join('')}|${hands[opp].map((c) => c.s + c.r).join('')}`;
  const legalOf = (x: number, lead: Card | null) => legal({ ...v, hands, trick: lead ? [{ seat: other(v, x), card: lead }] : [] } as unknown as View, x);
  // значение — очки seat минус очки opp до конца сдачи
  function go(turn: number, lead: Card | null, alpha: number, beta: number): number {
    if (!lead && !hands[seat].length && !hands[opp].length) return 0;
    const k = key(turn, lead);
    const m = memo.get(k);
    if (m != null) return m;
    const maxi = turn === seat;
    let best = maxi ? -1e9 : 1e9;
    const moves = legalOf(turn, lead);
    for (const c of moves) {
      const i = hands[turn].indexOf(c);
      hands[turn].splice(i, 1);
      let val: number;
      if (!lead) val = go(other(v, turn), c, alpha, beta);
      else {
        const w = trickWinner([{ seat: other(v, turn), card: lead }, { seat: turn, card: c }], T);
        let pts = points(lead, T) + points(c, T);
        if (!hands[seat].length && !hands[opp].length) pts += 10;
        val = (w === seat ? pts : -pts) + go(w, null, alpha, beta);
      }
      hands[turn].splice(i, 0, c);
      if (maxi) {
        if (val > best) best = val;
        if (best > alpha) alpha = best;
      } else {
        if (val < best) best = val;
        if (best < beta) beta = best;
      }
    }
    memo.set(k, best);
    return best;
  }
  const lead = v.trick.length ? v.trick[0].card : null;
  const moves = legalOf(seat, lead);
  if (moves.length === 1) return moves[0];
  let bestC = moves[0];
  let bestV = -1e9;
  for (const c of moves) {
    const i = hands[seat].indexOf(c);
    hands[seat].splice(i, 1);
    let val: number;
    if (!lead) val = go(opp, c, -1e9, 1e9);
    else {
      const w = trickWinner([{ seat: opp, card: lead }, { seat, card: c }], T);
      let pts = points(lead, T) + points(c, T);
      if (!hands[seat].length && !hands[opp].length) pts += 10;
      val = (w === seat ? pts : -pts) + go(w, null, -1e9, 1e9);
    }
    hands[seat].splice(i, 0, c);
    if (val > bestV) {
      bestV = val;
      bestC = c;
    }
  }
  return bestC;
}

function hard(v: View, seat: number): Card {
  if (fritz(v) && v.hands[seat].length + v.counts[other(v, seat)] <= 14) return exact(v, seat);
  return medium(v, seat);
}

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (v.over || v.turn !== seat) return null;
  if (v.phase === 'answer') {
    const c = rostCombo(v, seat);
    return { type: 'answer', rost: !!c && (level > 0 || rng.next() < 0.7) };
  }
  if (canMarriage(v, seat) && (level > 0 || rng.next() < 0.5)) return { type: 'marriage' };
  if (canSwap(v, seat) && (level > 0 || rng.next() < 0.5)) return { type: 'swap' };
  if (canDeclare(v, seat)) {
    const av = available(v, seat).sort((a, b) => b.pts - a.pts || comboRank(b, v.trump) - comboRank(a, v.trump));
    if (av.length && (level > 0 || rng.next() < 0.5)) return { type: 'declare', combo: av[0] };
  }
  if (level === 0) {
    const m = legal(v, seat);
    return { type: 'play', card: m[rng.int(m.length)] };
  }
  return { type: 'play', card: level === 2 ? hard(v, seat) : medium(v, seat) };
}
