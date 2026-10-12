/* «Менеджер» / «Космос 2000» — боты. Видят то же, что игрок (view без порядка колод).
 * Лёгкий — покупает почти всё, строит изредка, торгуется скромно; средний — держит запас на ренту, строит на полных группах;
 * сложный — запас по самой дорогой чужой ренте, перебивает на торгах участки, которые замыкают его группу или чужую,
 * сам предлагает выкупить третий участок группы, сидит на бирже, когда поле застроено. */
import type { Rng } from '../../core/types';
import {
  B,
  alive,
  canBuild,
  canMortgage,
  canRedeem,
  canSell,
  groupCells,
  owned,
  redeemCost,
  rent,
  tradeable,
  type Action,
  type State,
} from './engine';

/** Сколько держать в кармане. */
function reserve(s: State, seat: number, level: number): number {
  if (s.map === 'kosmos') return [80, 200, 350][level];
  if (level === 0) return 2000;
  let worst = 0;
  for (let c = 0; c < s.owner.length; c++) {
    const o = s.owner[c];
    if (o != null && o >= 0 && o !== seat) worst = Math.max(worst, rent(s, c));
  }
  return level === 1 ? Math.max(4000, worst * 0.4) : Math.max(6000, worst * 0.7);
}

/** Чего стоит участок для бота: цена плюс польза для групп. */
function value(s: State, seat: number, c: number, level: number): number {
  const cell = B(s).cells[c];
  let v = cell.price!;
  if (s.map !== 'manager' || cell.group == null) return v * (level === 2 ? 1.1 : 1);
  const g = groupCells(s, cell.group).filter((i) => i !== c);
  const mine = g.filter((i) => s.owner[i] === seat).length;
  if (mine === g.length) v *= level === 0 ? 1.3 : 2.2;
  else if (mine > 0 && g.every((i) => s.owner[i] == null || s.owner[i] === seat)) v *= 1.25;
  if (level === 2) {
    const others = g.map((i) => s.owner[i]).filter((o) => o != null && o !== seat);
    if (others.length === g.length && new Set(others).size === 1) v *= 1.6; // замкнул бы чужую группу
  }
  return v;
}

function roundTo(n: number, step: number) {
  return Math.max(step, Math.round(n / step) * step);
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  const b = B(s);
  const res = reserve(s, seat, level);
  const cash = s.cash[seat];
  switch (s.phase) {
    case 'roll': {
      if (s.map === 'manager') {
        if (s.jail[seat]) {
          const built = s.houses.some((h, c) => h > 0 && s.owner[c] !== seat);
          const stay = level === 2 && built;
          if (!stay && s.freeCards[seat].length) return { type: 'useCard' };
          if (!stay && cash >= 500 + res && level > 0) return { type: 'payJail' };
          return { type: 'roll' };
        }
        // выкуп из залога, когда денег с запасом
        if (level > 0) {
          for (const c of owned(s, seat)) if (s.mort[c] && canRedeem(s, seat, c) && cash - redeemCost(s, c) > res * 2) return { type: 'redeem', cell: c };
        }
        // стройка: сначала дорогие группы, равномерно
        const can = owned(s, seat).filter((c) => canBuild(s, seat, c)).sort((a, c) => b.cells[c].price! - b.cells[a].price!);
        for (const c of can) {
          const cost = b.cells[c].build!;
          if (level === 0 ? cash - cost >= res * 2 && rng.next() < 0.6 : cash - cost >= res) return { type: 'build', cell: c };
        }
        // сделка: докупить третий участок группы
        if (level === 2 && s.offers === 0 && rng.next() < 0.4) {
          const o = groupDeal(s, seat, res);
          if (o) return o;
        }
      }
      return { type: 'roll' };
    }
    case 'buy': {
      const c = s.pos[seat];
      const price = b.cells[c].price!;
      if (cash < price) return { type: 'pass' };
      const v = value(s, seat, c, level);
      if (level === 0) return rng.next() < 0.85 ? { type: 'buy' } : { type: 'pass' };
      if (cash - price >= res * (v > price * 1.5 ? 0.3 : 1)) return { type: 'buy' };
      return { type: 'pass' };
    }
    case 'auction': {
      const a = s.auction!;
      const v = value(s, seat, a.cell, level) * [0.7, 1, 1.15][level];
      const max = Math.min(v, cash - (level === 0 ? 0 : res * 0.5));
      const price = b.cells[a.cell].price!;
      const next = a.bid ? a.bid + roundTo(Math.max(b.step, a.bid * 0.1), b.step) : roundTo(price * 0.5, b.step);
      if (next <= max && next <= cash) return { type: 'bid', amount: next };
      return { type: 'fold' };
    }
    case 'offer': {
      const o = s.offer!;
      // бот — o.to: получает участки o.give и деньги o.cash (если > 0), отдаёт o.get
      let gain = o.cash;
      for (const c of o.give) gain += value(s, seat, c, level);
      for (const c of o.get) {
        const own = value(s, seat, c, level);
        gain -= level === 0 ? b.cells[c].price! : level === 1 ? Math.max(own, b.cells[c].price! * 1.4) : Math.max(own, value(s, o.from, c, 2) * 1.1);
      }
      gain += o.cards * 500;
      return gain > (level === 2 ? 1000 : 0) ? { type: 'accept' } : { type: 'reject' };
    }
    case 'debt': {
      const mine = owned(s, seat);
      const sell = mine.filter((c) => canSell(s, seat, c)).sort((a, c) => b.cells[a].build! - b.cells[c].build!);
      if (sell.length) return { type: 'sell', cell: sell[0] };
      const mort = mine.filter((c) => canMortgage(s, seat, c)).sort((a, c) => b.cells[a].price! - b.cells[c].price!);
      if (mort.length) return { type: 'mortgage', cell: mort[0] };
      return { type: 'bankrupt' };
    }
    case 'insure': {
      if (level === 0) {
        const lv = rng.int(3);
        return { type: 'insure', level: cash >= [0, 100, 250][lv] ? lv : 0 };
      }
      if (cash >= 250 + res && (level === 2 || cash > 1200)) return { type: 'insure', level: 2 };
      if (cash >= 100 + res) return { type: 'insure', level: 1 };
      return { type: 'insure', level: 0 };
    }
    case 'casino':
    case 'casino2':
      return { type: 'spin' };
    case 'bankBuy': {
      const price = b.cells[s.pos[seat]].price! + 100;
      if (cash >= price && cash - price >= res * (level === 0 ? 1 : 2) && rng.next() < [0.5, 0.8, 1][level]) return { type: 'buy' };
      return { type: 'pass' };
    }
  }
  return null;
}

/** Сложный бот: у кого-то один участок из моей почти полной группы — предложить за него деньги. */
function groupDeal(s: State, seat: number, res: number): Action | null {
  const b = B(s);
  for (let g = 0; g < b.groups.length; g++) {
    const cells = groupCells(s, g);
    const mine = cells.filter((c) => s.owner[c] === seat);
    if (mine.length !== cells.length - 1) continue;
    const c = cells.find((i) => s.owner[i] !== seat)!;
    const o = s.owner[c];
    if (o == null || o < 0 || !alive(s).includes(o) || !tradeable(s, o, c)) continue;
    const pay = roundTo(b.cells[c].price! * 1.6, b.step);
    if (s.cash[seat] - pay < res) continue;
    return { type: 'offer', to: o, give: [], get: [c], cash: pay, cards: 0 };
  }
  return null;
}
