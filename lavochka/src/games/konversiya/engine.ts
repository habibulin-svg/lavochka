/* «Конверсия 1» (АСК-ГЕЙМ, СП «АСК») — инвестиционная игра. Без DOM. Разбор и решения без пользователя — docs/analysis/konversiya.md.
 *
 * Ход — одно действие: покупка, добыча сырья, производство товара, продажа, погрузка или разгрузка «государственного» груза,
 * поездка (с картой «События в пути») или пропуск. Вне хода — ссуда 100 → 150 и обмен долларов на рубли 1:1.
 * Перевозки двигают фишку-индикатор ввоза-вывоза: смена цвета — смена курса; переход на 5-й курс — конец игры,
 * имущество продаётся по 5-му курсу, побеждает самый богатый. Все суммы — в тысячах.
 *
 * Частные сделки (правила: «не являются ходом и производятся между ходами»): тот, чей ход, до своего действия предлагает
 * другому игроку обмен — собственность, рубли, доллары с обеих сторон; товарные сделки — только когда оба в одном месте.
 * Пока предложение ждёт ответа, ход у адресата. Аренда («затрачивая свой ход, производить на чужом оборудовании»):
 * добыча или производство на оборудовании другого игрока за договорную плату — если хозяин согласен, это и есть ход. */
import type { Options, Rng } from '../../core/types';

export type Key = 'equipS' | 'equipI' | 'factory' | 'machS' | 'machI' | 'truckS' | 'truckI' | 'fleetS' | 'fleetI' | 'comp' | 'raw' | 'goods';
export const KEYS: Key[] = ['equipS', 'equipI', 'factory', 'machS', 'machI', 'truckS', 'truckI', 'fleetS', 'fleetI', 'comp', 'raw', 'goods'];
export type Row = 'equip' | 'raw' | 'factory' | 'mach' | 'goods' | 'truck' | 'fleet' | 'comp';
export const ROW: Record<Key, Row> = {
  equipS: 'equip',
  equipI: 'equip',
  factory: 'factory',
  machS: 'mach',
  machI: 'mach',
  truckS: 'truck',
  truckI: 'truck',
  fleetS: 'fleet',
  fleetI: 'fleet',
  comp: 'comp',
  raw: 'raw',
  goods: 'goods',
};
export const IMPORTED: Key[] = ['equipI', 'machI', 'truckI', 'fleetI', 'comp'];
export const isImported = (k: Key) => IMPORTED.includes(k);

export const NAMES: Record<Key, string> = {
  equipS: 'оборудование для добычи сырья',
  equipI: 'азиатское оборудование',
  factory: 'завод',
  machS: 'советские станки',
  machI: 'европейские станки',
  truckS: 'советский автотранспорт',
  truckI: 'африканский автотранспорт',
  fleetS: 'советский флот',
  fleetI: 'австралийский флот',
  comp: 'американский компьютер',
  raw: 'сырьё',
  goods: 'товар',
};

/** Таблица курсов: [купить, продать] на курсах 1–4 и одна цена на 5-м. */
const TABLE: Record<Row, [number, number][]> = {
  equip: [[40, 37], [32, 29], [20, 17], [8, 7], [4, 4]],
  raw: [[10, 5], [8, 4], [5, 3], [2, 2], [1, 1]],
  factory: [[60, 57], [48, 45], [30, 27], [12, 10], [6, 6]],
  mach: [[20, 18], [16, 14], [10, 8], [4, 3], [2, 2]],
  goods: [[30, 20], [24, 16], [15, 10], [6, 4], [2, 2]],
  truck: [[30, 28], [24, 22], [15, 13], [6, 5], [3, 3]],
  fleet: [[70, 66], [56, 52], [35, 31], [14, 12], [7, 7]],
  comp: [[150, 140], [120, 110], [75, 65], [30, 25], [15, 15]],
};
/** Перевозка одной партии груза по курсу. */
export const FREIGHT = [10, 8, 5, 2, 1];
/** Мировой рынок: цены в долларах. */
export const WORLD_PRICE: Partial<Record<Row, number>> = { equip: 4, mach: 2, goods: 4, truck: 3, fleet: 7, comp: 15 };

export type Cont = 'europe' | 'asia' | 'america' | 'africa' | 'australia';
export const CONTS: Cont[] = ['europe', 'asia', 'america', 'africa', 'australia'];
export const CONT_NAME: Record<Cont, string> = { europe: 'Европа', asia: 'Азия', america: 'Америка', africa: 'Африка', australia: 'Австралия' };
/** Что продаёт континент. */
export const CONT_ITEM: Record<Cont, Key> = { europe: 'machI', asia: 'equipI', america: 'comp', africa: 'truckI', australia: 'fleetI' };
/** Флот ходит только в Африку, Австралию и Америку. */
export const BY_SEA: Cont[] = ['africa', 'australia', 'america'];

export type Variant = 'short' | 'medium' | 'long';
/** Клетки зон курсов 1–4 на таблицах набора (tools/konversiya/tracks.py): фишка стоит на «0», следующая за зонами клетка — красная, 5-й курс.
 * В короткой таблице красная — 25-я клетка жёлтой полосы, поэтому жёлтых 24. */
export const ZONES: Record<Variant, number[]> = { short: [25, 25, 25, 24], medium: [15, 25, 35, 50], long: [15, 25, 50, 100] };
export const START = 100;
export const LOAN = 100;
export const LOAN_BACK = 150;
const SAFETY_ROUNDS = 80;

export interface Cfg {
  variant: Variant;
}
export const cfgFrom = (o: Options): Cfg => ({ variant: o.variant === 'medium' || o.variant === 'long' ? o.variant : 'short' });

// ---------------------------------------------------------------- карты «События в пути»

export type Card =
  | { k: 'extra' }
  | { k: 'usd'; v: number; nasa?: boolean }
  | { k: 'repair'; v: number }
  | { k: 'engine'; v: number }
  | { k: 'typhoon' }
  | { k: 'maneuvers' }
  | { k: 'strike' }
  | { k: 'disaster' };
/** Вид карты (номер картинки) и что делает. */
export const CARD_KINDS: { id: string; card: Card; n: number; text: string }[] = [
  { id: 'extra', card: { k: 'extra' }, n: 25, text: '«Благодаря проявленной предприимчивости Вы досрочно прибыли на место и успеваете совершить очередную операцию.»' },
  { id: 'usd1', card: { k: 'usd', v: 1 }, n: 4, text: '«Попутный груз. Вы заработали 1.000 $.»' },
  { id: 'usd5', card: { k: 'usd', v: 5 }, n: 3, text: '«Попутный груз. Вы заработали 5.000 $.»' },
  { id: 'usd10', card: { k: 'usd', v: 10 }, n: 2, text: '«Попутный груз. Вы заработали 10.000 $.»' },
  { id: 'usd15', card: { k: 'usd', v: 15 }, n: 1, text: '«Попутный груз. Вы заработали 15.000 $.»' },
  { id: 'nasa', card: { k: 'usd', v: 5, nasa: true }, n: 2, text: '«Район закрыт. Приземляются космонавты. NASA оплачивает простой 5.000 $.»' },
  { id: 'repair', card: { k: 'repair', v: 5 }, n: 4, text: '«Ремонт. Уплатите 5.000 руб. и двигайтесь дальше.»' },
  { id: 'engine', card: { k: 'engine', v: 10 }, n: 4, text: '«Отказал двигатель. Вернитесь назад и уплатите за ремонт двигателя 10.000 руб.»' },
  { id: 'typhoon', card: { k: 'typhoon' }, n: 2, text: '«Тайфун вынуждает Вас вернуться в пункт отправления.»' },
  { id: 'maneuvers', card: { k: 'maneuvers' }, n: 1, text: '«Впереди военные манёвры. Придётся пропустить 1 ход.»' },
  { id: 'strike', card: { k: 'strike' }, n: 1, text: '«В пункте назначения бастуют грузчики. Вы вынуждены пропустить ход.»' },
  { id: 'disaster', card: { k: 'disaster' }, n: 1, text: 'Катастрофа! Вы потеряли весь груз и транспорт.' },
];
/** Колода: номера видов карт по одной на карту (50). */
export const DECK: number[] = CARD_KINDS.flatMap((c, i) => Array(c.n).fill(i));

// ---------------------------------------------------------------- состояние

export type Mode = 'truck' | 'fleet' | 'state';
export type Loc = 'ussr' | Cont;

export interface Cargo {
  /** Свой советский товар. */
  goods: number;
  /** Государственный груз: туда — товар, обратно — импорт континента stateKind. */
  state: number;
  stateKind: Key | null;
  /** Своё купленное за границей. */
  imports: Partial<Record<Key, number>>;
}

export interface Player {
  rub: number;
  usd: number;
  own: Record<Key, number>;
  loc: Loc;
  cargo: Cargo;
  loan: boolean;
  skip: number;
  alive: boolean;
  /** На чём приехал (за границей грузят на тот же транспорт). */
  lastMode: Mode | null;
}

/** Что отдаёт сторона сделки: рубли, доллары и собственность (тыс.). */
export interface Bundle {
  rub?: number;
  usd?: number;
  items?: Partial<Record<Key, number>>;
}
export type Work = 'mine' | 'produce';
export type Offer = { kind: 'deal'; from: number; to: number; give: Bundle; get: Bundle } | { kind: 'rent'; from: number; to: number; work: Work; fee: number };
/** Сколько предложений можно сделать за свой ход (чтобы не засыпать соседей). */
export const MAX_OFFERS = 3;

export interface State {
  cfg: Cfg;
  /** Предложение ждёт ответа адресата. */
  offer?: Offer | null;
  /** Сколько предложений уже сделано в этот ход. */
  offers?: number;
  n: number;
  p: Player[];
  /** Внутренний рынок СССР: сколько чего лежит (сырьё и товар — без счёта). */
  market: Record<Key, number>;
  /** Мировой рынок: сколько осталось на континенте. */
  world: Record<Cont, number>;
  /** Фишка-индикатор: сколько партий пересекло границу. */
  ind: number;
  deck: number[];
  turn: number;
  first: number;
  round: number;
  /** Карта дала ещё одну операцию. */
  extra: boolean;
  /** Последняя вытянутая карта (вид) — для показа. */
  card: number | null;
  over: boolean;
  winner: number | null;
  ply: number;
}

const zero = (): Record<Key, number> => Object.fromEntries(KEYS.map((k) => [k, 0])) as Record<Key, number>;

function shuffle(rng: Rng): number[] {
  const d = DECK.slice();
  for (let i = d.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

export function newState(cfg: Cfg, n: number, rng: Rng): State {
  const market = zero();
  market.factory = 8;
  market.machS = 20;
  market.equipS = 20;
  market.truckS = 20;
  market.fleetS = 20;
  market.raw = 999;
  market.goods = 999;
  return {
    cfg,
    n,
    p: Array.from({ length: n }, () => ({ rub: START, usd: 0, own: zero(), loc: 'ussr' as Loc, cargo: { goods: 0, state: 0, stateKind: null, imports: {} }, loan: false, skip: 0, alive: true, lastMode: null })),
    market,
    world: { europe: 20, asia: 20, america: 20, africa: 20, australia: 20 },
    ind: 0,
    deck: shuffle(rng),
    turn: 0,
    first: 0,
    round: 1,
    extra: false,
    card: null,
    over: false,
    winner: null,
    ply: 0,
  };
}

export const setup = (seats: number[], o: Options, rng: Rng) => newState(cfgFrom(o), Math.max(2, seats.length), rng);
export const toAct = (s: State) => (s.over ? [] : s.offer ? [s.offer.to] : [s.turn]);

// ---------------------------------------------------------------- цены и счёт

/** Курс 1…5 по положению индикатора. */
export function rate(s: { cfg: Cfg; ind: number }): number {
  let acc = 0;
  const z = ZONES[s.cfg.variant];
  for (let i = 0; i < z.length; i++) {
    acc += z[i];
    if (s.ind <= acc) return i + 1;
  }
  return 5;
}
/** Сколько осталось до смены курса. */
export function toNextRate(s: { cfg: Cfg; ind: number }): number {
  let acc = 0;
  for (const z of ZONES[s.cfg.variant]) {
    acc += z;
    if (s.ind <= acc) return acc + 1 - s.ind;
  }
  return 0;
}
/** Номер красной клетки: дойти до неё — конец игры. */
export const total = (v: Variant) => ZONES[v].reduce((a, b) => a + b, 0) + 1;

/** Купить на внутреннем рынке (импортное — вдвое дороже). */
export const buyPrice = (s: State, k: Key) => TABLE[ROW[k]][rate(s) - 1][0] * (isImported(k) ? 2 : 1);
/** Продать внутреннему рынку. */
export const sellPrice = (s: State, k: Key, r = rate(s)) => TABLE[ROW[k]][r - 1][1] * (isImported(k) ? 2 : 1);
export const freight = (s: State) => FREIGHT[rate(s) - 1];

export const hasComp = (pl: Player) => pl.own.comp > 0;
/** Грузоподъёмность своего транспорта. */
export function capacity(pl: Player, mode: Mode): number {
  const c = hasComp(pl) ? 1 : 0;
  if (mode === 'truck') return pl.own.truckS * (1 + c) + pl.own.truckI * (2 + c);
  if (mode === 'fleet') return pl.own.fleetS * (2 + c) + pl.own.fleetI * (3 + c);
  return 999;
}
export const maxCap = (pl: Player) => Math.max(capacity(pl, 'truck'), capacity(pl, 'fleet'));
export const loadOf = (c: Cargo) => c.goods + c.state + Object.values(c.imports).reduce((a, b) => a + (b ?? 0), 0);

/** Сколько сырья добудет оборудование за ход и сколько это стоит (работает столько, на сколько хватает рублей; импортное — первым). */
export function mineYield(pl: Player): { units: number; cost: number } {
  const c = hasComp(pl) ? 1 : 0;
  let budget = Math.floor(pl.rub);
  const ni = Math.min(pl.own.equipI, budget);
  budget -= ni;
  const ns = Math.min(pl.own.equipS, budget);
  return { units: ni * (2 + c) + ns * (1 + c), cost: ni + ns };
}
/** Сколько товара выпустят станки (на заводе — по 5 станков) из имеющегося сырья — на сколько хватает рублей. */
export function produceYield(pl: Player): { units: number; cost: number } {
  const c = hasComp(pl) ? 1 : 0;
  let slots = pl.own.factory * 5;
  let raw = pl.own.raw;
  let units = 0;
  let cost = 0;
  // импортные станки выгоднее — первыми
  for (const [n, per] of [
    [pl.own.machI, 2 + c],
    [pl.own.machS, 1 + c],
  ] as [number, number][]) {
    for (let i = 0; i < n && slots > 0 && raw > 0 && cost + 2 <= pl.rub; i++) {
      const u = Math.min(per, raw);
      units += u;
      raw -= u;
      cost += 2;
      slots--;
    }
  }
  return { units, cost };
}

/** Деньги игрока на конец игры: рубли и доллары 1:1, имущество по курсу, минус долг. */
export function worth(s: State, i: number, r = rate(s)): number {
  const pl = s.p[i];
  let w = pl.rub + pl.usd - (pl.loan ? LOAN_BACK : 0);
  for (const k of KEYS) w += pl.own[k] * sellPrice(s, k, r);
  w += pl.cargo.goods * sellPrice(s, 'goods', r);
  for (const [k, n] of Object.entries(pl.cargo.imports)) w += (n ?? 0) * sellPrice(s, k as Key, r);
  return w;
}

// ---------------------------------------------------------------- действия

export type Action =
  | { type: 'buy'; items: Partial<Record<Key, number>> }
  | { type: 'sell'; items: Partial<Record<Key, number>> }
  | { type: 'mine' }
  | { type: 'produce' }
  | { type: 'load'; n: number }
  | { type: 'unload' }
  | { type: 'trip'; to: Loc; mode: Mode; goods: number }
  | { type: 'skip' }
  | { type: 'loan' }
  | { type: 'repay' }
  | { type: 'exchange'; usd: number }
  | { type: 'offer'; to: number; give: Bundle; get: Bundle }
  | { type: 'rent'; to: number; work: Work; fee: number }
  | { type: 'answer'; yes: boolean };

export type Event =
  | { type: 'buy'; seat: number; items: Partial<Record<Key, number>>; cost: number; usd: boolean }
  | { type: 'sell'; seat: number; items: Partial<Record<Key, number>>; got: number; usd: boolean }
  | { type: 'mine'; seat: number; units: number; cost: number }
  | { type: 'produce'; seat: number; units: number; cost: number }
  | { type: 'load'; seat: number; n: number; fee: number }
  | { type: 'unload'; seat: number; n: number }
  | { type: 'trip'; seat: number; from: Loc; to: Loc; mode: Mode; cost: number }
  | { type: 'card'; seat: number; kind: number }
  | { type: 'arrive'; seat: number; at: Loc; units: number }
  | { type: 'back'; seat: number; at: Loc }
  | { type: 'rate'; rate: number }
  | { type: 'skip'; seat: number; forced: boolean }
  | { type: 'loan'; seat: number; back: boolean }
  | { type: 'exchange'; seat: number; usd: number }
  | { type: 'broke'; seat: number }
  | { type: 'end'; winner: number | null; worth: number[] }
  | { type: 'offer'; offer: Offer }
  | { type: 'answer'; offer: Offer; yes: boolean }
  | { type: 'rented'; seat: number; owner: number; work: Work; units: number; cost: number; fee: number };

/** Где фишка может оказаться: занятые другими континенты закрыты. */
export const contFree = (s: State, c: Cont, me: number) => !s.p.some((q, i) => i !== me && q.alive && q.loc === c);

/** Какие поездки возможны (без своего товара — его число выбирает игрок). */
export function trips(s: State, i: number): { to: Loc; mode: Mode; cost: number }[] {
  const pl = s.p[i];
  const out: { to: Loc; mode: Mode; cost: number }[] = [];
  const dests: Loc[] = pl.loc === 'ussr' ? CONTS.filter((c) => contFree(s, c, i)) : ['ussr'];
  const units = loadOf(pl.cargo);
  for (const to of dests) {
    const abroad = to === 'ussr' ? (pl.loc as Cont) : to;
    if (pl.own.truckS + pl.own.truckI > 0 && capacity(pl, 'truck') >= units) out.push({ to, mode: 'truck', cost: 0 });
    if (pl.own.fleetS + pl.own.fleetI > 0 && BY_SEA.includes(abroad) && capacity(pl, 'fleet') >= units) out.push({ to, mode: 'fleet', cost: 0 });
    const cost = (1 + units) * freight(s);
    if (pl.rub >= cost) out.push({ to, mode: 'state', cost });
  }
  return out;
}

/** Базовые действия (для ботов и проверки); корзины покупки/продажи — любые допустимые, их проверяет apply. */
export function legal(s: State): Action[] {
  if (s.over) return [];
  const i = s.turn;
  const pl = s.p[i];
  const out: Action[] = [{ type: 'skip' }];
  if (!pl.loan) out.push({ type: 'loan' });
  else if (pl.rub >= LOAN_BACK) out.push({ type: 'repay' });
  if (pl.usd > 0 && pl.loc === 'ussr') out.push({ type: 'exchange', usd: pl.usd });
  if (pl.loc === 'ussr') {
    for (const k of KEYS) if (s.market[k] > 0 && pl.rub >= buyPrice(s, k)) out.push({ type: 'buy', items: { [k]: 1 } });
    for (const k of KEYS) if (pl.own[k] > 0) out.push({ type: 'sell', items: { [k]: pl.own[k] } });
    const m = mineYield(pl);
    if (m.units > 0 && pl.rub >= m.cost) out.push({ type: 'mine' });
    const p = produceYield(pl);
    if (p.units > 0 && pl.rub >= p.cost) out.push({ type: 'produce' });
  } else {
    const c = pl.loc as Cont;
    const k = CONT_ITEM[c];
    const price = WORLD_PRICE[ROW[k]]!;
    if (s.world[c] > 0 && pl.usd >= price && freeCap(pl) > 0) out.push({ type: 'buy', items: { [k]: 1 } });
    if (pl.cargo.goods > 0) out.push({ type: 'sell', items: { goods: pl.cargo.goods } });
  }
  const room = freeCap(pl);
  if (room > 0 && maxCap(pl) > 0 && (pl.loc === 'ussr' ? pl.cargo.state === 0 || pl.cargo.stateKind === 'goods' : s.world[pl.loc as Cont] > 0 && (pl.cargo.state === 0 || pl.cargo.stateKind === CONT_ITEM[pl.loc as Cont])))
    out.push({ type: 'load', n: room });
  if (canUnload(pl)) out.push({ type: 'unload' });
  for (const t of trips(s, i)) out.push({ type: 'trip', to: t.to, mode: t.mode, goods: tripGoods(s, i, t.mode) });
  return out;
}

/** Свободное место (по наибольшему своему транспорту; гос. транспорт не в счёт — для погрузки нужен свой). */
export const freeCap = (pl: Player) => Math.max(0, maxCap(pl) - loadOf(pl.cargo));
const canUnload = (pl: Player) => pl.cargo.state > 0 && ((pl.loc === 'ussr') === (pl.cargo.stateKind !== 'goods'));
/** Сколько своего товара возьмёт с собой при поездке из СССР (сколько влезет). */
export function tripGoods(s: State, i: number, mode: Mode): number {
  const pl = s.p[i];
  if (pl.loc !== 'ussr') return 0;
  const room = capacity(pl, mode) - loadOf(pl.cargo);
  return Math.max(0, Math.min(pl.own.goods, mode === 'state' ? pl.own.goods : room));
}

function validBasket(s: State, i: number, a: Action & { items: Partial<Record<Key, number>> }, buy: boolean): number | null {
  const pl = s.p[i];
  let sum = 0;
  let units = 0;
  for (const [key, nRaw] of Object.entries(a.items ?? {})) {
    const k = key as Key;
    const n = Number(nRaw);
    if (!KEYS.includes(k) || !Number.isInteger(n) || n <= 0) return null;
    if (pl.loc === 'ussr') {
      if (buy) {
        if (s.market[k] < n) return null;
        sum += n * buyPrice(s, k);
      } else {
        if (pl.own[k] < n) return null;
        sum += n * sellPrice(s, k);
      }
    } else {
      const c = pl.loc as Cont;
      if (buy) {
        if (k !== CONT_ITEM[c] || s.world[c] < n) return null;
        sum += n * WORLD_PRICE[ROW[k]]!;
        units += n;
      } else {
        if (k !== 'goods' || pl.cargo.goods < n) return null;
        sum += n * WORLD_PRICE.goods!;
      }
    }
  }
  if (sum === 0) return null;
  if (buy && (pl.loc === 'ussr' ? pl.rub : pl.usd) < sum) return null;
  if (buy && pl.loc !== 'ussr' && units > freeCapFor(pl)) return null;
  return sum;
}
/** За границей купленное грузится на тот транспорт, на котором приехали (гос. — без ограничений). */
const freeCapFor = (pl: Player) => (pl.lastMode === 'state' ? 999 : Math.max(0, capacity(pl, pl.lastMode ?? 'truck') - loadOf(pl.cargo)));

// ---------------------------------------------------------------- частные сделки и аренда

const isCount = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;
/** Сторона сделки может это отдать. */
export function bundleOk(pl: Player, b: Bundle): boolean {
  if (!b || typeof b !== 'object') return false;
  if (b.rub != null && (!isCount(b.rub) || b.rub > pl.rub)) return false;
  if (b.usd != null && (!isCount(b.usd) || b.usd > pl.usd)) return false;
  for (const [k, n] of Object.entries(b.items ?? {})) if (!KEYS.includes(k as Key) || !isCount(n) || (n as number) > pl.own[k as Key]) return false;
  return true;
}
export const bundleEmpty = (b: Bundle) => !b.rub && !b.usd && !Object.values(b.items ?? {}).some((n) => (n ?? 0) > 0);
const hasItems = (b: Bundle) => Object.values(b.items ?? {}).some((n) => (n ?? 0) > 0);
/** Можно ли сейчас предлагать сделку игроку `to`: свой ход, не больше MAX_OFFERS, товар — только в одном месте. */
export function canOffer(s: State, from: number, to: number, give: Bundle, get: Bundle): boolean {
  if (s.over || s.offer || from !== s.turn || (s.offers ?? 0) >= MAX_OFFERS) return false;
  if (!Number.isInteger(to) || to === from || !s.p[to]?.alive) return false;
  if (!bundleOk(s.p[from], give) || !bundleOk(s.p[to], get)) return false;
  // «любая услуга должна быть оплачена»: отдают обе стороны
  if (bundleEmpty(give) || bundleEmpty(get)) return false;
  if ((hasItems(give) || hasItems(get)) && s.p[from].loc !== s.p[to].loc) return false;
  return true;
}
/** Оборудование хозяина в руках арендатора: добыча или производство с его сырьём и деньгами. */
export function rentYield(s: State, from: number, to: number, work: Work, fee: number): { units: number; cost: number } {
  const me = s.p[from];
  const owner = s.p[to];
  const own = { ...me.own, equipS: owner.own.equipS, equipI: owner.own.equipI, factory: owner.own.factory, machS: owner.own.machS, machI: owner.own.machI, comp: owner.own.comp };
  const pl: Player = { ...me, own, rub: me.rub - fee };
  return work === 'mine' ? mineYield(pl) : produceYield(pl);
}
export function canRent(s: State, from: number, to: number, work: Work, fee: number): boolean {
  if (s.over || s.offer || from !== s.turn || (s.offers ?? 0) >= MAX_OFFERS) return false;
  if (!Number.isInteger(to) || to === from || !s.p[to]?.alive || (work !== 'mine' && work !== 'produce')) return false;
  if (!isCount(fee) || fee < 1 || fee > s.p[from].rub) return false;
  if (s.p[from].loc !== 'ussr' || s.p[to].loc !== 'ussr') return false;
  return rentYield(s, from, to, work, fee).units > 0;
}

function give(from: Player, to: Player, b: Bundle) {
  from.rub -= b.rub ?? 0;
  to.rub += b.rub ?? 0;
  from.usd -= b.usd ?? 0;
  to.usd += b.usd ?? 0;
  for (const [k, n] of Object.entries(b.items ?? {})) {
    from.own[k as Key] -= n ?? 0;
    to.own[k as Key] += n ?? 0;
  }
}

function dealStep(s0: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  const s = clone(s0);
  const ev: Event[] = [];
  if (a.type === 'offer') {
    if (!canOffer(s0, seat, a.to, a.give, a.get)) return null;
    s.offer = { kind: 'deal', from: seat, to: a.to, give: a.give, get: a.get };
  } else if (a.type === 'rent') {
    if (!canRent(s0, seat, a.to, a.work, a.fee)) return null;
    s.offer = { kind: 'rent', from: seat, to: a.to, work: a.work, fee: a.fee };
  } else if (a.type === 'answer') {
    const o = s0.offer;
    if (!o || seat !== o.to) return null;
    s.offer = null;
    s.offers = (s0.offers ?? 0) + 1;
    ev.push({ type: 'answer', offer: o, yes: !!a.yes });
    if (!a.yes) return { state: s, events: ev };
    const me = s.p[o.from];
    const them = s.p[o.to];
    if (o.kind === 'deal') {
      if (!bundleOk(me, o.give) || !bundleOk(them, o.get)) return { state: s, events: ev };
      give(me, them, o.give);
      give(them, me, o.get);
      return { state: s, events: ev };
    }
    // аренда — это ход арендатора
    const y = rentYield(s0, o.from, o.to, o.work, o.fee);
    me.rub -= o.fee + y.cost;
    them.rub += o.fee;
    if (o.work === 'mine') me.own.raw += y.units;
    else {
      me.own.raw -= y.units;
      me.own.goods += y.units;
    }
    s.ply++;
    ev.push({ type: 'rented', seat: o.from, owner: o.to, work: o.work, units: y.units, cost: y.cost, fee: o.fee });
    endTurn(s, ev);
    return { state: s, events: ev };
  } else return null;
  ev.push({ type: 'offer', offer: s.offer! });
  return { state: s, events: ev };
}

export function apply(s: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s.over || !a || typeof a !== 'object') return null;
  if (s.offer) return a.type === 'answer' ? dealStep(s, seat, a) : null;
  if (seat !== s.turn) return null;
  if (a.type === 'offer' || a.type === 'rent' || a.type === 'answer') return dealStep(s, seat, a);
  const pl = s.p[seat];
  switch (a.type) {
    case 'buy':
    case 'sell':
      if (validBasket(s, seat, a, a.type === 'buy') == null) return null;
      break;
    case 'exchange':
      if (pl.loc !== 'ussr' || !Number.isInteger(a.usd) || a.usd <= 0 || a.usd > pl.usd) return null;
      break;
    case 'load':
      if (!Number.isInteger(a.n) || a.n <= 0 || a.n > freeCap(pl) || !legal(s).some((m) => m.type === 'load')) return null;
      break;
    case 'trip': {
      const t = trips(s, seat).find((x) => x.to === a.to && x.mode === a.mode);
      if (!t || !Number.isInteger(a.goods) || a.goods < 0 || a.goods > tripGoods(s, seat, a.mode)) return null;
      break;
    }
    default:
      if (!legal(s).some((m) => m.type === a.type)) return null;
  }
  return step(s, a, rng);
}

function clone(s: State): State {
  return {
    ...s,
    p: s.p.map((q) => ({ ...q, own: { ...q.own }, cargo: { ...q.cargo, imports: { ...q.cargo.imports } } })),
    market: { ...s.market },
    world: { ...s.world },
    deck: s.deck.slice(),
  };
}

export function step(s0: State, a: Action, rng: Rng): { state: State; events: Event[] } {
  const s = clone(s0);
  const seat = s.turn;
  const pl = s.p[seat];
  const ev: Event[] = [];
  s.ply++;
  switch (a.type) {
    case 'loan':
      pl.loan = true;
      pl.rub += LOAN;
      ev.push({ type: 'loan', seat, back: false });
      return { state: s, events: ev };
    case 'repay':
      pl.loan = false;
      pl.rub -= LOAN_BACK;
      ev.push({ type: 'loan', seat, back: true });
      return { state: s, events: ev };
    case 'exchange':
      pl.usd -= a.usd;
      pl.rub += a.usd;
      ev.push({ type: 'exchange', seat, usd: a.usd });
      return { state: s, events: ev };
    case 'skip':
      ev.push({ type: 'skip', seat, forced: false });
      break;
    case 'buy': {
      const sum = validBasket(s0, seat, a, true)!;
      if (pl.loc === 'ussr') {
        pl.rub -= sum;
        for (const [k, n] of Object.entries(a.items)) {
          s.market[k as Key] -= n!;
          pl.own[k as Key] += n!;
        }
      } else {
        pl.usd -= sum;
        for (const [k, n] of Object.entries(a.items)) {
          s.world[pl.loc as Cont] -= n!;
          pl.cargo.imports[k as Key] = (pl.cargo.imports[k as Key] ?? 0) + n!;
        }
      }
      ev.push({ type: 'buy', seat, items: a.items, cost: sum, usd: pl.loc !== 'ussr' });
      break;
    }
    case 'sell': {
      const sum = validBasket(s0, seat, a, false)!;
      if (pl.loc === 'ussr') {
        pl.rub += sum;
        for (const [k, n] of Object.entries(a.items)) {
          pl.own[k as Key] -= n!;
          s.market[k as Key] += n!;
        }
      } else {
        pl.usd += sum;
        pl.cargo.goods -= a.items.goods!;
      }
      ev.push({ type: 'sell', seat, items: a.items, got: sum, usd: pl.loc !== 'ussr' });
      break;
    }
    case 'mine': {
      const m = mineYield(pl);
      pl.rub -= m.cost;
      pl.own.raw += m.units;
      ev.push({ type: 'mine', seat, units: m.units, cost: m.cost });
      break;
    }
    case 'produce': {
      const p = produceYield(pl);
      pl.rub -= p.cost;
      pl.own.raw -= p.units;
      pl.own.goods += p.units;
      ev.push({ type: 'produce', seat, units: p.units, cost: p.cost });
      break;
    }
    case 'load': {
      const fee = a.n * freight(s);
      pl.cargo.state += a.n;
      if (pl.loc === 'ussr') pl.cargo.stateKind = 'goods';
      else {
        pl.cargo.stateKind = CONT_ITEM[pl.loc as Cont];
        s.world[pl.loc as Cont] -= a.n;
      }
      pl.rub += fee;
      ev.push({ type: 'load', seat, n: a.n, fee });
      break;
    }
    case 'unload': {
      const n = pl.cargo.state;
      if (pl.loc === 'ussr' && pl.cargo.stateKind) s.market[pl.cargo.stateKind] += n;
      pl.cargo.state = 0;
      pl.cargo.stateKind = null;
      ev.push({ type: 'unload', seat, n });
      break;
    }
    case 'trip':
      return trip(s, seat, a, ev, rng);
  }
  endTurn(s, ev);
  return { state: s, events: ev };
}

function draw(s: State, rng: Rng): number {
  if (!s.deck.length) s.deck = shuffle(rng);
  return s.deck.shift()!;
}

/** Поездка: плата за гос. транспорт, карта «События в пути», прибытие с переводом индикатора. */
function trip(s: State, seat: number, a: Action & { type: 'trip' }, ev: Event[], rng: Rng) {
  const pl = s.p[seat];
  const from = pl.loc;
  if (from === 'ussr' && a.goods > 0) {
    pl.own.goods -= a.goods;
    pl.cargo.goods += a.goods;
  }
  const cost = a.mode === 'state' ? (1 + loadOf(pl.cargo)) * freight(s) : 0;
  pl.rub -= cost;
  pl.lastMode = a.mode;
  ev.push({ type: 'trip', seat, from, to: a.to, mode: a.mode, cost });
  const kind = draw(s, rng);
  s.card = kind;
  ev.push({ type: 'card', seat, kind });
  const card = CARD_KINDS[kind].card;
  let arrive = true;
  switch (card.k) {
    case 'usd':
      pl.usd += card.v;
      break;
    case 'repair':
      payRub(s, seat, card.v, ev);
      break;
    case 'engine':
      payRub(s, seat, card.v, ev);
      arrive = false;
      pl.skip++;
      break;
    case 'typhoon':
      arrive = false;
      pl.skip++;
      break;
    case 'maneuvers':
    case 'strike':
      pl.skip++;
      break;
    case 'disaster':
      // весь груз и транспорт этой поездки пропали; колоду — заново
      pl.cargo = { goods: 0, state: 0, stateKind: null, imports: {} };
      if (a.mode === 'truck') pl.own.truckS = pl.own.truckI = 0;
      if (a.mode === 'fleet') pl.own.fleetS = pl.own.fleetI = 0;
      s.deck = shuffle(rng);
      pl.loc = 'ussr';
      ev.push({ type: 'back', seat, at: 'ussr' });
      endTurn(s, ev);
      return { state: s, events: ev };
  }
  if (!pl.alive) {
    endTurn(s, ev);
    return { state: s, events: ev };
  }
  if (!arrive) {
    // вернулся, откуда выехал; свой товар — снова на складе
    if (from === 'ussr') {
      pl.own.goods += pl.cargo.goods;
      pl.cargo.goods = 0;
    }
    ev.push({ type: 'back', seat, at: from });
    endTurn(s, ev);
    return { state: s, events: ev };
  }
  pl.loc = a.to;
  const units = loadOf(pl.cargo);
  ev.push({ type: 'arrive', seat, at: a.to, units });
  const before = rate(s);
  s.ind += units;
  if (a.to === 'ussr') {
    // привезённое своё — уже имущество; непроданный свой товар — снова на склад
    for (const [k, n] of Object.entries(pl.cargo.imports)) pl.own[k as Key] += n ?? 0;
    pl.cargo.imports = {};
    pl.own.goods += pl.cargo.goods;
    pl.cargo.goods = 0;
  }
  const after = rate(s);
  if (after !== before) ev.push({ type: 'rate', rate: after });
  if (after === 5) {
    finish(s, ev);
    return { state: s, events: ev };
  }
  if (card.k === 'extra') {
    s.extra = true;
    return { state: s, events: ev };
  }
  endTurn(s, ev);
  return { state: s, events: ev };
}

/** Заплатить рублями: не хватает — доллары, ссуда, распродажа имущества; иначе — банкрот. */
function payRub(s: State, seat: number, v: number, ev: Event[]) {
  const pl = s.p[seat];
  if (pl.rub < v && pl.usd > 0) {
    const x = Math.min(pl.usd, v - pl.rub);
    pl.usd -= x;
    pl.rub += x;
  }
  if (pl.rub < v && !pl.loan) {
    pl.loan = true;
    pl.rub += LOAN;
    ev.push({ type: 'loan', seat, back: false });
  }
  for (const k of KEYS) {
    while (pl.rub < v && pl.own[k] > 0) {
      pl.own[k]--;
      s.market[k]++;
      pl.rub += sellPrice(s, k);
    }
  }
  if (pl.rub < v) {
    pl.rub = 0;
    pl.alive = false;
    ev.push({ type: 'broke', seat });
    return;
  }
  pl.rub -= v;
}

function endTurn(s: State, ev: Event[]) {
  s.extra = false;
  s.offers = 0;
  s.offer = null;
  if (s.p.filter((q) => q.alive).length <= 1) return finish(s, ev);
  let t = s.turn;
  for (let guard = 0; guard < 4 * s.n; guard++) {
    t = (t + 1) % s.n;
    if (t === s.first) {
      s.round++;
      if (s.round > SAFETY_ROUNDS) return finish(s, ev);
    }
    const q = s.p[t];
    if (!q.alive) continue;
    if (q.skip > 0) {
      q.skip--;
      ev.push({ type: 'skip', seat: t, forced: true });
      continue;
    }
    break;
  }
  s.turn = t;
}

function finish(s: State, ev: Event[]) {
  s.over = true;
  const w = s.p.map((q, i) => (q.alive ? worth(s, i) : -Infinity));
  const best = Math.max(...w);
  const top = w.flatMap((x, i) => (x === best ? [i] : []));
  s.winner = top.length === 1 ? top[0] : null;
  ev.push({ type: 'end', winner: s.winner, worth: w.map((x) => (x === -Infinity ? 0 : x)) });
}

