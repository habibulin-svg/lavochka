/* Криббедж — боты. Видят свою руку, стартер и всё, что выложено в розыгрыше.
 *   Лёгкий — сбрасывает и ходит наугад;
 *   Средний — оставляет четыре карты с лучшим счётом в среднем по стартерам, в розыгрыше берёт очки сразу
 *             и не оставляет сумму 5 и 21 (на десятку соперник сделает 15 и 31);
 *   Сложный — при сбросе учитывает и криб: свой криб — свои карты в него тоже идут в плюс, чужой — в минус
 *             (пятёрки и пары чужому крибу не отдаёт); в розыгрыше вычитает лучший ответ соперника по невидимым картам. */
import type { Rng } from '../../core/types';
import { makeDeck, sameCard, type Card } from '../../cards/deck';
import { canPlay, discardN, mates, pegScore, pip, scoreHand, sumItems, type Action, type View } from './engine';

const has = (list: Card[], c: Card) => list.some((x) => sameCard(x, c));

/** Средний счёт оставленных карт по возможным стартерам. */
function keepValue(keep: Card[], unknown: Card[], step: number): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < unknown.length; i += step) {
    sum += sumItems(scoreHand(keep, unknown[i]));
    n++;
  }
  return sum / Math.max(1, n);
}

/** Грубая цена карт в крибе: пятёрки, пары, 15 и соседи. */
function cribGuess(cs: Card[]): number {
  let v = 0;
  for (const c of cs) if (pip(c) === 5) v += 2;
  if (cs.length === 2) {
    const [a, b] = cs;
    if (a.r === b.r) v += 2;
    if (pip(a) + pip(b) === 15) v += 2;
    if (Math.abs(a.r - b.r) === 1) v += 1;
    if (a.s === b.s) v += 0.2;
  }
  return v;
}

function chooseDiscard(v: View, seat: number, level: number, rng: Rng): Action {
  const hand = v.hands[seat];
  const k = discardN(v);
  const combos: Card[][] = [];
  if (k === 2) for (let i = 0; i < hand.length; i++) for (let j = i + 1; j < hand.length; j++) combos.push([hand[i], hand[j]]);
  else for (const c of hand) combos.push([c]);
  if (level === 0) return { type: 'discard', cards: combos[rng.int(combos.length)] };
  const unknown = makeDeck(52).filter((c) => !has(hand, c));
  const myCrib = mates(v, seat).includes(v.dealer);
  let best = combos[0];
  let bv = -Infinity;
  for (const d of combos) {
    const keep = hand.filter((c) => !has(d, c));
    let val = keepValue(keep, unknown, level === 1 ? 4 : 1);
    if (level === 2) val += (myCrib ? 1 : -1) * cribGuess(d);
    else val += (myCrib ? 0.3 : -0.3) * cribGuess(d);
    if (val > bv) {
      bv = val;
      best = d;
    }
  }
  return { type: 'discard', cards: best };
}

function choosePlay(v: View, seat: number, level: number, rng: Rng): Action | null {
  const mine = v.left[seat].filter((c) => canPlay(v, seat, c));
  if (!mine.length) return null;
  if (level === 0 || mine.length === 1) return { type: 'play', card: mine[rng.int(mine.length)] };
  const pile = v.pile.map((p) => p.card);
  const seen = [...v.hands[seat], ...v.played.map((p) => p.card), ...(v.starter ? [v.starter] : [])];
  const unknown = makeDeck(52).filter((c) => !has(seen, c));
  let best = mine[0];
  let bv = -Infinity;
  for (const c of mine) {
    const p2 = [...pile, c];
    const cnt = v.count + pip(c);
    let val = sumItems(pegScore(p2, cnt));
    if (level === 1) {
      if (cnt === 5 || cnt === 21) val -= 1.2;
      val -= pip(c) * 0.02; // мелочь — на потом
    } else {
      // ответ соперника: средний лучший счёт по невидимым картам
      let reply = 0;
      let n = 0;
      for (const o of unknown) {
        const c2 = cnt + pip(o);
        if (c2 > 31) continue;
        reply += sumItems(pegScore([...p2, o], c2));
        n++;
      }
      val -= n ? (reply / n) * 1.6 : -0.6; // никто не ответит — скорее всего моё очко за «пас»
      val -= pip(c) * 0.02;
    }
    val += rng.next() * 0.001;
    if (val > bv) {
      bv = val;
      best = c;
    }
  }
  return { type: 'play', card: best };
}

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (v.over) return null;
  if (v.phase === 'discard') return v.discards[seat] ? null : chooseDiscard(v, seat, level, rng);
  if (v.turn !== seat) return null;
  return choosePlay(v, seat, level, rng);
}
