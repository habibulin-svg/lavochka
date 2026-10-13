/* «Вестерн» — боты. Лёгкий решает почти наугад и банком не пользуется. Средний покупает, пока остаётся запас наличных, держится
 * делового пути, продаёт товары на рынках и акции на спекулятивной бирже за три цены. Сложный считает окупаемость акций до конца игры,
 * берёт кредит под выгодную покупку и гасит его, ставит на звезду и в казино (там выигрыш в среднем больше ставки), ходит в колонию
 * и на скользкий путь, когда это выгодно. Бот видит то же, что и человек: в «Вестерне» скрытого нет. */
import type { Rng } from '../../core/types';
import { CO, GOOD_IDS, LEAD } from './data';
import { coValue, goodPrice, owned, worth, type Action, type Ask, type State } from './engine';

const pick = (a: Ask, id: string): Action => ({ type: 'choose', id: a.opts.some((o) => o.id === id) ? id : a.opts.find((o) => o.main)?.id ?? a.opts[0].id });
const has = (a: Ask, id: string) => a.opts.some((o) => o.id === id);

/** Сколько кругов ещё впереди у игрока. */
const lapsLeft = (s: State, seat: number) => Math.max(0, s.circles - s.circle[seat]);

/** Сколько принесёт акция до конца игры (с продажей банку в конце по номиналу — она входит в итог). */
function gain(s: State, seat: number, cell: number, price: number) {
  return CO[cell].profit * Math.max(0, lapsLeft(s, seat) - 0.5) + coValue(s, cell) - price;
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.phase === 'roll') return { type: 'roll' };
  const a = s.ask;
  if (!a || a.seat !== seat) return null;
  const cash = s.cash[seat];
  const reserve = [3000, 8000, 3000][level];
  const r = () => rng.next();

  switch (a.kind) {
    case 'fork': {
      if (level === 0) return { type: 'choose', id: a.opts[rng.int(a.opts.length)].id };
      switch (a.cell) {
        case 5:
          // скользкий путь: наркотики дороже продать, подкуп спасает от тюрьмы
          return pick(a, level === 2 && (s.stuff[seat].drugs > 0 || s.flags[seat].includes('bribe')) && lapsLeft(s, seat) > 1 ? '91' : '6');
        case 48:
          return pick(a, level === 2 && s.stuff[seat].trinkets > 0 && cash > 60000 && lapsLeft(s, seat) > 1 ? '111' : '49');
        case 57: {
          const rich = CO_FREE(s, [117, 128, 130]).some((c) => coValue(s, c) <= cash - reserve);
          return pick(a, level === 2 && rich && lapsLeft(s, seat) > 1 ? '114' : '58');
        }
        case 77:
          return pick(a, '78');
        case 100:
          return pick(a, '105');
        case 129:
          return pick(a, level === 2 && s.owner[130] == null && cash > coValue(s, 130) + reserve ? '130' : '131');
      }
      return pick(a, a.opts[0].id);
    }
    case 'buy': {
      const price = coValue(s, a.cell);
      if (level === 0) return pick(a, r() < 0.6 && cash - price >= reserve ? 'yes' : 'no');
      if (cash - price < reserve) return pick(a, 'no');
      if (level === 1) return pick(a, lapsLeft(s, seat) >= 1 ? 'yes' : 'no');
      return pick(a, gain(s, seat, a.cell, price) > 0 ? 'yes' : 'no');
    }
    case 'auction': {
      const v = coValue(s, a.cell);
      const max = level === 0 ? v * (0.5 + r() * 0.4) : level === 1 ? v * 0.9 : Math.min(v + CO[a.cell].profit * Math.max(0, lapsLeft(s, seat) - 1), v * 1.5);
      return pick(a, a.price! <= max && cash - a.price! >= reserve ? 'bid' : 'pass');
    }
    case 'bank':
      return bankChoice(s, seat, level, a);
    case 'market':
      // товары лежат без дохода — продать всё (сложный придерживает золото на откупы)
      for (const o of a.opts) if (o.id !== 'done' && !(level === 2 && o.id === 'gold' && s.gold[seat] <= 5)) return pick(a, o.id);
      return pick(a, 'done');
    case 'spec': {
      const k = a.cell === 18 ? 3 : 1.5;
      if (level === 0) return pick(a, 'done');
      const mine = owned(s, seat);
      // за три цены — почти всегда выгодно; за полторы — то, что не окупится до конца игры
      let best: number | null = null;
      let bestGain = 0;
      for (const c of mine) {
        const sell = coValue(s, c) * k;
        const keep = CO[c].profit * lapsLeft(s, seat) + coValue(s, c);
        const d = sell - keep;
        if (d > bestGain && (level === 2 || k === 3)) {
          bestGain = d;
          best = c;
        }
      }
      return pick(a, best != null ? String(best) : 'done');
    }
    case 'xbuy': {
      if (level < 2) return pick(a, 'done');
      for (const o of a.opts) {
        if (o.id === 'done') continue;
        const c = Number(o.id);
        const p = Math.round(coValue(s, c) * 1.5);
        if (cash - p >= reserve * 2 && gain(s, seat, c, p) > 0) return pick(a, o.id);
      }
      return pick(a, 'done');
    }
    case 'offer': {
      const c = a.target!;
      if (level === 0) return pick(a, r() < 0.5 ? 'yes' : 'no');
      // согласиться, если цена больше того, что акция принесёт до конца игры
      const keep = CO[c].profit * lapsLeft(s, seat) + coValue(s, c);
      return pick(a, a.price! > keep || (level === 1 && r() < 0.3) ? 'yes' : 'no');
    }
    case 'drugs':
      return pick(a, level === 1 && cash > 60000 && r() < 0.3 ? '5' : level === 0 && r() < 0.3 ? '10' : '0');
    case 'drugsell':
      // дальше по скользкому пути дороже, но можно и не дойти
      return pick(a, level === 2 && a.cell < 104 ? 'no' : 'yes');
    case 'bribe':
      return pick(a, (s.stuff[seat].drugs > 0 && level > 0) || (level === 2 && cash > 20000) || (level === 0 && r() < 0.3) ? 'yes' : 'no');
    case 'star':
      // остановиться на 40 или 41 в этом кругу — больше чем в половине случаев, а платят впятеро
      return pick(a, cash - 5000 >= reserve || level === 0 ? 'yes' : 'no');
    case 'casino':
      if (level === 0) return pick(a, r() < 0.5 ? '1000' : '0');
      return pick(a, level === 2 && cash > 40000 ? '5000' : cash > 15000 ? '1000' : '0');
    case 'army':
      return pick(a, level === 2 && cash > 60000 ? 'yes' : 'no');
    case 'trinkets':
      return pick(a, level === 0 ? (r() < 0.5 ? '10' : '0') : '20');
    case 'gold25':
    case 'terror':
      return pick(a, level > 0 && LEAD.some((c) => s.owner[c] === seat) ? 'yes' : level === 0 && r() < 0.5 ? 'yes' : 'no');
    case 'back52':
      return pick(a, 'no');
    case 'brains':
      return pick(a, lapsLeft(s, seat) >= 3 || level === 0 ? 'yes' : 'no');
    case 'gold108':
      if (level === 0) return pick(a, '0');
      return pick(a, s.gold[seat] < 3 ? (level === 2 ? '5' : '1') : '0');
    case 'jail': {
      // свобода дороже: пропуск хода — это примерно потерянный доход за ход
      const perTurn = level === 2 ? Math.max(2000, worth(s, seat) / 40) : 3000;
      return pick(a, a.price! < perTurn * (a.left ?? 2) || level === 0 ? 'pay' : 'jail');
    }
    case 'ransom':
      return pick(a, 'yes');
    case 'credit':
      return pick(a, level === 2 && CO_FREE(s, [117, 127, 128, 130]).some((c) => coValue(s, c) <= cash * 3 && coValue(s, c) > cash - reserve) ? 'yes' : 'no');
    case 'hit': {
      if (level === 0) return pick(a, r() < 0.2 ? a.opts[0].id : 'no');
      if (level === 1 || cash < 40000) return pick(a, 'no');
      // заказать самого богатого, если 10 % его наличных больше платы
      const rivals = a.opts.filter((o) => o.id !== 'no').map((o) => Number(o.id));
      const top = rivals.sort((p, q) => s.cash[q] - s.cash[p])[0];
      return pick(a, top != null && s.cash[top] * 0.1 > 5000 ? String(top) : 'no');
    }
    case 'media': {
      // уронить товар, которого у меня меньше всего, а у соперников больше
      let best = 'no';
      let score = 0;
      for (const g of GOOD_IDS) {
        if (!has(a, g)) continue;
        const mine = g === 'gold' ? s.gold[seat] : s.stuff[seat][g];
        const theirs = s.seats.filter((p) => p !== seat && !s.out[p]).reduce((n, p) => n + (g === 'gold' ? s.gold[p] : s.stuff[p][g]), 0);
        const d = (theirs - mine) * goodPrice(s, g);
        if (d > score) {
          score = d;
          best = g;
        }
      }
      return pick(a, best);
    }
    case 'goto': {
      if (level === 0) {
        const cos = a.opts.filter((o) => CO[Number(o.id)] && s.owner[Number(o.id)] == null);
        return pick(a, (cos[rng.int(Math.max(1, cos.length))] ?? a.opts[0]).id);
      }
      // сложный — в преступный клан, где капитал удваивается; иначе к лучшей свободной компании или за страховкой
      // партию кончает первый, кто прошёл все круги, — сложный не тратит ходы на скользкий путь
      if (level === 2 && cash >= 150000 && lapsLeft(s, seat) <= 1) return pick(a, '91');
      const main = a.opts.find((o) => o.main);
      return pick(a, main ? main.id : '85');
    }
  }
  return pick(a, a.opts.find((o) => o.main)?.id ?? a.opts[0].id);
}

const CO_FREE = (s: State, cells: number[]) => cells.filter((c) => s.owner[c] == null);

function bankChoice(s: State, seat: number, level: number, a: Ask): Action {
  const cash = s.cash[seat];
  if (level === 0) return pick(a, 'done');
  const id = (p: string) => a.opts.find((o) => o.id.startsWith(p))?.id;
  const last = lapsLeft(s, seat) <= 1;
  // вернуть кредит, когда денег с запасом (проценты дороги), а под конец — и ссуду
  if (s.debt[seat] > 0 && cash > s.debt[seat] + 20000 && id('repay')) return pick(a, id('repay')!);
  if (last && s.loan[seat] > 0 && cash > s.loan[seat] + 10000 && id('loan')) return pick(a, 'loan');
  if (level === 2) {
    // кредит под выгодную свободную компанию впереди
    const want = Object.keys(CO)
      .map(Number)
      .filter((c) => s.owner[c] == null && c < 111 && CO[c].profit / CO[c].price >= 0.3)
      .some((c) => coValue(s, c) > cash && coValue(s, c) <= cash + 50000 - s.borrowed[seat]);
    if (want && !last && id('take:')) {
      const big = a.opts.filter((o) => o.id.startsWith('take:')).pop();
      return pick(a, big!.id);
    }
    if (cash > 200000 && id('dep:')) return pick(a, a.opts.filter((o) => o.id.startsWith('dep:')).pop()!.id);
  }
  if (cash < 5000 && id('take:10000')) return pick(a, 'take:10000');
  return pick(a, 'done');
}
