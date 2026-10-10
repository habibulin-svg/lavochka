/* Бура — боты. Видят свою руку, свои взятки, открытый козырь и то, что лежит на столе в этом заходе.
 *   Лёгкий — заходит и отвечает почти наугад, иногда забывает вскрыться;
 *   Средний — заходит мелочью, бьёт, когда взятка того стоит, скидывает пустые карты;
 *   Сложный — ещё и заходит парой-тройкой одной масти, бережёт козыри, считает, что последним бить выгодно всегда. */
import type { Rng } from '../../core/types';
import type { Card } from '../../cards/deck';
import { combos, covers, isBura, isMoscow, leads, pilePoints, POINTS, POWER, TARGET, type Action, type State } from './engine';

const cost = (cs: Card[], trump: string) => cs.reduce((a, c) => a + (c.s === trump ? 8 + POWER[c.r] : POWER[c.r] * 0.6), 0);

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.phase === 'over' || s.turn !== seat) return null;
  const hand = s.hands[seat];
  const trump = s.trump;
  if (s.phase === 'lead') {
    if (isBura(hand, trump)) return { type: 'show', kind: 'bura' };
    if (s.cfg.moscow && isMoscow(hand)) return { type: 'show', kind: 'moscow' };
    const mine = pilePoints(s.piles[seat]);
    // лёгкий иногда «не досчитывает» и вскрывается позже
    if (mine >= TARGET && (level > 0 || rng.next() < 0.7)) return { type: 'declare' };
    const opts = leads(hand);
    if (level === 0) return { type: 'lead', cards: opts[rng.int(opts.length)] };
    const scored = opts.map((cs) => {
      const pts = pilePoints(cs);
      const trumps = cs.filter((c) => c.s === trump).length;
      let v = -pts - trumps * 9 - cs.reduce((a, c) => a + POWER[c.r], 0) * 0.3;
      // сложный: двумя-тремя картами масти тяжело отбиться
      if (level === 2 && cs.length > 1 && !trumps) v += cs.length * 4 + (cs.some((c) => c.r === 14 || c.r === 10) ? 6 : 0);
      return { cs, v: v + rng.next() * 0.5 };
    });
    scored.sort((a, b) => b.v - a.v);
    return { type: 'lead', cards: scored[0].cs };
  }
  // ответ
  const k = s.lead!.cards.length;
  const best = s.best!;
  const beaters = combos(hand, k).filter((cs) => covers(cs, best.cards, trump));
  const last = (s.seats.indexOf(seat) + 1) % s.seats.length === s.seats.indexOf(s.lead!.seat);
  const onTable = pilePoints(s.lead!.cards) + s.answers.reduce((a, x) => a + pilePoints(x.cards), 0);
  const skip = (): Action => {
    const pick = combos(hand, k).sort((a, b) => pilePoints(a) + cost(a, trump) * 0.5 - (pilePoints(b) + cost(b, trump) * 0.5))[0];
    return { type: 'skip', cards: pick };
  };
  if (!beaters.length) return skip();
  if (level === 0) return rng.next() < 0.6 ? { type: 'beat', cards: beaters[rng.int(beaters.length)] } : skip();
  const cheapest = beaters.slice().sort((a, b) => cost(a, trump) - cost(b, trump))[0];
  const gain = onTable + pilePoints(cheapest);
  // последним бить выгодно всегда; иначе — если на кону есть очки
  if (last || gain >= (level === 2 ? 8 : 11) || POINTS[best.cards[0].r] >= 10) return { type: 'beat', cards: cheapest };
  return skip();
}
