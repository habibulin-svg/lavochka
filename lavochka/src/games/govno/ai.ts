/* Г*вно — боты. Видят только свою руку и ладони на столе.
 *   Лёгкий — копит что попало, хлопает через 1,3–2,2 с;
 *   Средний — копит достоинство, которого больше всего, хлопает через 0,9–1,5 с;
 *   Сложный — то же, хлопает через 0,55–0,85 с. В «тихой» игре все замечают чужой хлопок чуть позже.
 * Человеку на телефоне нужно около секунды, чтобы заметить ладонь и нажать: средний бот — вровень с ним. */
import type { Rng } from '../../core/types';
import type { Card } from '../../cards/deck';
import { cid, hasFour, type Input, type View } from './engine';

const DELAY: [number, number][] = [
  [1300, 2200],
  [900, 1500],
  [550, 850],
];

interface Mem {
  round?: number;
  slap?: number;
  at?: number;
  keep?: number;
}

/** Какую карту отдать: держим достоинство, которого больше всего, отдаём из самого редкого. */
export function passCard(hand: Card[], level: number, rng: Rng, keep?: number): { card: Card | undefined; keep: number | undefined } {
  if (!hand.length) return { card: undefined, keep };
  const cnt = new Map<number, number>();
  for (const c of hand) cnt.set(c.r, (cnt.get(c.r) ?? 0) + 1);
  const top = Math.max(...cnt.values());
  if (keep == null || (cnt.get(keep) ?? 0) < top) keep = [...cnt.keys()].find((r) => cnt.get(r) === top);
  const rest = hand.filter((c) => c.r !== keep);
  if (!rest.length) return { card: undefined, keep };
  if (level === 0 && rng.next() < 0.35) return { card: hand[rng.int(hand.length)], keep };
  rest.sort((a, b) => (cnt.get(a.r) ?? 0) - (cnt.get(b.r) ?? 0));
  return { card: rest[0], keep };
}

export function botInput(v: View, seat: number, level: number, mem0: Record<string, unknown>, rng: Rng): Input {
  const mem = mem0 as Mem;
  if (mem.round !== v.round) {
    mem.round = v.round;
    mem.at = undefined;
  }
  mem.slap = Math.max(mem.slap ?? 0, v.slapN[seat]);
  const hand = v.hands[seat];
  const [lo, hi] = DELAY[Math.max(0, Math.min(2, level))];
  const delay = () => lo + rng.next() * (hi - lo) + (v.cfg.silent ? 250 : 0);
  let slap = mem.slap;
  if ((v.phase === 'look' || v.phase === 'pass') && hasFour(hand)) {
    // собрал — хлопнуть, чуть помедлив
    mem.at ??= v.t + delay() - (v.cfg.silent ? 250 : 0);
    if (v.t >= mem.at) slap = mem.slap + 1;
  } else if (v.phase === 'slap' && !v.slaps.some((x) => x.seat === seat)) {
    mem.at ??= v.slapAt + delay();
    if (v.t >= mem.at) slap = mem.slap + 1;
  } else mem.at = undefined;
  if (slap > mem.slap) mem.slap = slap;
  let pick: string | null = null;
  if (v.phase === 'look' || v.phase === 'pass') {
    const r = passCard(hand, level, rng, mem.keep);
    mem.keep = r.keep;
    pick = r.card ? cid(r.card) : null;
  }
  return { pick, tact: v.tacts, slap };
}
