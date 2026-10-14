/* Расписной покер (он же русский, одесский, детский, «покер на взятки») — правила (без DOM). 3–6 игроков, каждый за себя.
 * Правила — по nashpoker.net «Расписной покер».
 *
 * Колода 36 карт (джокер — семёрка или шестёрка пик) или 54 (два настоящих джокера). Сдачи по расписанию: по 1 карте, по 2, … до
 * максимума (9, а в 36 картах — сколько хватит на всех), максимум — столько раз, сколько игроков, потом вниз до 1. Дальше особые
 * сдачи на максимуме: тёмная (заказ не глядя в карты), бескозырка, золотая (каждая взятка в плюс), мизер (каждая в минус) и,
 * если выбрана, лобовая (по карте: свою не видишь, видишь чужие). Сдаёт по кругу каждый.
 * Козырь — верхняя карта остатка; остатка нет или открылся джокер — без козыря. С круговыми козырями козырь каждой взятки — масть,
 * следующая за мастью захода (♠→♣→♦→♥→♠).
 * Заказ — по кругу с левого от сдающего, от паса (0) до числа карт. Сдающий не может заказать так, чтобы сумма заказов совпала
 * с числом карт (вариант — может что угодно).
 * Ход: в масть; нет масти — козырем; нет и козыря — любую. Джокер кладётся всегда. Заходя с джокера, объявляют: «по старшим
 * козырям» / «по старшим пикам…» — все отдают старшую карту этой масти (нет масти — козырь, нет и его — любую), берёт джокер, если
 * взятку не перебили козырем; или «за младшую <масть>» — джокер идёт младшей картой масти. Не заходя: джокер «забирает» (старше всего;
 * второй джокер, положенный позже, старше первого) или «скидывается» (младше всего).
 * Очки: взял ровно заказ — по 10 за взятку, пас и ни одной — 5; перебор — по 1 за взятку; недобор — −10 за каждую недобранную.
 * Тёмная и бескозырка — вдвое, золотая — +20 за взятку, мизер — −20; лобовая — по 50 за взятку и −50 за недобор.
 * Грузинский: расписание до 8 (вшестером до 6), потом по 9 по разу на каждого, вниз до 1 и снова по 9; точно — заказ×50+50, мимо —
 * по 10 за взятку.
 */
import type { Options, Rng } from '../../core/types';
import { makeDeck, sameCard, SUITS, type Card, type Suit } from '../../cards/deck';
import { shuffle } from '../../core/rng';

export type Kind = 'up' | 'max' | 'down' | 'dark' | 'nt' | 'gold' | 'misere' | 'lob';
export const KIND_NAME: Record<Kind, string> = {
  up: 'Подъём',
  max: 'Круговая',
  down: 'Спуск',
  dark: 'Тёмная',
  nt: 'Бескозырка',
  gold: 'Золотая',
  misere: 'Мизер',
  lob: 'Лобовая',
};
/** Сдачи без заказа. */
export const noBid = (k: Kind) => k === 'gold' || k === 'misere';

export interface Cfg {
  deck: 36 | 54;
  /** Какая карта джокер в колоде 36. */
  joker: 6 | 7;
  /** Особые сдачи: по кругу (каждая столько раз, сколько игроков), по разу или без них. */
  specials: 'circle' | 'one' | 'none';
  lob: boolean;
  /** Сдающий заказывает что угодно. */
  free: boolean;
  /** Круговые козыри. */
  circular: boolean;
  /** Грузинский: своё расписание и счёт. */
  georgian: boolean;
}

export function cfgFrom(o: Options): Cfg {
  return {
    deck: Number(o.deck) === 54 ? 54 : 36,
    joker: Number(o.joker) === 6 ? 6 : 7,
    specials: o.specials === 'one' || o.specials === 'none' ? o.specials : 'circle',
    lob: !!o.lob,
    free: !!o.free,
    circular: !!o.circular,
    georgian: !!o.georgian,
  };
}

export const isJoker = (cfg: Cfg, c: Card) => c.r === 15 || (cfg.deck === 36 && c.s === 'S' && c.r === cfg.joker);

/** Как сыгран джокер. want — заход «по старшим <масть>», low — младшей картой масти (заход) или сброс, high — забирает. */
export type JokerPlay = { mode: 'want' | 'low'; suit: Suit } | { mode: 'high' | 'low'; suit?: undefined };
export interface Played {
  seat: number;
  card: Card;
  joker?: JokerPlay;
}

export interface Deal {
  kind: Kind;
  cards: number;
}

/** Расписание партии. */
export function schedule(cfg: Cfg, n: number): Deal[] {
  const out: Deal[] = [];
  const top = Math.min(9, Math.floor(cfg.deck / n));
  const add = (kind: Kind, cards: number, times = 1) => {
    for (let i = 0; i < times; i++) out.push({ kind, cards });
  };
  if (cfg.georgian) {
    const g = Math.min(top - 1, n >= 6 ? 6 : n === 5 ? 7 : 8);
    for (let c = 1; c <= g; c++) add('up', c);
    add('max', top, n);
    for (let c = g; c >= 1; c--) add('down', c);
    add('max', top, n);
  } else {
    for (let c = 1; c < top; c++) add('up', c);
    add('max', top, n);
    for (let c = top - 1; c >= 1; c--) add('down', c);
  }
  const times = cfg.specials === 'circle' ? n : cfg.specials === 'one' ? 1 : 0;
  for (const k of ['dark', 'nt', 'gold', 'misere'] as Kind[]) add(k, top, times);
  if (cfg.lob) add('lob', 1, n);
  return out;
}

export interface State {
  cfg: Cfg;
  seats: number[];
  plan: Deal[];
  /** Номер сдачи (0…plan.length-1). */
  deal: number;
  dealer: number;
  hands: Card[][];
  phase: 'bid' | 'play' | 'over';
  /** Открытая карта козыря (null — нет остатка). */
  trumpCard: Card | null;
  /** Козырь сдачи (null — бескозырка; при круговых козырях не используется). */
  trump: Suit | null;
  bids: (number | null)[];
  tricks: number[];
  trick: Played[];
  turn: number;
  score: number[];
  /** Очки последней сдачи. */
  last: number[] | null;
  /** Роспись: сыгранные сдачи по порядку — заказы, взятки, очки за сдачу. */
  rows: Row[];
}

export interface Row {
  bids: (number | null)[];
  took: number[];
  add: number[];
}

export interface View extends State {
  counts: number[];
  /** Свои карты сейчас не видны (тёмная, лобовая). */
  blind: boolean;
}

export type Action = { type: 'bid'; n: number } | { type: 'play'; card: Card; joker?: JokerPlay };

export type Event =
  | { type: 'deal'; deal: number; dealer: number; kind: Kind; cards: number; trumpCard: Card | null }
  | { type: 'bid'; seat: number; n: number }
  | { type: 'play'; seat: number; card: Card; joker?: JokerPlay }
  | { type: 'trick'; seat: number }
  | { type: 'round'; add: number[]; score: number[] }
  | { type: 'end'; winners: number[]; score: number[] };

const nextIn = (list: number[], seat: number) => list[(list.indexOf(seat) + 1) % list.length];
export const nextSuit = (s: Suit): Suit => SUITS[(SUITS.indexOf(s) + 1) % 4];
export const cur = (s: State) => s.plan[Math.min(s.deal, s.plan.length - 1)];

export function newState(cfg: Cfg, seats: number[]): State {
  const n = seats.length;
  return {
    cfg,
    seats: seats.slice(),
    plan: schedule(cfg, n),
    deal: 0,
    dealer: seats[n - 1],
    hands: Array.from({ length: 6 }, () => []),
    phase: 'bid',
    trumpCard: null,
    trump: null,
    bids: Array(6).fill(null),
    tricks: Array(6).fill(0),
    trick: [],
    turn: seats[0],
    score: Array(6).fill(0),
    last: null,
    rows: [],
  };
}

function dealOut(s: State, rng: Rng, ev: Event[]) {
  const d = cur(s);
  const deck = shuffle(makeDeck(s.cfg.deck), rng);
  s.hands = Array.from({ length: 6 }, () => []);
  // по кругу с левого от сдающего, последняя — сдающему
  let p = nextIn(s.seats, s.dealer);
  for (let k = 0; k < d.cards * s.seats.length; k++) {
    s.hands[p].push(deck[k]);
    p = nextIn(s.seats, p);
  }
  const rest = deck.slice(d.cards * s.seats.length);
  s.trumpCard = rest.length ? rest[0] : null;
  s.trump = d.kind === 'nt' || !s.trumpCard || isJoker(s.cfg, s.trumpCard) ? null : s.trumpCard.s;
  s.bids = Array(6).fill(null);
  s.tricks = Array(6).fill(0);
  s.trick = [];
  s.turn = nextIn(s.seats, s.dealer);
  s.phase = noBid(d.kind) ? 'play' : 'bid';
  ev.push({ type: 'deal', deal: s.deal, dealer: s.dealer, kind: d.kind, cards: d.cards, trumpCard: s.trumpCard });
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  const s = newState(cfgFrom(opts), seats);
  s.dealer = seats[rng.int(seats.length)];
  dealOut(s, rng, []);
  return s;
}

export const toAct = (s: State): number[] => (s.phase === 'over' ? [] : [s.turn]);

/** Какие заказы можно сделать сейчас. */
export function bidOptions(s: State, seat: number): number[] {
  const n = cur(s).cards;
  const all = Array.from({ length: n + 1 }, (_, i) => i);
  if (seat !== s.dealer || s.cfg.free) return all;
  const sum = s.seats.reduce((a, p) => a + (p === seat ? 0 : s.bids[p] ?? 0), 0);
  return all.filter((x) => x + sum !== n);
}

/** Масть, которой требуют ходить, и требуют ли старшую. */
export function leadOf(cfg: Cfg, trick: Played[]): { suit: Suit; want: boolean } | null {
  if (!trick.length) return null;
  const f = trick[0];
  if (f.joker && isJoker(cfg, f.card)) return { suit: f.joker.suit ?? f.card.s, want: f.joker.mode === 'want' };
  return { suit: f.card.s, want: false };
}

/** Козырь этой взятки. */
export function trumpOf(s: Pick<State, 'cfg' | 'trump'>, trick: Played[]): Suit | null {
  if (!s.cfg.circular) return s.trump;
  const l = leadOf(s.cfg, trick);
  return l ? nextSuit(l.suit) : null;
}

export function legal(s: State, seat: number): Card[] {
  const hand = s.hands[seat];
  const lead = leadOf(s.cfg, s.trick);
  if (!lead) return hand;
  const jk = hand.filter((c) => isJoker(s.cfg, c));
  const plain = hand.filter((c) => !isJoker(s.cfg, c));
  const trump = trumpOf(s, s.trick);
  const pick = (suit: Suit, top: boolean) => {
    const same = plain.filter((c) => c.s === suit);
    if (!same.length) return null;
    if (!top) return same;
    const r = Math.max(...same.map((c) => c.r));
    return same.filter((c) => c.r === r);
  };
  const res = pick(lead.suit, lead.want) ?? (trump ? pick(trump, lead.want && lead.suit === trump) : null) ?? plain;
  return [...res, ...jk];
}

/** Какие объявления джокера возможны. */
export function jokerChoices(s: State): JokerPlay[] {
  if (s.trick.length) return [{ mode: 'high' }, { mode: 'low' }];
  const out: JokerPlay[] = [];
  for (const suit of SUITS) out.push({ mode: 'want', suit });
  for (const suit of SUITS) out.push({ mode: 'low', suit });
  return out;
}

export function trickWinner(s: Pick<State, 'cfg' | 'trump'>, trick: Played[]): number {
  const cfg = s.cfg;
  const trump = trumpOf(s, trick);
  const lead = leadOf(cfg, trick)!;
  const highs = trick.filter((t, i) => i > 0 && isJoker(cfg, t.card) && t.joker?.mode === 'high');
  if (highs.length) return highs[highs.length - 1].seat;
  const plain = trick.filter((t) => !isJoker(cfg, t.card));
  const f = trick[0];
  if (isJoker(cfg, f.card) && f.joker?.mode === 'want') {
    const tr = plain.filter((t) => t.card.s === trump);
    if (trump && lead.suit !== trump && tr.length) return tr.sort((a, b) => b.card.r - a.card.r)[0].seat;
    return f.seat;
  }
  // обычная взятка (заходной джокер «за младшую» — младшая карта своей масти)
  const pool = plain.slice();
  if (isJoker(cfg, f.card)) pool.unshift({ seat: f.seat, card: { s: lead.suit, r: 0 } });
  const tr = trump ? pool.filter((t) => t.card.s === trump) : [];
  const by = tr.length ? tr : pool.filter((t) => t.card.s === lead.suit);
  return by.sort((a, b) => b.card.r - a.card.r)[0].seat;
}

/** Очки игрока за сдачу. */
export function points(cfg: Cfg, kind: Kind, bid: number | null, took: number): number {
  if (kind === 'gold') return 20 * took;
  if (kind === 'misere') return -20 * took;
  const b = bid ?? 0;
  if (cfg.georgian) {
    const base = took === b ? b * 50 + 50 : took * 10;
    return kind === 'dark' || kind === 'nt' ? base * 2 : base;
  }
  const unit = kind === 'lob' ? 50 : 10;
  let base: number;
  if (took === b) base = b === 0 ? 5 : unit * b;
  else if (took > b) base = took;
  else base = -unit * (b - took);
  return kind === 'dark' || kind === 'nt' ? base * 2 : base;
}

function validJoker(s: State, j: JokerPlay | undefined): boolean {
  if (!j) return false;
  if (s.trick.length) return (j.mode === 'high' || j.mode === 'low') && !j.suit;
  return (j.mode === 'want' || j.mode === 'low') && !!j.suit && SUITS.includes(j.suit);
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.phase === 'over' || seat !== s0.turn || !a) return null;
  const ev: Event[] = [];
  if (s0.phase === 'bid') {
    if (a.type !== 'bid' || !bidOptions(s0, seat).includes(a.n)) return null;
    const s: State = { ...s0, bids: s0.bids.slice() };
    s.bids[seat] = a.n;
    ev.push({ type: 'bid', seat, n: a.n });
    s.turn = nextIn(s.seats, seat);
    if (seat === s.dealer) s.phase = 'play';
    return { state: s, events: ev };
  }
  if (a.type !== 'play' || !a.card || !legal(s0, seat).some((c) => sameCard(c, a.card))) return null;
  const jk = isJoker(s0.cfg, a.card);
  if (jk && !validJoker(s0, a.joker)) return null;
  const play: Played = { seat, card: { s: a.card.s, r: a.card.r } };
  if (jk) play.joker = a.joker!.suit ? { mode: a.joker!.mode as 'want' | 'low', suit: a.joker!.suit } : { mode: a.joker!.mode as 'high' | 'low' };
  const s: State = { ...s0, hands: s0.hands.slice(), trick: [...s0.trick, play], tricks: s0.tricks.slice(), score: s0.score.slice() };
  s.hands[seat] = s.hands[seat].filter((c) => !sameCard(c, a.card));
  ev.push({ type: 'play', seat, card: play.card, joker: play.joker });
  if (s.trick.length < s.seats.length) {
    s.turn = nextIn(s.seats, seat);
    return { state: s, events: ev };
  }
  const w = trickWinner(s, s.trick);
  s.tricks[w]++;
  s.trick = [];
  s.turn = w;
  ev.push({ type: 'trick', seat: w });
  if (s.hands[w].length) return { state: s, events: ev };
  const d = cur(s);
  const add = Array(6).fill(0);
  for (const p of s.seats) {
    add[p] = points(s.cfg, d.kind, s.bids[p], s.tricks[p]);
    s.score[p] += add[p];
  }
  s.last = add;
  s.rows = [...s.rows, { bids: s.bids.slice(), took: s.tricks.slice(), add: add.slice() }];
  ev.push({ type: 'round', add: add.slice(), score: s.score.slice() });
  if (s.deal + 1 >= s.plan.length) {
    s.phase = 'over';
    ev.push({ type: 'end', winners: winnersOf(s), score: s.score.slice() });
    return { state: s, events: ev };
  }
  s.deal++;
  s.dealer = nextIn(s.seats, s.dealer);
  dealOut(s, rng, ev);
  return { state: s, events: ev };
}

export function winnersOf(s: State): number[] {
  const top = Math.max(...s.seats.map((p) => s.score[p]));
  return s.seats.filter((p) => s.score[p] === top);
}

/** Не видно своих карт: тёмная до конца заказа, лобовая до конца заказа (зато видны чужие). */
export const blindNow = (s: State) => s.phase === 'bid' && (cur(s).kind === 'dark' || cur(s).kind === 'lob');

export function makeView(s: State, seats: number[] | 'all'): View {
  const v = s as Partial<View>;
  const blind = blindNow(s);
  const lob = blind && cur(s).kind === 'lob';
  const see = (x: number) => {
    if (seats === 'all') return true;
    if (lob) return seats.length > 1 || !seats.includes(x);
    return !blind && seats.includes(x);
  };
  return { ...s, hands: s.hands.map((h, i) => (see(i) ? h.slice() : [])), counts: s.hands.map((h, i) => v.counts?.[i] ?? h.length), blind };
}

export const countOf = (s: State, seat: number) => ((s as Partial<View>).counts ? (s as View).counts[seat] : s.hands[seat].length);
