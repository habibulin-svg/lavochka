/* Храп, Рамс, Горб — правила (без DOM). Каждый сам за себя, козырь — открытая карта после сдачи (она же последняя в колоде).
 *
 * Храп: 36 карт, по 4. Перед сдачей каждый кладёт в банк спичку. Торговля слева от сдающего: «играю» (обязуюсь взять хоть одну
 * взятку), «пас» или «храп!» — возьму все взятки; после храпа играют все. Играющие меняют до трёх карт из колоды
 * (последней идёт открытый козырь). Розыгрыш: в масть обязательно, нет масти — обязан козырять, нет и козыря — любую.
 * Расчёт: каждая взятка — 1/4 банка. Играл и не взял ни одной — «сел»: кладёт в банк столько, сколько было в банке.
 * Храп взят — каждый платит храпящему по 5, не взят — храпящий платит каждому по 5 (банк делят по взяткам как обычно).
 * Сыграл один (остальные спасовали) — забирает банк без игры; никто — банк остаётся на следующую сдачу.
 * Рамс: 32 карты, по 5, на стол — «лапа» из 5 карт: играющий может взять её вместо своих карт (одна на сдачу). Обязан
 * перебивать: в масть — старшей, если есть; козырем — старше лежащего козыря, если есть. «Рамс!» — все взятки, как храп.
 * Горб: 36 карт, по 3, играют все, банка нет. Ни одной взятки — «горб»; все взятки — горб снимается. Набрал N горбов — проиграл.
 * Спички кончились у кого-то — партия окончена, побеждает самый богатый.
 */
import type { Options, Rng } from '../../core/types';
import { sameCard, type Card, type Suit } from '../../cards/deck';
import { shuffle } from '../../core/rng';

export type Mode = 'khrap' | 'rams' | 'gorb';

export interface Cfg {
  mode: Mode;
  hand: number;
  deck: 32 | 36;
  /** Сколько карт можно сменить из колоды. */
  exchange: number;
  /** Лапа (рамс). */
  widow: boolean;
  /** Обязан перебивать. */
  strict: boolean;
  /** Спичек у каждого в начале. */
  stake: number;
  /** Горб: до скольких горбов. */
  limit: number;
}

export function cfgFrom(o: Options): Cfg {
  const mode: Mode = o.mode === 'rams' || o.mode === 'gorb' ? o.mode : 'khrap';
  const stake = [10, 20, 30].includes(Number(o.stake)) ? Number(o.stake) : 20;
  const limit = [3, 5, 7].includes(Number(o.limit)) ? Number(o.limit) : 5;
  const strict = o.strict == null ? mode === 'rams' : !!o.strict;
  if (mode === 'rams') return { mode, hand: 5, deck: 32, exchange: 0, widow: true, strict, stake, limit };
  if (mode === 'gorb') return { mode, hand: 3, deck: 36, exchange: 0, widow: false, strict, stake, limit };
  return { mode, hand: 4, deck: 36, exchange: 3, widow: false, strict, stake, limit };
}

/** Сколько игроков допустимо: в рамсе на 32 картах по 5 и лапа — не больше пяти. */
export const maxPlayers = (cfg: Cfg) => (cfg.mode === 'rams' ? 5 : 6);

export const KHRAP_PAY = 5;
const MAX_DEALS = 60;

export type Bid = 'play' | 'pass' | 'khrap' | 'widow';

export interface State {
  cfg: Cfg;
  seats: number[];
  dealer: number;
  round: number;
  hands: Card[][];
  deck: Card[];
  widow: Card[] | null;
  trump: Suit;
  trumpCard: Card;
  phase: 'bid' | 'swap' | 'play' | 'over';
  bids: (Bid | null)[];
  khrap: number | null;
  /** Кто играет эту сдачу. */
  inPlay: boolean[];
  /** Кто уже менял карты. */
  swapped: boolean[];
  trick: { seat: number; card: Card }[];
  tricks: number[];
  turn: number;
  chips: number[];
  bank: number;
  gorbs: number[];
  last: { gains: number[]; note: string } | null;
}

export interface View extends State {
  counts: number[];
  deckCount: number;
  widowCount: number;
}

export type Action = { type: 'bid'; bid: Bid } | { type: 'swap'; cards: Card[] } | { type: 'play'; card: Card };

export type Event =
  | { type: 'deal'; round: number; dealer: number; trump: Suit; trumpCard: Card; bank: number; hands?: Card[][] }
  | { type: 'bid'; seat: number; bid: Bid; hand?: Card[] }
  | { type: 'swap'; seat: number; count: number; cards?: Card[] }
  | { type: 'play'; seat: number; card: Card }
  | { type: 'trick'; seat: number; cards: Card[] }
  | { type: 'alone'; seat: number | null; bank: number }
  | { type: 'settle'; gains: number[]; tricks: number[]; bank: number; khrap: number | null; khrapOk: boolean; sat: number[] }
  | { type: 'gorb'; add: number[]; gorbs: number[] }
  | { type: 'end'; winners: number[] };

const nextIn = (list: number[], seat: number) => list[(list.indexOf(seat) + 1) % list.length];
export const players = (s: State) => s.seats.filter((p) => s.inPlay[p]);

export function newState(cfg: Cfg, seats: number[]): State {
  return {
    cfg,
    seats: seats.slice(),
    dealer: seats[seats.length - 1],
    round: 0,
    hands: [[], [], [], [], [], []],
    deck: [],
    widow: null,
    trump: 'S',
    trumpCard: { s: 'S', r: 6 },
    phase: 'bid',
    bids: [null, null, null, null, null, null],
    khrap: null,
    inPlay: [false, false, false, false, false, false],
    swapped: [false, false, false, false, false, false],
    trick: [],
    tricks: [0, 0, 0, 0, 0, 0],
    turn: seats[0],
    chips: [0, 1, 2, 3, 4, 5].map(() => cfg.stake),
    bank: 0,
    gorbs: [0, 0, 0, 0, 0, 0],
    last: null,
  };
}

function deal(s: State, rng: Rng, ev: Event[]) {
  s.round++;
  s.dealer = s.round === 1 ? s.dealer : nextIn(s.seats, s.dealer);
  if (s.cfg.mode !== 'gorb')
    for (const p of s.seats)
      if (s.chips[p] > 0) {
        s.chips[p]--;
        s.bank++;
      }
  const deck = shuffle(
    (() => {
      const out: Card[] = [];
      for (const su of ['S', 'C', 'D', 'H'] as Suit[]) for (let r = s.cfg.deck === 32 ? 7 : 6; r <= 14; r++) out.push({ s: su, r });
      return out;
    })(),
    rng
  );
  s.hands = [[], [], [], [], [], []];
  let p = nextIn(s.seats, s.dealer);
  for (let k = 0; k < s.cfg.hand * s.seats.length; k++) {
    s.hands[p].push(deck.shift()!);
    p = nextIn(s.seats, p);
  }
  s.widow = s.cfg.widow ? deck.splice(0, s.cfg.hand) : null;
  s.trumpCard = deck.shift()!;
  s.trump = s.trumpCard.s;
  // открытый козырь — последняя карта колоды
  deck.push(s.trumpCard);
  s.deck = deck;
  s.bids = [null, null, null, null, null, null];
  s.khrap = null;
  s.swapped = [false, false, false, false, false, false];
  s.trick = [];
  s.tricks = [0, 0, 0, 0, 0, 0];
  s.turn = nextIn(s.seats, s.dealer);
  ev.push({ type: 'deal', round: s.round, dealer: s.dealer, trump: s.trump, trumpCard: s.trumpCard, bank: s.bank, hands: s.hands.map((h) => h.slice()) });
  if (s.cfg.mode === 'gorb') {
    s.inPlay = [0, 1, 2, 3, 4, 5].map((q) => s.seats.includes(q));
    s.phase = 'play';
  } else {
    s.inPlay = [false, false, false, false, false, false];
    s.phase = 'bid';
  }
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  const s = newState(cfgFrom(opts), seats);
  deal(s, rng, []);
  return s;
}

export const toAct = (s: State): number[] => (s.phase === 'over' ? [] : [s.turn]);

/** Какие заявки можно сделать. */
export function bidOptions(s: State, seat: number): Bid[] {
  if (s.phase !== 'bid' || s.turn !== seat) return [];
  const out: Bid[] = ['play', 'pass'];
  if (s.cfg.widow && s.widow) out.push('widow');
  if (s.khrap == null) out.push('khrap');
  return out;
}

/** Какой картой можно ходить. */
export function legal(s: State, seat: number): Card[] {
  const hand = s.hands[seat];
  if (!s.trick.length) return hand;
  const T = s.trump;
  const lead = s.trick[0].card.s;
  const trumped = lead !== T && s.trick.some((t) => t.card.s === T);
  const follow = hand.filter((c) => c.s === lead);
  if (follow.length) {
    if (s.cfg.strict && !trumped) {
      const top = Math.max(...s.trick.filter((t) => t.card.s === lead).map((t) => t.card.r));
      const higher = follow.filter((c) => c.r > top);
      if (higher.length) return higher;
    }
    return follow;
  }
  const trumps = hand.filter((c) => c.s === T);
  if (trumps.length) {
    if (s.cfg.strict && trumped) {
      const top = Math.max(...s.trick.filter((t) => t.card.s === T).map((t) => t.card.r));
      const higher = trumps.filter((c) => c.r > top);
      if (higher.length) return higher;
    }
    return trumps;
  }
  return hand;
}

export function trickWinner(trick: { seat: number; card: Card }[], trump: Suit): number {
  const lead = trick[0].card.s;
  const tr = trick.filter((t) => t.card.s === trump);
  const pool = tr.length ? tr : trick.filter((t) => t.card.s === lead);
  return pool.slice().sort((a, b) => b.card.r - a.card.r)[0].seat;
}

/** Первый играющий слева от сдающего. */
function firstPlayer(s: State): number {
  let p = nextIn(s.seats, s.dealer);
  for (let i = 0; i < s.seats.length && !s.inPlay[p]; i++) p = nextIn(s.seats, p);
  return p;
}

function nextPlayer(s: State, seat: number): number {
  let p = nextIn(s.seats, seat);
  for (let i = 0; i < s.seats.length && !s.inPlay[p]; i++) p = nextIn(s.seats, p);
  return p;
}

/** Торговля окончена: кто играет, нужен ли обмен. */
function endBidding(s: State, rng: Rng, ev: Event[]) {
  for (const p of s.seats) s.inPlay[p] = s.khrap != null || (s.bids[p] != null && s.bids[p] !== 'pass');
  const pl = players(s);
  if (pl.length < 2) {
    // сыграл один — банк его без игры; никто — банк ждёт следующей сдачи
    const who = pl.length === 1 ? pl[0] : null;
    const bank = s.bank;
    const gains = [0, 0, 0, 0, 0, 0];
    if (who != null) {
      s.chips[who] += s.bank;
      gains[who] = s.bank;
      s.bank = 0;
    }
    s.last = { gains, note: who != null ? 'alone' : 'nobody' };
    ev.push({ type: 'alone', seat: who, bank });
    nextDeal(s, rng, ev);
    return;
  }
  // спасовавшие сбрасывают карты
  for (const p of s.seats) if (!s.inPlay[p]) s.hands[p] = [];
  if (s.cfg.exchange > 0) {
    s.phase = 'swap';
    s.turn = firstPlayer(s);
  } else startPlay(s);
}

function startPlay(s: State) {
  s.phase = 'play';
  s.turn = s.khrap ?? firstPlayer(s);
}

function nextDeal(s: State, rng: Rng, ev: Event[]) {
  const broke = s.cfg.mode !== 'gorb' && s.seats.some((p) => s.chips[p] <= 0);
  const gorbOut = s.cfg.mode === 'gorb' && s.seats.some((p) => s.gorbs[p] >= s.cfg.limit);
  if (broke || gorbOut || s.round >= MAX_DEALS) {
    s.phase = 'over';
    ev.push({ type: 'end', winners: winners(s) });
    return;
  }
  deal(s, rng, ev);
}

export function winners(s: State): number[] {
  if (s.cfg.mode === 'gorb') {
    const low = Math.min(...s.seats.map((p) => s.gorbs[p]));
    return s.seats.filter((p) => s.gorbs[p] === low);
  }
  const top = Math.max(...s.seats.map((p) => s.chips[p]));
  return s.seats.filter((p) => s.chips[p] === top);
}

function settle(s: State, rng: Rng, ev: Event[]) {
  const pl = players(s);
  if (s.cfg.mode === 'gorb') {
    const add = [0, 0, 0, 0, 0, 0];
    for (const p of pl) {
      if (s.tricks[p] === 0) add[p] = 1;
      else if (s.tricks[p] === s.cfg.hand && s.gorbs[p] > 0) add[p] = -1;
      s.gorbs[p] += add[p];
    }
    s.last = { gains: add, note: 'gorb' };
    ev.push({ type: 'gorb', add, gorbs: s.gorbs.slice() });
    nextDeal(s, rng, ev);
    return;
  }
  const B = s.bank;
  const share = Math.floor(B / s.cfg.hand);
  const gains = [0, 0, 0, 0, 0, 0];
  for (const p of pl) {
    const g = share * s.tricks[p];
    gains[p] += g;
    s.chips[p] += g;
    s.bank -= g;
  }
  const sat: number[] = [];
  let khrapOk = false;
  if (s.khrap != null) {
    const k = s.khrap;
    khrapOk = s.tricks[k] === s.cfg.hand;
    for (const p of pl) {
      if (p === k) continue;
      const from = khrapOk ? p : k;
      const to = khrapOk ? k : p;
      const pay = Math.min(KHRAP_PAY, s.chips[from]);
      s.chips[from] -= pay;
      s.chips[to] += pay;
      gains[from] -= pay;
      gains[to] += pay;
    }
  } else
    for (const p of pl)
      if (s.tricks[p] === 0) {
        // сел: кладёт в банк столько, сколько было в банке
        const pay = Math.min(B, s.chips[p]);
        s.chips[p] -= pay;
        s.bank += pay;
        gains[p] -= pay;
        sat.push(p);
      }
  s.last = { gains, note: s.khrap != null ? (khrapOk ? 'khrap-ok' : 'khrap-fail') : 'play' };
  ev.push({ type: 'settle', gains, tricks: s.tricks.slice(), bank: s.bank, khrap: s.khrap, khrapOk, sat });
  nextDeal(s, rng, ev);
}

function clone(s0: State): State {
  return {
    ...s0,
    hands: s0.hands.map((h) => h.slice()),
    deck: s0.deck.slice(),
    widow: s0.widow ? s0.widow.slice() : null,
    bids: s0.bids.slice(),
    inPlay: s0.inPlay.slice(),
    swapped: s0.swapped.slice(),
    trick: s0.trick.slice(),
    tricks: s0.tricks.slice(),
    chips: s0.chips.slice(),
    gorbs: s0.gorbs.slice(),
  };
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.phase === 'over' || seat !== s0.turn || !a || typeof a !== 'object') return null;
  const s = clone(s0);
  const ev: Event[] = [];
  if (s.phase === 'bid') {
    if (a.type !== 'bid' || !bidOptions(s, seat).includes(a.bid)) return null;
    s.bids[seat] = a.bid;
    if (a.bid === 'widow') {
      s.hands[seat] = s.widow!;
      s.widow = null;
    }
    ev.push({ type: 'bid', seat, bid: a.bid, hand: a.bid === 'widow' ? s.hands[seat].slice() : undefined });
    if (a.bid === 'khrap') {
      s.khrap = seat;
      endBidding(s, rng, ev);
      return { state: s, events: ev };
    }
    if (s.seats.every((p) => s.bids[p] != null)) endBidding(s, rng, ev);
    else {
      // следующий по кругу, кто ещё не говорил
      let p = nextIn(s.seats, seat);
      while (s.bids[p] != null) p = nextIn(s.seats, p);
      s.turn = p;
    }
    return { state: s, events: ev };
  }
  if (s.phase === 'swap') {
    if (a.type !== 'swap' || !Array.isArray(a.cards)) return null;
    const hand = s.hands[seat];
    const max = Math.min(s.cfg.exchange, s.deck.length);
    if (a.cards.length > max || !a.cards.every((c) => hand.some((x) => sameCard(x, c))) || new Set(a.cards.map((c) => c.s + c.r)).size !== a.cards.length) return null;
    const got = s.deck.splice(0, a.cards.length);
    s.hands[seat] = [...hand.filter((c) => !a.cards.some((x) => sameCard(x, c))), ...got];
    s.swapped[seat] = true;
    ev.push({ type: 'swap', seat, count: a.cards.length, cards: got });
    const next = nextPlayer(s, seat);
    if (s.swapped[next]) startPlay(s);
    else s.turn = next;
    return { state: s, events: ev };
  }
  // розыгрыш
  if (a.type !== 'play' || !a.card || !legal(s, seat).some((c) => sameCard(c, a.card))) return null;
  s.hands[seat] = s.hands[seat].filter((c) => !sameCard(c, a.card));
  s.trick = [...s.trick, { seat, card: { s: a.card.s, r: a.card.r } }];
  ev.push({ type: 'play', seat, card: a.card });
  if (s.trick.length < players(s).length) {
    s.turn = nextPlayer(s, seat);
    return { state: s, events: ev };
  }
  const w = trickWinner(s.trick, s.trump);
  s.tricks[w]++;
  ev.push({ type: 'trick', seat: w, cards: s.trick.map((t) => t.card) });
  s.trick = [];
  s.turn = w;
  if (!s.hands[w].length) settle(s, rng, ev);
  return { state: s, events: ev };
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const see = (p: number) => seats === 'all' || seats.includes(p);
  const v = s as Partial<View>;
  return {
    ...s,
    hands: s.hands.map((h, p) => (see(p) ? h.slice() : [])),
    deck: [],
    widow: null,
    counts: s.hands.map((h, p) => v.counts?.[p] ?? h.length),
    deckCount: v.deckCount ?? s.deck.length,
    widowCount: v.widowCount ?? (s.widow ? s.widow.length : 0),
  };
}

export const countOf = (s: State, seat: number) => ((s as Partial<View>).counts ? (s as View).counts[seat] : s.hands[seat].length);
export const widowLeft = (s: State) => ((s as Partial<View>).widowCount ?? (s.widow ? s.widow.length : 0));
export const deckLeft = (s: State) => ((s as Partial<View>).deckCount ?? s.deck.length);
