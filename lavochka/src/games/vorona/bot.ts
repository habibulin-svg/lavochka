/* «Белая ворона» — боты. Лёгкий покупает и рискует наугад, банком почти не пользуется. Средний покупает бизнес, пока до конца
 * игры есть время дойти до «Клиента», гасит заём в День Белой Вороны. Сложный ещё и считает: бизнес — только если прибыль
 * больше процентов по займу, лишние деньги — во вклад под 10 %, страховки — когда впереди не меньше двух месяцев. */
import type { Rng } from '../../core/types';
import { MAIL, PAYDAY } from './data';
import { bizList, type Action, type State } from './engine';

/** Сколько ещё клеток календаря пройдёт игрок до конца партии. */
const daysLeft = (s: State, seat: number) => (s.months - s.month[seat] - 1) * PAYDAY + (PAYDAY - s.pos[seat]);

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  const cash = s.cash[seat];
  switch (s.phase) {
    case 'roll':
      return { type: 'roll' };
    case 'mail': {
      const m = MAIL[s.card!.id];
      if (m.kind === 'risk') return level === 0 ? (rng.next() < 0.6 ? { type: 'buy' } : { type: 'pass' }) : { type: 'buy' };
      const months = s.months - s.month[seat];
      if (level === 0) return rng.next() < 0.4 ? { type: 'buy' } : { type: 'pass' };
      return months >= (level === 2 ? 2 : 3) ? { type: 'buy' } : { type: 'pass' };
    }
    case 'biz': {
      const b = bizList(s)[s.card!.id];
      const left = daysLeft(s, seat);
      if (level === 0) return rng.next() < 0.5 && left > 6 ? { type: 'buy' } : { type: 'pass' };
      // «Клиент» — четыре клетки в месяц: в среднем раз в 7–8 дней
      if (left < (level === 2 ? 9 : 12)) return { type: 'pass' };
      if (level === 2) {
        const borrow = Math.max(0, b.cost - cash);
        const interest = borrow > 100 ? borrow * 0.2 : 0;
        if (b.price - b.cost <= interest) return { type: 'pass' };
      }
      return { type: 'buy' };
    }
    case 'client': {
      // продать самое прибыльное
      const list = s.biz[seat];
      let best = 0;
      list.forEach((id, i) => {
        const b = bizList(s)[id];
        const top = bizList(s)[list[best]];
        if (b.price - b.cost > top.price - top.cost) best = i;
      });
      return { type: 'sell', i: best };
    }
    case 'payday': {
      const bank = s.bank[seat];
      const reserve = [300, 200, 150][level];
      // сначала погасить заём
      if (bank < 0) {
        const can = Math.floor(Math.min(-bank, cash - (level === 0 ? 400 : 0)) / 50) * 50;
        if (can >= 50) return { type: 'bank', n: can };
      }
      // лишнее — во вклад (лёгкий не копит)
      if (level > 0 && s.bank[seat] >= 0) {
        const last = s.month[seat] + 1 >= s.months;
        const extra = Math.floor((cash - reserve) / 50) * 50;
        if (!last && extra >= 100) return { type: 'bank', n: level === 2 ? extra : Math.floor(extra / 100) * 50 || 50 };
      }
      return { type: 'done' };
    }
  }
  return null;
}
