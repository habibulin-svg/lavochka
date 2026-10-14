/* Козёл (карточный) — правила (без DOM). 4 игрока пара на пару: 0 и 2 против 1 и 3. Колода 36 по 9 (или 32 по 8).
 *
 * Старшие козыри всегда: вальты (В♣ > В♠ > В♥ > В♦), за ними дамы (Д♣ > Д♠ > Д♥ > Д♦), потом карты козырной масти: Т > 10 > К > 9 > 8 > 7 > 6.
 * Простые масти: Т > 10 > К > 9 … Вальты и дамы — не своей масти, а козыри. Козырь — масть последней карты сдатчика
 * (вариант — всегда трефы). В масть ходить обязательно; нет масти — обязан бить козырем; нет и козыря — сброс.
 * Очки: Т 11, 10 — 10, К 4, Д 3, В 2 (всего 120). Пара, набравшая 61, выиграла кон; проигравшим «рога»: 2, если у них 31–59,
 * 4 — если 30 и меньше, 6 — если без единой взятки. 60 на 60 — «яйца»: никому, следующий кон вдвойне. 12 очков — «козёл».
 */
import type { Options, Rng } from '../../core/types';
import { makeDeck, sameCard, type Card, type Suit } from '../../cards/deck';
import { shuffle } from '../../core/rng';

export interface Cfg {
  deck: 32 | 36;
  /** Козырь: масть последней карты сдатчика или всегда трефы. */
  trump: 'last' | 'clubs';
  /** Нет масти — обязан бить козырем. */
  force: boolean;
  limit: number;
}

export function cfgFrom(o: Options): Cfg {
  return { deck: Number(o.deck) === 32 ? 32 : 36, trump: o.trump === 'clubs' ? 'clubs' : 'last', force: o.force !== false, limit: [6, 12, 24].includes(Number(o.limit)) ? Number(o.limit) : 12 };
}

export const POINTS: Record<number, number> = { 14: 11, 10: 10, 13: 4, 12: 3, 11: 2, 9: 0, 8: 0, 7: 0, 6: 0 };
const SUPER: Suit[] = ['C', 'S', 'H', 'D'];
/** Порядок простых карт: Т > 10 > К > 9 > 8 > 7 > 6. */
const PLAIN: Record<number, number> = { 14: 7, 10: 6, 13: 5, 9: 4, 8: 3, 7: 2, 6: 1 };

export const isTrump = (c: Card, trump: Suit) => c.r === 11 || c.r === 12 || c.s === trump;
/** «Масть» карты в игре: козырь — 'T'. */
export const suitOf = (c: Card, trump: Suit): Suit | 'T' => (isTrump(c, trump) ? 'T' : c.s);
/** Сила карты (больше — старше). Козыри выше всех простых. */
export function power(c: Card, trump: Suit): number {
  if (c.r === 11) return 300 - SUPER.indexOf(c.s);
  if (c.r === 12) return 200 - SUPER.indexOf(c.s);
  if (c.s === trump) return 100 + PLAIN[c.r];
  return PLAIN[c.r];
}

export const team = (seat: number) => seat % 2;

export interface State {
  cfg: Cfg;
  seats: number[];
  hands: Card[][];
  trump: Suit;
  /** Последняя карта сдатчика (открыта всем). */
  trumpCard: Card;
  dealer: number;
  round: number;
  trick: { seat: number; card: Card }[];
  turn: number;
  /** Очки и взятки пар в этом коне. */
  pts: [number, number];
  tricksT: [number, number];
  tricks: number[];
  /** «Рога» пар за партию. */
  horns: [number, number];
  /** Множитель за «яйца». */
  eggs: number;
  last: { pts: [number, number]; add: [number, number] } | null;
  over: boolean;
}

export interface View extends State {
  counts: number[];
}

export type Action = { type: 'play'; card: Card };

export type Event =
  | { type: 'deal'; round: number; dealer: number; trump: Suit; trumpCard: Card; hands?: Card[][] }
  | { type: 'play'; seat: number; card: Card }
  | { type: 'trick'; seat: number; cards: Card[]; pts: number }
  | { type: 'round'; pts: [number, number]; add: [number, number]; horns: [number, number]; eggs: boolean }
  | { type: 'end'; loser: number; horns: [number, number] };

const nextIn = (list: number[], seat: number) => list[(list.indexOf(seat) + 1) % list.length];

export function newState(cfg: Cfg, seats: number[]): State {
  return {
    cfg,
    seats: seats.slice(),
    hands: [[], [], [], []],
    trump: 'C',
    trumpCard: { s: 'C', r: 6 },
    dealer: seats[3],
    round: 0,
    trick: [],
    turn: seats[0],
    pts: [0, 0],
    tricksT: [0, 0],
    tricks: [0, 0, 0, 0],
    horns: [0, 0],
    eggs: 1,
    last: null,
    over: false,
  };
}

function deal(s: State, rng: Rng, ev: Event[]) {
  s.round++;
  s.dealer = s.round === 1 ? s.seats[3] : nextIn(s.seats, s.dealer);
  const deck = shuffle(makeDeck(s.cfg.deck), rng);
  // сдают начиная с соседа сдатчика — последняя карта колоды достаётся сдатчику
  const hands: Card[][] = [[], [], [], []];
  let p = nextIn(s.seats, s.dealer);
  for (let i = 0; i < deck.length; i++) {
    hands[p].push(deck[i]);
    p = nextIn(s.seats, p);
  }
  s.hands = hands;
  s.trumpCard = deck[deck.length - 1];
  s.trump = s.cfg.trump === 'clubs' ? 'C' : s.trumpCard.s;
  s.trick = [];
  s.pts = [0, 0];
  s.tricksT = [0, 0];
  s.tricks = [0, 0, 0, 0];
  s.turn = nextIn(s.seats, s.dealer);
  ev.push({ type: 'deal', round: s.round, dealer: s.dealer, trump: s.trump, trumpCard: s.trumpCard, hands: s.hands.map((h) => h.slice()) });
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  const s = newState(cfgFrom(opts), seats);
  deal(s, rng, []);
  return s;
}

export const toAct = (s: State): number[] => (s.over ? [] : [s.turn]);

export function legal(s: State, seat: number): Card[] {
  const hand = s.hands[seat];
  if (!s.trick.length) return hand;
  const lead = suitOf(s.trick[0].card, s.trump);
  const follow = hand.filter((c) => suitOf(c, s.trump) === lead);
  if (follow.length) return follow;
  if (s.cfg.force) {
    const tr = hand.filter((c) => isTrump(c, s.trump));
    if (tr.length) return tr;
  }
  return hand;
}

export function trickWinner(trick: { seat: number; card: Card }[], trump: Suit): number {
  const lead = suitOf(trick[0].card, trump);
  const pool = trick.filter((t) => isTrump(t.card, trump)).length ? trick.filter((t) => isTrump(t.card, trump)) : trick.filter((t) => suitOf(t.card, trump) === lead);
  return pool.sort((a, b) => power(b.card, trump) - power(a.card, trump))[0].seat;
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn || !a || a.type !== 'play' || !a.card || !legal(s0, seat).some((c) => sameCard(c, a.card))) return null;
  const s: State = { ...s0, hands: s0.hands.slice(), trick: [...s0.trick, { seat, card: { s: a.card.s, r: a.card.r } }], pts: [...s0.pts] as [number, number], tricksT: [...s0.tricksT] as [number, number], tricks: s0.tricks.slice(), horns: [...s0.horns] as [number, number] };
  const ev: Event[] = [];
  s.hands[seat] = s.hands[seat].filter((c) => !sameCard(c, a.card));
  ev.push({ type: 'play', seat, card: a.card });
  if (s.trick.length < 4) {
    s.turn = nextIn(s.seats, seat);
    return { state: s, events: ev };
  }
  const w = trickWinner(s.trick, s.trump);
  const cards = s.trick.map((t) => t.card);
  const pts = cards.reduce((x, c) => x + POINTS[c.r], 0);
  s.pts[team(w)] += pts;
  s.tricksT[team(w)]++;
  s.tricks[w]++;
  s.trick = [];
  s.turn = w;
  ev.push({ type: 'trick', seat: w, cards, pts });
  if (s.hands[w].length) return { state: s, events: ev };
  endRound(s, rng, ev);
  return { state: s, events: ev };
}

function endRound(s: State, rng: Rng, ev: Event[]) {
  const add: [number, number] = [0, 0];
  const eggs = s.pts[0] === s.pts[1];
  if (!eggs) {
    const win = s.pts[0] > s.pts[1] ? 0 : 1;
    const lose = 1 - win;
    const base = s.tricksT[lose] === 0 ? 6 : s.pts[lose] <= 30 ? 4 : 2;
    add[lose] = base * s.eggs;
    s.horns[lose] += add[lose];
    s.eggs = 1;
  } else s.eggs *= 2;
  s.last = { pts: [...s.pts] as [number, number], add };
  ev.push({ type: 'round', pts: [...s.pts] as [number, number], add, horns: [...s.horns] as [number, number], eggs });
  const loser = s.horns[0] >= s.cfg.limit ? 0 : s.horns[1] >= s.cfg.limit ? 1 : -1;
  if (loser >= 0) {
    s.over = true;
    ev.push({ type: 'end', loser, horns: [...s.horns] as [number, number] });
    return;
  }
  deal(s, rng, ev);
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const see = (x: number) => seats === 'all' || seats.includes(x);
  const v = s as Partial<View>;
  return { ...s, hands: s.hands.map((h, i) => (see(i) ? h.slice() : [])), counts: s.hands.map((h, i) => v.counts?.[i] ?? h.length) };
}

export const countOf = (s: State, seat: number) => ((s as Partial<View>).counts ? (s as View).counts[seat] : s.hands[seat].length);
