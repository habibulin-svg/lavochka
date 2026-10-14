/* Черви — боты. Видят свою руку, взятку на столе и что уже взято (взятки открыты).
 *   Лёгкий — отдаёт и ходит почти наугад (по правилам);
 *   Средний — отдаёт старшие карты, в масть кладёт старшую из тех, что не берут взятку, на чужой масти сбрасывает даму пик и черви;
 *   Сложный — ещё бережёт защищённую даму пик, создаёт ренонсы при обмене, выманивает даму пик мелкими пиками. */
import type { Rng } from '../../core/types';
import type { Card } from '../../cards/deck';
import { cardPts, isQS, legal, trickWinner, type Action, type View } from './engine';

const danger = (c: Card) => (isQS(c) ? 100 : c.s === 'S' && c.r > 12 ? 40 + c.r : c.s === 'H' ? 20 + c.r : c.r);

function choosePass(hand: Card[], level: number, rng: Rng): Card[] {
  if (level === 0) return hand.slice().sort(() => rng.next() - 0.5).slice(0, 3);
  const spades = hand.filter((c) => c.s === 'S');
  const qsSafe = level === 2 && spades.length >= 5 && spades.some(isQS);
  const score = (c: Card) => {
    let v = danger(c);
    if (qsSafe && c.s === 'S') v -= 60;
    // сложный: опустошить короткую масть (кроме пик и червей)
    if (level === 2 && c.s !== 'S' && c.s !== 'H' && hand.filter((x) => x.s === c.s).length <= 2) v += 15;
    return v + rng.next();
  };
  return hand.slice().sort((a, b) => score(b) - score(a)).slice(0, 3);
}

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (v.phase === 'over') return null;
  const hand = v.hands[seat];
  if (v.phase === 'pass') return v.passing[seat] ? null : { type: 'pass', cards: choosePass(hand, level, rng) };
  if (v.turn !== seat) return null;
  const moves = legal(v, seat);
  if (moves.length === 1 || level === 0) return { type: 'play', card: moves[rng.int(moves.length)] };
  const byRank = (a: Card, b: Card) => a.r - b.r;

  // заход
  if (!v.trick.length) {
    const qsOut = v.taken.some((t) => t.some(isQS)) || hand.some(isQS);
    const safe = moves.filter((c) => !isQS(c) && !(c.s === 'S' && c.r > 12 && !qsOut));
    const pool = safe.length ? safe : moves;
    // сложный: мелкой пикой выманить даму, если её у нас нет и старших пик тоже
    if (level === 2 && !qsOut) {
      const low = pool.filter((c) => c.s === 'S' && c.r < 12).sort(byRank);
      if (low.length) return { type: 'play', card: low[0] };
    }
    const lowest = pool.slice().sort((a, b) => a.r - b.r + (a.s === 'H' ? 3 : 0) - (b.s === 'H' ? 3 : 0))[0];
    return { type: 'play', card: lowest };
  }

  const suit = v.trick[0].card.s;
  const follow = moves[0].s === suit && moves.every((c) => c.s === suit);
  const pts = v.trick.reduce((x, t) => x + cardPts(t.card), 0);
  const last = v.trick.length === v.seats.length - 1;
  if (follow) {
    const top = Math.max(...v.trick.filter((t) => t.card.s === suit).map((t) => t.card.r));
    const under = moves.filter((c) => c.r < top).sort(byRank);
    // не беру: старшая из тех, что ниже победителя (избавиться от высоких безопасно)
    if (under.length) {
      const pick = under[under.length - 1];
      // на пиках даму под туза/короля — сразу
      return { type: 'play', card: under.find(isQS) ?? pick };
    }
    // взять всё равно придётся: последним и без очков — самой старшей, иначе — самой младшей
    const sorted = moves.slice().sort(byRank);
    const noQ = sorted.filter((c) => !isQS(c));
    const pool = noQ.length ? noQ : sorted;
    return { type: 'play', card: last && pts === 0 ? pool[pool.length - 1] : pool[0] };
  }
  // нечем ходить в масть — сброс: дама пик, потом старшие пики, потом черви, потом старшие
  const sorted = moves.slice().sort((a, b) => danger(b) - danger(a));
  // сложный: не сливать очки тому, кто идёт на «луну» — грубо: если у одного все очки, сбрасываем не черву
  if (level === 2) {
    const w = trickWinner(v.trick);
    const raw = v.seats.map((p) => v.taken[p].reduce((x, c) => x + cardPts(c), 0));
    const total = raw.reduce((a, b) => a + b, 0);
    if (total >= 10 && raw[w] === total) {
      const clean = sorted.filter((c) => !cardPts(c));
      if (clean.length) return { type: 'play', card: clean[0] };
    }
  }
  return { type: 'play', card: sorted[0] };
}
