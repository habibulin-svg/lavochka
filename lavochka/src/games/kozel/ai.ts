/* Козёл — боты. Видят свою руку и взятку на столе; знают, кто напарник.
 *   Лёгкий — любая допустимая карта;
 *   Средний — берёт взятку, если на ней есть очки, самой дешёвой бьющей; не может — сносит пустую карту;
 *   Сложный — ещё и «смазывает»: когда взятку держит напарник, подкладывает ему туза или десятку; заходит с тузов простых мастей. */
import type { Rng } from '../../core/types';
import type { Card } from '../../cards/deck';
import { isTrump, legal, POINTS, power, team, trickWinner, type Action, type View } from './engine';

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (v.over || v.turn !== seat) return null;
  const moves = legal(v, seat);
  if (moves.length === 1 || level === 0) return { type: 'play', card: moves[rng.int(moves.length)] };
  const T = v.trump;
  const cost = (c: Card) => POINTS[c.r] + (isTrump(c, T) ? 8 + power(c, T) / 40 : 0);
  const cheapest = (cs: Card[]) => cs.slice().sort((a, b) => cost(a) - cost(b))[0];

  if (!v.trick.length) {
    // заход: туз простой масти — пока не перебили; иначе мелочь
    const aces = moves.filter((c) => c.r === 14 && !isTrump(c, T));
    if (aces.length && (level === 2 || rng.next() < 0.5)) return { type: 'play', card: aces[0] };
    return { type: 'play', card: cheapest(moves) };
  }
  const w = trickWinner(v.trick, T);
  const partnerHolds = team(w) === team(seat);
  const onTable = v.trick.reduce((x, t) => x + POINTS[t.card.r], 0);
  const last = v.trick.length === 3;
  const winners = moves.filter((c) => trickWinner([...v.trick, { seat, card: c }], T) === seat);

  if (partnerHolds) {
    // напарник держит: последним — смело смазать; иначе сложный тоже смазывает, если напарник держит козырем-валетом
    const sure = last || (level === 2 && power(v.trick.find((t) => t.seat === w)!.card, T) >= 298);
    if (sure) {
      const fat = moves.filter((c) => !isTrump(c, T) || c.r === 14 || c.r === 10).sort((a, b) => POINTS[b.r] - POINTS[a.r])[0];
      if (fat && POINTS[fat.r] >= 10) return { type: 'play', card: fat };
    }
    return { type: 'play', card: cheapest(moves) };
  }
  if (winners.length && (onTable >= (level === 2 ? 3 : 10) || last)) return { type: 'play', card: cheapest(winners) };
  // не взять — снести пустое
  const empty = moves.slice().sort((a, b) => POINTS[a.r] - POINTS[b.r] || cost(a) - cost(b));
  return { type: 'play', card: empty[0] };
}
