/* «Акционеры» — движок без DOM. Один кубик. «Малый бизнес» (1–36): патенты приносят первые деньги, банки дают под них кредит,
 * рэкет, пожар, казино, теневая экономика, школа бизнеса и страховка. Пройдя «наследство», фишка останавливается на «Начале»;
 * следующим ходом — без кубика в «Аэропорт» (или ещё круг: до первой покупки фирмы — не больше трёх кругов подряд, после — двух).
 * Из аэропорта — «большой бизнес» (38–73): фирмы, предприятия (до трёх, строятся перед своим ходом), прибыль с попавших только при
 * предприятиях, суд, ограбление, забастовка; круг кончается в «Клубе бизнесменов» — оттуда снова большой бизнес или назад в малый.
 * Биржа (вариант) меняет курс компании в 2–5 раз. Все решения — общий «вопрос» (ask): { type: 'choose', id }.
 * Перед ходом — постройка предприятий, залог и выкуп ({ type: 'build' | 'mortgage' | 'redeem', cell }).
 * Конец — после заданного числа кругов стола или когда остался один; побеждает наибольший капитал, вложенный в собственность.
 *
 * Решения, принятые без правил (в инструкции нет или неясно — записаны в docs/STATE.md):
 * — «Первый ход на «дачу»» — направление: с «Начала» бросают кубик и идут по нижнему ряду, первая клетка — «Дача».
 * — «Наследство» получает только остановившийся на клетке; прошедший мимо встаёт на «Начало».
 * — «Не более трёх (двух) раз» — кругов малого бизнеса подряд всего, включая первый.
 * — Кредит: по умолчанию 20 % через 15 своих ходов (в правилах — «договариваются», пример 20 % через 10–15); не вернул — залог фирм,
 *   не хватило — банкрот. «После 8-го (10-го) — за оставшуюся половину» — за патенты сверх 8 (10) банк даёт половину ставки.
 * — Стартовых денег в правилах нет (всё зарабатывают в малом бизнесе) — по умолчанию 0, настройкой 300 000 или 1 000 000.
 * — Казино проигрывает не больше наличных. Клад: ключ по умолчанию — шестёрка.
 * — Аукцион — только если попавшему на фирму не хватило денег (как в правилах); старт +10 % к цене, шаг 10 % цены.
 * — Залог — вся фирма с предприятиями за половину текущей стоимости, выкуп — за полную; заложенная прибыли не приносит и в капитал
 *   не идёт. Не хватает на обязательный платёж — фирмы закладываются сами, начиная с дешёвых.
 * — Курс компании держится в пределах от 1/25 до 25 номинала.
 * — «Состояние» в карточках биржевой игры — наличные. «Отчаянный игрок» при понижении теряет все наличные (из игры не выбывает).
 * — «Клуб джентльменов» — без последствий (следить за речью за столом). «Член клуба бизнесменов» — кто хоть раз дошёл до клуба.
 * — Суд: конфискуются наличные, патенты, фирмы и кредиты; пропуск 3 хода (настройка). Второй суд с теневой карточкой — выбывает.
 * — Карточки «Турист», «Шоу», «дом и дорога», «шуба», «Клаксон» платят владельцам соответствующих фирм за каждую фирму; своим — не платят.
 * — Акционирование (совместная покупка фирмы) не сделано. */
import type { Rng } from '../../core/types';
import {
  AIR,
  BIG0,
  CELLS,
  CLUB,
  CO_NEDRA,
  CO_SHOW,
  CO_TURIST,
  COS,
  DECKS,
  DECK_NAME,
  EXCHANGE,
  FIRM_CELLS,
  PATENTS,
  PT_IDS,
  PT_NAME,
  SMALL0,
  SMALL_END,
  START,
  STRIKE_CELL,
  coFirms,
  firmByName,
  inBig,
  inSmall,
  type Card,
  type Deck,
  type Pt,
} from './data';

export const MAXP = 6;

export interface Pat {
  t: Pt;
  v: number;
}

export interface Loan {
  /** Сколько вернуть (с процентами). */
  sum: number;
  /** Через сколько своих ходов. */
  left: number;
}

export interface Bet {
  seat: number;
  /** ×3 («Хотите играть на бирже?») или ×10 («Отчаянный игрок»). */
  k: 3 | 10;
  card: Held;
}

export interface Held {
  deck: Deck;
  i: number;
}

export type AskKind = 'route' | 'buy' | 'credit' | 'shadow' | 'school' | 'insure' | 'charityOr' | 'playExchange' | 'mecenat' | 'auction';

export interface Opt {
  id: string;
  label: string;
  main?: boolean;
}

export interface Ask {
  seat: number;
  kind: AskKind;
  cell: number;
  text: string;
  opts: Opt[];
  price?: number;
  /** Карточка, из-за которой вопрос. */
  card?: Held;
}

export interface Auction {
  cell: number;
  charity: boolean;
  bid: number;
  step: number;
  lead: number | null;
  in: number[];
  at: number;
}

export interface State {
  seats: number[];
  /** Сколько кругов стола играть. */
  rounds: number;
  round: number;
  /** Вариант с биржей. */
  exchange: boolean;
  /** Аукционы фирм, на которые не хватило денег. */
  auctions: boolean;
  /** Число-ключ клада. */
  key: number;
  /** Пропуск ходов после суда. */
  courtSkip: number;
  /** Кредит: процент и срок в своих ходах. */
  pct: number;
  term: number;
  /** Пока у игрока нет фирм, долг не разоряет: отдаёт сколько есть. */
  mercy?: boolean;
  pos: number[];
  cash: number[];
  pats: Pat[][];
  /** Патенты, отнятые рэкетом, — вернёт милиция. */
  racket: Pat[][];
  /** Патенты в банке. */
  pile: Record<Pt, number[]>;
  loans: Loan[][];
  owner: Record<number, number | null>;
  ent: Record<number, number>;
  mort: Record<number, boolean>;
  /** Курс компаний: [числитель, знаменатель]. */
  rate: [number, number][];
  polis: boolean[];
  diploma: boolean[];
  shadow: number[];
  inspector: boolean[];
  courts: number[];
  singer: boolean[];
  gardener: boolean[];
  beauty: boolean[];
  /** Угроза банкротства: сколько своих ходов ещё действует. */
  threat: number[];
  /** Всего внесено на благотворительность и ещё не использованная налоговая льгота. */
  donated: number[];
  relief: number[];
  club: boolean[];
  /** Кругов малого бизнеса подряд в этот заход и всего. */
  laps: number[];
  smallDone: number[];
  /** На «Начале» перед новым заходом в малый бизнес (бросает кубик сразу). */
  fresh: boolean[];
  skip: number[];
  out: boolean[];
  bets: Bet[];
  /** Забастовка в аэропорту: до какой карточки. */
  airStrike: Deck | null;
  /** Карточки, которые сейчас у игроков, на бирже или в аэропорту. */
  held: Held[];
  /** Колоды: какие карточки ещё не вытянуты. */
  deck: Record<Deck, number[]>;
  anyBought: boolean;
  turn: number;
  /** 'move' — бросок сделан, фишку на выпавшую клетку переставляет сам игрок. */
  phase: 'roll' | 'move' | 'ask' | 'over';
  ask: Ask | null;
  auc: Auction | null;
  dice: number | null;
  /** Последняя вытянутая карточка — для показа. */
  card: Held | null;
  result: { winners: number[]; text: string; scores: Record<number, number> } | null;
}

export type Action =
  | { type: 'roll' }
  | { type: 'move' }
  | { type: 'choose'; id: string }
  | { type: 'build'; cell: number }
  | { type: 'mortgage'; cell: number }
  | { type: 'redeem'; cell: number };

export type Who = number | null;

export type Event =
  | { type: 'roll'; seat: number; d: number; why?: 'strike' | 'casino' | 'treasure' }
  | { type: 'move'; seat: number; path: number[]; back?: boolean; jump?: boolean }
  | { type: 'cell'; seat: number; cell: number }
  | { type: 'patent'; seat: number; t: Pt; v: number; paid: number }
  | { type: 'card'; seat: number; deck: Deck; i: number }
  | { type: 'pay'; from: Who; to: Who; amount: number; why: string }
  | { type: 'pats'; seat: number; n: number; why: string; back?: boolean }
  | { type: 'credit'; seat: number; n: number; sum: number; due: number }
  | { type: 'buy'; seat: number; cell: number; price: number }
  | { type: 'build'; seat: number; cell: number; n: number; cost: number }
  | { type: 'mortgage'; seat: number; cell: number; sum: number; back?: boolean }
  | { type: 'lose'; seat: number; cell: number; why: string }
  | { type: 'spin'; seat: number; co: number; k: number }
  | { type: 'skip'; seat: number; left: number; air?: boolean }
  | { type: 'note'; seat: number | null; text: string }
  | { type: 'choice'; seat: number; label: string }
  | { type: 'auction'; cell: number; seat: number | null; bid: number }
  | { type: 'bankrupt'; seat: number }
  | { type: 'end'; winners: number[]; text: string };

export const fmt = (n: number) => (n < 0 ? '−' : '') + String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const money = (n: number) => fmt(n) + ' р.';

const r1000 = (n: number) => Math.max(1000, Math.round(n / 1000) * 1000);
const r10k = (n: number) => Math.max(10000, Math.round(n / 10000) * 10000);
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

export const rateOf = (s: State, co: number) => s.rate[co][0] / s.rate[co][1];
export const firmOf = (cell: number) => CELLS[cell].firm!;
export const priceOf = (s: State, cell: number) => r1000(firmOf(cell).price * rateOf(s, firmOf(cell).co));
export const entCost = (s: State, cell: number) => r1000(firmOf(cell).ent * rateOf(s, firmOf(cell).co));
/** Прибыль с попавшего: по числу предприятий, по курсу; диплом менеджера — вдвое. */
export function profitOf(s: State, cell: number): number {
  const n = s.ent[cell];
  const o = s.owner[cell];
  if (!n || o == null) return 0;
  return r1000(firmOf(cell).profit[n - 1] * rateOf(s, firmOf(cell).co) * (s.diploma[o] ? 2 : 1));
}
/** Стоимость собственности: фирма и предприятия по курсу. */
export const valueOf = (s: State, cell: number) => priceOf(s, cell) + s.ent[cell] * entCost(s, cell);
export const owned = (s: State, seat: number) => FIRM_CELLS.filter((c) => s.owner[c] === seat);
export const alive = (s: State) => s.seats.filter((p) => !s.out[p]);
/** Капитал, вложенный в собственность (заложенное не считается). */
export const capital = (s: State, seat: number) => owned(s, seat).reduce((a, c) => a + (s.mort[c] ? 0 : valueOf(s, c)), 0);
export const exchangeOpen = (s: State) => s.exchange && s.anyBought;
export const lapLimit = (s: State) => (s.anyBought ? 2 : 3);
/** Сколько даст банк за патенты (сверх порога; сверх второго порога — половина ставки). */
export function creditFor(bank: number, n: number): { k: number; sum: number } {
  const [from, rate] = bank === 1 ? [3, 300000] : [5, 500000];
  const k = Math.max(0, n - from);
  const full = Math.min(k, 5);
  return { k, sum: full * rate + (k - full) * (rate / 2) };
}
export const cardOf = (h: Held): Card => DECKS[h.deck][h.i];
export const patMul = (s: State, seat: number, t: Pt) => (t === 'muzyka' && s.singer[seat] ? 10 : t === 'dacha' && s.gardener[seat] ? 3 : 1);

export function newState(
  seats: number[],
  o: { rounds?: number; exchange?: boolean; auctions?: boolean; key?: number; courtSkip?: number; pct?: number; term?: number; start?: number; mercy?: boolean } = {}
): State {
  const all = <T>(f: (i: number) => T) => Array.from({ length: MAXP }, (_, i) => f(i));
  const inGame = (i: number) => seats.includes(i);
  const owner: Record<number, number | null> = {};
  const ent: Record<number, number> = {};
  const mort: Record<number, boolean> = {};
  for (const c of FIRM_CELLS) {
    owner[c] = null;
    ent[c] = 0;
    mort[c] = false;
  }
  const pile = {} as Record<Pt, number[]>;
  for (const t of PT_IDS) pile[t] = PATENTS[t].slice();
  const exchange = o.exchange ?? true;
  const s: State = {
    seats,
    rounds: o.rounds ?? 50,
    round: 1,
    exchange,
    auctions: o.auctions ?? true,
    key: o.key ?? 6,
    courtSkip: o.courtSkip ?? 3,
    pct: o.pct ?? 20,
    term: o.term ?? 15,
    mercy: o.mercy ?? false,
    pos: all(() => START),
    cash: all((i) => (inGame(i) ? (o.start ?? 0) : 0)),
    pats: all(() => []),
    racket: all(() => []),
    pile,
    loans: all(() => []),
    owner,
    ent,
    mort,
    rate: COS.map(() => [1, 1] as [number, number]),
    polis: all(() => false),
    diploma: all(() => false),
    shadow: all(() => 0),
    inspector: all(() => false),
    courts: all(() => 0),
    singer: all(() => false),
    gardener: all(() => false),
    beauty: all(() => false),
    threat: all(() => 0),
    donated: all(() => 0),
    relief: all(() => 0),
    club: all(() => false),
    laps: all(() => 0),
    smallDone: all(() => 0),
    fresh: all(() => true),
    skip: all(() => 0),
    out: all((i) => !inGame(i)),
    bets: [],
    airStrike: null,
    held: [],
    deck: { izv: [], telex: [] },
    anyBought: false,
    turn: seats[0],
    phase: 'roll',
    ask: null,
    auc: null,
    dice: null,
    card: null,
    result: null,
  };
  s.deck.izv = fullDeck(s, 'izv');
  s.deck.telex = fullDeck(s, 'telex');
  return s;
}

function fullDeck(s: State, d: Deck): number[] {
  return DECKS[d].map((_, i) => i).filter((i) => (s.exchange || !DECKS[d][i].exch) && !s.held.some((h) => h.deck === d && h.i === i));
}

export function clone(s: State): State {
  const pile = {} as Record<Pt, number[]>;
  for (const t of PT_IDS) pile[t] = s.pile[t].slice();
  return {
    ...s,
    seats: s.seats.slice(),
    pos: s.pos.slice(),
    cash: s.cash.slice(),
    pats: s.pats.map((x) => x.map((p) => ({ ...p }))),
    racket: s.racket.map((x) => x.map((p) => ({ ...p }))),
    pile,
    loans: s.loans.map((x) => x.map((l) => ({ ...l }))),
    owner: { ...s.owner },
    ent: { ...s.ent },
    mort: { ...s.mort },
    rate: s.rate.map((r) => [r[0], r[1]] as [number, number]),
    polis: s.polis.slice(),
    diploma: s.diploma.slice(),
    shadow: s.shadow.slice(),
    inspector: s.inspector.slice(),
    courts: s.courts.slice(),
    singer: s.singer.slice(),
    gardener: s.gardener.slice(),
    beauty: s.beauty.slice(),
    threat: s.threat.slice(),
    donated: s.donated.slice(),
    relief: s.relief.slice(),
    club: s.club.slice(),
    laps: s.laps.slice(),
    smallDone: s.smallDone.slice(),
    fresh: s.fresh.slice(),
    skip: s.skip.slice(),
    out: s.out.slice(),
    bets: s.bets.map((b) => ({ ...b, card: { ...b.card } })),
    held: s.held.map((h) => ({ ...h })),
    deck: { izv: s.deck.izv.slice(), telex: s.deck.telex.slice() },
    ask: s.ask ? { ...s.ask, opts: s.ask.opts.map((o) => ({ ...o })), card: s.ask.card ? { ...s.ask.card } : undefined } : null,
    auc: s.auc ? { ...s.auc, in: s.auc.in.slice() } : null,
    card: s.card ? { ...s.card } : null,
    result: s.result ? { ...s.result, winners: s.result.winners.slice(), scores: { ...s.result.scores } } : null,
  };
}

type Ctx = { s: State; ev: Event[]; rng: Rng };

const die = (x: Ctx) => x.rng.int(6) + 1;
const note = (x: Ctx, seat: number | null, text: string) => x.ev.push({ type: 'note', seat, text });

// ---------------- деньги ----------------

function give(x: Ctx, seat: number, amount: number, why: string) {
  const { s } = x;
  amount = Math.round(amount);
  if (amount <= 0 || s.out[seat]) return;
  s.cash[seat] += amount;
  x.ev.push({ type: 'pay', from: null, to: seat, amount, why });
}

function mortgage(x: Ctx, seat: number, cell: number) {
  const { s } = x;
  const sum = Math.round(valueOf(s, cell) / 2);
  s.mort[cell] = true;
  s.cash[seat] += sum;
  x.ev.push({ type: 'mortgage', seat, cell, sum });
}

/** Добыть наличные под обязательный платёж: заложить фирмы, начиная с дешёвых. */
function raise(x: Ctx, seat: number, need: number) {
  const { s } = x;
  const list = owned(s, seat)
    .filter((c) => !s.mort[c])
    .sort((a, b) => valueOf(s, a) - valueOf(s, b));
  for (const c of list) {
    if (s.cash[seat] >= need) return;
    mortgage(x, seat, c);
  }
}

/** Заплатить (to = null — банку). Не хватает и после залога — банкротство. Возвращает, сколько заплачено. */
function pay(x: Ctx, seat: number, amount: number, to: Who, why: string): number {
  const { s } = x;
  amount = Math.round(amount);
  if (amount <= 0 || s.out[seat] || to === seat) return 0;
  if (to != null && s.out[to]) to = null;
  raise(x, seat, amount);
  const paid = Math.min(amount, Math.max(0, s.cash[seat]));
  s.cash[seat] -= paid;
  if (to != null) s.cash[to] += paid;
  if (paid > 0) x.ev.push({ type: 'pay', from: seat, to, amount: paid, why });
  if (paid < amount) {
    if (s.mercy && !owned(s, seat).length) note(x, seat, 'фирм нет — остаток долга списан');
    else bankrupt(x, seat, to);
  }
  return paid;
}

/** Отдать сколько есть, не разоряясь (казино, ограбление, понижение «состояния»). */
function lose(x: Ctx, seat: number, amount: number, why: string) {
  const { s } = x;
  const paid = Math.min(Math.round(amount), s.cash[seat]);
  if (paid <= 0) return;
  s.cash[seat] -= paid;
  x.ev.push({ type: 'pay', from: seat, to: null, amount: paid, why });
}

function unhold(s: State, pred: (h: Held) => boolean) {
  s.held = s.held.filter((h) => !pred(h));
}
const heldIs = (deck: Deck, fx: string) => (h: Held) => h.deck === deck && DECKS[deck][h.i].fx === fx;

/** Патенты — в банк. */
function returnPats(s: State, list: Pat[]) {
  for (const p of list) s.pile[p.t].push(p.v);
}

function bankrupt(x: Ctx, seat: number, to: Who) {
  const { s } = x;
  if (s.out[seat]) return;
  s.out[seat] = true;
  const heir = to != null && !s.out[to] ? to : null;
  for (const c of owned(s, seat)) {
    if (heir != null) s.owner[c] = heir;
    else {
      s.owner[c] = null;
      s.ent[c] = 0;
      s.mort[c] = false;
    }
  }
  if (heir != null) s.cash[heir] += Math.max(0, s.cash[seat]);
  s.cash[seat] = 0;
  returnPats(s, s.pats[seat]);
  returnPats(s, s.racket[seat]);
  s.pats[seat] = [];
  s.racket[seat] = [];
  s.loans[seat] = [];
  dropCards(s, seat);
  x.ev.push({ type: 'bankrupt', seat });
  if (s.ask?.seat === seat) s.ask = null;
  if (s.auc) s.auc.in = s.auc.in.filter((p) => p !== seat);
}

/** Карточки игрока возвращаются в колоду. */
function dropCards(s: State, seat: number) {
  if (s.singer[seat] && !s.seats.some((p) => p !== seat && s.singer[p])) unhold(s, heldIs('izv', 'singer'));
  if (s.gardener[seat] && !s.seats.some((p) => p !== seat && s.gardener[p])) unhold(s, heldIs('izv', 'gardener'));
  if (s.beauty[seat] && !s.seats.some((p) => p !== seat && s.beauty[p])) unhold(s, heldIs('telex', 'beauty'));
  if (s.threat[seat] && !s.seats.some((p) => p !== seat && s.threat[p])) unhold(s, heldIs('telex', 'threat'));
  s.singer[seat] = s.gardener[seat] = s.beauty[seat] = false;
  s.threat[seat] = 0;
  for (const b of s.bets.filter((b) => b.seat === seat)) unhold(s, (h) => h.deck === b.card.deck && h.i === b.card.i);
  s.bets = s.bets.filter((b) => b.seat !== seat);
}

/** Угроза банкротства сработала? */
function threatHit(x: Ctx, seat: number, why: string) {
  const { s } = x;
  if (s.threat[seat] > 0 && !s.out[seat]) {
    note(x, seat, `угроза банкротства сбылась: ${why}`);
    bankrupt(x, seat, null);
  }
}

function loseEnterprises(x: Ctx, seat: number, why: string) {
  const { s } = x;
  for (const c of owned(s, seat)) {
    if (s.ent[c] > 0) {
      s.ent[c] = 0;
      x.ev.push({ type: 'lose', seat, cell: c, why });
    }
  }
}

// ---------------- биржа ----------------

/** Два вращения указателя: компания и изменение курса. */
function spin(x: Ctx, seat: number) {
  const { s } = x;
  const co = x.rng.int(8);
  const k = x.rng.int(8);
  const m = EXCHANGE[k];
  const r = s.rate[co];
  let [n, d] = m > 0 ? [r[0] * m, r[1]] : [r[0], r[1] * -m];
  if (n / d > 25) [n, d] = [25, 1];
  if (n / d < 1 / 25) [n, d] = [1, 25];
  const g = gcd(n, d);
  s.rate[co] = [n / g, d / g];
  x.ev.push({ type: 'spin', seat, co, k });
  const up = m > 0;
  // ставки на бирже срабатывают при любом изменении курса
  for (const b of s.bets.slice()) {
    if (s.out[b.seat]) continue;
    const c = s.cash[b.seat];
    if (up) give(x, b.seat, c * (b.k - 1), b.k === 3 ? 'биржа: состояние утроилось' : 'биржа: состояние вдесятеро');
    else if (b.k === 3) lose(x, b.seat, c - Math.floor(c / 3), 'биржа: состояние втрое меньше');
    else lose(x, b.seat, c, 'биржа: отчаянный игрок разорён');
    unhold(s, (h) => h.deck === b.card.deck && h.i === b.card.i);
  }
  s.bets = [];
  if (!up) {
    for (const p of alive(s)) {
      if (coFirms(co).some((c) => s.owner[c] === p)) threatHit(x, p, `курс ${COS[co].short} упал`);
    }
  }
}

// ---------------- ход ----------------

/** Клетки хода на d вперёд и пройден ли круг малого бизнеса. */
function walkPath(s: State, seat: number, d: number): { path: number[]; lap: boolean } {
  let p = s.pos[seat];
  const path: number[] = [];
  let lap = false;
  for (let i = 0; i < d; i++) {
    if (p === START) p = SMALL0;
    else if (p === AIR) p = BIG0;
    else if (p === SMALL_END) {
      p = START;
      lap = true;
    } else if (p === CLUB) break;
    else p++;
    path.push(p);
    if (lap || p === CLUB) break;
  }
  return { path, lap };
}

/** Фаза 'move': куда встанет фишка того, кто ходит (для подсветки клетки). */
export function walkTarget(s: State): number | null {
  if (s.phase !== 'move' || !s.dice) return null;
  const { path } = walkPath(s, s.turn, s.dice);
  return path.length ? path[path.length - 1] : null;
}

/** Шаги вперёд: малый бизнес кончается на «Начале», большой — в «Клубе» (остаток очков сгорает). */
function walk(x: Ctx, seat: number, d: number) {
  const { s } = x;
  const { path, lap } = walkPath(s, seat, d);
  if (!path.length) return;
  const p = path[path.length - 1];
  s.pos[seat] = p;
  s.fresh[seat] = false;
  x.ev.push({ type: 'move', seat, path });
  if (lap) {
    s.laps[seat]++;
    s.smallDone[seat]++;
    note(x, seat, `круг малого бизнеса пройден (${s.laps[seat]}-й подряд)`);
    return;
  }
  land(x, seat);
}

function back(x: Ctx, seat: number, d: number) {
  const { s } = x;
  const p = s.pos[seat];
  const first = inSmall(p) ? SMALL0 : inBig(p) ? BIG0 : p;
  const path: number[] = [];
  for (let q = p - 1; q >= Math.max(first, p - d); q--) path.push(q);
  if (!path.length) return;
  s.pos[seat] = path[path.length - 1];
  x.ev.push({ type: 'move', seat, path, back: true });
  land(x, seat);
}

function jump(x: Ctx, seat: number, to: number) {
  x.s.pos[seat] = to;
  x.ev.push({ type: 'move', seat, path: [to], jump: true });
}

function ask(x: Ctx, seat: number, kind: AskKind, text: string, opts: Opt[], extra: Partial<Ask> = {}) {
  x.s.ask = { seat, kind, cell: x.s.pos[seat], text, opts, ...extra };
  x.s.phase = 'ask';
}

function givePatent(x: Ctx, seat: number, t: Pt) {
  const { s } = x;
  const pile = s.pile[t];
  if (!pile.length) {
    note(x, seat, `патенты «${PT_NAME[t]}» в банке кончились`);
    return;
  }
  const v = pile.splice(x.rng.int(pile.length), 1)[0];
  s.pats[seat].push({ t, v });
  const paid = v * patMul(s, seat, t);
  s.cash[seat] += paid;
  x.ev.push({ type: 'patent', seat, t, v, paid });
}

function payTax(x: Ctx, seat: number, tax: number) {
  const { s } = x;
  const small = inSmall(s.pos[seat]);
  if (small && s.smallDone[seat] === 0) {
    note(x, seat, 'первый круг — налог не берётся');
    return;
  }
  const r = s.relief[seat];
  if (r > tax) {
    s.relief[seat] = 0;
    note(x, seat, 'благотворителю налог прощён');
    return;
  }
  if (r > tax / 2) {
    s.relief[seat] = 0;
    note(x, seat, 'благотворителю — половина налога');
    tax = Math.round(tax / 2);
  }
  pay(x, seat, tax, null, 'налог');
}

function land(x: Ctx, seat: number) {
  const { s } = x;
  const c = CELLS[s.pos[seat]];
  x.ev.push({ type: 'cell', seat, cell: c.id });
  switch (c.kind) {
    case 'patent':
      return givePatent(x, seat, c.pt!);
    case 'izv':
      return draw(x, seat, 'izv');
    case 'telex':
      return draw(x, seat, 'telex');
    case 'tax':
      return payTax(x, seat, c.n!);
    case 'treasure': {
      let hits = 0;
      for (let i = 0; i < 3; i++) {
        const d = die(x);
        x.ev.push({ type: 'roll', seat, d, why: 'treasure' });
        if (d === s.key) hits++;
      }
      if (hits) give(x, seat, c.n! * hits, `клад${hits > 1 ? ` ×${hits}` : ''}`);
      else note(x, seat, 'ключ не подошёл — клада нет');
      return;
    }
    case 'rest':
      s.skip[seat] += c.n!;
      note(x, seat, `отдыхает ${c.n} хода`);
      return;
    case 'racket': {
      const n = s.pats[seat].length;
      if (!n) return note(x, seat, 'патентов нет — рэкету нечего взять');
      s.racket[seat].push(...s.pats[seat]);
      s.pats[seat] = [];
      x.ev.push({ type: 'pats', seat, n, why: 'рэкет' });
      return;
    }
    case 'police': {
      const n = s.racket[seat].length;
      if (!n) return;
      s.pats[seat].push(...s.racket[seat]);
      s.racket[seat] = [];
      x.ev.push({ type: 'pats', seat, n, why: 'милиция вернула', back: true });
      return;
    }
    case 'fire': {
      if (s.polis[seat]) return note(x, seat, 'застрахован — пожар не страшен');
      const n = s.pats[seat].length;
      returnPats(s, s.pats[seat]);
      s.pats[seat] = [];
      if (n) x.ev.push({ type: 'pats', seat, n, why: 'пожар' });
      loseEnterprises(x, seat, 'пожар');
      return;
    }
    case 'exchange':
      if (exchangeOpen(s)) return spin(x, seat);
      if (s.exchange) note(x, seat, 'биржа заработает после первой покупки фирмы');
      return;
    case 'bank': {
      const { k, sum } = creditFor(c.n!, s.pats[seat].length);
      if (!k) return note(x, seat, `для кредита нужно больше ${c.n === 1 ? 3 : 5} патентов`);
      const due = Math.round((sum * (100 + s.pct)) / 100);
      ask(x, seat, 'credit', `Банк даёт кредит ${money(sum)} за ${k} ${plural(k, 'патент', 'патента', 'патентов')}; вернуть ${money(due)} через ${s.term} ходов.`, [
        { id: 'take', label: `Взять ${money(sum)}`, main: true },
        { id: 'no', label: 'Не брать' },
      ]);
      return;
    }
    case 'casino': {
      const d = die(x);
      x.ev.push({ type: 'roll', seat, d, why: 'casino' });
      if (d % 2 === 0) give(x, seat, c.n!, 'казино: выигрыш');
      else lose(x, seat, c.n!, 'казино: проигрыш');
      return;
    }
    case 'shadow':
      ask(x, seat, 'shadow', `Теневая экономика предлагает ${money(c.n!)}. Взять — и стать теневиком?`, [
        { id: 'take', label: `Взять ${money(c.n!)}` },
        { id: 'no', label: 'Отказаться', main: true },
      ]);
      return;
    case 'subsidy':
    case 'inherit':
      return give(x, seat, c.n!, c.kind === 'subsidy' ? 'субсидия' : 'наследство');
    case 'school':
      if (s.diploma[seat]) return note(x, seat, 'диплом менеджера уже есть');
      if (s.cash[seat] < c.n!) return note(x, seat, 'на обучение не хватает денег');
      ask(x, seat, 'school', `Школа бизнеса: ${money(c.n!)} и пропуск хода — диплом менеджера удвоит прибыль с вашей собственности.`, [
        { id: 'yes', label: `Учиться за ${money(c.n!)}`, main: true },
        { id: 'no', label: 'Не надо' },
      ]);
      return;
    case 'insure':
      if (s.polis[seat]) return note(x, seat, 'страховой полис уже есть');
      if (s.cash[seat] < c.n!) return note(x, seat, 'на полис не хватает денег');
      ask(x, seat, 'insure', `Страховой полис за ${money(c.n!)}: пожар и ограбление вам больше не страшны.`, [
        { id: 'yes', label: `Купить за ${money(c.n!)}`, main: true },
        { id: 'no', label: 'Не надо' },
      ]);
      return;
    case 'firm':
      return landFirm(x, seat, c.id);
    case 'inspector':
      if (s.shadow[seat] > 0 && !s.inspector[seat]) {
        s.inspector[seat] = true;
        note(x, seat, 'фининспектор проверил финансы теневика');
      }
      return;
    case 'court':
      return court(x, seat);
    case 'robbed':
      if (s.polis[seat]) return note(x, seat, 'застрахован — грабители ушли ни с чем');
      return lose(x, seat, s.cash[seat], 'вас ограбили');
    case 'strike':
      threatHit(x, seat, 'забастовка на предприятиях');
      return;
    case 'charity':
      return startAuction(x, seat, c.id, true);
    case 'club':
      s.club[seat] = true;
      note(x, seat, 'круг большого бизнеса пройден — клуб бизнесменов');
      return;
  }
}

function court(x: Ctx, seat: number) {
  const { s } = x;
  if (s.shadow[seat] > 0 && s.courts[seat] > 0) {
    note(x, seat, 'второй раз в суде — выходит из игры');
    bankrupt(x, seat, null);
    return;
  }
  if (!(s.shadow[seat] > 0 && s.inspector[seat])) {
    if (s.shadow[seat] > 0) note(x, seat, 'фининспектор не проверял — суду нечего предъявить');
    return;
  }
  s.courts[seat]++;
  lose(x, seat, s.cash[seat], 'суд: конфискация');
  for (const c of owned(s, seat)) {
    s.owner[c] = null;
    s.ent[c] = 0;
    s.mort[c] = false;
    x.ev.push({ type: 'lose', seat, cell: c, why: 'конфискация' });
  }
  const n = s.pats[seat].length + s.racket[seat].length;
  returnPats(s, s.pats[seat]);
  returnPats(s, s.racket[seat]);
  s.pats[seat] = [];
  s.racket[seat] = [];
  if (n) x.ev.push({ type: 'pats', seat, n, why: 'конфискация' });
  s.loans[seat] = [];
  s.shadow[seat] = 0;
  s.inspector[seat] = false;
  s.skip[seat] += s.courtSkip;
  note(x, seat, `суд: всё конфисковано, пропуск ${s.courtSkip} ${plural(s.courtSkip, 'хода', 'ходов', 'ходов')}`);
}

export const discountFor = (s: State, seat: number, cell: number) => (s.beauty[seat] && firmOf(cell).co === CO_SHOW ? 0.5 : 1);
export const buyPrice = (s: State, seat: number, cell: number) => r1000(priceOf(s, cell) * discountFor(s, seat, cell));

function landFirm(x: Ctx, seat: number, cell: number) {
  const { s } = x;
  const o = s.owner[cell];
  const f = firmOf(cell);
  if (o == null) {
    const price = buyPrice(s, seat, cell);
    if (s.cash[seat] >= price) {
      ask(x, seat, 'buy', `«${f.name}» (${COS[f.co].short}): купить право владения за ${money(price)}${price < priceOf(s, cell) ? ' — льгота королевы красоты' : ''}?`, [
        { id: 'yes', label: `Купить за ${money(price)}`, main: true },
        { id: 'no', label: 'Не покупать' },
      ]);
    } else if (s.auctions) {
      note(x, seat, `на «${f.name}» не хватает денег — фирма идёт с аукциона`);
      startAuction(x, seat, cell, false);
    } else note(x, seat, `на «${f.name}» не хватает денег`);
    return;
  }
  if (o === seat) return;
  if (s.mort[cell]) return note(x, seat, `«${f.name}» в залоге — прибыли нет`);
  if (!s.ent[cell]) return note(x, seat, `на «${f.name}» нет предприятий — платить не нужно`);
  if (s.pos[o] === STRIKE_CELL) return note(x, seat, `предприятия «${f.name}» бастуют — прибыли нет`);
  pay(x, seat, profitOf(s, cell), o, `прибыль: «${f.name}»`);
}

function buy(x: Ctx, seat: number, cell: number, price: number) {
  const { s } = x;
  s.cash[seat] -= price;
  s.owner[cell] = seat;
  if (s.beauty[seat] && firmOf(cell).co === CO_SHOW && price < priceOf(s, cell)) {
    s.beauty[seat] = false;
    unhold(s, heldIs('telex', 'beauty'));
  }
  if (!s.anyBought) {
    s.anyBought = true;
    if (s.exchange) note(x, null, 'куплена первая фирма — биржа открыта');
  }
  x.ev.push({ type: 'buy', seat, cell, price });
}

// ---------------- аукцион ----------------

function startAuction(x: Ctx, seat: number, cell: number, charity: boolean) {
  const { s } = x;
  const i = s.seats.indexOf(seat);
  const order = s.seats.map((_, k) => s.seats[(i + k) % s.seats.length]).filter((p) => !s.out[p]);
  const price = charity ? CELLS[cell].n! : priceOf(s, cell);
  const bid = charity ? price : r10k(price * 1.1);
  const step = charity ? 50000 : r10k(price / 10);
  s.auc = { cell, charity, bid, step, lead: null, in: order, at: 0 };
  x.ev.push({ type: 'auction', cell, seat: null, bid });
  auctionNext(x);
}

export const aucNextBid = (a: Auction) => (a.lead == null ? a.bid : a.bid + a.step);

function auctionNext(x: Ctx) {
  const { s } = x;
  const a = s.auc!;
  for (let guard = 0; guard < 60; guard++) {
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
    const name = a.charity ? 'Благотворительный аукцион' : `Аукцион: ${firmOf(a.cell).name} (цена ${money(priceOf(s, a.cell))})`;
    s.ask = {
      seat: p,
      kind: 'auction',
      cell: a.cell,
      text: `${name}${a.lead != null ? ` — ставка ${money(a.bid)}` : ''}`,
      opts: [
        { id: 'bid', label: `${a.charity ? 'Пожертвовать' : 'Ставка'} ${money(need)}`, main: !a.charity },
        { id: 'pass', label: 'Пас', main: a.charity },
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
  if (a.charity) {
    pay(x, a.lead, a.bid, null, 'благотворительный взнос');
    donate(s, a.lead, a.bid);
    note(x, a.lead, `меценат: взнос ${money(a.bid)}`);
  } else {
    buy(x, a.lead, a.cell, a.bid);
  }
}

function donate(s: State, seat: number, n: number) {
  s.donated[seat] += n;
  s.relief[seat] += n;
}

// ---------------- карточки ----------------

function draw(x: Ctx, seat: number, deck: Deck) {
  const { s } = x;
  if (s.airStrike === deck) {
    s.airStrike = null;
    unhold(s, (h) => DECKS[h.deck][h.i].fx === 'airStrike');
    note(x, null, `вытянут «${DECK_NAME[deck]}» — забастовка в аэропорту кончилась`);
  }
  if (!s.deck[deck].length) s.deck[deck] = fullDeck(s, deck);
  if (!s.deck[deck].length) return note(x, seat, 'колода пуста');
  const i = s.deck[deck].splice(x.rng.int(s.deck[deck].length), 1)[0];
  const h: Held = { deck, i };
  s.card = h;
  x.ev.push({ type: 'card', seat, deck, i });
  cardFx(x, seat, h);
}

const other = (d: Deck): Deck => (d === 'izv' ? 'telex' : 'izv');

/** Заплатить владельцам фирм (за каждую фирму; своим и банку — не платят). */
function payOwners(x: Ctx, seat: number, cells: number[], n: number, why: string) {
  const { s } = x;
  for (const c of cells) {
    const o = s.owner[c];
    if (o == null || o === seat || s.out[o] || s.out[seat]) continue;
    pay(x, seat, n, o, why);
  }
}

function cardFx(x: Ctx, seat: number, h: Held) {
  const { s } = x;
  const card = cardOf(h);
  const n = card.n ?? 0;
  const keep = () => s.held.push({ ...h });
  switch (card.fx) {
    case 'polisFree':
      if (s.polis[seat]) return note(x, seat, 'полис уже есть');
      if (s.donated[seat] > CELLS.find((c) => c.kind === 'insure')!.n! / 2) {
        s.polis[seat] = true;
        return note(x, seat, 'меценат получает страховой полис бесплатно');
      }
      return note(x, seat, 'благотворительных взносов мало — полиса нет');
    case 'lowQuality':
    case 'ecoDanger':
      pay(x, seat, n, null, card.fx === 'lowQuality' ? 'товары низкого качества' : 'экологический штраф');
      return threatHit(x, seat, card.fx === 'lowQuality' ? 'товары низкого качества' : 'экологически опасные предприятия');
    case 'partner':
      loseEnterprises(x, seat, 'ненадёжный партнёр');
      return threatHit(x, seat, 'ненадёжный партнёр');
    case 'birthday':
      for (const p of alive(s)) if (p !== seat) pay(x, p, n, seat, 'подарок на день рождения');
      return;
    case 'tourist':
      return payOwners(x, seat, coFirms(CO_TURIST), n, 'путешествие');
    case 'show':
      return payOwners(x, seat, coFirms(CO_SHOW), n, 'шоу-представления');
    case 'build':
      return payOwners(x, seat, [firmByName('Дом'), firmByName('Дорога')], n, 'дом и дорога');
    case 'payNews': {
      const g = firmByName('Газеты');
      const o = s.owner[g];
      if (o === seat) return note(x, seat, 'газета своя — реклама бесплатно');
      return pay(x, seat, n, o != null && !s.out[o] ? o : null, 'реклама в газете');
    }
    case 'fur':
      for (const [name, sum] of [
        ['Меха', 100000],
        ['Дом моделей', 50000],
      ] as const) {
        const c = firmByName(name);
        const o = s.owner[c];
        if (o === seat) continue;
        pay(x, seat, sum, o != null && !s.out[o] ? o : null, name === 'Меха' ? 'шуба' : 'модный туалет');
      }
      return;
    case 'klaxon': {
      const cars = (
        [
          ['Мотоциклы', 50000],
          ['Легковые', 100000],
          ['Грузовые', 150000],
        ] as const
      ).map(([name, sum]) => ({ c: firmByName(name), sum }));
      for (const p of alive(s)) {
        if (!owned(s, p).length) continue;
        const car = cars.find((k) => s.owner[k.c] != null && s.owner[k.c] !== p && !s.out[s.owner[k.c]!]);
        if (car) pay(x, p, car.sum, s.owner[car.c], `машина у «Клаксона»`);
      }
      return;
    }
    case 'singer':
      s.singer[seat] = true;
      return keep();
    case 'gardener':
      s.gardener[seat] = true;
      keep();
      return give(x, seat, n, 'приз садовода');
    case 'gentlemen':
      return note(x, seat, 'джентльмен — за столом ни одного некорректного слова!');
    case 'airStrike':
      if (s.airStrike) return note(x, seat, 'аэропорт и так бастует');
      s.airStrike = other(h.deck);
      keep();
      note(x, null, `забастовка в аэропорту — до карточки «${DECK_NAME[s.airStrike]}»`);
      return checkAirStrike(x);
    case 'exch':
      if (exchangeOpen(s)) return spin(x, seat);
      return note(x, seat, 'биржа ещё не работает — фирм не куплено');
    case 'fever':
      if (!exchangeOpen(s)) return note(x, seat, 'биржа ещё не работает — фирм не куплено');
      {
        const i = s.seats.indexOf(seat);
        for (let k = 0; k < s.seats.length; k++) {
          const p = s.seats[(i + k) % s.seats.length];
          if (!s.out[p]) spin(x, p);
        }
      }
      return;
    case 'gain':
    case 'charityAd':
    case 'clubPrize':
      if (card.fx === 'charityAd' && !s.donated[seat]) return note(x, seat, 'благотворительных взносов не было — рекламы нет');
      if (card.fx === 'clubPrize' && !s.club[seat]) return note(x, seat, 'в клубе бизнесменов ещё не бывал — суперприза нет');
      return give(x, seat, n, card.fx === 'clubPrize' ? 'суперприз клуба' : 'прибыль');
    case 'fine':
      return pay(x, seat, n, null, 'штраф');
    case 'charityOr': {
      const sums = [50000, 100000, 200000].filter((v) => s.cash[seat] >= v);
      ask(
        x,
        seat,
        'charityOr',
        `Благотворительный взнос — или карточка «${DECK_NAME[other(h.deck)]}».`,
        [...sums.map((v, k) => ({ id: String(v), label: `Внести ${money(v)}`, main: k === 0 })), { id: 'card', label: `Взять «${DECK_NAME[other(h.deck)]}»`, main: !sums.length }],
        { card: h }
      );
      return;
    }
    case 'playExchange':
      ask(x, seat, 'playExchange', 'Играть на бирже? Да — при любом повышении курса наличные утроятся, при понижении — втрое меньше. Нет — три хода назад.', [
        { id: 'yes', label: 'Играть на бирже' },
        { id: 'no', label: 'Три хода назад', main: true },
      ], { card: h });
      return;
    case 'mecenat':
      ask(
        x,
        seat,
        'mecenat',
        `Стать меценатом — внести ${money(n)} на развитие культуры? Нет — вперёд на 5 ходов.`,
        [...(s.cash[seat] >= n ? [{ id: 'yes', label: `Внести ${money(n)}` }] : []), { id: 'no', label: 'Вперёд на 5', main: true }],
        { card: h }
      );
      return;
    case 'beauty':
      s.beauty[seat] = true;
      keep();
      return give(x, seat, n, 'приз конкурса красоты');
    case 'threat':
      if (s.threat[seat]) return note(x, seat, 'угроза банкротства уже висит');
      s.threat[seat] = 5;
      keep();
      return note(x, seat, 'угроза банкротства на 5 ходов');
    case 'nedra': {
      const owners = new Set(coFirms(CO_NEDRA).map((c) => s.owner[c]).filter((o): o is number => o != null && !s.out[o]));
      if (!owners.size) return note(x, null, 'у «Недр» нет владельцев');
      for (const o of owners) give(x, o, n, '«Недра»: цены поднялись');
      return;
    }
    case 'desperate':
      keep();
      s.bets.push({ seat, k: 10, card: { ...h } });
      return note(x, seat, 'карточка «отчаянного игрока» — на бирже');
  }
}

/** Все в аэропорту — забастовка кончается. */
function checkAirStrike(x: Ctx) {
  const { s } = x;
  if (s.airStrike && alive(s).every((p) => s.pos[p] === AIR)) {
    s.airStrike = null;
    unhold(s, (h) => DECKS[h.deck][h.i].fx === 'airStrike');
    note(x, null, 'все в аэропорту — забастовка кончилась');
  }
}

const plural = (n: number, one: string, few: string, many: string) => {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
};

// ---------------- очередь ----------------

function routeAsk(x: Ctx, seat: number) {
  const { s } = x;
  if (s.pos[seat] === START && !s.fresh[seat]) {
    const again = s.laps[seat] < lapLimit(s);
    ask(x, seat, 'route', again ? `Круг малого бизнеса пройден (${s.laps[seat]} из ${lapLimit(s)}). Лететь в большой бизнес или ещё круг?` : `Пройдено ${s.laps[seat]} ${plural(s.laps[seat], 'круг', 'круга', 'кругов')} малого бизнеса — пора в большой.`, [
      { id: 'fly', label: 'В аэропорт', main: true },
      ...(again ? [{ id: 'again', label: 'Ещё круг малого бизнеса' }] : []),
    ]);
    return true;
  }
  if (s.pos[seat] === CLUB) {
    ask(x, seat, 'route', 'Клуб бизнесменов: снова большой бизнес или назад в малый?', [
      { id: 'big', label: 'Снова большой бизнес', main: true },
      { id: 'small', label: 'В малый бизнес' },
    ]);
    return true;
  }
  return false;
}

/** Начало своего хода: угроза банкротства и кредиты отсчитывают ходы; на «Начале» и в «Клубе» — выбор пути. */
function beginTurn(x: Ctx, p: number): boolean {
  const { s } = x;
  if (s.threat[p] > 0) {
    s.threat[p]--;
    if (!s.threat[p]) {
      unhold(s, heldIs('telex', 'threat'));
      note(x, p, 'угроза банкротства миновала');
    }
  }
  for (const l of s.loans[p]) l.left--;
  for (const l of s.loans[p].filter((l) => l.left <= 0)) {
    pay(x, p, l.sum, null, 'возврат кредита');
    if (s.out[p]) return false;
  }
  s.loans[p] = s.loans[p].filter((l) => l.left > 0);
  s.phase = 'roll';
  s.ask = null;
  routeAsk(x, p);
  return true;
}

function endTurn(x: Ctx) {
  const { s } = x;
  s.ask = null;
  s.phase = 'roll';
  if (checkEnd(x)) return;
  let i = s.seats.indexOf(s.turn);
  for (let guard = 0; guard < 400; guard++) {
    const j = (i + 1) % s.seats.length;
    if (j <= i) {
      s.round++;
      if (checkEnd(x)) return;
    }
    i = j;
    const p = s.seats[i];
    if (s.out[p]) continue;
    if (s.skip[p] > 0) {
      s.skip[p]--;
      x.ev.push({ type: 'skip', seat: p, left: s.skip[p] });
      continue;
    }
    if (s.airStrike && s.pos[p] === AIR) {
      checkAirStrike(x);
      if (s.airStrike) {
        x.ev.push({ type: 'skip', seat: p, left: 0, air: true });
        continue;
      }
    }
    s.turn = p;
    if (!beginTurn(x, p)) {
      if (checkEnd(x)) return;
      continue;
    }
    return;
  }
}

function checkEnd(x: Ctx): boolean {
  const { s } = x;
  if (s.result) return true;
  const left = alive(s);
  const done = s.round > s.rounds;
  if (left.length > 1 && !done) return false;
  const scores: Record<number, number> = {};
  for (const p of s.seats) scores[p] = s.out[p] ? 0 : capital(s, p);
  // по капиталу в собственности, при равенстве — по наличным
  const better = (a: number, b: number) => scores[a] - scores[b] || s.cash[a] - s.cash[b];
  const top = left.reduce((a, b) => (better(b, a) > 0 ? b : a), left[0]);
  const winners = left.filter((p) => better(p, top) === 0);
  const text =
    left.length === 1 && !done
      ? 'остался единственным, кто не разорился'
      : scores[winners[0]] > 0
        ? `наибольший капитал в собственности — ${money(scores[winners[0]])}`
        : 'собственности нет ни у кого — побеждают наличные';
  s.round = Math.min(s.round, s.rounds);
  s.result = { winners, text, scores };
  s.phase = 'over';
  s.ask = null;
  s.auc = null;
  x.ev.push({ type: 'end', winners, text });
  return true;
}

function settle(x: Ctx) {
  const { s } = x;
  if (s.result) return;
  if (s.ask && s.out[s.ask.seat]) s.ask = null;
  if (s.ask) return;
  if (s.auc) return auctionNext(x);
  endTurn(x);
}

// ---------------- действия ----------------

export function toAct(s: State): number[] {
  if (s.result || s.phase === 'over') return [];
  if (s.phase === 'ask' && s.ask) return [s.ask.seat];
  return [s.turn];
}

/** Можно ли сейчас строить, закладывать и выкупать: свой ход, до броска (или на выборе пути). */
export const canManage = (s: State, seat: number) =>
  !s.result && !s.auc && s.turn === seat && !s.out[seat] && (s.phase === 'roll' || (s.phase === 'ask' && s.ask?.kind === 'route' && s.ask.seat === seat));

export const canBuild = (s: State, seat: number, cell: number) =>
  canManage(s, seat) && s.owner[cell] === seat && !s.mort[cell] && s.ent[cell] < 3 && s.cash[seat] >= entCost(s, cell);

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.result) return null;
  const s = clone(s0);
  const x: Ctx = { s, ev: [], rng };
  const ok = () => ({ state: s, events: x.ev });

  if (a.type === 'build' || a.type === 'mortgage' || a.type === 'redeem') {
    if (!canManage(s, seat) || !FIRM_CELLS.includes(a.cell) || s.owner[a.cell] !== seat) return null;
    const c = a.cell;
    if (a.type === 'build') {
      if (!canBuild(s, seat, c)) return null;
      const cost = entCost(s, c);
      s.cash[seat] -= cost;
      s.ent[c]++;
      x.ev.push({ type: 'build', seat, cell: c, n: s.ent[c], cost });
    } else if (a.type === 'mortgage') {
      if (s.mort[c]) return null;
      mortgage(x, seat, c);
    } else {
      const v = valueOf(s, c);
      if (!s.mort[c] || s.cash[seat] < v) return null;
      s.cash[seat] -= v;
      s.mort[c] = false;
      x.ev.push({ type: 'mortgage', seat, cell: c, sum: v, back: true });
    }
    return ok();
  }

  if (a.type === 'roll') {
    if (s.phase !== 'roll' || seat !== s.turn) return null;
    const p = s.pos[seat];
    if (p === CLUB || (p === START && !s.fresh[seat])) return null;
    const d = die(x);
    s.dice = d;
    if (p === STRIKE_CELL) {
      x.ev.push({ type: 'roll', seat, d, why: 'strike' });
      if (d % 2) {
        note(x, seat, 'нечётное — забастовка продолжается');
        settle(x);
        return ok();
      }
      note(x, seat, 'чётное — забастовка кончилась');
    } else x.ev.push({ type: 'roll', seat, d });
    // фишку на выпавшую клетку переставляет сам игрок — действие 'move'
    if (walkPath(s, seat, d).path.length) {
      s.phase = 'move';
      return ok();
    }
    settle(x);
    return ok();
  }

  if (a.type === 'move') {
    if (s.phase !== 'move' || seat !== s.turn || !s.dice) return null;
    s.phase = 'roll';
    walk(x, seat, s.dice);
    settle(x);
    return ok();
  }

  // choose
  const q = s.ask;
  if (s.phase !== 'ask' || !q || q.seat !== seat || !q.opts.some((o) => o.id === a.id)) return null;
  const label = q.opts.find((o) => o.id === a.id)!.label;
  s.ask = null;
  s.phase = 'roll';
  if (q.kind !== 'auction') x.ev.push({ type: 'choice', seat, label });
  const c = CELLS[q.cell];
  switch (q.kind) {
    case 'route':
      if (a.id === 'again') {
        s.fresh[seat] = true;
        return ok();
      }
      if (a.id === 'fly' || a.id === 'big') {
        if (a.id === 'fly') s.laps[seat] = 0;
        jump(x, seat, AIR);
        checkAirStrike(x);
      } else {
        jump(x, seat, START);
        s.fresh[seat] = true;
        s.laps[seat] = 0;
      }
      break;
    case 'buy':
      if (a.id === 'yes') {
        const price = buyPrice(s, seat, q.cell);
        if (s.cash[seat] < price) return null;
        buy(x, seat, q.cell, price);
      }
      break;
    case 'credit':
      if (a.id === 'take') {
        const { k, sum } = creditFor(c.n!, s.pats[seat].length);
        const given = s.pats[seat].splice(s.pats[seat].length - k, k);
        returnPats(s, given);
        s.cash[seat] += sum;
        const due = Math.round((sum * (100 + s.pct)) / 100);
        s.loans[seat].push({ sum: due, left: s.term });
        x.ev.push({ type: 'credit', seat, n: k, sum, due });
      }
      break;
    case 'shadow':
      if (a.id === 'take') {
        s.shadow[seat]++;
        give(x, seat, c.n!, 'теневые деньги');
      }
      break;
    case 'school':
      if (a.id === 'yes') {
        pay(x, seat, c.n!, null, 'школа бизнеса');
        s.diploma[seat] = true;
        s.skip[seat]++;
      }
      break;
    case 'insure':
      if (a.id === 'yes') {
        pay(x, seat, c.n!, null, 'страховой полис');
        s.polis[seat] = true;
      }
      break;
    case 'charityOr':
      if (a.id === 'card') draw(x, seat, other(q.card!.deck));
      else {
        const v = Number(a.id);
        pay(x, seat, v, null, 'благотворительный взнос');
        donate(s, seat, v);
      }
      break;
    case 'playExchange':
      if (a.id === 'yes') {
        s.held.push({ ...q.card! });
        s.bets.push({ seat, k: 3, card: { ...q.card! } });
      } else back(x, seat, 3);
      break;
    case 'mecenat':
      if (a.id === 'yes') {
        pay(x, seat, cardOf(q.card!).n!, null, 'меценатство');
        donate(s, seat, cardOf(q.card!).n!);
      } else walk(x, seat, 5);
      break;
    case 'auction': {
      const au = s.auc;
      if (!au) return null;
      if (a.id === 'bid') {
        const need = aucNextBid(au);
        if (s.cash[seat] < need) return null;
        au.bid = need;
        au.lead = seat;
        au.at++;
        x.ev.push({ type: 'auction', cell: au.cell, seat, bid: need });
      } else {
        au.in = au.in.filter((p) => p !== seat);
        x.ev.push({ type: 'choice', seat, label: 'Пас' });
      }
      break;
    }
  }
  settle(x);
  return ok();
}

/** Скрытого нет: колоды тянутся наугад из оставшихся, порядка нет. */
export function view(s: State): State {
  return s;
}
