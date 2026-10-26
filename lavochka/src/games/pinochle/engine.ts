/* Пинокль — правила (без DOM). Сводка — docs/analysis/rules-deberts.md.
 * 48 карт: по две каждой от девятки до туза. Старшинство в масти: Т, 10, К, Д, В, 9 (из двух одинаковых старше та, что легла раньше).
 *
 * Вчетвером пара на пару (напротив), по 12 карт; втроём — каждый сам за себя, по 15 и 3 в прикуп («вдова»).
 * Торги: от соседа сдатчика по кругу, от 250 с шагом 10; спасовавший больше не торгуется; все спасовали — сдатчик играет за 250.
 * Взявший называет козырь (втроём — сперва забирает вдову и закапывает 3 карты). Мелды (у всех, раскрываются сразу):
 * ран (Т-10-К-Д-В козыря) 150, двойной — 1500; королевский марьяж (К+Д козыря) 40; марьяж 20; дикс (девятка козыря) 10;
 * тузы во всех мастях 100 (двойные — 1000), короли 80/800, дамы 60/600, вальты 40/400; пинокль (Д♠ + В♦) 40, двойной — 300.
 * Розыгрыш: первым ходит взявший. В масть и старше, если можно; нет масти — козырем (и старше козырей на столе); нет и козыря — любой.
 * Очки взяток: тузы, десятки и короли — по 10, последняя взятка — 10 (всего 250).
 * Взявшая сторона набрала мелды + взятки не меньше заказа — записывает всё; нет — минус заказ. Остальные — свои взятки и мелды
 * (мелды — только если взяли хоть одну взятку). Партия — до 1500 (втроём — до 1000).
 */
import type { Options, Rng } from '../../core/types';
import { makeDeck, SUITS, type Card, type Suit } from '../../cards/deck';
import { shuffle } from '../../core/rng';

export interface PCard extends Card {
  d: number;
}

export interface Cfg {
  target: number;
  /** Вчетвером: после козыря напарник отдаёт заказчику 4 карты, тот возвращает 4. */
  exchange?: boolean;
}

export function cfgFrom(o: Options, n = 4): Cfg {
  const t = Number(o.target);
  return { target: [500, 1000, 1500].includes(t) ? t : n === 3 ? 1000 : 1500, exchange: o.exchange !== false };
}

/** Сколько карт в обмене с напарником. */
export const PASS = 4;

export const MIN_BID = 250;
const POWER: Record<number, number> = { 14: 6, 10: 5, 13: 4, 12: 3, 11: 2, 9: 1 };
export const power = (c: Card) => POWER[c.r];
export const counter = (c: Card) => (c.r === 14 || c.r === 10 || c.r === 13 ? 10 : 0);
export const sameP = (a: PCard, b: PCard) => a.s === b.s && a.r === b.r && a.d === b.d;

export interface MeldLine {
  what: string;
  pts: number;
}

/** Мелды руки при козыре trump. */
export function melds(hand: Card[], trump: Suit): MeldLine[] {
  const cnt = (s: Suit | null, r: number) => hand.filter((c) => c.r === r && (s == null || c.s === s)).length;
  const out: MeldLine[] = [];
  const runs = Math.min(...[14, 10, 13, 12, 11].map((r) => cnt(trump, r)));
  if (runs === 2) out.push({ what: 'двойной ран', pts: 1500 });
  else if (runs === 1) out.push({ what: 'ран', pts: 150 });
  const royal = Math.min(cnt(trump, 13), cnt(trump, 12)) - runs;
  for (let k = 0; k < royal; k++) out.push({ what: 'королевский марьяж', pts: 40 });
  for (const s of SUITS) {
    if (s === trump) continue;
    const m = Math.min(cnt(s, 13), cnt(s, 12));
    for (let k = 0; k < m; k++) out.push({ what: 'марьяж', pts: 20 });
  }
  for (let k = 0; k < cnt(trump, 9); k++) out.push({ what: 'дикс', pts: 10 });
  const around: [number, string, number][] = [
    [14, 'тузы', 100],
    [13, 'короли', 80],
    [12, 'дамы', 60],
    [11, 'вальты', 40],
  ];
  for (const [r, what, pts] of around) {
    const n = Math.min(...SUITS.map((s) => cnt(s, r)));
    if (n === 2) out.push({ what: `двойные ${what}`, pts: pts * 10 });
    else if (n === 1) out.push({ what: `${what} всех мастей`, pts });
  }
  const pin = Math.min(cnt('S', 12), cnt('D', 11));
  if (pin === 2) out.push({ what: 'двойной пинокль', pts: 300 });
  else if (pin === 1) out.push({ what: 'пинокль', pts: 40 });
  return out;
}

export const meldTotal = (hand: Card[], trump: Suit) => melds(hand, trump).reduce((x, m) => x + m.pts, 0);

export type Phase = 'bid' | 'trump' | 'pass' | 'return' | 'bury' | 'play' | 'over';

export interface State {
  cfg: Cfg;
  seats: number[];
  dealer: number;
  hands: PCard[][];
  widow: PCard[];
  phase: Phase;
  turn: number;
  bid: number;
  bidder: number | null;
  out: number[];
  trump: Suit | null;
  /** Мелды сторон (сколько и что). */
  meld: number[];
  meldLines: MeldLine[][];
  trick: { seat: number; card: PCard }[];
  /** Сыгранные в сдаче карты (видели все). */
  gone: PCard[];
  pts: number[];
  tricksT: number[];
  tricks: number[];
  buried: PCard[];
  score: number[];
  deal: number;
  last: { lines: string[]; add: number[] } | null;
  over: boolean;
  winner: number | null;
}

export interface View extends State {
  counts: number[];
}

export type Action = { type: 'bid'; n: number } | { type: 'pass' } | { type: 'trump'; suit: Suit } | { type: 'bury'; cards: PCard[] } | { type: 'give'; cards: PCard[] } | { type: 'play'; card: PCard };

export type Event =
  | { type: 'deal'; deal: number; dealer: number; hands?: PCard[][] }
  | { type: 'bid'; seat: number; n: number }
  | { type: 'pass'; seat: number }
  | { type: 'won'; seat: number; bid: number; widow?: PCard[] }
  | { type: 'trump'; seat: number; suit: Suit; melds: MeldLine[][]; meld: number[]; /** мелды — после обмена с напарником */ pending?: boolean }
  | { type: 'bury'; seat: number; n: number }
  | { type: 'give'; seat: number; to: number; n: number; cards?: PCard[] }
  | { type: 'play'; seat: number; card: PCard }
  | { type: 'trick'; seat: number; cards: PCard[]; pts: number }
  | { type: 'hand'; lines: string[]; add: number[]; score: number[] }
  | { type: 'end'; winner: number; score: number[] };

const nextIn = (list: number[], seat: number) => list[(list.indexOf(seat) + 1) % list.length];
export const pairs = (s: { seats: number[] }) => s.seats.length === 4;
export const teamOf = (s: { seats: number[] }, seat: number) => (pairs(s) ? s.seats.indexOf(seat) % 2 : s.seats.indexOf(seat));
const nTeams = (s: { seats: number[] }) => (pairs(s) ? 2 : s.seats.length);

export function newState(cfg: Cfg, seats: number[]): State {
  const n = seats.length === 4 ? 2 : seats.length;
  return {
    cfg,
    seats: seats.slice(),
    dealer: seats[seats.length - 1],
    hands: seats.reduce((a, x) => ((a[x] = []), a), [] as PCard[][]),
    widow: [],
    phase: 'bid',
    turn: seats[0],
    bid: 0,
    bidder: null,
    out: [],
    trump: null,
    meld: Array(n).fill(0),
    meldLines: seats.reduce((a, x) => ((a[x] = []), a), [] as MeldLine[][]),
    trick: [],
    gone: [],
    pts: Array(n).fill(0),
    tricksT: Array(n).fill(0),
    tricks: seats.reduce((a, x) => ((a[x] = 0), a), [] as number[]),
    buried: [],
    score: Array(n).fill(0),
    deal: 0,
    last: null,
    over: false,
    winner: null,
  };
}

function dealHand(s: State, rng: Rng, ev: Event[]) {
  s.deal++;
  if (s.deal > 1) s.dealer = nextIn(s.seats, s.dealer);
  const deck: PCard[] = shuffle([...makeDeck(24).map((c) => ({ ...c, d: 0 })), ...makeDeck(24).map((c) => ({ ...c, d: 1 }))], rng);
  const n = pairs(s) ? 12 : 15;
  for (const x of s.seats) s.hands[x] = deck.splice(0, n);
  s.widow = deck;
  s.phase = 'bid';
  s.turn = nextIn(s.seats, s.dealer);
  s.bid = 0;
  s.bidder = null;
  s.out = [];
  s.trump = null;
  s.meld = s.meld.map(() => 0);
  for (const x of s.seats) s.meldLines[x] = [];
  s.trick = [];
  s.gone = [];
  s.pts = s.pts.map(() => 0);
  s.tricksT = s.tricksT.map(() => 0);
  for (const x of s.seats) s.tricks[x] = 0;
  s.buried = [];
  ev.push({ type: 'deal', deal: s.deal, dealer: s.dealer, hands: s.hands.map((h) => (h ? h.slice() : h)) });
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  const s = newState(cfgFrom(opts, seats.length), seats);
  dealHand(s, rng, []);
  return s;
}

export const toAct = (s: State): number[] => (s.over ? [] : [s.turn]);
export const minBid = (s: State | View) => (s.bid ? s.bid + 10 : MIN_BID);

/** Кто следующий торгуется (не спасовавший). */
function nextBidder(s: State, from: number): number {
  let p = nextIn(s.seats, from);
  for (let k = 0; k < s.seats.length; k++, p = nextIn(s.seats, p)) if (!s.out.includes(p)) return p;
  return from;
}

function wonBid(s: State, seat: number, ev: Event[]) {
  s.bidder = seat;
  s.bid = Math.max(s.bid, MIN_BID);
  if (!pairs(s)) {
    s.hands[seat].push(...s.widow);
    ev.push({ type: 'won', seat, bid: s.bid, widow: s.widow.slice() });
    s.widow = [];
  } else ev.push({ type: 'won', seat, bid: s.bid });
  s.phase = 'trump';
  s.turn = seat;
}

export function legal(s: State | View, seat: number): PCard[] {
  const hand = s.hands[seat];
  if (!s.trick.length || !s.trump) return hand;
  const T = s.trump;
  const lead = s.trick[0].card;
  const win = s.trick.reduce((b, t) => (beats(b.card, t.card, T) ? t : b));
  const follow = hand.filter((c) => c.s === lead.s);
  if (follow.length) {
    // в масть и старше, если можно (если берёт козырь — просто в масть)
    if (win.card.s !== lead.s) return follow;
    const over = follow.filter((c) => power(c) > power(win.card));
    return over.length ? over : follow;
  }
  const tr = hand.filter((c) => c.s === T);
  if (tr.length) {
    if (win.card.s !== T) return tr;
    const over = tr.filter((c) => power(c) > power(win.card));
    return over.length ? over : tr;
  }
  return hand;
}

/** b бьёт a (b сыграна позже: из равных старше первая). */
export function beats(a: Card, b: Card, trump: Suit): boolean {
  if (b.s === a.s) return power(b) > power(a);
  return b.s === trump;
}

function clone(s0: State): State {
  return {
    ...s0,
    hands: s0.hands.map((h) => (h ? h.slice() : h)),
    widow: s0.widow.slice(),
    out: s0.out.slice(),
    meld: s0.meld.slice(),
    meldLines: s0.meldLines.map((m) => (m ? m.slice() : m)),
    trick: s0.trick.slice(),
    gone: s0.gone.slice(),
    pts: s0.pts.slice(),
    tricksT: s0.tricksT.slice(),
    tricks: s0.tricks.slice(),
    buried: s0.buried.slice(),
    score: s0.score.slice(),
  };
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn || !a) return null;
  const s = clone(s0);
  const ev: Event[] = [];
  if (s.phase === 'bid') {
    if (a.type === 'bid') {
      const n = Math.floor(a.n);
      if (n < minBid(s) || n % 10 !== 0 || n > 3000) return null;
      s.bid = n;
      s.bidder = seat;
      ev.push({ type: 'bid', seat, n });
    } else if (a.type === 'pass') {
      s.out.push(seat);
      ev.push({ type: 'pass', seat });
    } else return null;
    const left = s.seats.filter((x) => !s.out.includes(x));
    if (left.length === 1 && s.bidder === left[0]) {
      wonBid(s, left[0], ev);
      return { state: s, events: ev };
    }
    if (!left.length) {
      // все спасовали — сдатчик играет за 250
      wonBid(s, s.dealer, ev);
      return { state: s, events: ev };
    }
    s.turn = nextBidder(s, seat);
    // круг вернулся к единственному оставшемуся, который ещё не заказывал
    if (left.length === 1 && s.bidder == null) {
      wonBid(s, left[0], ev);
      return { state: s, events: ev };
    }
    return { state: s, events: ev };
  }
  if (s.phase === 'pass' || s.phase === 'return') {
    // обмен с напарником: сначала напарник отдаёт 4, потом заказчик возвращает 4; мелды — после обмена
    if (a.type !== 'give' || !Array.isArray(a.cards) || a.cards.length !== PASS) return null;
    const cs = a.cards.map((c) => s.hands[seat].find((x) => sameP(x, c)));
    if (cs.some((c) => !c) || new Set(cs.map((c) => `${c!.s}${c!.r}${c!.d}`)).size !== PASS) return null;
    const to = s.phase === 'pass' ? s.bidder! : partnerOf(s, s.bidder!);
    s.hands[seat] = s.hands[seat].filter((x) => !cs.some((c) => sameP(c!, x)));
    s.hands[to] = [...s.hands[to], ...(cs as PCard[])];
    ev.push({ type: 'give', seat, to, n: PASS, cards: cs as PCard[] });
    if (s.phase === 'pass') {
      s.phase = 'return';
      s.turn = s.bidder!;
    } else {
      declareMelds(s, s.trump!, s.bidder!, ev);
      s.phase = 'play';
      s.turn = s.bidder!;
    }
    return { state: s, events: ev };
  }
  if (s.phase === 'trump') {
    if (a.type !== 'trump' || !SUITS.includes(a.suit)) return null;
    s.trump = a.suit;
    if (pairs(s) && s.cfg.exchange) {
      s.phase = 'pass';
      s.turn = partnerOf(s, seat);
      return { state: s, events: [{ type: 'trump', seat, suit: a.suit, melds: s.meldLines.map(() => []), meld: s.meld.slice(), pending: true }] };
    }
    for (const x of s.seats) {
      s.meldLines[x] = melds(s.hands[x], a.suit);
      s.meld[teamOf(s, x)] += s.meldLines[x].reduce((y, m) => y + m.pts, 0);
    }
    ev.push({ type: 'trump', seat, suit: a.suit, melds: s.meldLines.map((m) => (m ? m.slice() : m)), meld: s.meld.slice() });
    if (!pairs(s)) s.phase = 'bury';
    else s.phase = 'play';
    return { state: s, events: ev };
  }
  if (s.phase === 'bury') {
    if (a.type !== 'bury' || !Array.isArray(a.cards) || a.cards.length !== 3) return null;
    const cs = a.cards.map((c) => s.hands[seat].find((x) => sameP(x, c)));
    if (cs.some((c) => !c) || new Set(cs.map((c) => `${c!.s}${c!.r}${c!.d}`)).size !== 3) return null;
    s.hands[seat] = s.hands[seat].filter((x) => !cs.some((c) => sameP(c!, x)));
    // закопанные идут в очки взявшего
    s.buried = cs as PCard[];
    s.pts[teamOf(s, seat)] += s.buried.reduce((x, c) => x + counter(c), 0);
    ev.push({ type: 'bury', seat, n: 3 });
    s.phase = 'play';
    return { state: s, events: ev };
  }
  if (s.phase !== 'play' || a.type !== 'play' || !legal(s, seat).some((c) => sameP(c, a.card))) return null;
  const card = s.hands[seat].find((c) => sameP(c, a.card))!;
  s.hands[seat] = s.hands[seat].filter((c) => !sameP(c, card));
  s.trick.push({ seat, card });
  ev.push({ type: 'play', seat, card });
  if (s.trick.length < s.seats.length) {
    s.turn = nextIn(s.seats, seat);
    return { state: s, events: ev };
  }
  const w = s.trick.reduce((b, t) => (beats(b.card, t.card, s.trump!) ? t : b)).seat;
  const cards = s.trick.map((t) => t.card);
  s.gone.push(...cards);
  let pts = cards.reduce((x, c) => x + counter(c), 0);
  const last = s.seats.every((x) => !s.hands[x].length);
  if (last) pts += 10;
  const t = teamOf(s, w);
  s.pts[t] += pts;
  s.tricksT[t]++;
  s.tricks[w]++;
  s.trick = [];
  s.turn = w;
  ev.push({ type: 'trick', seat: w, cards, pts });
  if (last) endHand(s, rng, ev);
  return { state: s, events: ev };
}

/** Напарник (вчетвером — напротив). */
export const partnerOf = (s: { seats: number[] }, seat: number) => s.seats[(s.seats.indexOf(seat) + 2) % s.seats.length];

/** Мелды всех рук (после обмена) — в общий счёт сторон. */
function declareMelds(s: State, trump: Suit, seat: number, ev: Event[]) {
  for (const x of s.seats) {
    s.meldLines[x] = melds(s.hands[x], trump);
    s.meld[teamOf(s, x)] += s.meldLines[x].reduce((y, m) => y + m.pts, 0);
  }
  ev.push({ type: 'trump', seat, suit: trump, melds: s.meldLines.map((m) => (m ? m.slice() : m)), meld: s.meld.slice() });
}

function endHand(s: State, rng: Rng, ev: Event[]) {
  const n = nTeams(s);
  const bt = teamOf(s, s.bidder!);
  const add = Array(n).fill(0);
  const lines: string[] = [];
  for (let t = 0; t < n; t++) {
    const total = s.pts[t] + (s.tricksT[t] ? s.meld[t] : 0);
    if (t === bt) {
      if (total >= s.bid) add[t] = total;
      else {
        add[t] = -s.bid;
        lines.push(`заказ ${s.bid} не сыгран`);
      }
    } else add[t] = total;
  }
  for (let t = 0; t < n; t++) s.score[t] += add[t];
  s.last = { lines, add };
  ev.push({ type: 'hand', lines, add, score: s.score.slice() });
  const top = Math.max(...s.score);
  // до цели первым — взявшая сторона, если дошла (так принято: «заказчик выходит первым»)
  if (top >= s.cfg.target || s.deal >= 60) {
    s.over = true;
    s.phase = 'over';
    s.winner = s.score[bt] >= s.cfg.target ? bt : s.score.indexOf(top);
    ev.push({ type: 'end', winner: s.winner, score: s.score.slice() });
    return;
  }
  dealHand(s, rng, ev);
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const see = (x: number) => seats === 'all' || seats.includes(x);
  const v = s as Partial<View>;
  return { ...s, hands: s.hands.map((h, i) => (h ? (see(i) ? h.slice() : []) : h)), widow: seats === 'all' ? s.widow.slice() : [], buried: seats === 'all' ? s.buried.slice() : [], counts: s.hands.map((h, i) => (h ? (v.counts?.[i] ?? h.length) : 0)) };
}

export const countOf = (s: State | View, seat: number) => ('counts' in s ? (s as View).counts[seat] : s.hands[seat].length);
