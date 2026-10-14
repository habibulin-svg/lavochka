/* Сундучок — боты. Видят свою руку, сундучки, сколько карт у каждого и открытую память стола (кто какой ранг просил и не отдал).
 *   Лёгкий — просит случайный свой ранг у случайного соперника;
 *   Средний — тянет к сундучку ранг, которого больше всего на руке, просит у того, у кого больше карт;
 *   Сложный — сначала бьёт по тем, кто точно держит нужный ранг (сам его просил), добивает тройки. */
import type { Rng } from '../../core/types';
import { SUITS, type Suit } from '../../cards/deck';
import { canAsk, countOf, lackKey, type Action, type View } from './engine';

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (v.over || v.turn !== seat) return null;
  const hand = v.hands[seat];
  if (!hand.length) return null;
  const targets = v.seats.filter((t) => canAsk(v, seat, t));
  if (!targets.length) return null;
  const cnt = new Map<number, number>();
  for (const c of hand) cnt.set(c.r, (cnt.get(c.r) ?? 0) + 1);
  const ranks = [...cnt.keys()];
  /** Масти, которых нет на руке (вариант «с мастью»); у target не спрашиваем то, чего у него точно нет. */
  const missing = (r: number, t: number): Suit[] => SUITS.filter((s) => !hand.some((c) => c.r === r && c.s === s) && (level === 0 || !v.lacks[t].includes(lackKey(r, s))));
  const ask = (target: number, rank: number): Action => {
    if (!v.cfg.suit) return { type: 'ask', target, rank };
    const m = missing(rank, target);
    const all = SUITS.filter((s) => !hand.some((c) => c.r === rank && c.s === s));
    const pool = m.length ? m : all;
    return { type: 'ask', target, rank, suit: pool[rng.int(pool.length)] };
  };

  if (level === 0) return ask(targets[rng.int(targets.length)], ranks[rng.int(ranks.length)]);

  if (level === 2) {
    // точно известно, у кого лежит нужный ранг
    const sure: { t: number; r: number; w: number }[] = [];
    for (const t of targets) for (const r of v.known[t]) if (cnt.has(r)) sure.push({ t, r, w: cnt.get(r)! * 10 + rng.next() });
    if (sure.length) {
      sure.sort((a, b) => b.w - a.w);
      return ask(sure[0].t, sure[0].r);
    }
  }
  // ранг ближе к сундучку — у того, у кого больше карт; кто уже сказал «нет» и ничего не брал — того не спрашиваем
  const order = ranks.sort((a, b) => cnt.get(b)! - cnt.get(a)! || rng.next() - 0.5);
  for (const r of order) {
    const ok = targets.filter((t) => (v.cfg.suit ? missing(r, t).length > 0 : !v.lacks[t].includes(r)));
    if (!ok.length) continue;
    ok.sort((a, b) => countOf(v, b) - countOf(v, a) + (rng.next() - 0.5) * 2);
    return ask(ok[0], r);
  }
  return ask(targets[rng.int(targets.length)], order[0]);
}
