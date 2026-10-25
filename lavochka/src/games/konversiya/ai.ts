/* «Конверсия» — боты. У каждого свой род занятий (по месту): перевозчик-торговец (возит свой товар за границу за доллары,
 * ввозит импорт и продаёт вдвое дороже советского, догружается государственным грузом), производитель (завод, станки, сырьё →
 * товар) или добытчик сырья. Вне хода берут ссуду, когда денег нет, и возвращают, когда их много.
 * Перед последней сменой курса (после неё всё стоит гроши) распродают всё имущество: сложный — заранее, средний — в последний момент.
 * Лёгкий через раз делает что-нибудь случайное из допустимого. */
import type { Rng } from '../../core/types';
import {
  buyPrice,
  BY_SEA,
  capacity,
  CONT_ITEM,
  CONTS,
  contFree,

  KEYS,
  legal,
  LOAN_BACK,
  loadOf,
  mineYield,
  produceYield,
  rate,
  ROW,
  toNextRate,
  trips,
  tripGoods,
  WORLD_PRICE,
  type Action,
  type Cont,
  type Key,
  type Mode,
  type State,
} from './engine';

type Role = 'trader' | 'producer' | 'miner';
const ROLES: Role[] = ['trader', 'producer', 'trader', 'miner', 'trader', 'producer'];

const basket = (items: Partial<Record<Key, number>>) => Object.fromEntries(Object.entries(items).filter(([, n]) => (n ?? 0) > 0)) as Partial<Record<Key, number>>;
const empty = (b: Partial<Record<Key, number>>) => !Object.keys(b).length;

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over || s.turn !== seat) return null;
  const acts = legal(s);
  if (level <= 0 && rng.next() < 0.45) {
    const pick = acts.filter((a) => a.type !== 'loan' && a.type !== 'repay' && a.type !== 'exchange');
    return pick[rng.int(pick.length)] ?? { type: 'skip' };
  }
  const pl = s.p[seat];
  const role: Role = level <= 0 ? ROLES[(seat + 1) % ROLES.length] : ROLES[seat % ROLES.length];
  const has = (t: Action['type']) => acts.some((a) => a.type === t);

  // вне хода: ссуда и возврат
  // ссуда — один раз и надолго: вернуть к концу (на 4-м курсе) или когда денег очень много
  if (has('repay') && (pl.rub > LOAN_BACK + 300 || (rate(s) === 4 && pl.rub > LOAN_BACK + 20))) return { type: 'repay' };
  if (has('loan') && pl.rub < 35 && rate(s) < 3) return { type: 'loan' };
  if (pl.loc === 'ussr' && pl.usd > 0 && role !== 'trader') return { type: 'exchange', usd: pl.usd };

  // перед последней сменой курса — распродажа всего и ничего не покупать: после неё всё стоит гроши
  const left = toNextRate(s);
  const closing = rate(s) === 4 && left <= (level >= 2 ? 8 : 4);
  if (closing) {
    const transport = role === 'trader' && pl.own.truckS + pl.own.truckI + pl.own.fleetS + pl.own.fleetI > 0;
    if (transport) return closingRun(s, seat, acts, rng);
    if (pl.loc === 'ussr') {
      const b = basket(Object.fromEntries(KEYS.map((k) => [k, pl.own[k]])));
      if (!empty(b)) return { type: 'sell', items: b };
      if (pl.usd > 0) return { type: 'exchange', usd: pl.usd };
      if (acts.some((a) => a.type === 'unload')) return { type: 'unload' };
      return { type: 'skip' };
    }
    if (pl.cargo.goods > 0) return { type: 'sell', items: { goods: pl.cargo.goods } };
    return home(s, seat, acts);
  }

  if (role === 'trader') return trader(s, seat, acts, rng);
  if (role === 'producer') return producer(s, seat, acts);
  return miner(s, seat, acts);
}

function trader(s: State, seat: number, acts: Action[], rng: Rng): Action {
  const pl = s.p[seat];
  const has = (t: Action['type']) => acts.some((a) => a.type === t);
  if (pl.loc !== 'ussr') {
    const c = pl.loc as Cont;
    if (pl.cargo.goods > 0) return { type: 'sell', items: { goods: pl.cargo.goods } };
    if (has('unload')) return { type: 'unload' };
    const k = CONT_ITEM[c];
    const price = WORLD_PRICE[ROW[k]]!;
    const room = pl.lastMode === 'state' ? 99 : Math.max(0, capacity(pl, pl.lastMode ?? 'truck') - loadOf(pl.cargo));
    const n = Math.min(Math.floor(pl.usd / price), s.world[c], room);
    if (n > 0) return { type: 'buy', items: { [k]: n } };
    const load = acts.find((a) => a.type === 'load');
    if (load && pl.lastMode !== 'state') return load;
    return home(s, seat, acts);
  }
  if (has('unload')) return { type: 'unload' };
  // привезённый импорт — на рынок (компьютер и импортный транспорт оставляем себе)
  const imp = basket({ machI: pl.own.machI, equipI: pl.own.equipI, fleetI: pl.own.fleetI > 1 ? pl.own.fleetI - 1 : 0, comp: pl.own.comp > 1 ? pl.own.comp - 1 : 0 });
  if (!empty(imp)) return { type: 'sell', items: imp };
  const trucks = pl.own.truckS + pl.own.truckI + pl.own.fleetS + pl.own.fleetI;
  if (!trucks) {
    const p = buyPrice(s, 'truckS');
    const n = Math.min(3, Math.floor((pl.rub - 10) / p), s.market.truckS);
    if (n > 0) return { type: 'buy', items: { truckS: n } };
    return { type: 'skip' };
  }
  // ещё транспорт, если денег много
  if (pl.rub > 200 && s.market.truckS > 0 && capacity(pl, 'truck') < 8) return { type: 'buy', items: { truckS: Math.min(3, s.market.truckS, Math.floor((pl.rub - 120) / buyPrice(s, 'truckS'))) || 1 } };
  const mode: Mode = capacity(pl, 'truck') >= capacity(pl, 'fleet') ? 'truck' : 'fleet';
  const room = capacity(pl, mode) - loadOf(pl.cargo) - pl.own.goods;
  if (room > 0 && pl.rub >= buyPrice(s, 'goods') + 10) {
    const n = Math.min(room, Math.floor((pl.rub - 10) / buyPrice(s, 'goods')));
    if (n > 0) return { type: 'buy', items: { goods: n } };
  }
  const load = acts.find((a) => a.type === 'load') as (Action & { type: 'load' }) | undefined;
  if (load && pl.own.goods + loadOf(pl.cargo) < capacity(pl, mode)) return { type: 'load', n: Math.max(1, Math.min(load.n, capacity(pl, mode) - loadOf(pl.cargo) - pl.own.goods)) };
  const ts = trips(s, seat).filter((t) => t.mode === mode && (mode !== 'fleet' || BY_SEA.includes(t.to as Cont)));
  if (ts.length) {
    const t = ts[rng.int(ts.length)];
    return { type: 'trip', to: t.to, mode: t.mode, goods: tripGoods(s, seat, t.mode) };
  }
  const any = trips(s, seat)[0];
  if (any && CONTS.some((c) => contFree(s, c, seat))) return { type: 'trip', to: any.to, mode: any.mode, goods: tripGoods(s, seat, any.mode) };
  return { type: 'skip' };
}

/** Перевозчик в конце игры: имущество (кроме транспорта) продано, возит только государственный груз — за плату и ради курса. */
function closingRun(s: State, seat: number, acts: Action[], rng: Rng): Action {
  const pl = s.p[seat];
  const has = (t: Action['type']) => acts.some((a) => a.type === t);
  if (pl.loc === 'ussr') {
    const b = basket(Object.fromEntries(KEYS.filter((k) => !k.startsWith('truck') && !k.startsWith('fleet')).map((k) => [k, pl.own[k]])));
    if (!empty(b)) return { type: 'sell', items: b };
    if (pl.usd > 0) return { type: 'exchange', usd: pl.usd };
    if (has('unload')) return { type: 'unload' };
    const load = acts.find((a) => a.type === 'load');
    if (load && pl.cargo.state === 0) return load;
    const ts = trips(s, seat).filter((t) => t.mode !== 'state');
    if (ts.length) {
      const t = ts[rng.int(ts.length)];
      return { type: 'trip', to: t.to, mode: t.mode, goods: 0 };
    }
    return { type: 'skip' };
  }
  if (pl.cargo.goods > 0) return { type: 'sell', items: { goods: pl.cargo.goods } };
  if (has('unload')) return { type: 'unload' };
  const load = acts.find((a) => a.type === 'load');
  if (load && pl.cargo.state === 0 && pl.lastMode !== 'state') return load;
  return home(s, seat, acts);
}

function home(s: State, seat: number, acts: Action[]): Action {
  const ts = trips(s, seat);
  const pl = s.p[seat];
  const t = ts.find((x) => x.mode === pl.lastMode) ?? ts[0];
  if (t) return { type: 'trip', to: 'ussr', mode: t.mode, goods: 0 };
  return acts.find((a) => a.type === 'skip')!;
}

function producer(s: State, seat: number, acts: Action[]): Action {
  const pl = s.p[seat];
  const has = (t: Action['type']) => acts.some((a) => a.type === t);
  if (pl.loc !== 'ussr') return home(s, seat, acts);
  if (pl.own.goods > 0) return { type: 'sell', items: { goods: pl.own.goods } };
  const p = produceYield(pl);
  if (p.units > 0 && has('produce') && p.units >= Math.min(pl.own.raw, 1)) {
    // сначала докупить сырья под все станки
    const machines = Math.min(pl.own.machS + pl.own.machI, pl.own.factory * 5);
    if (pl.own.raw >= machines || pl.rub < buyPrice(s, 'raw') + p.cost) return { type: 'produce' };
  }
  const items: Partial<Record<Key, number>> = {};
  let money = pl.rub - 4;
  if (!pl.own.factory && money >= buyPrice(s, 'factory') + buyPrice(s, 'machS')) {
    items.factory = 1;
    money -= buyPrice(s, 'factory');
  }
  const slots = (pl.own.factory + (items.factory ?? 0)) * 5 - pl.own.machS - pl.own.machI;
  const mp = buyPrice(s, 'machS');
  const nm = Math.max(0, Math.min(slots, s.market.machS, Math.floor((money - buyPrice(s, 'raw')) / (mp + buyPrice(s, 'raw')))));
  if (nm > 0) {
    items.machS = nm;
    money -= nm * mp;
  }
  const machines = pl.own.machS + pl.own.machI + nm;
  const needRaw = Math.max(0, machines - pl.own.raw);
  const nr = Math.min(needRaw, Math.floor(money / buyPrice(s, 'raw')));
  if (nr > 0) items.raw = nr;
  if (!empty(items) && (pl.own.factory || items.factory)) return { type: 'buy', items };
  if (has('produce')) return { type: 'produce' };
  if (has('loan') && rate(s) < 3) return { type: 'loan' };
  return { type: 'skip' };
}

function miner(s: State, seat: number, acts: Action[]): Action {
  const pl = s.p[seat];
  const has = (t: Action['type']) => acts.some((a) => a.type === t);
  if (pl.loc !== 'ussr') return home(s, seat, acts);
  if (pl.own.raw >= Math.max(2, mineYield(pl).units)) return { type: 'sell', items: { raw: pl.own.raw } };
  const ep = buyPrice(s, 'equipS');
  const have = pl.own.equipS + pl.own.equipI;
  // оборудование дешевеет с каждым курсом — покупать рано и в меру
  const want = rate(s) <= 2 ? 6 : rate(s) === 3 ? 3 : 0;
  if (have < want && pl.rub - 15 >= ep && s.market.equipS > 0) return { type: 'buy', items: { equipS: Math.min(want - have, s.market.equipS, Math.floor((pl.rub - 15) / ep)) } };
  if (has('mine')) return { type: 'mine' };
  if (pl.own.raw > 0) return { type: 'sell', items: { raw: pl.own.raw } };
  if (has('loan') && rate(s) < 3) return { type: 'loan' };
  return { type: 'skip' };
}

