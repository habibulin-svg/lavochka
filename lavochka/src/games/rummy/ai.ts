/* Рамми, джин и кункен — боты. Видят свою руку, стол, сброс и что соперники брали из сброса.
 *   Лёгкий — берёт из колоды, выкладывает что видит, сбрасывает самую дорогую лишнюю карту;
 *   Средний — берёт из сброса, если карта сразу сокращает «хвост», выкладывает и докладывает всё, сбрасывает дорогое
 *             и не нужное для будущих комбинаций (пары и соседей бережёт); в джине стучит при первой возможности;
 *   Сложный — ещё и не скармливает соседу карты, которые тот брал из сброса (той же масти рядом, того же достоинства);
 *             в джине стучит рано, а с маленьким хвостом дотягивает до джина. */
import type { Rng } from '../../core/types';
import { bestSplit, canLayoff, isJoker, meldValue, same, value, type RCard } from './melds';
import { canMeldNow, canTakeDiscard, KNOCK, OPEN_MIN, rulesOf, splitAll, type Action, type View } from './engine';

/** Ценность карты для руки: часть комбинации — высоко, пара или сосед — средне. */
function keepScore(hand: RCard[], c: RCard): number {
  if (isJoker(c)) return 100;
  let v = 0;
  for (const x of hand) {
    if (x === c || isJoker(x)) continue;
    if (x.r === c.r) v += 3;
    if (x.s === c.s && Math.abs(x.r - c.r) === 1) v += 3;
    if (x.s === c.s && Math.abs(x.r - c.r) === 2) v += 1;
  }
  return v;
}

function chooseDiscard(v: View, seat: number, level: number, picked: RCard[]): RCard {
  const rules = rulesOf(v.cfg);
  const hand = v.hands[seat];
  const split = bestSplit(hand, rules);
  const pool = split.dead.length ? split.dead : hand.filter((c) => !isJoker(c));
  const cands = (pool.length ? pool : hand).filter((c) => !v.mustUse || !same(c, v.mustUse));
  let best = cands[0];
  let bv = -Infinity;
  for (const c of cands) {
    let s = value(c) * (level === 0 ? 1 : 1.2) - (level ? keepScore(hand, c) * 2 : 0);
    if (level === 2) {
      // не кормить соседа: он брал из сброса карты этой масти рядом или того же достоинства
      for (const p of picked) if (p.r === c.r || (p.s === c.s && Math.abs(p.r - c.r) <= 2)) s -= 6;
      // на столе можно доложить — это подарок соседу
      if (v.melds.some((m) => canLayoff(m.cards, c, rules))) s -= 4;
    }
    if (isJoker(c)) s -= 100;
    if (s > bv) (bv = s), (best = c);
  }
  return best;
}

/** Что брал из сброса следующий за мной игрок (ему и скармливать нельзя). */
const pickedOf = (v: View, seat: number): RCard[] => v.took[v.seats[(v.seats.indexOf(seat) + 1) % v.seats.length]] ?? [];

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (v.over || v.turn !== seat) return null;
  const rules = rulesOf(v.cfg);
  const hand = v.hands[seat];
  if (v.phase === 'draw') {
    if (level > 0 && canTakeDiscard(v, seat)) {
      const top = v.discard[v.discard.length - 1];
      const before = bestSplit(hand, rules).deadValue;
      const after = bestSplit([...hand, top], rules);
      // берём, если карта сразу в комбинации и хвост уменьшается
      if (after.melds.some((m) => m.some((c) => same(c, top))) && after.deadValue < before) return { type: 'draw', from: 'discard' };
    }
    return { type: 'draw', from: 'stock' };
  }
  // выкладка и доклад (не в джине)
  if (canMeldNow(v, seat)) {
    const split = bestSplit(hand, rules);
    if (split.melds.length) {
      const cards = split.melds.flat();
      const opened = v.cfg.mode !== 'kunken' || v.opened[seat];
      const total = split.melds.reduce((x, m) => x + meldValue(m, rules), 0);
      if ((opened || total >= OPEN_MIN) && splitAll(cards, rules)) {
        // лёгкий иногда держит карты
        if (!(level === 0 && rng.next() < 0.3)) return { type: 'meld', cards };
      }
    }
    const opened = v.cfg.mode !== 'kunken' || v.opened[seat];
    if (opened)
      for (const c of hand)
        for (const m of v.melds)
          if (canLayoff(m.cards, c, rules) && (level > 0 || rng.next() < 0.5)) {
            // джокер просто так не докладываем
            if (isJoker(c) && hand.length > 1) continue;
            return { type: 'layoff', card: c, meld: m.id };
          }
  }
  if (v.mustUse) {
    // взял из сброса — обязан пустить в дело: выложить с ней
    const split = bestSplit(hand, rules);
    const m = split.melds.find((x) => x.some((c) => same(c, v.mustUse!)));
    if (m) return { type: 'meld', cards: v.cfg.mode === 'kunken' && !v.opened[seat] ? split.melds.flat() : m };
    const lay = v.melds.find((x) => canLayoff(x.cards, v.mustUse!, rules));
    if (lay) return { type: 'layoff', card: v.mustUse, meld: lay.id };
  }
  const card = chooseDiscard(v, seat, level, pickedOf(v, seat));
  if (v.cfg.mode === 'gin') {
    const rest = hand.filter((c) => !same(c, card));
    const dv = bestSplit(rest, rules).deadValue;
    const knockAt = level === 2 ? (v.stockLeft > 20 ? KNOCK : 4) : level === 1 ? KNOCK : 6;
    if (dv === 0 || dv <= knockAt) return { type: 'discard', card, knock: true };
  }
  return { type: 'discard', card };
}
