/* «Вестерн» — движок без DOM. Один кубик, фишки идут по стрелкам поля; на развилках (5, 48, 57, 77, 100, 129) игрок выбирает путь
 * прямо посреди хода. Круг закрывается на клетке 1: разовый доход 5 000 $, дивиденды по акциям, продукция МММ и ЭМА, проценты.
 * Все решения — общий «вопрос» (ask) со списком вариантов: { type: 'choose', id }. Акции можно продать банку по номиналу в любой момент
 * своего хода ({ type: 'sell', cell }). Не хватает денег — снимается вклад, продаются товары и акции; не хватило и этого — банкрот.
 * Конец — кто-то прошёл заданное число кругов или остался один не разорившийся. Побеждает самый богатый: наличные, вклад, акции
 * и товары по курсу минус кредиты и стартовая ссуда.
 *
 * Решения, принятые без правил (их в инструкции нет): процент по кредиту 15 % за круг, по вкладу 10 %; «Мститель» (51) отбирает
 * половину наличных; торги (9) — английский аукцион с половины номинала, шаг 10 %; покупка у игрока на бирже (14, 64, 87) —
 * предложение за полторы цены, владелец соглашается или нет; «Крёстный отец» — банк. */
import type { Rng } from '../../core/types';
import {
  BANKS,
  CELLS,
  CO,
  CO_CELLS,
  COLONY_STEP,
  CREDIT_PER_LAP,
  CREDIT_RATE,
  DEPOSIT_RATE,
  DRUG_SALE,
  EXCHANGES,
  FACTORY,
  GOOD_IDS,
  GOODS,
  LAP_BONUS,
  LEAD,
  MARKETS,
  SPECULATION,
  START_LOAN,
  inColony,
  inSlip,
  type Good,
  type Stuff,
} from './data';

export type Flag = 'bribe' | 'free' | 'bank37' | 'strike' | 'crop' | 'press' | 'army' | 'star';

export type AskKind =
  | 'fork'
  | 'buy'
  | 'drugs'
  | 'bribe'
  | 'star'
  | 'casino'
  | 'army'
  | 'trinkets'
  | 'gold25'
  | 'back52'
  | 'brains'
  | 'terror'
  | 'gold108'
  | 'jail'
  | 'ransom'
  | 'credit'
  | 'hit'
  | 'media'
  | 'goto'
  | 'drugsell'
  | 'bank'
  | 'market'
  | 'spec'
  | 'xbuy'
  | 'offer'
  | 'auction';

export interface Opt {
  id: string;
  label: string;
  /** Главный вариант — выделен. */
  main?: boolean;
}

export interface Ask {
  seat: number;
  kind: AskKind;
  cell: number;
  text: string;
  opts: Opt[];
  /** Развилка посреди хода: сколько шагов осталось. Предложение на бирже: кто покупает и за сколько. */
  left?: number;
  buyer?: number;
  price?: number;
  target?: number;
}

export interface Auction {
  cell: number;
  bid: number;
  lead: number | null;
  /** Кто ещё торгуется, по кругу. */
  in: number[];
  /** Чья очередь (индекс в in). */
  at: number;
}

export interface State {
  seats: number[];
  /** Сколько кругов играть. */
  circles: number;
  /** Упрощение для начинающих: биржа труда и курсы акций не меняются. */
  simple: boolean;
  pos: number[];
  cash: number[];
  dep: number[];
  /** Кредит банка (с процентами каждый круг). */
  debt: number[];
  /** Стартовая беспроцентная ссуда. */
  loan: number[];
  /** Колониальный заём (115) — вернуть в конце круга. */
  colLoan: number[];
  /** Взято кредита в этом круге. */
  borrowed: number[];
  gold: number[];
  stuff: Record<Stuff, number>[];
  /** Биржа труда: индекс −4…+4. */
  labour: number[];
  circle: number[];
  out: boolean[];
  skip: number[];
  extra: number[];
  flags: Flag[][];
  /** Заработано на скользком пути / в колонии с момента входа (для конфискаций). */
  slip: number[];
  col: number[];
  colGold: number[];
  /** Сколько раз прошёл круг колонии (130 → 114). */
  colLap: number[];
  /** Вклады золотом (70): на каком круге созреют. */
  brains: number[][];
  owner: Record<number, number | null>;
  /** Фондовая биржа: пункты ведущих компаний. */
  pts: Record<number, number>;
  /** Товарная биржа: пункты товаров. */
  gp: Record<Good, number>;
  turn: number;
  phase: 'roll' | 'ask' | 'over';
  ask: Ask | null;
  auc: Auction | null;
  dice: number | null;
  result: { winners: number[]; text: string; scores: Record<number, number> } | null;
}

export type Action = { type: 'roll' } | { type: 'choose'; id: string } | { type: 'sell'; cell: number };

export type Who = number | null;

export type Event =
  | { type: 'roll'; seat: number; d: number; back?: boolean }
  | { type: 'move'; seat: number; path: number[]; jump?: boolean }
  | { type: 'cell'; seat: number; cell: number }
  | { type: 'pay'; from: Who; to: Who; amount: number; why: string }
  | { type: 'gold'; seat: number; kg: number; why: string }
  | { type: 'stuff'; seat: number; what: Stuff; n: number; why: string }
  | { type: 'lap'; seat: number; circle: number; income: number; lost: boolean }
  | { type: 'labour'; seat: number; labour: number }
  | { type: 'stock'; cell: number; pts: number }
  | { type: 'price'; good: Good; pts: number }
  | { type: 'buy'; seat: number; cell: number; price: number; from?: Who }
  | { type: 'sell'; seat: number; cell: number; price: number; why: string }
  | { type: 'skip'; seat: number; left: number }
  | { type: 'jail'; seat: number; n: number; bribed?: boolean }
  | { type: 'choice'; seat: number; kind: AskKind; label: string }
  | { type: 'casino'; seat: number; d: number; bet: number; win: boolean }
  | { type: 'auction'; cell: number; seat: number | null; bid: number }
  | { type: 'bankrupt'; seat: number }
  | { type: 'end'; winners: number[]; text: string };

export const fmt = (n: number) => (n < 0 ? '−' : '') + String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const money = (n: number) => fmt(n) + ' $';

export const goodPrice = (s: State, g: Good) => GOODS[g].nom + s.gp[g] * GOODS[g].step;
/** Стоимость акции: ведущие — по курсу фондовой биржи (пункт = 10 % номинала). */
export const coValue = (s: State, cell: number) => Math.round(CO[cell].price * (LEAD.includes(cell) ? 1 + 0.1 * (s.pts[cell] ?? 0) : 1));
export const owned = (s: State, seat: number) => CO_CELLS.filter((c) => s.owner[c] === seat);
export const alive = (s: State) => s.seats.filter((p) => !s.out[p]);
export const has = (s: State, seat: number, f: Flag) => s.flags[seat].includes(f);
export const mediaCount = (s: State, seat: number) => owned(s, seat).filter((c) => CO[c].group === 'media').length;

/** Сколько всё стоит: наличные, вклад, акции и товары по курсу минус кредиты и ссуда. */
export function worth(s: State, seat: number): number {
  let w = s.cash[seat] + s.dep[seat] - s.debt[seat] - s.loan[seat] - s.colLoan[seat];
  for (const c of owned(s, seat)) w += coValue(s, c);
  for (const g of GOOD_IDS) w += (g === 'gold' ? s.gold[seat] : s.stuff[seat][g]) * goodPrice(s, g);
  return w;
}

const STUFF0 = (): Record<Stuff, number> => ({ gold: 0, auto: 0, cola: 0, oil: 0, drugs: 0, trinkets: 0 });

export function newState(seats: number[], circles: number, simple: boolean): State {
  const four = <T>(f: (i: number) => T) => Array.from({ length: 4 }, (_, i) => f(i));
  const inGame = (i: number) => seats.includes(i);
  const owner: Record<number, number | null> = {};
  for (const c of CO_CELLS) owner[c] = null;
  return {
    seats,
    circles: Math.max(1, circles),
    simple,
    pos: four(() => 0),
    cash: four((i) => (inGame(i) ? START_LOAN : 0)),
    dep: four(() => 0),
    debt: four(() => 0),
    loan: four((i) => (inGame(i) ? START_LOAN : 0)),
    colLoan: four(() => 0),
    borrowed: four(() => 0),
    gold: four(() => 0),
    stuff: four(STUFF0),
    labour: four(() => 0),
    circle: four(() => 0),
    out: four((i) => !inGame(i)),
    skip: four(() => 0),
    extra: four(() => 0),
    flags: four(() => []),
    slip: four(() => 0),
    col: four(() => 0),
    colGold: four(() => 0),
    colLap: four(() => 0),
    brains: four(() => []),
    owner,
    pts: { 65: 0, 56: 0, 117: 0 },
    gp: { gold: 0, auto: 0, cola: 0, oil: 0 },
    turn: seats[0],
    phase: 'roll',
    ask: null,
    auc: null,
    dice: null,
    result: null,
  };
}

export function clone(s: State): State {
  return {
    ...s,
    seats: s.seats.slice(),
    pos: s.pos.slice(),
    cash: s.cash.slice(),
    dep: s.dep.slice(),
    debt: s.debt.slice(),
    loan: s.loan.slice(),
    colLoan: s.colLoan.slice(),
    borrowed: s.borrowed.slice(),
    gold: s.gold.slice(),
    stuff: s.stuff.map((x) => ({ ...x })),
    labour: s.labour.slice(),
    circle: s.circle.slice(),
    out: s.out.slice(),
    skip: s.skip.slice(),
    extra: s.extra.slice(),
    flags: s.flags.map((x) => x.slice()),
    slip: s.slip.slice(),
    col: s.col.slice(),
    colGold: s.colGold.slice(),
    colLap: s.colLap.slice(),
    brains: s.brains.map((x) => x.slice()),
    owner: { ...s.owner },
    pts: { ...s.pts },
    gp: { ...s.gp },
    ask: s.ask ? { ...s.ask, opts: s.ask.opts.map((o) => ({ ...o })) } : null,
    auc: s.auc ? { ...s.auc, in: s.auc.in.slice() } : null,
    result: s.result ? { ...s.result, winners: s.result.winners.slice(), scores: { ...s.result.scores } } : null,
  };
}

type Ctx = { s: State; ev: Event[]; rng: Rng };

const die = (x: Ctx) => x.rng.int(6) + 1;
const round100 = (n: number) => Math.round(n / 100) * 100;

// ---------------- деньги ----------------

/** Получить из банка. Заработок на скользком пути и в колонии запоминается — его могут конфисковать. */
function give(x: Ctx, seat: number, amount: number, why: string) {
  const { s } = x;
  amount = Math.round(amount);
  if (amount <= 0 || s.out[seat]) return;
  s.cash[seat] += amount;
  if (inSlip(s.pos[seat])) s.slip[seat] += amount;
  if (inColony(s.pos[seat])) s.col[seat] += amount;
  x.ev.push({ type: 'pay', from: null, to: seat, amount, why });
}

function addGold(x: Ctx, seat: number, kg: number, why: string) {
  const { s } = x;
  if (!kg) return;
  s.gold[seat] = Math.max(0, s.gold[seat] + kg);
  if (kg > 0 && inColony(s.pos[seat])) s.colGold[seat] += kg;
  x.ev.push({ type: 'gold', seat, kg, why });
}

/** Добыть наличные: вклад, товары по курсу, акции банку (сначала дешёвые). */
function raise(x: Ctx, seat: number, need: number) {
  const { s } = x;
  if (s.cash[seat] >= need) return;
  if (s.dep[seat] > 0) {
    const n = Math.min(s.dep[seat], need - s.cash[seat]);
    s.dep[seat] -= n;
    s.cash[seat] += n;
  }
  for (const g of GOOD_IDS) {
    if (s.cash[seat] >= need) return;
    const have = g === 'gold' ? s.gold[seat] : s.stuff[seat][g];
    if (have > 0) sellGood(x, seat, g, have, 'на покрытие долга');
  }
  const cos = owned(s, seat).sort((a, b) => coValue(s, a) - coValue(s, b));
  for (const c of cos) {
    if (s.cash[seat] >= need) return;
    sellCo(x, seat, c, 1, 'на покрытие долга');
  }
}

/** Заплатить (to = null — банку). Не хватает и после распродажи — банкротство. Возвращает, сколько заплачено. */
function pay(x: Ctx, seat: number, amount: number, to: Who, why: string): number {
  const { s } = x;
  amount = Math.round(amount);
  if (amount <= 0 || s.out[seat]) return 0;
  if (to === seat) return 0;
  raise(x, seat, amount);
  const paid = Math.min(amount, Math.max(0, s.cash[seat]));
  s.cash[seat] -= paid;
  if (to != null && !s.out[to]) s.cash[to] += paid;
  if (paid > 0) x.ev.push({ type: 'pay', from: seat, to, amount: paid, why });
  if (paid < amount) bankrupt(x, seat);
  return paid;
}

function bankrupt(x: Ctx, seat: number) {
  const { s } = x;
  if (s.out[seat]) return;
  s.out[seat] = true;
  for (const c of owned(s, seat)) s.owner[c] = null;
  s.cash[seat] = 0;
  s.dep[seat] = 0;
  x.ev.push({ type: 'bankrupt', seat });
  if (s.ask?.seat === seat && s.ask.kind !== 'offer') s.ask = null;
}

function sellGood(x: Ctx, seat: number, g: Good, n: number, why: string) {
  const { s } = x;
  if (n <= 0) return;
  if (g === 'gold') s.gold[seat] -= n;
  else s.stuff[seat][g] -= n;
  x.ev.push({ type: 'stuff', seat, what: g, n: -n, why });
  give(x, seat, n * goodPrice(s, g), `${GOODS[g].name}: ${n} ${GOODS[g].unit}`);
}

function sellCo(x: Ctx, seat: number, cell: number, mult: number, why: string) {
  const { s } = x;
  const price = Math.round(coValue(s, cell) * mult);
  s.owner[cell] = null;
  s.cash[seat] += price;
  x.ev.push({ type: 'sell', seat, cell, price, why });
}

// ---------------- биржи ----------------

function setLabour(x: Ctx, seat: number, d: number) {
  const { s } = x;
  if (s.simple) return;
  const was = s.labour[seat];
  s.labour[seat] = Math.max(-4, Math.min(4, was + d));
  if (s.labour[seat] === was) return;
  x.ev.push({ type: 'labour', seat, labour: s.labour[seat] });
  for (const c of LEAD) if (s.owner[c] === seat) moveStock(x, c, s.labour[seat] - was);
}

function moveStock(x: Ctx, cell: number, d: number) {
  const { s } = x;
  if (s.simple) return;
  const was = s.pts[cell];
  s.pts[cell] = Math.max(-5, Math.min(10, was + d));
  if (s.pts[cell] !== was) x.ev.push({ type: 'stock', cell, pts: s.pts[cell] });
}

function movePrice(x: Ctx, g: Good, d: number) {
  const { s } = x;
  const was = s.gp[g];
  s.gp[g] = Math.max(GOODS[g].min, Math.min(GOODS[g].max, was + d));
  if (s.gp[g] !== was) x.ev.push({ type: 'price', good: g, pts: s.gp[g] });
}

/** Процент по кредиту с учётом биржи труда. */
export const creditRate = (s: State, seat: number) => CREDIT_RATE * (s.labour[seat] > 0 ? 0.5 : s.labour[seat] < 0 ? 2 : 1);
/** Сколько можно продать на рынке: индекс ниже нуля — рынки берут только половину промышленной продукции. */
export const sellable = (s: State, seat: number, g: Good) => {
  const have = g === 'gold' ? s.gold[seat] : s.stuff[seat][g];
  return (g === 'auto' || g === 'cola') && s.labour[seat] < 0 ? Math.ceil(have / 2) : have;
};

// ---------------- круг ----------------

function profitOf(s: State, seat: number, c: number) {
  const co = CO[c];
  if (has(s, seat, 'strike') && FACTORY.has(c)) return 0;
  if (has(s, seat, 'crop') && co.group === 'plant') return 0;
  if (has(s, seat, 'press') && co.group === 'media') return 0;
  return co.profit;
}

/** Прошёл клетку 1: разовый доход, дивиденды, продукция, проценты, флаги круга. */
function lap(x: Ctx, seat: number) {
  const { s } = x;
  s.circle[seat]++;
  const lost = has(s, seat, 'bank37');
  let income = LAP_BONUS;
  for (const c of owned(s, seat)) income += profitOf(s, seat, c);
  // ХММ получает 10 % прибыли владельцев МММ и ЭМА
  const hmm = s.owner[10];
  x.ev.push({ type: 'lap', seat, circle: s.circle[seat], income, lost });
  if (!lost) give(x, seat, income, `круг ${s.circle[seat]}: разовый доход и дивиденды`);
  for (const c of [56, 65]) {
    if (s.owner[c] === seat && hmm != null && hmm !== seat && !s.out[hmm]) pay(x, seat, CO[c].profit * 0.1, hmm, `ХММ: 10 % прибыли ${c === 56 ? 'МММ' : 'ЭМА'}`);
  }
  // продукция: 1 бочка (автомобиль) с каждых 10 тыс. капитала
  if (!has(s, seat, 'strike')) {
    for (const [c, g] of [
      [56, 'cola'],
      [65, 'auto'],
    ] as const) {
      if (s.owner[c] !== seat) continue;
      const n = Math.floor(coValue(s, c) / 10000);
      s.stuff[seat][g] += n;
      x.ev.push({ type: 'stuff', seat, what: g, n, why: c === 56 ? 'продукция МММ' : 'продукция ЭМА' });
    }
  }
  // СМИ поднимают ваши ведущие акции на пункт за круг
  if (mediaCount(s, seat) > 0) for (const c of LEAD) if (s.owner[c] === seat) moveStock(x, c, 1);
  if (s.dep[seat] > 0) give(x, seat, s.dep[seat] * DEPOSIT_RATE, 'проценты по вкладу');
  if (s.debt[seat] > 0) pay(x, seat, s.debt[seat] * creditRate(s, seat), null, 'проценты по кредиту');
  if (s.colLoan[seat] > 0 && !s.out[seat]) {
    const n = s.colLoan[seat];
    s.colLoan[seat] = 0;
    pay(x, seat, n, null, 'возврат колониального займа');
  }
  const ripe = s.brains[seat].filter((c) => c <= s.circle[seat]).length;
  if (ripe) {
    s.brains[seat] = s.brains[seat].filter((c) => c > s.circle[seat]);
    addGold(x, seat, 20 * ripe, 'вклад золотом созрел');
  }
  s.flags[seat] = [];
  s.borrowed[seat] = 0;
}

// ---------------- ход ----------------

function nexts(s: State, seat: number, cell: number): number[] {
  const n = CELLS[cell].next;
  // в колонии — не больше двух кругов
  if (cell === 129 && s.colLap[seat] >= 1) return [131];
  return n;
}

/** Шаги по полю; на развилке посреди хода — вопрос. Дошёл — разбор клетки. */
function walk(x: Ctx, seat: number, left: number) {
  const { s } = x;
  while (left > 0) {
    const from = s.pos[seat];
    const opts = nexts(s, seat, from);
    if (opts.length > 1) {
      s.ask = forkAsk(s, seat, from, left);
      s.phase = 'ask';
      return;
    }
    step(x, seat, opts[0]);
    if (s.out[seat]) return;
    left--;
  }
  land(x, seat);
}

/** Шаг на соседнюю клетку (событие — на каждый шаг; отрисовка склеивает их в один ход). */
function step(x: Ctx, seat: number, to: number) {
  const { s } = x;
  const from = s.pos[seat];
  s.pos[seat] = to;
  x.ev.push({ type: 'move', seat, path: [to] });
  if (to === 1 && from !== 0) lap(x, seat);
  if (from === 130 && to === 114) s.colLap[seat]++;
  if (inColony(to)) pay(x, seat, COLONY_STEP, null, 'колония: клетка');
}

function forkAsk(s: State, seat: number, cell: number, left: number): Ask {
  const label: Record<string, string> = {
    '5:6': 'Деловой путь',
    '5:91': 'Скользкий путь',
    '48:49': 'Деловой путь',
    '48:89': 'К танкеру (89)',
    '48:111': 'Морем в колонию',
    '57:58': 'Деловой путь',
    '57:114': 'В колонию — 500 $',
    '77:78': 'На «Улицу 101»',
    '77:90': 'Через наркоплантатора (90)',
    '100:101': 'На дело (101)',
    '100:105': 'К выходу (105)',
    '129:130': 'Ещё круг по колонии',
    '129:131': 'На остров (131)',
  };
  const opts = nexts(s, seat, cell).map((n, i) => ({ id: String(n), label: label[`${cell}:${n}`] ?? `На клетку ${n}`, main: i === 0 }));
  return { seat, kind: 'fork', cell, text: 'Развилка: куда идти?', opts, left };
}

function goTo(x: Ctx, seat: number, to: number) {
  const { s } = x;
  if (to === 1) lap(x, seat);
  if (s.out[seat]) return;
  s.pos[seat] = to;
  x.ev.push({ type: 'move', seat, path: [to], jump: true });
  land(x, seat);
}

function jail(x: Ctx, seat: number, n: number, cell: number) {
  const { s } = x;
  if (has(s, seat, 'bribe') && [92, 96, 101, 103].includes(cell)) {
    x.ev.push({ type: 'jail', seat, n: 0, bribed: true });
    return;
  }
  if (s.stuff[seat].drugs > 0) n *= 2;
  s.skip[seat] += n;
  x.ev.push({ type: 'jail', seat, n });
}

const yesNo = (yes: string, no = 'Нет'): Opt[] => [
  { id: 'yes', label: yes, main: true },
  { id: 'no', label: no },
];

function ask(x: Ctx, seat: number, kind: AskKind, text: string, opts: Opt[], extra: Partial<Ask> = {}) {
  const { s } = x;
  s.ask = { seat, kind, cell: s.pos[seat], text, opts, ...extra };
  s.phase = 'ask';
}

/** Разбор клетки, на которой остановился игрок. */
function land(x: Ctx, seat: number) {
  const { s } = x;
  const cell = s.pos[seat];
  x.ev.push({ type: 'cell', seat, cell });
  const free = has(s, seat, 'free');
  const army = has(s, seat, 'army');
  const tax = (n: number, why: string) => {
    if (!free) pay(x, seat, n, null, why);
  };
  // ушёл со скользкого пути или из колонии — заработок там больше не считается
  if (!inSlip(cell)) s.slip[seat] = 0;
  if (!inColony(cell)) {
    s.col[seat] = 0;
    s.colGold[seat] = 0;
    s.colLap[seat] = 0;
  }

  if (CO[cell]) {
    const o = s.owner[cell];
    if (o == null) {
      const price = coValue(s, cell);
      if (s.cash[seat] >= price) ask(x, seat, 'buy', `${CO[cell].name}: купить за ${money(price)}?`, yesNo(`Купить за ${money(price)}`, 'Не покупать'));
    }
    return;
  }
  if (BANKS.has(cell)) return bankAsk(x, seat);
  if (MARKETS.has(cell)) return marketAsk(x, seat);
  if (EXCHANGES.has(cell)) return xbuyAsk(x, seat);
  if (SPECULATION[cell]) return specAsk(x, seat);
  if (DRUG_SALE[cell] && cell !== 98 && cell !== 104) return drugAsk(x, seat);

  switch (cell) {
    case 2: {
      const sum = [56, 65, 117].filter((c) => s.owner[c] === seat).reduce((n, c) => n + coValue(s, c), 0);
      if (sum) tax(sum * 0.33, 'налог: 33 % стоимости ведущих компаний');
      return;
    }
    case 3:
      if (s.cash[seat] >= 500)
        ask(x, seat, 'drugs', 'Купить наркотик по 100 $ за тонну?', [
          { id: '10', label: '10 т — 1 000 $', main: true },
          { id: '5', label: '5 т — 500 $' },
          { id: '0', label: 'Не покупать' },
        ]);
      return;
    case 4:
      if (!has(s, seat, 'bribe') && s.cash[seat] >= 1000) ask(x, seat, 'bribe', 'Подкупить полицию на круг за 1 000 $?', yesNo('Подкупить — 1 000 $'));
      return;
    case 5:
      return tax(500, 'президентский налог');
    case 7:
    case 62:
    case 126:
      if (cell === 62 && army) return;
      return goTo(x, seat, 83);
    case 9:
      return startAuction(x, seat);
    case 12:
      return goTo(x, seat, 15);
    case 13:
      return ask(x, seat, 'goto', 'Угон самолёта: выберите клетку на поле', gotoOpts(s, seat));
    case 16:
      if (!has(s, seat, 'star') && s.cash[seat] >= 5000) ask(x, seat, 'star', 'Поставить 5 000 $ на мировую звезду?', yesNo('Поставить 5 000 $'));
      return;
    case 17:
      s.skip[seat] += 2;
      x.ev.push({ type: 'jail', seat, n: 2 });
      return;
    case 19:
    case 77:
      return setLabour(x, seat, -1);
    case 32:
      return setLabour(x, seat, 1);
    case 21:
      pay(x, seat, 200, null, '«крёстному отцу»');
      return;
    case 22: {
      const rivals = alive(s).filter((p) => p !== seat);
      if (rivals.length && s.cash[seat] >= 5000)
        ask(x, seat, 'hit', 'Заказать конкурента за 5 000 $ — он отправится в «Протез-офис»?', [
          ...rivals.map((p) => ({ id: String(p), label: `Заказать: ${p}` })),
          { id: 'no', label: 'Нет', main: true },
        ]);
      return;
    }
    case 23:
      movePrice(x, 'oil', -1);
      return goTo(x, seat, 83);
    case 25:
      if (s.simple) return;
      if (s.gold[seat] >= 1) return ask(x, seat, 'gold25', 'Отдать 1 кг золота, чтобы индекс не упал?', yesNo('Отдать 1 кг', 'Пусть падает'));
      return setLabour(x, seat, -1);
    case 28:
      return addGold(x, seat, 3, 'золото');
    case 31: {
      const n = 5 * goodPrice(s, 'oil');
      pay(x, seat, n, s.owner[117], '5 баррелей нефти «Бамперу»');
      return;
    }
    case 34: {
      setLabour(x, seat, -1);
      const bread = s.owner[116];
      if (bread != null && !s.out[bread]) give(x, bread, CO[116].profit, 'хлебный плантатор: голод в колонии');
      pay(x, seat, s.cash[seat] * 0.2, s.owner[54], '«Протез-миссии» — 20 %');
      return;
    }
    case 35:
      if (mediaCount(s, seat) > 0)
        ask(x, seat, 'media', 'Ваша пресса: котировка какого товара падает на 1 пункт?', [
          ...GOOD_IDS.filter((g) => s.gp[g] > GOODS[g].min).map((g) => ({ id: g, label: GOODS[g].name })),
          { id: 'no', label: 'Никакого' },
        ]);
      return;
    case 36: {
      const o = s.owner[127];
      if (o != null && o !== seat) pay(x, seat, CO[127].profit, o, 'шикарные женщины: разовый доход жемчужной отмели');
      return;
    }
    case 37:
      s.flags[seat].push('bank37');
      return;
    case 39:
      if (s.cash[seat] >= 1000)
        ask(x, seat, 'casino', 'Казино: ставка? При «6» — вдесятеро.', [
          { id: '1000', label: 'Ставка 1 000 $', main: true },
          ...(s.cash[seat] >= 5000 ? [{ id: '5000', label: 'Ставка 5 000 $' }] : []),
          { id: '0', label: 'Не играть' },
        ]);
      return;
    case 40:
    case 41:
      if (has(s, seat, 'star')) {
        s.flags[seat] = s.flags[seat].filter((f) => f !== 'star');
        give(x, seat, 25000 + 5000 * mediaCount(s, seat), 'выигрыш на звезду');
      }
      return;
    case 42:
    case 43: {
      const g: Good = cell === 42 ? 'cola' : 'auto';
      const o = s.owner[cell === 42 ? 56 : 65];
      if (o !== seat) pay(x, seat, 10 * goodPrice(s, g), o, `10 ${g === 'cola' ? 'бочек кока-колы' : 'машин'}`);
      if (!s.out[seat]) {
        s.stuff[seat][g] += 10;
        x.ev.push({ type: 'stuff', seat, what: g, n: 10, why: 'покупка' });
      }
      return;
    }
    case 44: {
      const n = alive(s)
        .filter((p) => p !== seat && (inSlip(s.pos[p]) || inColony(s.pos[p]) || s.pos[p] === 88))
        .reduce((k, p) => k + s.skip[p], 0);
      if (n) give(x, seat, 200 * n, `«Бройлер Дайджест»: ${n} пропущенных ходов соперников`);
      return;
    }
    case 47:
      if (!army && s.cash[seat] >= 3000) ask(x, seat, 'army', '«Марионеточная армия»: защита на круг за 3 000 $?', yesNo('Нанять — 3 000 $'));
      return;
    case 48:
      if (s.cash[seat] >= 100)
        ask(x, seat, 'trinkets', 'Купить безделушки по 10 $ для туземцев?', [
          { id: '20', label: '20 шт. — 200 $', main: true },
          { id: '10', label: '10 шт. — 100 $' },
          { id: '0', label: 'Не покупать' },
        ]);
      return;
    case 50: {
      const rivals = alive(s).filter((p) => p !== seat);
      const part = Math.floor(s.cash[seat] / rivals.length);
      for (const p of rivals) pay(x, seat, part, p, 'вас надули');
      return;
    }
    case 51: {
      const nx = nextAlive(s, seat);
      if (nx == null || nx === seat || has(s, nx, 'army')) return;
      const n = Math.floor(s.cash[nx] / 2);
      if (n > 0) {
        s.cash[nx] -= n;
        s.cash[seat] += n;
        x.ev.push({ type: 'pay', from: nx, to: seat, amount: n, why: '«Мститель»' });
      }
      return;
    }
    case 52:
      if (s.gold[seat] >= 3) ask(x, seat, 'back52', 'За 3 кг золота бросить кубик и пойти назад?', yesNo('Назад — 3 кг', 'Остаться'));
      return;
    case 55: {
      const o = s.owner[127];
      if (o != null && !s.out[o]) give(x, o, CO[127].profit, '«Жемчужина»: разовый доход');
      return;
    }
    case 60: {
      const sum = owned(s, seat).reduce((n, c) => n + CO[c].profit, 0);
      const o = s.owner[53];
      if (!sum) return;
      if (o != null && o !== seat) pay(x, o, sum, seat, 'сброс отходов: военный завод платит');
      else give(x, seat, sum, 'сброс отходов');
      return;
    }
    case 66:
      s.flags[seat].push('strike');
      return setLabour(x, seat, 1);
    case 69:
      s.extra[seat] += 3;
      return;
    case 70:
      if (s.gold[seat] >= 1) ask(x, seat, 'brains', 'Вложить 1 кг золота — через 3 круга 20 кг?', yesNo('Вложить 1 кг'));
      return;
    case 71:
      for (const p of alive(s)) {
        const sum = owned(s, p)
          .filter((c) => CO[c].group === 'plant' && !CO[c].drugs)
          .reduce((n, c) => n + CO[c].profit, 0);
        if (sum) give(x, p, sum, '«Гербицид»: разовый доход плантатора');
      }
      return;
    case 73:
      s.flags[seat].push('free');
      return;
    case 74: {
      const leads = LEAD.filter((c) => s.owner[c] === seat);
      if (!leads.length || s.simple) return;
      if (s.gold[seat] >= 3) return ask(x, seat, 'terror', 'Теракт: отдать 3 кг золота, чтобы акции не упали?', yesNo('Отдать 3 кг', 'Пусть падают'));
      for (const c of leads) moveStock(x, c, -1);
      return;
    }
    case 75: {
      if (s.debt[seat] > 0) {
        const n = s.debt[seat];
        s.debt[seat] = 0;
        pay(x, seat, n, null, 'возврат кредита');
      }
      if (!s.out[seat] && s.loan[seat] > 0 && s.cash[seat] >= s.loan[seat]) {
        const n = s.loan[seat];
        s.loan[seat] = 0;
        pay(x, seat, n, null, 'возврат ссуды');
      }
      return;
    }
    case 76:
      s.flags[seat].push('crop');
      return;
    case 79:
      return tax(s.cash[seat] * 0.1, 'налог: 10 % наличных');
    case 80:
      return addGold(x, seat, 5, 'рука в бюджете');
    case 82:
      s.flags[seat].push('press');
      return;
    case 83:
      if (s.owner[54] !== seat) pay(x, seat, s.cash[seat] * 0.1, s.owner[54], '«Протез-офис»: 10 % за услуги');
      return;
    case 85:
      return give(x, seat, 10000, 'страховка «Гарантия-Фикс»');
    case 86: {
      const sum = owned(s, seat)
        .filter((c) => CO[c].group === 'plant')
        .reduce((n, c) => n + CO[c].profit, 0);
      if (sum) tax(sum, '«Компост-офис»: пошлина с плантаций');
      return;
    }
    case 88:
      s.skip[seat] += 3;
      x.ev.push({ type: 'jail', seat, n: 3 });
      return;
    case 89:
      return movePrice(x, 'oil', 1);
    case 90:
      if (s.owner[128] === seat) jail(x, seat, 5, cell);
      return;
    case 91:
      return give(x, seat, s.cash[seat], 'преступный клан: капитал удвоился');
    case 92:
    case 96:
      return jail(x, seat, 2, cell);
    case 101:
      return jail(x, seat, 3, cell);
    case 107:
      return jail(x, seat, 4, cell);
    case 93:
      return give(x, seat, 100, 'грабёж');
    case 95:
      pay(x, seat, 200, null, 'рэкет');
      return;
    case 97:
      return give(x, seat, 300, 'продажа краденого');
    case 98:
      give(x, seat, 400, 'фальшивая монета');
      return drugAsk(x, seat);
    case 99:
      return give(x, seat, 1000, 'налёт');
    case 100:
      return give(x, seat, 500, 'взлом сейфа');
    case 102:
      return give(x, seat, 700, 'вымогательство');
    case 103:
      if (has(s, seat, 'bribe')) return jail(x, seat, 2, cell);
      return jailAsk(x, seat, 2);
    case 104:
      give(x, seat, 1000, 'крупное дело');
      return drugAsk(x, seat);
    case 105:
      return jailAsk(x, seat, 4);
    case 106:
      if (s.slip[seat] > 0) {
        const n = Math.floor(s.slip[seat] / 2);
        pay(x, seat, n, null, '«крёстному отцу» — половина заработанного');
        s.slip[seat] -= n;
      }
      return;
    case 108: {
      const p = goodPrice(s, 'gold');
      const opts = [1, 5, 10].filter((k) => s.cash[seat] >= k * p).map((k) => ({ id: String(k), label: `${k} кг — ${money(k * p)}` }));
      if (opts.length) ask(x, seat, 'gold108', `Купить золото по ${money(p)} за кг?`, [...opts, { id: '0', label: 'Не покупать', main: true }]);
      return;
    }
    case 110:
      return jailAsk(x, seat, 5);
    case 111:
      if (army) return;
      return goTo(x, seat, 131);
    case 112:
      if (army) return;
      if (s.gold[seat] >= 1) return ask(x, seat, 'ransom', 'Пираты! Откупиться 1 кг золота — или в рабство?', yesNo('Откупиться (на 49)', 'В рабство (на 88)'));
      return goTo(x, seat, 88);
    case 113:
      return confiscateColony(x, seat, 'корабль на рифах');
    case 115:
      if (s.colLoan[seat] === 0 && s.cash[seat] >= 1000) {
        const n = round100(s.cash[seat] * 2);
        ask(x, seat, 'credit', `Беспроцентный заём ${money(n)} до конца круга?`, yesNo(`Взять ${money(n)}`, 'Не брать'), { price: n });
      }
      return;
    case 120: {
      const n = s.stuff[seat].trinkets;
      if (n > 0) {
        s.stuff[seat].trinkets = 0;
        x.ev.push({ type: 'stuff', seat, what: 'trinkets', n: -n, why: 'обмен с туземцами' });
        give(x, seat, 200 * n, `обмен с туземцами: ${n} безделушек`);
      }
      return;
    }
    case 121:
      if (army) return;
      if (s.gold[seat] >= 1) addGold(x, seat, -1, 'вас ограбили');
      else pay(x, seat, goodPrice(s, 'gold'), null, 'вас ограбили: 1 кг золота');
      return;
    case 122:
      return addGold(x, seat, 7, 'прииск «Бонанза»');
    case 123:
      return goTo(x, seat, 1);
    case 124:
    case 125:
      addGold(x, seat, cell === 124 ? 5 : 3, 'золото Клондайка');
      return movePrice(x, 'gold', 1);
    case 129:
      if (army) return;
      return confiscateColony(x, seat, 'экспроприация');
    case 131:
      pay(x, seat, 200, null, 'вывоз с необитаемого острова');
      return;
  }
}

function nextAlive(s: State, seat: number): number | null {
  const i = s.seats.indexOf(seat);
  for (let k = 1; k <= s.seats.length; k++) {
    const p = s.seats[(i + k) % s.seats.length];
    if (!s.out[p]) return p;
  }
  return null;
}

function confiscateColony(x: Ctx, seat: number, why: string) {
  const { s } = x;
  const n = Math.min(s.col[seat], s.cash[seat]);
  if (n > 0) pay(x, seat, n, null, `${why}: заработанное в колонии`);
  const kg = Math.min(s.colGold[seat], s.gold[seat]);
  if (kg > 0) addGold(x, seat, -kg, `${why}: золото колонии`);
  s.col[seat] = 0;
  s.colGold[seat] = 0;
}

function jailAsk(x: Ctx, seat: number, n: number) {
  const { s } = x;
  const loot = Math.min(s.slip[seat], s.cash[seat]);
  if (loot <= 0) return jail(x, seat, n, s.pos[seat]);
  ask(
    x,
    seat,
    'jail',
    `Конфискация награбленного (${money(loot)}) или ${n} ${n < 5 ? 'хода' : 'ходов'} тюрьмы?`,
    [
      { id: 'pay', label: `Отдать ${money(loot)}`, main: true },
      { id: 'jail', label: `Тюрьма: ${s.stuff[seat].drugs > 0 ? n * 2 : n}` },
    ],
    { price: loot, left: n }
  );
}

function drugAsk(x: Ctx, seat: number) {
  const { s } = x;
  const t = s.stuff[seat].drugs;
  const p = DRUG_SALE[s.pos[seat]];
  if (t > 0) ask(x, seat, 'drugsell', `Продать ${t} т наркотика по ${money(p)}?`, yesNo(`Продать за ${money(t * p)}`, 'Придержать'));
}

function gotoOpts(s: State, seat: number): Opt[] {
  const opts: Opt[] = [];
  for (const c of CELLS) if (c.id >= 1 && c.id !== 13) opts.push({ id: String(c.id), label: `${c.id}. ${c.name}` });
  // главное — свободные компании, на которые хватает денег
  const best = CO_CELLS.filter((c) => s.owner[c] == null && coValue(s, c) <= s.cash[seat] && c < 111).sort((a, b) => CO[b].profit / coValue(s, b) - CO[a].profit / coValue(s, a))[0];
  if (best) opts.find((o) => o.id === String(best))!.main = true;
  return opts;
}

// ---------------- банк, рынок, биржи ----------------

export function bankOpts(s: State, seat: number): Opt[] {
  const cash = s.cash[seat];
  const room = CREDIT_PER_LAP - s.borrowed[seat];
  const o: Opt[] = [];
  if (room >= 10000) o.push({ id: 'take:10000', label: 'Кредит 10 000 $' });
  if (room > 10000) o.push({ id: `take:${room}`, label: `Кредит ${money(room)}` });
  if (s.debt[seat] > 0 && cash > 0) {
    const n = Math.min(s.debt[seat], cash);
    o.push({ id: `repay:${n}`, label: n === s.debt[seat] ? `Вернуть кредит ${money(n)}` : `Вернуть ${money(n)} кредита` });
  }
  if (s.loan[seat] > 0 && cash >= s.loan[seat]) o.push({ id: 'loan', label: `Вернуть ссуду ${money(s.loan[seat])}` });
  if (cash >= 10000) o.push({ id: 'dep:10000', label: 'Во вклад 10 000 $' });
  const half = Math.floor(cash / 2 / 1000) * 1000;
  if (half > 10000) o.push({ id: `dep:${half}`, label: `Во вклад ${money(half)}` });
  if (s.dep[seat] > 0) o.push({ id: `wd:${s.dep[seat]}`, label: `Снять вклад ${money(s.dep[seat])}` });
  o.push({ id: 'done', label: 'Уйти из банка', main: true });
  return o;
}

function bankAsk(x: Ctx, seat: number) {
  const { s } = x;
  ask(x, seat, 'bank', `Банк · кредит ${money(s.debt[seat])} (${Math.round(creditRate(s, seat) * 100)} % за круг) · вклад ${money(s.dep[seat])}`, bankOpts(s, seat));
}

function marketAsk(x: Ctx, seat: number) {
  const { s } = x;
  const opts: Opt[] = [];
  for (const g of GOOD_IDS) {
    const n = sellable(s, seat, g);
    if (n > 0) opts.push({ id: g, label: `${GOODS[g].name}: ${n} ${GOODS[g].unit} за ${money(n * goodPrice(s, g))}` });
  }
  if (!opts.length) return;
  opts.push({ id: 'done', label: 'Больше не продавать' });
  opts[0].main = true;
  ask(x, seat, 'market', 'Рынок сбыта: что продать банку?', opts);
}

function specAsk(x: Ctx, seat: number) {
  const { s } = x;
  const k = SPECULATION[s.pos[seat]];
  const mine = owned(s, seat);
  if (!mine.length) return;
  const opts: Opt[] = mine.map((c) => ({ id: String(c), label: `${CO[c].name} — ${money(coValue(s, c) * k)}` }));
  opts.push({ id: 'done', label: 'Ничего не продавать', main: true });
  ask(x, seat, 'spec', `Спекуляция: продать акции банку за ${k === 3 ? 'три цены' : 'полторы цены'}?`, opts);
}

export const offerPrice = (s: State, cell: number) => Math.round(coValue(s, cell) * 1.5);

function xbuyAsk(x: Ctx, seat: number) {
  const { s } = x;
  const opts: Opt[] = [];
  for (const c of CO_CELLS) {
    const o = s.owner[c];
    if (o == null || o === seat || s.out[o]) continue;
    const p = offerPrice(s, c);
    if (s.cash[seat] >= p) opts.push({ id: String(c), label: `${CO[c].name} — предложить ${money(p)}` });
  }
  if (!opts.length) return;
  opts.push({ id: 'done', label: 'Ничего не покупать', main: true });
  ask(x, seat, 'xbuy', 'Биржа: предложить игроку продать акции за полторы цены?', opts);
}

function startAuction(x: Ctx, seat: number) {
  const { s } = x;
  const free = CO_CELLS.filter((c) => s.owner[c] == null && c < 111);
  if (!free.length) return;
  const cell = free[x.rng.int(free.length)];
  // торгуются все, начиная с попавшего
  const i = s.seats.indexOf(seat);
  const order = s.seats.map((_, k) => s.seats[(i + k) % s.seats.length]).filter((p) => !s.out[p]);
  s.auc = { cell, bid: Math.round(CO[cell].price / 2), lead: null, in: order, at: 0 };
  x.ev.push({ type: 'auction', cell, seat: null, bid: s.auc.bid });
  auctionNext(x);
}

export const aucStep = (cell: number) => Math.max(500, Math.round(CO[cell].price / 10));
export const aucNextBid = (a: Auction) => (a.lead == null ? a.bid : a.bid + aucStep(a.cell));

/** Следующий в торгах; у кого не хватает денег на ставку — пасует сам. */
function auctionNext(x: Ctx) {
  const { s } = x;
  const a = s.auc!;
  for (let guard = 0; guard < 40; guard++) {
    if (!a.in.length || (a.lead != null && a.in.length === 1 && a.in[0] === a.lead)) return auctionEnd(x);
    a.at %= a.in.length;
    const p = a.in[a.at];
    if (p === a.lead) {
      a.at++;
      continue;
    }
    const need = aucNextBid(a);
    if (s.cash[p] < need || s.out[p]) {
      a.in.splice(a.at, 1);
      continue;
    }
    s.ask = {
      seat: p,
      kind: 'auction',
      cell: a.cell,
      text: `Торги: ${CO[a.cell].name} (номинал ${money(CO[a.cell].price)})${a.lead != null ? ` — ставка ${money(a.bid)}` : ''}`,
      opts: [
        { id: 'bid', label: `Ставка ${money(need)}`, main: true },
        { id: 'pass', label: 'Пас' },
      ],
      price: need,
    };
    s.phase = 'ask';
    return;
  }
  auctionEnd(x);
}

function auctionEnd(x: Ctx) {
  const { s } = x;
  const a = s.auc!;
  s.auc = null;
  s.ask = null;
  if (a.lead == null) {
    x.ev.push({ type: 'auction', cell: a.cell, seat: null, bid: 0 });
    return;
  }
  pay(x, a.lead, a.bid, null, `торги: ${CO[a.cell].name}`);
  if (!s.out[a.lead]) {
    s.owner[a.cell] = a.lead;
    x.ev.push({ type: 'buy', seat: a.lead, cell: a.cell, price: a.bid });
  }
}

// ---------------- очередь ходов ----------------

function endTurn(x: Ctx) {
  const { s } = x;
  s.ask = null;
  s.phase = 'roll';
  if (checkEnd(x)) return;
  const cur = s.turn;
  if (!s.out[cur] && s.extra[cur] > 0 && s.skip[cur] === 0) {
    s.extra[cur]--;
    return;
  }
  let i = s.seats.indexOf(cur);
  for (let guard = 0; guard < 200; guard++) {
    i = (i + 1) % s.seats.length;
    const p = s.seats[i];
    if (s.out[p]) continue;
    if (s.skip[p] > 0) {
      s.skip[p]--;
      x.ev.push({ type: 'skip', seat: p, left: s.skip[p] });
      continue;
    }
    s.turn = p;
    return;
  }
}

function checkEnd(x: Ctx): boolean {
  const { s } = x;
  const left = alive(s);
  const done = s.seats.some((p) => !s.out[p] && s.circle[p] >= s.circles);
  if (left.length > 1 && !done) return false;
  const scores: Record<number, number> = {};
  for (const p of s.seats) scores[p] = s.out[p] ? 0 : worth(s, p);
  const best = Math.max(...left.map((p) => scores[p]));
  const winners = left.filter((p) => scores[p] === best);
  const text = left.length === 1 && !done ? 'остался единственным не разорившимся' : `самый богатый после ${s.circles} кругов: ${money(best)}`;
  s.result = { winners, text, scores };
  s.phase = 'over';
  s.ask = null;
  x.ev.push({ type: 'end', winners, text });
  return true;
}

/** После разбора: если вопроса нет — ход закончен. */
function settle(x: Ctx) {
  const { s } = x;
  if (s.result) return;
  if (s.ask && s.out[s.ask.seat] && s.ask.kind !== 'offer') s.ask = null;
  if (!s.ask) {
    if (s.auc) return auctionNext(x);
    endTurn(x);
  }
}

// ---------------- действия ----------------

export function toAct(s: State): number[] {
  if (s.result || s.phase === 'over') return [];
  if (s.phase === 'ask' && s.ask) return [s.ask.seat];
  return [s.turn];
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (!a || typeof a !== 'object' || s0.result || !toAct(s0).includes(seat)) return null;
  const s = clone(s0);
  const x: Ctx = { s, ev: [], rng };
  const ok = () => ({ state: s, events: x.ev });

  if (a.type === 'sell') {
    const c = Number(a.cell);
    if (s.owner[c] !== seat || (s.auc && s.auc.cell === c)) return null;
    if (s.ask?.kind === 'offer' && s.ask.target === c) return null;
    sellCo(x, seat, c, 1, 'банку по номиналу');
    const k = s.ask?.seat === seat ? s.ask.kind : null;
    if (k === 'spec' || k === 'bank' || k === 'market') {
      s.ask = null;
      if (k === 'spec') specAsk(x, seat);
      else if (k === 'bank') bankAsk(x, seat);
      else marketAsk(x, seat);
      settle(x);
    }
    return ok();
  }

  if (s.phase === 'roll') {
    if (a.type !== 'roll') return null;
    const d = die(x);
    s.dice = d;
    x.ev.push({ type: 'roll', seat, d });
    walk(x, seat, d);
    settle(x);
    return ok();
  }

  if (s.phase !== 'ask' || !s.ask || a.type !== 'choose') return null;
  const q = s.ask;
  const opt = q.opts.find((o) => o.id === String(a.id));
  if (!opt) return null;
  s.ask = null;
  if (q.kind !== 'fork' && q.kind !== 'auction' && q.kind !== 'goto') x.ev.push({ type: 'choice', seat, kind: q.kind, label: opt.label });
  const id = opt.id;
  const yes = id === 'yes';

  switch (q.kind) {
    case 'fork': {
      const to = Number(id);
      if (q.cell === 57 && to === 114) {
        pay(x, seat, 500, s.owner[114], 'турбюро: путёвка в колонию');
        if (s.out[seat]) break;
        s.pos[seat] = 114;
        x.ev.push({ type: 'move', seat, path: [114], jump: true });
      } else step(x, seat, to);
      if (!s.out[seat]) walk(x, seat, q.left! - 1);
      break;
    }
    case 'buy':
      if (yes) {
        const c = q.cell;
        const price = coValue(s, c);
        if (s.cash[seat] < price || s.owner[c] != null) return null;
        s.cash[seat] -= price;
        s.owner[c] = seat;
        x.ev.push({ type: 'buy', seat, cell: c, price });
      }
      break;
    case 'drugs': {
      const t = Number(id);
      if (t > 0) {
        pay(x, seat, 100 * t, null, 'наркотик');
        s.stuff[seat].drugs += t;
        x.ev.push({ type: 'stuff', seat, what: 'drugs', n: t, why: 'покупка' });
      }
      break;
    }
    case 'bribe':
      if (yes) {
        pay(x, seat, 1000, null, 'подкуп полиции');
        s.flags[seat].push('bribe');
      }
      break;
    case 'star':
      if (yes) {
        pay(x, seat, 5000, null, 'ставка на звезду');
        s.flags[seat].push('star');
      }
      break;
    case 'casino': {
      const bet = Number(id);
      if (bet > 0) {
        const d = die(x);
        const win = d === 6;
        x.ev.push({ type: 'casino', seat, d, bet, win });
        if (win) give(x, seat, bet * 9, 'казино: шестёрка!');
        else pay(x, seat, bet, null, 'казино: ставка');
      }
      break;
    }
    case 'army':
      if (yes) {
        pay(x, seat, 3000, null, '«Марионеточная армия»');
        s.flags[seat].push('army');
      }
      break;
    case 'trinkets': {
      const n = Number(id);
      if (n > 0) {
        pay(x, seat, 10 * n, null, 'безделушки');
        s.stuff[seat].trinkets += n;
        x.ev.push({ type: 'stuff', seat, what: 'trinkets', n, why: 'покупка' });
      }
      break;
    }
    case 'gold25':
      if (yes) addGold(x, seat, -1, 'подкуп рабочей аристократии');
      else setLabour(x, seat, -1);
      break;
    case 'terror':
      if (yes) addGold(x, seat, -3, 'откуп от теракта');
      else for (const c of LEAD) if (s.owner[c] === seat) moveStock(x, c, -1);
      break;
    case 'brains':
      if (yes) {
        addGold(x, seat, -1, 'вклад золотом');
        s.brains[seat].push(s.circle[seat] + 3);
      }
      break;
    case 'back52':
      if (yes) {
        addGold(x, seat, -3, 'ход назад');
        const d = die(x);
        x.ev.push({ type: 'roll', seat, d, back: true });
        const path: number[] = [];
        for (let k = 1; k <= d; k++) path.push(52 - k);
        s.pos[seat] = 52 - d;
        x.ev.push({ type: 'move', seat, path });
        land(x, seat);
      }
      break;
    case 'gold108': {
      const kg = Number(id);
      if (kg > 0) {
        pay(x, seat, kg * goodPrice(s, 'gold'), null, 'покупка золота');
        if (!s.out[seat]) addGold(x, seat, kg, 'покупка');
      }
      break;
    }
    case 'jail':
      if (id === 'pay') {
        pay(x, seat, q.price!, null, 'конфискация награбленного');
        s.slip[seat] = 0;
      } else jail(x, seat, q.left!, q.cell);
      break;
    case 'ransom':
      if (yes) {
        addGold(x, seat, -1, 'выкуп у пиратов');
        goTo(x, seat, 49);
      } else goTo(x, seat, 88);
      break;
    case 'credit':
      if (yes) {
        s.colLoan[seat] = q.price!;
        s.cash[seat] += q.price!;
        x.ev.push({ type: 'pay', from: null, to: seat, amount: q.price!, why: 'колониальный заём' });
      }
      break;
    case 'hit':
      if (id !== 'no') {
        const p = Number(id);
        pay(x, seat, 5000, null, '«крёстному отцу»: заказ');
        if (!s.out[p] && !s.out[seat]) {
          s.pos[p] = 83;
          x.ev.push({ type: 'move', seat: p, path: [83], jump: true });
          if (s.owner[54] !== p) pay(x, p, s.cash[p] * 0.1, s.owner[54], '«Протез-офис»: 10 % за услуги');
        }
      }
      break;
    case 'media':
      if (id !== 'no') movePrice(x, id as Good, -1);
      break;
    case 'goto':
      goTo(x, seat, Number(id));
      break;
    case 'drugsell':
      if (yes) {
        const t = s.stuff[seat].drugs;
        s.stuff[seat].drugs = 0;
        x.ev.push({ type: 'stuff', seat, what: 'drugs', n: -t, why: 'продажа' });
        give(x, seat, t * DRUG_SALE[q.cell], `наркотики: ${t} т`);
      }
      break;
    case 'bank': {
      if (id === 'done') break;
      const [op, v] = id.split(':');
      const n = Number(v);
      if (op === 'take') {
        s.debt[seat] += n;
        s.borrowed[seat] += n;
        s.cash[seat] += n;
      } else if (op === 'repay') {
        s.debt[seat] -= n;
        s.cash[seat] -= n;
      } else if (op === 'loan') {
        s.cash[seat] -= s.loan[seat];
        s.loan[seat] = 0;
      } else if (op === 'dep') {
        s.dep[seat] += n;
        s.cash[seat] -= n;
      } else if (op === 'wd') {
        s.dep[seat] -= n;
        s.cash[seat] += n;
      }
      bankAsk(x, seat);
      break;
    }
    case 'market':
      if (id !== 'done') {
        sellGood(x, seat, id as Good, sellable(s, seat, id as Good), 'рынок сбыта');
        marketAsk(x, seat);
      }
      break;
    case 'spec':
      if (id !== 'done') {
        sellCo(x, seat, Number(id), SPECULATION[q.cell], 'спекуляция');
        specAsk(x, seat);
      }
      break;
    case 'xbuy':
      if (id !== 'done') {
        const c = Number(id);
        const o = s.owner[c]!;
        const p = offerPrice(s, c);
        s.ask = { seat: o, kind: 'offer', cell: q.cell, text: `Продать ${CO[c].name} за ${money(p)}?`, opts: yesNo(`Продать за ${money(p)}`, 'Не продавать'), buyer: seat, price: p, target: c };
        s.phase = 'ask';
      }
      break;
    case 'offer': {
      const c = q.target!;
      const b = q.buyer!;
      if (yes && s.owner[c] === seat && s.cash[b] >= q.price!) {
        s.cash[b] -= q.price!;
        s.cash[seat] += q.price!;
        s.owner[c] = b;
        x.ev.push({ type: 'buy', seat: b, cell: c, price: q.price!, from: seat });
      }
      break;
    }
    case 'auction': {
      const au = s.auc!;
      if (id === 'bid') {
        au.bid = q.price!;
        au.lead = seat;
        x.ev.push({ type: 'auction', cell: au.cell, seat, bid: au.bid });
        au.at++;
      } else {
        au.in = au.in.filter((p) => p !== seat);
      }
      auctionNext(x);
      break;
    }
  }
  settle(x);
  return ok();
}

/** Видят все всё: скрытого в «Вестерне» нет. */
export function view(s: State): State {
  return s;
}
