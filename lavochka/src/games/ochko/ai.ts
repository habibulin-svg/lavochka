/* Очко и блэкджек — боты. Видят только свой view: свои карты, открытые чужие, открытую карту дилера. */
import type { Rng } from '../../core/types';
import { makeDeck, type Card } from '../../cards/deck';
import { betRange, canDo, cardPts, total, type Action, type View } from './engine';

/** Доля карт, что не дадут перебора (по картам, которых не видно). */
function pSafe(v: View, mine: Card[]): number {
  const seen = new Set<string>();
  const add = (c: Card) => c.r && seen.add(c.s + c.r);
  mine.forEach(add);
  v.dealer.forEach(add);
  for (const p of v.seats) for (const h of v.hands[p]) h.cards.forEach(add);
  const rest = makeDeck(v.cfg.deck).filter((c) => !seen.has(c.s + c.r));
  if (!rest.length) return 0;
  const ok = rest.filter((c) => total(v.cfg, [...mine, c]).n <= 21).length;
  return ok / rest.length;
}

function bet(v: View, seat: number, level: number, rng: Rng): Action {
  const { min, max } = betRange(v, seat);
  const clamp = (x: number) => ({ type: 'bet' as const, n: Math.max(min, Math.min(max, Math.round(x))) });
  if (v.cfg.bj) {
    const m = v.money[seat];
    if (level === 0) return clamp(min + rng.int(4) * 5);
    return clamp(Math.max(min, Math.round((m * (level === 1 ? 0.1 : 0.07)) / 5) * 5));
  }
  // очко: ставка по первой карте
  const c = v.hands[seat][0].cards[0];
  const pts = cardPts(v.cfg, c);
  if (level === 0) return clamp(1 + rng.int(Math.max(1, Math.ceil(max * 0.4))));
  const good = pts >= 10 ? 1 : pts >= 8 ? 0.5 : pts <= 4 ? 0.35 : 0.2;
  // сложный: с тузом и маленьким банком — на весь банк
  if (level === 2 && pts === 11 && max <= v.money[seat] * 0.5) return clamp(max);
  return clamp(max * (level === 2 ? 0.5 : 0.35) * good + 1);
}

/** Очко: брать ли ещё понтёру. */
function ochkoHit(v: View, cards: Card[], level: number, rng: Rng): boolean {
  const n = total(v.cfg, cards).n;
  if (level === 0) return n < 14 + rng.int(4);
  if (level === 1) return n < 17;
  return n < 17 || pSafe(v, cards) > 0.5;
}

/** Блэкджек: базовая стратегия (сложный — полная, средний — упрощённая). */
function bjMove(v: View, seat: number, level: number, rng: Rng): Action {
  const h = v.hands[seat][v.hi];
  const { n, soft } = total(v.cfg, h.cards);
  const u = cardPts(v.cfg, v.dealer[0]);
  const can = canDo(v, seat);
  if (level === 0) return { type: n < 15 + rng.int(3) ? 'hit' : 'stand' };
  const hit: Action = { type: 'hit' };
  const stand: Action = { type: 'stand' };
  const dbl = (or: Action): Action => (can.double ? { type: 'double' } : or);
  if (can.split) {
    const r = cardPts(v.cfg, h.cards[0]);
    const yes =
      r === 11 || r === 8 ||
      (level === 2 && (((r === 2 || r === 3 || r === 7) && u <= 7) || (r === 6 && u <= 6) || (r === 9 && u <= 9 && u !== 7) || (r === 4 && (u === 5 || u === 6))));
    if (yes) return { type: 'split' };
  }
  if (level === 2 && can.surrender && !soft && ((n === 16 && u >= 9) || (n === 15 && u === 10))) return { type: 'surrender' };
  if (soft && level === 2) {
    if (n >= 19) return stand;
    if (n === 18) return u >= 3 && u <= 6 ? dbl(stand) : u <= 8 ? stand : hit;
    const from = n <= 14 ? 5 : n <= 16 ? 4 : 3;
    return u >= from && u <= 6 ? dbl(hit) : hit;
  }
  if (soft) return n >= 18 ? stand : hit;
  if (n <= 8) return hit;
  if (n === 9) return level === 2 && u >= 3 && u <= 6 ? dbl(hit) : hit;
  if (n === 10) return u <= 9 ? dbl(hit) : hit;
  if (n === 11) return u <= 10 ? dbl(hit) : hit;
  if (n === 12) return u >= 4 && u <= 6 ? stand : hit;
  if (n <= 16) return u <= 6 ? stand : hit;
  return stand;
}

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (v.over) return null;
  if (v.phase === 'dealer') {
    if (seat !== v.banker) return null;
    const n = total(v.cfg, v.dealer).n;
    const more = n < 17 || (level === 2 && n === 17 && pSafe(v, v.dealer) > 0.6) || (level === 0 && n < 19 && rng.int(3) === 0);
    return { type: more ? 'hit' : 'stand' };
  }
  if (v.turn !== seat) return null;
  if (v.phase === 'bet') return bet(v, seat, level, rng);
  if (v.phase === 'insure') return { type: 'insure', yes: level === 0 && rng.int(3) === 0 };
  if (v.phase !== 'play') return null;
  if (v.cfg.bj) return bjMove(v, seat, level, rng);
  const h = v.hands[seat][v.hi];
  return { type: ochkoHit(v, h.cards, level, rng) ? 'hit' : 'stand' };
}
