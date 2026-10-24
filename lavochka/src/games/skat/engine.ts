/* Скат — правила (без DOM). Сводка — docs/analysis/rules-skat.md (pagat, en.wiki, Parlett).
 *
 * Втроём, 32 карты: по 10 и 2 в скат. Торги: средний (сосед после первого) называет числа 18, 20, 22, 23, 24, 27… первому, тот отвечает
 * «да» (держит) или «пас»; потом третий торгуется с победителем. Все спасовали — пересдача. Взявший торги играет один против двоих:
 * берёт скат и сносит две карты или играет «с руки» (без ската), затем объявляет игру: масть (трефы 12, пики 11, червы 10, бубны 9),
 * гранд (24, козыри — одни валеты) или нуль (без козырей, не взять ни одной взятки: 23, с руки 35, открытый 46, открытый с руки 59).
 * Козыри в масти: вальты (♣ ♠ ♥ ♦), затем Т 10 К Д 9 8 7 козырной масти. В масть ходить обязательно (валет — козырь, не своя масть).
 * Очки: В 2, Т 11, 10 10, К 4, Д 3 (всего 120); снесённый скат — играющему. Выиграл — 61 и больше (шнайдер — 90, шварц — все взятки).
 * Ценность игры = базовое × (матадоры + 1 [+ с руки] [+ шнайдер] [+ объявлен] [+ шварц] [+ объявлен] [+ открытая]).
 * Матадоры — вальты и козыри подряд от трефового (с ними — сколько есть подряд, без них — сколько не хватает до первого).
 * Ценность меньше заявки — перебор: проигрыш на наименьшее кратное базового, не меньшее заявки.
 * Счёт: выиграл — +ценность, проиграл — −2 × ценность; по Зегеру–Фабиану ещё +50 за выигрыш, −50 за проигрыш и +40 соперникам.
 */
import type { Options, Rng } from '../../core/types';
import { makeDeck, sameCard, SUITS, type Card, type Suit } from '../../cards/deck';
import { shuffle } from '../../core/rng';

export interface Cfg {
  deals: number;
  fabian: boolean;
}

export function cfgFrom(o: Options): Cfg {
  return { deals: [6, 12, 24, 36].includes(Number(o.deals)) ? Number(o.deals) : 12, fabian: o.fabian !== false };
}

export const BIDS = [18, 20, 22, 23, 24, 27, 30, 33, 35, 36, 40, 44, 45, 46, 48, 50, 54, 55, 59, 60, 63, 66, 70, 72, 77, 80, 81, 84, 88, 90, 96, 99, 100, 108, 110, 117, 120, 121, 126, 130, 132, 135, 140, 143, 144, 150, 153, 154, 156, 160, 162, 165, 168, 170, 176, 180, 187, 192, 198, 204, 216, 240, 264];
export const BASE: Record<string, number> = { D: 9, H: 10, S: 11, C: 12, grand: 24 };
export const NULL_VAL = { plain: 23, hand: 35, ouvert: 46, ouvertHand: 59 };
const JACKS: Suit[] = ['C', 'S', 'H', 'D'];

export type GameKind = Suit | 'grand' | 'null';

export interface Contract {
  kind: GameKind;
  hand: boolean;
  /** Объявлены шнайдер/шварц (только с руки), открытая игра. */
  schneider?: boolean;
  schwarz?: boolean;
  ouvert?: boolean;
}

export const POINTS: Record<number, number> = { 11: 2, 14: 11, 10: 10, 13: 4, 12: 3, 9: 0, 8: 0, 7: 0 };
const SUIT_ORDER: Record<number, number> = { 14: 7, 10: 6, 13: 5, 12: 4, 9: 3, 8: 2, 7: 1 };
const NULL_ORDER: Record<number, number> = { 14: 8, 13: 7, 12: 6, 11: 5, 10: 4, 9: 3, 8: 2, 7: 1 };

export const isTrump = (c: Card, k: GameKind) => k !== 'null' && (c.r === 11 || c.s === k);
/** «Масть» карты в этой игре: козырь — 'T'. */
export const suitOf = (c: Card, k: GameKind): Suit | 'T' => (isTrump(c, k) ? 'T' : c.s);
export function power(c: Card, k: GameKind): number {
  if (k === 'null') return NULL_ORDER[c.r];
  if (c.r === 11) return 200 - JACKS.indexOf(c.s);
  if (c.s === k) return 100 + SUIT_ORDER[c.r];
  return SUIT_ORDER[c.r];
}

/** Матадоры: с ними (+) или без них (−), по руке играющего вместе со скатом. */
export function matadors(cards: Card[], k: GameKind): number {
  const order: Card[] = JACKS.map((s) => ({ s, r: 11 }));
  if (k !== 'grand' && k !== 'null') for (const r of [14, 10, 13, 12, 9, 8, 7]) order.push({ s: k, r });
  const has = (c: Card) => cards.some((x) => sameCard(x, c));
  const first = has(order[0]);
  let n = 0;
  for (const c of order) {
    if (has(c) === first) n++;
    else break;
  }
  return first ? n : -n;
}

/** Ценность игры (без перебора). */
export function gameValue(c: Contract, cards: Card[], outcome: { schneider: boolean; schwarz: boolean }): number {
  if (c.kind === 'null') return c.ouvert ? (c.hand ? NULL_VAL.ouvertHand : NULL_VAL.ouvert) : c.hand ? NULL_VAL.hand : NULL_VAL.plain;
  let m = Math.abs(matadors(cards, c.kind)) + 1;
  if (c.hand) m++;
  if (outcome.schneider || c.schneider || c.schwarz) m++;
  if (c.schneider) m++;
  if (outcome.schwarz || c.schwarz) m++;
  if (c.schwarz) m++;
  if (c.ouvert) m++;
  return BASE[c.kind] * m;
}

export type Phase = 'bid' | 'skat' | 'discard' | 'declare' | 'play' | 'over';

export interface State {
  cfg: Cfg;
  seats: number[];
  dealer: number;
  hands: Card[][];
  skat: Card[];
  phase: Phase;
  turn: number;
  /** Торги: кто называет, кто отвечает, текущее число, стадия. */
  asker: number | null;
  listener: number | null;
  bid: number;
  bidStage: number;
  passed: number[];
  declarer: number | null;
  contract: Contract | null;
  /** Снос (видит только играющий). */
  put: Card[];
  /** Играют с руки (скат не брали). */
  handGame: boolean;
  /** Карты играющего со скатом на момент объявления — по ним матадоры. */
  orig: Card[];
  trick: { seat: number; card: Card }[];
  gone: Card[];
  pts: number[];
  tricks: number[];
  score: number[];
  deal: number;
  last: { lines: string[]; add: number[] } | null;
  over: boolean;
  winner: number | null;
}

export interface View extends State {
  counts: number[];
}

export type Action =
  | { type: 'bid'; n: number }
  | { type: 'hold' }
  | { type: 'pass' }
  | { type: 'skat'; take: boolean }
  | { type: 'discard'; cards: Card[] }
  | { type: 'declare'; contract: Contract }
  | { type: 'play'; card: Card };

export type Event =
  | { type: 'deal'; deal: number; dealer: number; hands?: Card[][] }
  | { type: 'bid'; seat: number; n: number }
  | { type: 'hold'; seat: number; n: number }
  | { type: 'pass'; seat: number }
  | { type: 'won'; seat: number; bid: number }
  | { type: 'redeal' }
  | { type: 'skat'; seat: number; take: boolean; cards?: Card[] }
  | { type: 'discard'; seat: number }
  | { type: 'declare'; seat: number; contract: Contract; ouvertHand?: Card[] }
  | { type: 'play'; seat: number; card: Card }
  | { type: 'trick'; seat: number; cards: Card[]; pts: number }
  | { type: 'hand'; won: boolean; value: number; pts: number; lines: string[]; add: number[]; score: number[] }
  | { type: 'end'; winner: number; score: number[] };

const nextIn = (list: number[], seat: number) => list[(list.indexOf(seat) + 1) % list.length];

export function newState(cfg: Cfg, seats: number[]): State {
  return {
    cfg,
    seats: seats.slice(0, 3),
    dealer: seats[2],
    hands: seats.reduce((a, x) => ((a[x] = []), a), [] as Card[][]),
    skat: [],
    phase: 'bid',
    turn: seats[1],
    asker: null,
    listener: null,
    bid: 0,
    bidStage: 1,
    passed: [],
    declarer: null,
    contract: null,
    put: [],
    handGame: false,
    orig: [],
    trick: [],
    gone: [],
    pts: seats.reduce((a, x) => ((a[x] = 0), a), [] as number[]),
    tricks: seats.reduce((a, x) => ((a[x] = 0), a), [] as number[]),
    score: seats.reduce((a, x) => ((a[x] = 0), a), [] as number[]),
    deal: 0,
    last: null,
    over: false,
    winner: null,
  };
}

/** Первая, вторая, третья рука от сдатчика. */
export const fore = (s: State | View) => nextIn(s.seats, s.dealer);
export const middle = (s: State | View) => nextIn(s.seats, fore(s));
export const rear = (s: State | View) => nextIn(s.seats, middle(s));

function dealHand(s: State, rng: Rng, ev: Event[], keep = false) {
  s.deal++;
  if (s.deal > 1 && !keep) s.dealer = nextIn(s.seats, s.dealer);
  const deck = shuffle(makeDeck(32), rng);
  for (const x of s.seats) s.hands[x] = deck.splice(0, 10);
  s.skat = deck;
  s.phase = 'bid';
  s.asker = middle(s);
  s.listener = fore(s);
  s.turn = s.asker;
  s.bid = 0;
  s.bidStage = 1;
  s.passed = [];
  s.declarer = null;
  s.contract = null;
  s.put = [];
  s.handGame = false;
  s.orig = [];
  s.trick = [];
  s.gone = [];
  for (const x of s.seats) {
    s.pts[x] = 0;
    s.tricks[x] = 0;
  }
  ev.push({ type: 'deal', deal: s.deal, dealer: s.dealer, hands: s.hands.map((h) => (h ? h.slice() : h)) });
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  const s = newState(cfgFrom(opts), seats);
  dealHand(s, rng, []);
  return s;
}

export const toAct = (s: State): number[] => (s.over ? [] : [s.turn]);
export const nextBid = (s: State | View) => BIDS.find((b) => b > s.bid) ?? 999;

/** Победитель торгов определён. */
function wonBid(s: State, seat: number, ev: Event[]) {
  s.declarer = seat;
  s.bid = Math.max(s.bid, 18);
  ev.push({ type: 'won', seat, bid: s.bid });
  s.phase = 'skat';
  s.turn = seat;
}

/** Ход торгов после паса или ответа. */
function advanceBid(s: State, rng: Rng, ev: Event[]) {
  if (s.bidStage === 1 && (s.passed.includes(s.asker!) || s.passed.includes(s.listener!))) {
    // первая пара отторговалась: победитель слушает третьего
    const winner = s.passed.includes(s.asker!) ? s.listener! : s.asker!;
    s.bidStage = 2;
    s.asker = rear(s);
    s.listener = winner;
    s.turn = s.asker;
    return;
  }
  if (s.bidStage === 2 && (s.passed.includes(s.asker!) || s.passed.includes(s.listener!))) {
    const winner = s.passed.includes(s.asker!) ? s.listener! : s.asker!;
    if (s.bid === 0) {
      // никто ничего не назвал: оставшийся может сыграть за 18 или спасовать
      if (s.passed.includes(winner)) {
        ev.push({ type: 'redeal' });
        dealHand(s, rng, ev);
        return;
      }
      s.bidStage = 3;
      s.asker = winner;
      s.listener = null;
      s.turn = winner;
      return;
    }
    wonBid(s, winner, ev);
  }
}

function clone(s0: State): State {
  return {
    ...s0,
    hands: s0.hands.map((h) => (h ? h.slice() : h)),
    skat: s0.skat.slice(),
    passed: s0.passed.slice(),
    put: s0.put.slice(),
    orig: s0.orig.slice(),
    trick: s0.trick.slice(),
    gone: s0.gone.slice(),
    pts: s0.pts.slice(),
    tricks: s0.tricks.slice(),
    score: s0.score.slice(),
  };
}

export function legal(s: State | View, seat: number): Card[] {
  const hand = s.hands[seat];
  if (!s.trick.length || !s.contract) return hand;
  const k = s.contract.kind;
  const lead = suitOf(s.trick[0].card, k);
  const follow = hand.filter((c) => suitOf(c, k) === lead);
  return follow.length ? follow : hand;
}

export function trickWinner(trick: { seat: number; card: Card }[], k: GameKind): number {
  let best = trick[0];
  for (const t of trick.slice(1)) {
    const st = suitOf(t.card, k);
    const sb = suitOf(best.card, k);
    if (st === 'T' && sb !== 'T') best = t;
    else if (st === sb && power(t.card, k) > power(best.card, k)) best = t;
  }
  return best.seat;
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn || !a) return null;
  const s = clone(s0);
  const ev: Event[] = [];
  if (s.phase === 'bid') {
    if (s.bidStage === 3) {
      // первая рука может сыграть за 18
      if (a.type === 'bid' && a.n === 18) {
        s.bid = 18;
        ev.push({ type: 'bid', seat, n: 18 });
        wonBid(s, seat, ev);
      } else if (a.type === 'pass') {
        ev.push({ type: 'pass', seat });
        ev.push({ type: 'redeal' });
        dealHand(s, rng, ev);
      } else return null;
      return { state: s, events: ev };
    }
    if (seat === s.asker) {
      if (a.type === 'bid') {
        if (a.n !== nextBid(s) && !(BIDS.includes(a.n) && a.n > s.bid)) return null;
        s.bid = a.n;
        ev.push({ type: 'bid', seat, n: a.n });
        s.turn = s.listener!;
        return { state: s, events: ev };
      }
      if (a.type !== 'pass') return null;
      s.passed.push(seat);
      ev.push({ type: 'pass', seat });
      advanceBid(s, rng, ev);
      return { state: s, events: ev };
    }
    if (seat === s.listener) {
      if (a.type === 'hold') {
        ev.push({ type: 'hold', seat, n: s.bid });
        s.turn = s.asker!;
        return { state: s, events: ev };
      }
      if (a.type !== 'pass') return null;
      s.passed.push(seat);
      ev.push({ type: 'pass', seat });
      advanceBid(s, rng, ev);
      return { state: s, events: ev };
    }
    return null;
  }
  if (s.phase === 'skat') {
    if (a.type !== 'skat') return null;
    s.orig = [...s.hands[seat], ...s.skat];
    s.handGame = !a.take;
    if (a.take) {
      s.hands[seat] = [...s.hands[seat], ...s.skat];
      ev.push({ type: 'skat', seat, take: true, cards: s.skat.slice() });
      s.phase = 'discard';
    } else {
      s.put = s.skat.slice();
      ev.push({ type: 'skat', seat, take: false });
      s.phase = 'declare';
    }
    s.skat = [];
    return { state: s, events: ev };
  }
  if (s.phase === 'discard') {
    if (a.type !== 'discard' || !Array.isArray(a.cards) || a.cards.length !== 2) return null;
    const cs = a.cards.map((c) => s.hands[seat].find((x) => sameCard(x, c)));
    if (cs.some((c) => !c) || sameCard(cs[0]!, cs[1]!)) return null;
    s.put = cs as Card[];
    s.hands[seat] = s.hands[seat].filter((x) => !s.put.some((c) => sameCard(c, x)));
    ev.push({ type: 'discard', seat });
    s.phase = 'declare';
    return { state: s, events: ev };
  }
  if (s.phase === 'declare') {
    if (a.type !== 'declare' || !a.contract) return null;
    const c = a.contract;
    const hand = s.handGame;
    if (!['C', 'S', 'H', 'D', 'grand', 'null'].includes(c.kind)) return null;
    const contract: Contract = { kind: c.kind, hand, schneider: hand && !!c.schneider, schwarz: hand && !!c.schwarz, ouvert: !!c.ouvert && (c.kind === 'null' || hand) };
    if (contract.schwarz) contract.schneider = true;
    s.contract = contract;
    ev.push({ type: 'declare', seat, contract, ouvertHand: contract.ouvert ? s.hands[seat].slice() : undefined });
    s.phase = 'play';
    s.turn = fore(s);
    return { state: s, events: ev };
  }
  if (s.phase !== 'play' || a.type !== 'play' || !legal(s, seat).some((c) => sameCard(c, a.card))) return null;
  const card = s.hands[seat].find((c) => sameCard(c, a.card))!;
  s.hands[seat] = s.hands[seat].filter((c) => !sameCard(c, card));
  s.trick.push({ seat, card });
  ev.push({ type: 'play', seat, card });
  if (s.trick.length < 3) {
    s.turn = nextIn(s.seats, seat);
    return { state: s, events: ev };
  }
  const k = s.contract!.kind;
  const w = trickWinner(s.trick, k);
  const cards = s.trick.map((t) => t.card);
  const pts = cards.reduce((x, c) => x + POINTS[c.r], 0);
  s.gone.push(...cards);
  s.pts[w] += pts;
  s.tricks[w]++;
  s.trick = [];
  s.turn = w;
  ev.push({ type: 'trick', seat: w, cards, pts });
  // нуль: играющий взял взятку — проиграл сразу
  if (k === 'null' && w === s.declarer) return finishHand(s, rng, ev);
  if (s.seats.every((x) => !s.hands[x].length)) return finishHand(s, rng, ev);
  return { state: s, events: ev };
}

function finishHand(s: State, rng: Rng, ev: Event[]) {
  const d = s.declarer!;
  const c = s.contract!;
  const declPts = s.pts[d] + s.put.reduce((x, k) => x + POINTS[k.r], 0);
  const defTricks = s.seats.filter((x) => x !== d).reduce((x, k) => x + s.tricks[k], 0);
  const lines: string[] = [];
  let won: boolean;
  let value: number;
  if (c.kind === 'null') {
    won = s.tricks[d] === 0;
    value = gameValue(c, [], { schneider: false, schwarz: false });
  } else {
    const schneider = declPts >= 90 || declPts <= 30;
    const schwarz = defTricks === 0 || s.tricks[d] === 0;
    value = gameValue(c, s.orig, { schneider, schwarz });
    won = declPts >= 61;
    if (c.schneider && declPts < 90) won = false;
    if (c.schwarz && defTricks > 0) won = false;
    if (schwarz && s.tricks[d] === 0) won = false;
    if (schneider) lines.push(declPts >= 90 ? 'шнайдер' : 'играющий в шнайдере');
    if (schwarz) lines.push('шварц');
  }
  if (value < s.bid) {
    won = false;
    const base = c.kind === 'null' ? value : BASE[c.kind];
    value = Math.ceil(s.bid / base) * base;
    lines.push(`перебор: заявка ${s.bid}`);
  }
  const add = s.seats.reduce((a, x) => ((a[x] = 0), a), [] as number[]);
  if (won) add[d] = value + (s.cfg.fabian ? 50 : 0);
  else {
    add[d] = -2 * value - (s.cfg.fabian ? 50 : 0);
    if (s.cfg.fabian) for (const x of s.seats) if (x !== d) add[x] += 40;
  }
  for (const x of s.seats) s.score[x] += add[x];
  s.last = { lines, add };
  ev.push({ type: 'hand', won, value, pts: declPts, lines, add, score: s.score.slice() });
  if (s.deal >= s.cfg.deals) {
    s.over = true;
    s.phase = 'over';
    const best = Math.max(...s.seats.map((x) => s.score[x]));
    s.winner = s.seats.find((x) => s.score[x] === best)!;
    ev.push({ type: 'end', winner: s.winner, score: s.score.slice() });
    return { state: s, events: ev };
  }
  dealHand(s, rng, ev);
  return { state: s, events: ev };
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const see = (x: number) => seats === 'all' || seats.includes(x);
  const v = s as Partial<View>;
  const ouvert = s.contract?.ouvert && s.phase === 'play';
  return {
    ...s,
    hands: s.hands.map((h, i) => (h ? (see(i) || (ouvert && i === s.declarer) ? h.slice() : []) : h)),
    skat: seats === 'all' ? s.skat.slice() : [],
    put: seats === 'all' || (s.declarer != null && see(s.declarer)) ? s.put.slice() : [],
    orig: seats === 'all' || (s.declarer != null && see(s.declarer)) ? s.orig.slice() : [],
    counts: s.hands.map((h, i) => (h ? (v.counts?.[i] ?? h.length) : 0)),
  };
}

export const countOf = (s: State | View, seat: number) => ('counts' in s ? (s as View).counts[seat] : s.hands[seat].length);
export { SUITS };
