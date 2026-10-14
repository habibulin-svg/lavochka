/* Очко (двадцать одно) и Блэкджек — правила (без DOM).
 *
 * Очко: банкир — один из игроков, ставит банк из своих денег. Понтёры по очереди слева от банкира: смотрят первую карту
 * (втёмную), ставят не больше непокрытого остатка банка, получают вторую и добирают «ещё» / «хватит». Туз 11, король 4,
 * дама 3, валет 2. Два туза — «золотое очко» (сразу, двойная выплата). Перебор — ставка сразу в банк. Потом банкир
 * открывает свою карту и добирает (сам или по правилу «до 17»); у банкира два туза — забирает все ставки. Ничья —
 * в пользу банка (или ставка возвращается). Банк прогорел — переходит дальше; вырос втрое или банкир отсидел три сдачи —
 * «стук»: последняя сдача, после неё банкир забирает банк и колода уходит соседу слева.
 *
 * Блэкджек: постоянный дилер (не игрок), 52 карты, по две карты каждому и дилеру (одна закрыта), туз 1/11, картинки по 10.
 * Блэкджек платит 3:2, удвоение, сплит (один раз), отказ, страховка при тузе у дилера, дилер тянет до 17 и стоит на мягких 17.
 * Ничья — ставка возвращается.
 */
import type { Options, Rng } from '../../core/types';
import { makeDeck, type Card } from '../../cards/deck';
import { shuffle } from '../../core/rng';

export interface Cfg {
  /** Блэкджек: постоянный дилер, 52 карты, туз 1/11. */
  bj: boolean;
  deck: 36 | 52;
  /** Очко: туз при переборе считается за 1. */
  soft: boolean;
  /** Очко: ничья — в пользу банка (иначе ставка возвращается). */
  tieBank: boolean;
  /** Очко: банкир обязан тянуть до 17 (иначе решает сам). */
  dealer17: boolean;
  /** Деньги каждого на старте. */
  purse: number;
  /** Очко: сколько банкир кладёт в банк. */
  bankSize: number;
  /** Очко: сколько раз банк обходит стол. Блэкджек: сколько сдач. */
  length: number;
}

export function cfgFrom(o: Options): Cfg {
  const bj = o.mode === 'bj';
  const pick = (v: unknown, ok: number[], d: number) => (ok.includes(Number(v)) ? Number(v) : d);
  return {
    bj,
    deck: bj || Number(o.deck) === 52 ? 52 : 36,
    soft: bj || o.soft === true,
    tieBank: !bj && o.tie !== 'push',
    dealer17: bj || o.dealer17 === true,
    purse: 100,
    bankSize: pick(o.bank, [10, 20, 30, 50], 20),
    length: bj ? pick(o.hands, [10, 20, 30], 20) : pick(o.laps, [1, 2, 3], 1),
  };
}

/** Банкир держит банк не больше стольких сдач, потом «стук». */
export const BANK_DEALS = 3;
/** Банк вырос во столько раз — «стук». */
export const STUK_X = 3;
/** Страховка от бесконечной партии. */
export const MAX_DEALS = 400;
/** Блэкджек: ставки от и шаг. */
export const BJ_MIN = 5;

export type Res = 'win' | 'lose' | 'push' | 'bust' | 'golden' | 'bj' | 'surr' | 'skip';

export interface Hand {
  cards: Card[];
  bet: number;
  /** Рука доиграна (стоит, перебор, расчёт). */
  done: boolean;
  /** Карты открыты всем. */
  open: boolean;
  res?: Res;
  /** Сколько вернулось игроку при расчёте (вместе со ставкой). */
  paid?: number;
  doubled?: boolean;
  /** Рука из сплита тузов: одна карта и всё. */
  splitAce?: boolean;
}

export type Phase = 'bet' | 'insure' | 'play' | 'dealer' | 'over';

export interface State {
  cfg: Cfg;
  seats: number[];
  money: number[];
  /** Очко: место банкира; блэкджек — null (дилер заведения). */
  banker: number | null;
  bank: number;
  bankStart: number;
  /** Сколько сдач держит текущий банкир. */
  bankDeals: number;
  /** Сколько раз банк сменил хозяина. */
  passes: number;
  /** Сколько сдач сыграно. */
  deal: number;
  /** Идёт последняя сдача банкира. */
  stuk: boolean;
  deck: Card[];
  /** Руки по местам (в блэкджеке после сплита — две). */
  hands: Hand[][];
  /** Карты банкира/дилера. */
  dealer: Card[];
  dealerOpen: boolean;
  /** Страховки (блэкджек) по местам. */
  insurance: number[];
  /** Понтёры этой сдачи по порядку. */
  order: number[];
  phase: Phase;
  /** Чей ход (место) и какая рука. */
  turn: number | null;
  hi: number;
  /** Выбывшие без денег. */
  broke: number[];
  over: boolean;
  winner: number | null;
}

export interface View extends Omit<State, 'deck'> {
  deckLeft: number;
}

export type Action =
  | { type: 'bet'; n: number }
  | { type: 'hit' }
  | { type: 'stand' }
  | { type: 'double' }
  | { type: 'split' }
  | { type: 'surrender' }
  | { type: 'insure'; yes: boolean };

export type Event =
  | { type: 'deal'; n: number; seats: number[]; cards: Card[]; dealer: Card[]; banker: number | null; stuk: boolean }
  | { type: 'bet'; seat: number; n: number }
  | { type: 'skip'; seat: number }
  | { type: 'card'; seat: number; hand: number; card: Card; open: boolean }
  | { type: 'dcard'; card: Card }
  | { type: 'split'; seat: number }
  | { type: 'double'; seat: number; hand: number }
  | { type: 'insure'; seat: number; n: number }
  | { type: 'stand'; seat: number; hand: number; total: number }
  | { type: 'reveal'; seat: number; hand: number; cards: Card[] }
  | { type: 'dreveal'; cards: Card[] }
  | { type: 'settle'; seat: number; hand: number; res: Res; bet: number; paid: number; total: number }
  | { type: 'dtotal'; total: number; golden: boolean; bj: boolean; house: boolean }
  | { type: 'stuk'; seat: number; bank: number }
  | { type: 'banker'; seat: number; bank: number; prev: number | null; took: number; burnt: boolean }
  | { type: 'broke'; seat: number }
  | { type: 'end'; winner: number; money: number[] };

/** Сколько очков у карты. */
export function cardPts(cfg: Cfg, c: Card): number {
  if (c.r === 14) return 11;
  if (cfg.bj) return c.r >= 10 ? 10 : c.r;
  return c.r === 11 ? 2 : c.r === 12 ? 3 : c.r === 13 ? 4 : c.r;
}

/** Сумма руки (тузы по 1, если перебор и туз мягкий) и мягкая ли она. */
export function total(cfg: Cfg, cards: Card[]): { n: number; soft: boolean } {
  let n = 0;
  let aces = 0;
  for (const c of cards) {
    n += cardPts(cfg, c);
    if (c.r === 14) aces++;
  }
  if (cfg.soft) while (n > 21 && aces) (n -= 10), aces--;
  return { n, soft: cfg.soft && aces > 0 };
}

export const sum = (cfg: Cfg, cards: Card[]) => total(cfg, cards).n;
/** Два туза с раздачи — «золотое очко» (только в очке). */
export const golden = (cfg: Cfg, cards: Card[]) => !cfg.bj && cards.length === 2 && cards[0].r === 14 && cards[1].r === 14;
/** Блэкджек с раздачи. */
export const natural = (cfg: Cfg, cards: Card[]) => cfg.bj && cards.length === 2 && sum(cfg, cards) === 21;
export const busted = (cfg: Cfg, cards: Card[]) => !golden(cfg, cards) && sum(cfg, cards) > 21;

export function newState(cfg: Cfg, seats: number[]): State {
  return {
    cfg,
    seats: seats.slice(),
    money: [0, 0, 0, 0, 0, 0].map(() => cfg.purse),
    banker: null,
    bank: 0,
    bankStart: 0,
    bankDeals: 0,
    passes: 0,
    deal: 0,
    stuk: false,
    deck: [],
    hands: [[], [], [], [], [], []],
    dealer: [],
    dealerOpen: false,
    insurance: [0, 0, 0, 0, 0, 0],
    order: [],
    phase: 'bet',
    turn: null,
    hi: 0,
    broke: [],
    over: false,
    winner: null,
  };
}

const clone = (s: State): State => ({
  ...s,
  money: s.money.slice(),
  deck: s.deck.slice(),
  hands: s.hands.map((hs) => hs.map((h) => ({ ...h, cards: h.cards.slice() }))),
  dealer: s.dealer.slice(),
  insurance: s.insurance.slice(),
  order: s.order.slice(),
  broke: s.broke.slice(),
});

/** Следующее по кругу место с деньгами (после seat). */
function nextWithMoney(s: State, seat: number): number | null {
  const i = s.seats.indexOf(seat);
  for (let k = 1; k <= s.seats.length; k++) {
    const p = s.seats[(i + k) % s.seats.length];
    if (s.money[p] > 0) return p;
  }
  return null;
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  const s = newState(cfgFrom(opts), seats);
  const ev: Event[] = [];
  if (!s.cfg.bj) {
    // жребий: открывают по карте по кругу — у кого первым туз, тот и банкует
    const deck = shuffle(makeDeck(s.cfg.deck), rng);
    let i = 0;
    while (deck[i].r !== 14) i++;
    takeBank(s, seats[i % seats.length]);
  }
  startDeal(s, rng, ev);
  return s;
}

function takeBank(s: State, seat: number) {
  const n = Math.min(s.cfg.bankSize, s.money[seat]);
  s.banker = seat;
  s.money[seat] -= n;
  s.bank = n;
  s.bankStart = n;
  s.bankDeals = 0;
  s.stuk = false;
}

function draw(s: State, rng: Rng): Card {
  if (!s.deck.length) {
    // колода кончилась — тасуем всё, что не на столе
    const used = new Set([...s.dealer, ...s.hands.flatMap((hs) => hs.flatMap((h) => h.cards))].map((c) => c.s + c.r));
    s.deck = shuffle(makeDeck(s.cfg.deck).filter((c) => !used.has(c.s + c.r)), rng);
  }
  return s.deck.shift()!;
}

/** Непокрытый остаток банка: банк минус ставки, что ещё не рассчитаны. */
export function cover(s: State | View): number {
  let out = 0;
  for (const p of s.seats) for (const h of s.hands[p]) if (!h.res) out += h.bet;
  return Math.max(0, s.bank - out);
}

/** Пределы ставки для места сейчас. */
export function betRange(s: State | View, seat: number): { min: number; max: number } {
  if (s.cfg.bj) return { min: Math.min(BJ_MIN, s.money[seat]), max: s.money[seat] };
  return { min: 1, max: Math.min(s.money[seat], cover(s)) };
}

function startDeal(s: State, rng: Rng, ev: Event[]) {
  s.deal++;
  s.deck = shuffle(makeDeck(s.cfg.deck), rng);
  s.hands = s.hands.map(() => []);
  s.insurance = s.insurance.map(() => 0);
  s.dealer = [];
  s.dealerOpen = false;
  s.hi = 0;
  if (s.cfg.bj) {
    s.order = s.seats.filter((p) => s.money[p] >= BJ_MIN);
    for (const p of s.order) s.hands[p] = [{ cards: [], bet: 0, done: false, open: true }];
    s.phase = 'bet';
    s.turn = s.order[0] ?? null;
    ev.push({ type: 'deal', n: s.deal, seats: s.order.slice(), cards: [], dealer: [], banker: null, stuk: false });
    return;
  }
  // очко: понтёры слева от банкира, по одной карте втёмную, банкиру — одна
  const b = s.banker!;
  const i = s.seats.indexOf(b);
  s.order = [];
  for (let k = 1; k < s.seats.length; k++) {
    const p = s.seats[(i + k) % s.seats.length];
    if (s.money[p] > 0) s.order.push(p);
  }
  const cards: Card[] = [];
  for (const p of s.order) {
    const c = draw(s, rng);
    cards.push(c);
    s.hands[p] = [{ cards: [c], bet: 0, done: false, open: false }];
  }
  s.dealer = [draw(s, rng)];
  ev.push({ type: 'deal', n: s.deal, seats: s.order.slice(), cards, dealer: s.dealer.slice(), banker: b, stuk: s.stuk });
  s.phase = 'bet';
  s.turn = null;
  nextPunter(s, rng, ev, -1);
}

/** Очко: ход следующему понтёру после индекса k в order (кто может поставить). */
function nextPunter(s: State, rng: Rng, ev: Event[], k: number) {
  for (let j = k + 1; j < s.order.length; j++) {
    const p = s.order[j];
    if (betRange(s, p).max >= 1) {
      s.turn = p;
      s.phase = 'bet';
      return;
    }
    const h = s.hands[p][0];
    h.done = true;
    h.res = 'skip';
    ev.push({ type: 'skip', seat: p });
  }
  s.turn = null;
  dealerTurn(s, rng, ev);
}

export const toAct = (s: State): number[] => {
  if (s.over) return [];
  if (s.phase === 'dealer') return s.banker != null && !s.cfg.dealer17 ? [s.banker] : [];
  return s.turn != null ? [s.turn] : [];
};

/** Что можно сделать текущей рукой. */
export function canDo(s: State | View, seat: number): { double: boolean; split: boolean; surrender: boolean } {
  const no = { double: false, split: false, surrender: false };
  if (!s.cfg.bj || s.phase !== 'play' || s.turn !== seat) return no;
  const hs = s.hands[seat];
  const h = hs[s.hi];
  if (!h || h.cards.length !== 2) return no;
  const rich = s.money[seat] >= h.bet;
  return {
    double: rich,
    split: rich && hs.length === 1 && cardPts(s.cfg, h.cards[0]) === cardPts(s.cfg, h.cards[1]) && h.cards[0].r === h.cards[1].r,
    surrender: hs.length === 1,
  };
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over || !a) return null;
  const s = clone(s0);
  const ev: Event[] = [];
  const cfg = s.cfg;

  if (s.phase === 'dealer') {
    if (seat !== s.banker || cfg.dealer17 || (a.type !== 'hit' && a.type !== 'stand')) return null;
    if (a.type === 'hit') {
      const c = draw(s, rng);
      s.dealer.push(c);
      ev.push({ type: 'dcard', card: c });
      if (sum(cfg, s.dealer) < 21 && !golden(cfg, s.dealer)) return { state: s, events: ev };
    }
    settle(s, rng, ev);
    return { state: s, events: ev };
  }

  if (seat !== s.turn) return null;

  if (s.phase === 'bet') {
    if (a.type !== 'bet') return null;
    const { min, max } = betRange(s, seat);
    const n = Math.floor(a.n);
    if (!(n >= min && n <= max)) return null;
    s.money[seat] -= n;
    s.hands[seat][0].bet = n;
    ev.push({ type: 'bet', seat, n });
    if (cfg.bj) {
      const i = s.order.indexOf(seat);
      if (i < s.order.length - 1) s.turn = s.order[i + 1];
      else bjDeal(s, rng, ev);
    } else {
      // очко: вторая карта
      hitCard(s, seat, 0, rng, ev);
      s.phase = 'play';
      afterCard(s, seat, rng, ev);
    }
    return { state: s, events: ev };
  }

  if (s.phase === 'insure') {
    if (a.type !== 'insure') return null;
    const n = a.yes ? Math.min(Math.floor(s.hands[seat][0].bet / 2), s.money[seat]) : 0;
    if (n > 0) {
      s.money[seat] -= n;
      s.insurance[seat] = n;
      ev.push({ type: 'insure', seat, n });
    }
    const left = s.order.filter((p) => s.hands[p][0].bet > 0);
    const i = left.indexOf(seat);
    if (i < left.length - 1) s.turn = left[i + 1];
    else peek(s, rng, ev);
    return { state: s, events: ev };
  }

  if (s.phase !== 'play') return null;
  const hs = s.hands[seat];
  const h = hs[s.hi];
  if (!h || h.done) return null;
  const can = canDo(s, seat);
  switch (a.type) {
    case 'hit':
      hitCard(s, seat, s.hi, rng, ev);
      afterCard(s, seat, rng, ev);
      break;
    case 'stand':
      h.done = true;
      ev.push({ type: 'stand', seat, hand: s.hi, total: sum(cfg, h.cards) });
      nextHand(s, rng, ev);
      break;
    case 'double':
      if (!can.double) return null;
      s.money[seat] -= h.bet;
      h.bet *= 2;
      h.doubled = true;
      ev.push({ type: 'double', seat, hand: s.hi });
      hitCard(s, seat, s.hi, rng, ev);
      if (!busted(cfg, h.cards)) {
        h.done = true;
        ev.push({ type: 'stand', seat, hand: s.hi, total: sum(cfg, h.cards) });
      }
      afterCard(s, seat, rng, ev);
      break;
    case 'split': {
      if (!can.split) return null;
      s.money[seat] -= h.bet;
      const aces = h.cards[0].r === 14;
      const h2: Hand = { cards: [h.cards[1]], bet: h.bet, done: false, open: true, splitAce: aces };
      h.cards = [h.cards[0]];
      h.splitAce = aces;
      hs.push(h2);
      ev.push({ type: 'split', seat });
      hitCard(s, seat, 0, rng, ev);
      hitCard(s, seat, 1, rng, ev);
      if (aces) {
        // тузы после сплита — по одной карте и всё
        hs.forEach((x, k) => {
          x.done = true;
          ev.push({ type: 'stand', seat, hand: k, total: sum(cfg, x.cards) });
        });
      }
      afterCard(s, seat, rng, ev);
      break;
    }
    case 'surrender':
      if (!can.surrender) return null;
      h.done = true;
      resolveHand(s, seat, 0, 'surr', ev);
      nextHand(s, rng, ev);
      break;
    default:
      return null;
  }
  return { state: s, events: ev };
}

function hitCard(s: State, seat: number, k: number, rng: Rng, ev: Event[]) {
  const c = draw(s, rng);
  const h = s.hands[seat][k];
  h.cards.push(c);
  ev.push({ type: 'card', seat, hand: k, card: c, open: h.open });
}

/** Выплата по руке. */
function resolveHand(s: State, seat: number, k: number, res: Res, ev: Event[]) {
  const h = s.hands[seat][k];
  let paid = 0;
  const bj = s.cfg.bj;
  if (res === 'win') paid = 2 * h.bet;
  else if (res === 'push') paid = h.bet;
  else if (res === 'bj') paid = h.bet + Math.floor((h.bet * 3) / 2);
  else if (res === 'golden') paid = 3 * h.bet;
  else if (res === 'surr') paid = Math.floor(h.bet / 2);
  h.res = res;
  if (!bj) {
    // очко: выигрыш платит банк (не больше, чем в нём есть сверх других ставок)
    const gain = paid - h.bet;
    if (gain > 0) {
      let free = s.bank;
      for (const p of s.seats) for (const x of s.hands[p]) if (!x.res && x !== h) free -= x.bet;
      const g = Math.max(0, Math.min(gain, free));
      paid = h.bet + g;
      s.bank -= g;
    } else s.bank += h.bet - paid;
  }
  h.paid = paid;
  h.open = true;
  h.done = true;
  s.money[seat] += paid;
  ev.push({ type: 'settle', seat, hand: k, res, bet: h.bet, paid, total: sum(s.cfg, h.cards) });
}

/** После карты: золотое очко, перебор, 21 — рука закрывается; иначе ждём решения. */
function afterCard(s: State, seat: number, rng: Rng, ev: Event[]) {
  const cfg = s.cfg;
  const h = s.hands[seat][s.hi];
  if (golden(cfg, h.cards)) {
    ev.push({ type: 'reveal', seat, hand: s.hi, cards: h.cards.slice() });
    resolveHand(s, seat, s.hi, 'golden', ev);
  } else if (busted(cfg, h.cards)) {
    if (!h.open) ev.push({ type: 'reveal', seat, hand: s.hi, cards: h.cards.slice() });
    resolveHand(s, seat, s.hi, 'bust', ev);
  } else if (!h.done && sum(cfg, h.cards) === 21) {
    h.done = true;
    ev.push({ type: 'stand', seat, hand: s.hi, total: 21 });
  } else if (h.splitAce) h.done = true;
  if (h.done) nextHand(s, rng, ev);
}

/** Следующая рука того же игрока (сплит) или следующий игрок. */
function nextHand(s: State, rng: Rng, ev: Event[]) {
  const seat = s.turn!;
  const hs = s.hands[seat];
  while (s.hi < hs.length && hs[s.hi].done) s.hi++;
  if (s.hi < hs.length) {
    // вторая рука сплита: дать ей вторую карту уже дано — проверить 21
    const h = hs[s.hi];
    if (sum(s.cfg, h.cards) === 21) {
      h.done = true;
      ev.push({ type: 'stand', seat, hand: s.hi, total: 21 });
      return nextHand(s, rng, ev);
    }
    return;
  }
  s.hi = 0;
  const i = s.order.indexOf(seat);
  if (s.cfg.bj) {
    for (let j = i + 1; j < s.order.length; j++) {
      const p = s.order[j];
      if (s.hands[p].some((h) => !h.done)) {
        s.turn = p;
        return;
      }
    }
    s.turn = null;
    dealerTurn(s, rng, ev);
  } else nextPunter(s, rng, ev, i);
}

/** Блэкджек: все поставили — раздача по две карты. */
function bjDeal(s: State, rng: Rng, ev: Event[]) {
  for (let r = 0; r < 2; r++) {
    for (const p of s.order) hitCard(s, p, 0, rng, ev);
    const c = draw(s, rng);
    s.dealer.push(c);
    ev.push({ type: 'dcard', card: r === 0 ? c : { s: 'S', r: 0 } });
  }
  s.phase = 'insure';
  if (s.dealer[0].r === 14) {
    s.turn = s.order[0];
    return;
  }
  peek(s, rng, ev);
}

/** Блэкджек: дилер заглядывает под карту при тузе или десятке; потом игроки с блэкджеком получают сразу. */
function peek(s: State, rng: Rng, ev: Event[]) {
  const cfg = s.cfg;
  s.phase = 'play';
  s.turn = null;
  if (cardPts(cfg, s.dealer[0]) >= 10 && natural(cfg, s.dealer)) {
    s.dealerOpen = true;
    ev.push({ type: 'dreveal', cards: s.dealer.slice() });
    ev.push({ type: 'dtotal', total: 21, golden: false, bj: true, house: true });
    for (const p of s.order) {
      if (s.insurance[p]) s.money[p] += s.insurance[p] * 3;
      resolveHand(s, p, 0, natural(cfg, s.hands[p][0].cards) ? 'push' : 'lose', ev);
    }
    return endDeal(s, rng, ev);
  }
  for (const p of s.order) {
    const h = s.hands[p][0];
    if (natural(cfg, h.cards)) resolveHand(s, p, 0, 'bj', ev);
  }
  s.hi = 0;
  const first = s.order.find((p) => s.hands[p].some((h) => !h.done));
  if (first == null) return dealerTurn(s, rng, ev);
  s.turn = first;
}

/** Все понтёры сыграли: банкир/дилер открывает карту и добирает. */
function dealerTurn(s: State, rng: Rng, ev: Event[]) {
  const cfg = s.cfg;
  s.phase = 'dealer';
  s.turn = null;
  s.dealerOpen = true;
  ev.push({ type: 'dreveal', cards: s.dealer.slice() });
  const live = s.seats.some((p) => s.hands[p].some((h) => !h.res));
  // против кого играть — нет: банкир просто открывается
  if (!live) return settle(s, rng, ev);
  if (golden(cfg, s.dealer)) return settle(s, rng, ev);
  if (!cfg.dealer17) {
    if (sum(cfg, s.dealer) >= 21) return settle(s, rng, ev);
    return; // банкир добирает сам
  }
  while (sum(cfg, s.dealer) < 17 && !golden(cfg, s.dealer)) {
    const c = draw(s, rng);
    s.dealer.push(c);
    ev.push({ type: 'dcard', card: c });
  }
  settle(s, rng, ev);
}

/** Расчёт всех нерассчитанных рук с банкиром. */
function settle(s: State, rng: Rng, ev: Event[]) {
  const cfg = s.cfg;
  const d = sum(cfg, s.dealer);
  const dg = golden(cfg, s.dealer);
  const dbust = !dg && d > 21;
  ev.push({ type: 'dtotal', total: d, golden: dg, bj: false, house: cfg.bj });
  for (const p of s.seats)
    s.hands[p].forEach((h, k) => {
      if (h.res) return;
      if (!h.open) ev.push({ type: 'reveal', seat: p, hand: k, cards: h.cards.slice() });
      const n = sum(cfg, h.cards);
      let res: Res;
      if (dg) res = 'lose';
      else if (dbust) res = 'win';
      else if (n > d) res = 'win';
      else if (n < d) res = 'lose';
      else res = cfg.tieBank ? 'lose' : 'push';
      resolveHand(s, p, k, res, ev);
    });
  endDeal(s, rng, ev);
}

/** Сдача сыграна: смена банка, выбывшие, конец партии или новая сдача. */
function endDeal(s: State, rng: Rng, ev: Event[]) {
  s.phase = 'over';
  s.turn = null;
  if (!s.cfg.bj) {
    const b = s.banker!;
    s.bankDeals++;
    if (s.bank <= 0 || s.stuk) {
      const took = s.bank;
      s.money[b] += took;
      s.bank = 0;
      s.passes++;
      const nb = nextWithMoney(s, b);
      if (gameOver(s, ev)) return;
      takeBank(s, nb!);
      ev.push({ type: 'banker', seat: nb!, bank: s.bank, prev: b, took, burnt: took <= 0 });
    } else if (s.bank >= STUK_X * s.bankStart || s.bankDeals >= BANK_DEALS) {
      s.stuk = true;
      ev.push({ type: 'stuk', seat: b, bank: s.bank });
    }
  }
  if (gameOver(s, ev)) return;
  startDeal(s, rng, ev);
}

function gameOver(s: State, ev: Event[]): boolean {
  const cfg = s.cfg;
  for (const p of s.seats)
    if (!s.broke.includes(p) && s.money[p] < (cfg.bj ? BJ_MIN : 1) && !(p === s.banker && s.bank > 0)) {
      s.broke.push(p);
      ev.push({ type: 'broke', seat: p });
    }
  // деньги в банке — банкирские
  const worth = (p: number) => s.money[p] + (p === s.banker ? s.bank : 0);
  const rich = s.seats.filter((p) => worth(p) > 0);
  const playable = cfg.bj ? s.seats.filter((p) => s.money[p] >= BJ_MIN).length : rich.length;
  const done = cfg.bj ? s.deal >= cfg.length : s.passes >= cfg.length * s.seats.length;
  if (!done && playable >= (cfg.bj ? 1 : 2) && s.deal < MAX_DEALS) return false;
  if (!cfg.bj && s.banker != null) {
    s.money[s.banker] += s.bank;
    s.bank = 0;
  }
  const best = Math.max(...s.seats.map((p) => s.money[p]));
  s.winner = s.seats.find((p) => s.money[p] === best)!;
  s.over = true;
  s.phase = 'over';
  s.turn = null;
  ev.push({ type: 'end', winner: s.winner, money: s.money.slice() });
  return true;
}

const HIDDEN: Card = { s: 'S', r: 0 };

export function makeView(s: State, seats: number[] | 'all'): View {
  const all = seats === 'all';
  const me = (p: number) => all || (seats as number[]).includes(p);
  const { deck, ...rest } = s;
  const dealerShown = s.dealerOpen || (s.banker != null && me(s.banker));
  return {
    ...rest,
    deckLeft: deck.length,
    hands: s.hands.map((hs, p) => hs.map((h) => (h.open || me(p) ? h : { ...h, cards: h.cards.map(() => HIDDEN) }))),
    // дилер блэкджека: видна только первая карта
    dealer: dealerShown ? s.dealer.slice() : s.dealer.map((c, i) => (s.cfg.bj && i === 0 ? c : HIDDEN)),
  };
}
