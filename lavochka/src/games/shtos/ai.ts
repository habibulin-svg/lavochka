/* Штос — боты. Все вышедшие карты открыты, колоду не видит никто — бот видит то же, что человек (сколько осталось каждого достоинства).
 *   Лёгкий — ставит на что попало и сколько попало, углы гнёт азартно, иногда ставит медью;
 *   Средний — играет «мирандолем»: одна и та же ставка, углов не гнёт, выигрыш в карман, куш оставляет;
 *   Сложный — ставит на карты, которых осталась одна («последняя» — плие ей не грозит), ставку держит долей от денег,
 *             угол гнёт только на последней карте и когда отстаёт; банк держит покрупнее — преимущество банкомёта в плие. */
import type { Rng } from '../../core/types';
import { bankChoices, canParoli, canPaix, canStake, MIN_BET, pending, ranksOf, room, stakeRange, type Action, type View } from './engine';

const round10 = (n: number) => Math.max(MIN_BET, Math.floor(n / 10) * 10);

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (v.over || v.turn !== seat) return null;
  if (v.phase === 'deal') return { type: 'deal' };
  if (v.phase === 'bank') {
    const ch = bankChoices(v, seat);
    if (level <= 0) return { type: 'bank', n: ch[rng.int(ch.length)] };
    if (level === 1) return { type: 'bank', n: ch.includes(200) ? 200 : ch[ch.length - 1] };
    const want = v.money[seat] * 0.4;
    const fit = ch.filter((n) => n <= want);
    return { type: 'bank', n: fit.length ? fit[fit.length - 1] : ch[0] };
  }
  if (v.phase !== 'stake') return null;

  const money = v.money[seat];
  const leader = Math.max(...v.seats.filter((x) => x !== seat).map((x) => v.money[x]), 0);

  // выигрыш — решить про угол
  const won = pending(v, seat)[0];
  if (won) {
    const rest = v.rest[won.rank] ?? 0;
    if (level <= 0) {
      if (canParoli(v, won) && rng.next() < 0.5) return { type: 'paroli', rank: won.rank };
      if (canPaix(v, won) && rng.next() < 0.5) return { type: 'paix', rank: won.rank };
      return { type: 'take', rank: won.rank };
    }
    if (level === 1) return canPaix(v, won) ? { type: 'paix', rank: won.rank } : { type: 'take', rank: won.rank };
    if (rest === 1 && won.level < 2 && money < leader && canParoli(v, won)) return { type: 'paroli', rank: won.rank };
    if (rest === 1 && canPaix(v, won)) return { type: 'paix', rank: won.rank };
    return { type: 'take', rank: won.rank };
  }

  // новая ставка
  const mine = v.bets.filter((b) => b.seat === seat).length;
  const want = level <= 0 ? 1 + rng.int(2) : level === 1 ? 1 : money < leader ? 2 : 1;
  const [lo, hi] = stakeRange(v, seat);
  if (mine < want && hi >= lo && room(v) >= MIN_BET) {
    const free = ranksOf(v.cfg).filter((r) => (v.rest[r] ?? 0) > 0 && !v.bets.some((b) => b.seat === seat && b.rank === r));
    let pick = free;
    if (level >= 2) {
      const min = Math.min(...free.map((r) => v.rest[r]));
      pick = free.filter((r) => v.rest[r] === min);
    }
    if (pick.length) {
      const rank = pick[rng.int(pick.length)];
      let n: number;
      if (level <= 0) n = round10(10 + rng.int(Math.min(hi, 150)));
      else if (level === 1) n = 50;
      else n = round10(money * (money < leader && v.talia >= v.talias - 1 ? 0.12 : 0.06));
      n = Math.max(lo, Math.min(hi, n));
      const copper = v.cfg.copper && level <= 0 && rng.next() < 0.2;
      if (canStake(v, seat, rank, n, copper)) return { type: 'stake', rank, n, copper };
    }
  }
  return { type: 'done' };
}
