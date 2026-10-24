/* Канаста — боты. Видят свою руку, комбинации обеих пар, колоду сброса.
 *   Лёгкий — берёт из колоды, выкладывает натуральные тройки, сбрасывает наугад из одиночек;
 *   Средний — берёт колоду сброса, когда может, выкладывает всё натуральное и докладывает, дикие — к комбинациям,
 *             которым до канасты не хватает одной-двух; сбрасывает одиночки, которых нет в комбинациях соперников;
 *   Сложный — ещё и прячет карты до выхода (не раскрывается без нужды, пока нет минимума), а когда колода сброса велика
 *             и соперник собирает, — сбрасывает чёрную тройку (её взять нельзя). */
import type { Rng } from '../../core/types';
import { canastasNeeded, canTakePile, cardValue, isBlack3, isCanasta, isWild, minMeld, teamOf, validMeld, type Action, type CCard, type View } from './engine';

/** Натуральные карты руки по достоинствам. */
function byRank(hand: CCard[]): Map<number, CCard[]> {
  const m = new Map<number, CCard[]>();
  for (const c of hand) if (!isWild(c) && c.r !== 3) m.set(c.r, [...(m.get(c.r) ?? []), c]);
  return m;
}

/** Что можно выложить сейчас: группы натуральных от трёх, к своим — любые натуральные, дикие — к почти канастам. */
function plan(v: View, seat: number, level: number): { rank: number; cards: CCard[] }[] {
  const team = teamOf(v, seat);
  const hand = v.hands[seat];
  const own = v.melds[team];
  const groups: { rank: number; cards: CCard[] }[] = [];
  for (const [r, cs] of byRank(hand)) {
    const has = own.find((m) => m.rank === r);
    if (has || cs.length >= 3) groups.push({ rank: r, cards: cs.slice() });
  }
  // дикие: к группам, где их меньше чем натуральных, ближе к канасте
  if (level > 0) {
    const w = hand.filter(isWild);
    for (const c of w) {
      const best = groups
        .map((g) => ({ g, total: (own.find((m) => m.rank === g.rank)?.cards ?? []).concat(g.cards) }))
        .filter(({ g, total }) => validMeld(g.rank, [...total, c]) && total.length >= 4 && total.length < 7)
        .sort((a, b) => b.total.length - a.total.length)[0];
      if (best) best.g.cards.push(c);
    }
  }
  return groups.filter((g) => validMeld(g.rank, [...(own.find((m) => m.rank === g.rank)?.cards ?? []), ...g.cards]));
}

function chooseDiscard(v: View, seat: number, level: number, rng: Rng): CCard {
  const hand = v.hands[seat];
  const team = teamOf(v, seat);
  const opp = 1 - team;
  const oppRanks = new Set((v.melds[opp] ?? []).map((m) => m.rank));
  const ranks = byRank(hand);
  const cands = hand.filter((c) => !isWild(c));
  if (!cands.length) return hand[0];
  if (level === 0) return cands[rng.int(cands.length)];
  // чёрная тройка — стопор: сложный бросает, когда колода сброса велика
  const b3 = cands.find(isBlack3);
  if (b3 && (level === 2 ? v.pile.length >= 4 : true)) return b3;
  let best = cands[0];
  let bv = Infinity;
  for (const c of cands) {
    let s = (ranks.get(c.r)?.length ?? 0) * 10 + cardValue(c) * 0.2;
    if (oppRanks.has(c.r)) s += 15; // соперник может доложить из колоды
    if (v.melds[team].some((m) => m.rank === c.r)) s += 20;
    if (s < bv) (bv = s), (best = c);
  }
  return best;
}

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (v.over || v.turn !== seat) return null;
  const team = teamOf(v, seat);
  const hand = v.hands[seat];
  if (v.phase === 'draw') {
    if (level > 0 && v.pile.length) {
      const top = v.pile[v.pile.length - 1];
      const nat = hand.filter((c) => !isWild(c) && c.r === top.r);
      const tries: CCard[][] = [nat.slice(0, 2), nat.slice(0, 1).concat(hand.filter(isWild).slice(0, 1)), []];
      // для первой выкладки добавим всё натуральное
      if (!v.opened[team]) for (const g of plan(v, seat, level)) if (g.rank !== top.r) tries.unshift([...nat, ...g.cards]);
      for (const t of tries) if (canTakePile(v, seat, t) && (v.pile.length >= 2 || level === 2)) return { type: 'pile', cards: t };
    }
    return { type: 'draw' };
  }
  const groups = plan(v, seat, level);
  if (groups.length) {
    const sum = groups.reduce((x, g) => x + g.cards.reduce((y, c) => y + cardValue(c), 0), 0);
    const cnt = groups.reduce((x, g) => x + g.cards.length, 0);
    const opened = v.opened[team];
    const enough = opened || sum >= minMeld(v.score[team]);
    // не выкладывать почти всё: нужны карты для сброса (или выход с канастой — движок проверит)
    const keep = hand.length - cnt;
    const canOut = v.melds[team].filter(isCanasta).length >= canastasNeeded(v);
    if (enough && (keep >= 2 || canOut)) {
      // сложный не спешит раскрываться ради одной тройки в начале
      if (!(level === 2 && !opened && sum < minMeld(v.score[team]) + 10 && v.stockLeft > 60 && hand.length > 8)) return { type: 'meld', groups };
    }
  }
  return { type: 'discard', card: chooseDiscard(v, seat, level, rng) };
}
