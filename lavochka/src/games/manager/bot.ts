/* «Менеджер» / «Космос 2000» — боты. Видят то же, что игрок (view без порядка колод).
 * Лёгкий — покупает почти всё, строит изредка, торгуется скромно; средний — держит запас на ренту, строит на полных группах;
 * сложный — запас по самой дорогой чужой ренте, перебивает на торгах участки, которые замыкают его группу или чужую,
 * сам предлагает выкупить третий участок группы, сидит на бирже, когда поле застроено.
 * «Бизнес»: средний и сложный покупают на валютной бирже доллары под предприятие на своей монополии, в долгах сначала продают доллары. */
import type { Rng } from '../../core/types';
import { INSURE, RATE, ROULETTE, SHARES_BUY_CAP } from './boards';
import {
  B,
  alive,
  bankShares,
  hubOpts,
  marketGain,
  marketOpts,
  sharePrice,
  canBuild,
  canMortgage,
  canRedeem,
  canSell,
  fullGroup,
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
  const k = s.map === 'biznes' ? 5 : s.map === 'biznesmen' ? 8 : s.map === 'imperiya' || s.map === 'nep' ? 0.08 : 1;
  if (level === 0) return 2000 * k;
  let worst = 0;
  for (let c = 0; c < s.owner.length; c++) {
    const o = s.owner[c];
    if (o != null && o >= 0 && o !== seat) worst = Math.max(worst, rent(s, c));
  }
  return level === 1 ? Math.max(4000 * k, worst * 0.4) : Math.max(6000 * k, worst * 0.7);
}

/** Чего стоит участок для бота: цена плюс польза для групп. */
function value(s: State, seat: number, c: number, level: number): number {
  const cell = B(s).cells[c];
  let v = cell.price!;
  if (s.map === 'kosmos' || cell.group == null) return v * (level === 2 ? 1.1 : 1);
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
    case 'move':
      return { type: 'move' };
    case 'roll': {
      if (s.map !== 'kosmos') {
        if (s.jail[seat]) {
          const built = s.houses.some((h, c) => h > 0 && s.owner[c] !== seat);
          const stay = level === 2 && built;
          if (!stay && s.freeCards[seat].length) return { type: 'useCard' };
          if (!stay && cash >= (b.jailPay ?? 500) + res && level > 0) return { type: 'payJail' };
          return { type: 'roll' };
        }
        // выкуп из залога, когда денег с запасом
        if (level > 0) {
          for (const c of owned(s, seat)) if (s.mort[c] && canRedeem(s, seat, c) && cash - redeemCost(s, c) > res * 2) return { type: 'redeem', cell: c };
        }
        // стройка: сначала дорогие группы, равномерно
        const can = owned(s, seat).filter((c) => canBuild(s, seat, c)).sort((a, c) => b.cells[c].price! - b.cells[a].price!);
        for (const c of can) {
          // валютное предприятие «Бизнеса» — за доллары, их и копили
          if (s.map === 'biznes' && s.houses[c] === 3) return { type: 'build', cell: c };
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
      let next = a.bid ? a.bid + roundTo(Math.max(b.step, a.bid * 0.1), b.step) : roundTo(price * 0.5, b.step);
      // «Империя»: отказавшийся торгуется только выше цены
      if (s.map === 'imperiya' && seat === s.turn && next <= price) next = price + b.step;
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
      // «Бизнесмен»: сначала акции — по курсу, без потерь
      const sc = [0, 1, 2, 3].filter((c) => s.shares[seat][c] > 0).sort((a, c) => s.price[c] - s.price[a])[0];
      if (s.map === 'biznesmen' && sc != null) return { type: 'shares', c: sc, n: -1 };
      if (s.usd[seat] >= 50) {
        const need = Math.ceil((s.debt!.amount - cash) / RATE / 50) * 50;
        return { type: 'exchange', usd: -Math.min(s.usd[seat] - (s.usd[seat] % 50), Math.max(50, need)) };
      }
      const mine = owned(s, seat);
      const sell = mine.filter((c) => canSell(s, seat, c)).sort((a, c) => b.cells[a].build! - b.cells[c].build!);
      if (sell.length) return { type: 'sell', cell: sell[0] };
      const mort = mine.filter((c) => canMortgage(s, seat, c)).sort((a, c) => b.cells[a].price! - b.cells[c].price!);
      if (mort.length) return { type: 'mortgage', cell: mort[0] };
      return { type: 'bankrupt' };
    }
    case 'insure': {
      if (s.map === 'biznes') {
        if (cash < INSURE) return { type: 'insure', level: 0 };
        if (level === 0) return { type: 'insure', level: rng.next() < 0.5 ? 1 : 0 };
        return { type: 'insure', level: cash >= INSURE + res ? 1 : 0 };
      }
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
    case 'exchange': {
      const want = usdWanted(s, seat, level);
      const buy = Math.ceil((want - s.usd[seat]) / 100) * 100;
      if (buy > 0 && cash - buy * RATE >= res * (level === 2 ? 0.6 : 1)) return { type: 'exchange', usd: buy };
      return { type: 'pass' };
    }
    case 'hub':
      return hubChoice(s, seat, level, res, rng);
    case 'sub': {
      // «Империя»: выход из подпространства — на ничью планету по карману, на свою, а не на чужую дорогую
      const exits = b.cells[s.pos[seat]].exits ?? [];
      const score = (c: number) => {
        const o = s.owner[c];
        if (o == null) return cash >= b.cells[c].price! ? b.cells[c].price! : 0;
        if (o === seat) return 50;
        return -rent(s, c);
      };
      const best = level === 0 ? exits[rng.int(exits.length)] : [...exits].sort((p, q) => score(q) - score(p))[0];
      return { type: 'exit', cell: best };
    }
    case 'stocks':
      return stocksChoice(s, seat, level, res, rng);
    case 'roulette': {
      if (s.rl >= 0 && ROULETTE[s.rl].out) return { type: 'pass' };
      if (s.rl >= 0) return { type: 'roulette' };
      const entries = ROULETTE.map((r, i) => (r.in ? i : -1)).filter((i) => i >= 0);
      const best = level === 0 ? entries[rng.int(entries.length)] : entries.sort((a, c) => spinEv(c) - spinEv(a))[0];
      return { type: 'roulette', entry: best };
    }
    case 'pick': {
      const pk = s.pick!;
      const cs = [0, 1, 2, 3];
      if (pk.mode === 'raise') return { type: 'pick', c: cs.sort((a, c) => s.shares[seat][c] - s.shares[seat][a])[0] };
      // подарок — что дороже; покупка — что дешевле (и есть в банке)
      const have = cs.filter((c) => bankShares(s, c) > 0);
      const list = have.length ? have : cs;
      list.sort((a, c) => (pk.mode === 'gift' ? s.price[c] - s.price[a] : s.price[a] - s.price[c]));
      return { type: 'pick', c: list[0] };
    }
    case 'bankBuy': {
      const price = b.cells[s.pos[seat]].price! + 100;
      if (cash >= price && cash - price >= res * (level === 0 ? 1 : 2) && rng.next() < [0.5, 0.8, 1][level]) return { type: 'buy' };
      return { type: 'pass' };
    }
  }
  return null;
}

/** «Бизнес»: сколько долларов держать — на предприятие на своей монополии (лёгкий доллары не копит). */
function usdWanted(s: State, seat: number, level: number): number {
  if (level === 0) return 0;
  const b = B(s);
  const mono = owned(s, seat).filter((c) => fullGroup(s, c) && s.houses[c] < 4 && s.houses[c] >= (level === 2 ? 1 : 2));
  if (!mono.length) return 0;
  return Math.max(...mono.map((c) => b.cells[c].buildUsd!));
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

/** «Бизнесмен»: средний выигрыш броска рулетки со стартового сектора (два кубика). */
function spinEv(from: number): number {
  let ev = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) ev += ROULETTE[(from + a + b) % ROULETTE.length].v / 36;
  return ev;
}

/** «Бизнесмен»: клетка с выбором — банк, отель, таможня, маклер, рулетка, перекрёсток. */
function hubChoice(s: State, seat: number, level: number, res: number, rng: Rng): Action {
  const opts = hubOpts(s).filter((o) => o.ok);
  const has = (id: string) => opts.some((o) => o.id === id);
  const cash = s.cash[seat];
  const b = B(s);
  // за рубежом есть что покупать
  const freeAbroad = b.cells.some((c, i) => c.abroad && s.owner[i] == null && c.price! < cash - res);
  const want = (id: string): boolean => {
    switch (id) {
      case 'exit':
        return true;
      case 'stocks':
      case 'broker':
        return level > 0 || rng.next() < 0.5;
      case 'roulette':
        return cash > res + 40000 && (level > 0 || rng.next() < 0.5);
      case 'abroad':
      case 'abroad2':
        return freeAbroad && cash > res * 2 + 60000 && rng.next() < [0.3, 0.5, 0.7][level];
      case 'home':
        return (!freeAbroad && rng.next() < 0.6) || rng.next() < 0.2;
      case 'home2':
        return !freeAbroad || rng.next() < 0.35;
      case 'road':
        return !freeAbroad || rng.next() < 0.3;
    }
    return false;
  };
  for (const o of opts) if (o.id !== 'pass' && o.id !== 'back' && want(o.id)) return { type: 'hub', opt: o.id };
  if (has('pass')) return { type: 'hub', opt: 'pass' };
  return { type: 'hub', opt: opts[opts.length - 1]?.id ?? 'back' };
}

/** «Бизнесмен»: на бирже — подкупить акции под выгодную карточку и сыграть её. */
function stocksChoice(s: State, seat: number, level: number, res: number, rng: Rng): Action {
  if (s.played) return { type: 'pass' };
  const hand = s.hand[seat];
  let best: { card: number; opt: number; score: number; to: number[] } | null = null;
  hand.forEach((id, card) => {
    if (id < 0) return;
    marketOpts(s.price, id).forEach((to, opt) => {
      let score = marketGain(s, seat, seat, s.price, to);
      for (let c = 0; c < 4; c++) score += (to[c] - s.price[c]) * 1000 * s.shares[seat][c];
      if (level === 2) for (const p of alive(s)) if (p !== seat) score -= marketGain(s, p, seat, s.price, to) / 3;
      if (level === 0) score = rng.next();
      if (!best || score > best.score) best = { card, opt, score, to };
    });
  });
  if (!best) return { type: 'pass' };
  const bb = best as { card: number; opt: number; score: number; to: number[] };
  // курс цвета пойдёт вверх — сначала докупить акций
  if (level > 0) {
    const c = [0, 1, 2, 3].sort((a, d) => bb.to[d] - s.price[d] - (bb.to[a] - s.price[a]))[0];
    const rise = bb.to[c] - s.price[c];
    if (rise >= 3 && s.shares[seat][c] < SHARES_BUY_CAP && bankShares(s, c) > 0 && s.cash[seat] - sharePrice(s, c) >= res) return { type: 'shares', c, n: 1 };
  }
  if (bb.score > 0 || level === 0) return { type: 'play', card: bb.card, opt: bb.opt };
  return { type: 'pass' };
}
