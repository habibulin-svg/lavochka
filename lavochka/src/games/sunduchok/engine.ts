/* Сундучок — правила (без DOM). 2–6 игроков, колода 36 (или 52). На руки: вдвоём по 6, втроём по 5, больше — по 4; остальное — «базар».
 *
 * В свой ход просишь у любого соперника карты ранга, который у тебя уже есть: «Ленка, дай тузов!». Есть — отдаёт все, и ты просишь ещё.
 * Нет — «иди на базар»: тянешь карту; вытянул тот самый ранг — показываешь и ходишь дальше, иначе ход переходит.
 * Четыре карты ранга на руке — «сундучок»: выкладывается на стол, больше его не тронут.
 * Рука опустела — в свой ход берёшь с базара до четырёх карт. Все сундучки собраны — у кого больше, тот выиграл.
 * Варианты: просить ранг и масть («дай короля пик»); при неудаче ход переходит к тому, у кого просил.
 */
import type { Options, Rng } from '../../core/types';
import { makeDeck, sameCard, SUITS, type Card, type Suit } from '../../cards/deck';
import { shuffle } from '../../core/rng';

export interface Cfg {
  deck: 36 | 52;
  /** Просить конкретную карту (ранг и масть). */
  suit: boolean;
  /** «Иди на базар» — ход к тому, у кого просил. */
  toAsked: boolean;
}

export function cfgFrom(o: Options): Cfg {
  return { deck: Number(o.deck) === 52 ? 52 : 36, suit: !!o.suit, toAsked: !!o.toAsked };
}

export const ranksOf = (cfg: Cfg) => Array.from({ length: cfg.deck === 52 ? 13 : 9 }, (_, i) => (cfg.deck === 52 ? 2 : 6) + i);

export interface State {
  cfg: Cfg;
  seats: number[];
  hands: Card[][];
  bazaar: Card[];
  /** Сундучки каждого (ранги). */
  chests: number[][];
  turn: number;
  /** Что каждый точно держит — по открытым действиям (просил ранг — значит есть; отдал — уже нет). */
  known: number[][];
  /** Чего у каждого точно нет: сказал «иди на базар» и с тех пор ничего не брал. */
  lacks: number[][];
  /** Последняя просьба — для показа. */
  last: { seat: number; target: number; rank: number; suit?: Suit; got: number; fish: boolean; lucky: boolean } | null;
  over: boolean;
}

export interface View extends State {
  counts: number[];
  bazaarCount: number;
}

export type Action = { type: 'ask'; target: number; rank: number; suit?: Suit };

export type Event =
  | { type: 'ask'; seat: number; target: number; rank: number; suit?: Suit; cards: Card[] }
  | { type: 'fish'; seat: number; card?: Card; lucky: boolean }
  | { type: 'chest'; seat: number; rank: number }
  | { type: 'refill'; seat: number; n: number; cards?: Card[] }
  | { type: 'pass'; seat: number }
  | { type: 'end'; chests: number[] };

const nextIn = (list: number[], seat: number) => list[(list.indexOf(seat) + 1) % list.length];
const without = (hand: Card[], cs: Card[]) => hand.filter((c) => !cs.some((x) => sameCard(x, c)));
/** Чего нет: ранг, а в варианте с мастью — карта (ранг×10 + номер масти). */
export const lackKey = (r: number, suit?: Suit) => (suit ? r * 10 + SUITS.indexOf(suit) + 1 : r);
const addKnown = (k: number[], r: number) => (k.includes(r) ? k : [...k, r]);

export function newState(cfg: Cfg, seats: number[]): State {
  return { cfg, seats: seats.slice(), hands: [[], [], [], [], [], []], bazaar: [], chests: [[], [], [], [], [], []], turn: seats[0], known: [[], [], [], [], [], []], lacks: [[], [], [], [], [], []], last: null, over: false };
}

/** Четвёрки с руки — в сундучки. */
function layChests(s: State, seat: number, ev: Event[]) {
  for (const r of ranksOf(s.cfg)) {
    const same = s.hands[seat].filter((c) => c.r === r);
    if (same.length === 4) {
      s.hands[seat] = without(s.hands[seat], same);
      s.chests[seat] = [...s.chests[seat], r];
      s.known = s.known.map((k) => k.filter((x) => x !== r));
      ev.push({ type: 'chest', seat, rank: r });
    }
  }
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  const s = newState(cfgFrom(opts), seats);
  const deck = shuffle(makeDeck(s.cfg.deck), rng);
  const each = seats.length === 2 ? 6 : seats.length === 3 ? 5 : 4;
  for (const p of seats) s.hands[p] = deck.splice(0, each);
  s.bazaar = deck;
  for (const p of seats) layChests(s, p, []);
  s.turn = seats[rng.int(seats.length)];
  prepareTurn(s, []);
  return s;
}

const totalChests = (s: State) => s.chests.reduce((a, c) => a + c.length, 0);

/** Начало хода: пустая рука — добрать с базара до четырёх; нечем ходить — ход дальше. Возвращает false, если партия кончилась. */
function prepareTurn(s: State, ev: Event[]): boolean {
  for (let guard = 0; guard < s.seats.length + 1; guard++) {
    if (totalChests(s) === ranksOf(s.cfg).length || (!s.bazaar.length && s.seats.every((p) => !s.hands[p].length))) {
      s.over = true;
      ev.push({ type: 'end', chests: s.chests.map((c) => c.length) });
      return false;
    }
    const p = s.turn;
    if (!s.hands[p].length && s.bazaar.length) {
      const got = s.bazaar.slice(0, 4);
      s.bazaar = s.bazaar.slice(4);
      s.hands[p] = got;
      s.lacks = s.lacks.map((k, i) => (i === p ? [] : k));
      ev.push({ type: 'refill', seat: p, n: got.length, cards: got });
      layChests(s, p, ev);
      if (!s.hands[p].length) continue;
    }
    // просить можно, только если есть свои карты и есть у кого просить
    if (s.hands[p].length && s.seats.some((x) => x !== p && s.hands[x].length)) return true;
    if (s.hands[p].length && !s.seats.some((x) => x !== p && s.hands[x].length)) {
      // соперникам нечего отдавать — тянуть с базара, пока есть что
      if (!s.bazaar.length) {
        s.over = true;
        ev.push({ type: 'end', chests: s.chests.map((c) => c.length) });
        return false;
      }
      return true;
    }
    ev.push({ type: 'pass', seat: p });
    s.turn = nextIn(s.seats, p);
  }
  s.over = true;
  ev.push({ type: 'end', chests: s.chests.map((c) => c.length) });
  return false;
}

export const toAct = (s: State): number[] => (s.over ? [] : [s.turn]);

/** Можно ли сейчас попросить у target (у него есть карты; или просить не у кого, и тогда — любой соперник: сразу базар). */
export function canAsk(s: State, seat: number, target: number): boolean {
  if (target === seat || !s.seats.includes(target)) return false;
  const anyone = s.seats.some((x) => x !== seat && countIn(s, x) > 0);
  return countIn(s, target) > 0 || !anyone;
}

const countIn = (s: State, seat: number) => ((s as Partial<View>).counts ? (s as View).counts[seat] : s.hands[seat].length);

export function apply(s0: State, seat: number, a: Action, _rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn || !a || a.type !== 'ask') return null;
  const hand = s0.hands[seat];
  if (!hand.some((c) => c.r === a.rank)) return null;
  if (s0.cfg.suit) {
    if (!a.suit || !SUITS.includes(a.suit) || hand.some((c) => c.r === a.rank && c.s === a.suit)) return null;
  }
  if (!canAsk(s0, seat, a.target)) return null;
  const s: State = { ...s0, hands: s0.hands.slice(), chests: s0.chests.slice(), known: s0.known.slice(), lacks: s0.lacks.slice(), bazaar: s0.bazaar.slice() };
  const ev: Event[] = [];
  const t = a.target;
  const give = s.hands[t].filter((c) => c.r === a.rank && (!s.cfg.suit || c.s === a.suit));
  ev.push({ type: 'ask', seat, target: t, rank: a.rank, suit: s.cfg.suit ? a.suit : undefined, cards: give });
  s.known[seat] = addKnown(s.known[seat], a.rank);
  if (give.length) {
    s.hands[t] = without(s.hands[t], give);
    s.hands[seat] = [...s.hands[seat], ...give];
    s.lacks[seat] = [];
    if (!s.cfg.suit) s.lacks[t] = addKnown(s.lacks[t], a.rank);
    if (!s.hands[t].some((c) => c.r === a.rank)) s.known[t] = s.known[t].filter((x) => x !== a.rank);
    s.last = { seat, target: t, rank: a.rank, suit: a.suit, got: give.length, fish: false, lucky: false };
    layChests(s, seat, ev);
    // ход продолжается (если ещё есть чем)
    prepareTurn(s, ev);
    return { state: s, events: ev };
  }
  if (!s.cfg.suit) s.known[t] = s.known[t].filter((x) => x !== a.rank);
  s.lacks[t] = addKnown(s.lacks[t], lackKey(a.rank, s.cfg.suit ? a.suit : undefined));
  // на базар
  let lucky = false;
  if (s.bazaar.length) {
    const c = s.bazaar[0];
    s.bazaar = s.bazaar.slice(1);
    s.hands[seat] = [...s.hands[seat], c];
    s.lacks[seat] = [];
    lucky = c.r === a.rank && (!s.cfg.suit || c.s === a.suit);
    ev.push({ type: 'fish', seat, card: c, lucky });
    layChests(s, seat, ev);
  }
  s.last = { seat, target: t, rank: a.rank, suit: a.suit, got: 0, fish: true, lucky };
  if (!lucky) s.turn = s.cfg.toAsked ? t : nextIn(s.seats, seat);
  prepareTurn(s, ev);
  return { state: s, events: ev };
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const see = (x: number) => seats === 'all' || seats.includes(x);
  const v = s as Partial<View>;
  return {
    ...s,
    hands: s.hands.map((h, i) => (see(i) ? h.slice() : [])),
    bazaar: [],
    counts: s.hands.map((h, i) => v.counts?.[i] ?? h.length),
    bazaarCount: v.bazaarCount ?? s.bazaar.length,
  };
}

export const countOf = countIn;
export const bazaarLeft = (s: State) => (s as Partial<View>).bazaarCount ?? s.bazaar.length;
