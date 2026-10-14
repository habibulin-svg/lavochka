/* Верю — не верю — правила (без DOM). 2–6 игроков, колода 36 (или 52) раздаётся вся; остаток (не делится) — в отбой втёмную.
 *
 * Заход: 1–4 карты рубашкой вверх и заявка ранга («две восьмёрки») — правда или блеф. Следующий выбирает:
 *  • «Верю» — докладывает 1–4 карты под тот же ранг (тоже можно соврать), право проверки уходит дальше;
 *  • «Не верю» — открываются карты предыдущего: есть хоть одна не того ранга — он забирает всю стопку, все честные —
 *    забирает проверявший. Заходит тот, кто оказался прав.
 * Стопка растёт, пока кто-нибудь не скажет «Не верю».
 * Четыре карты одного ранга на руке сразу уходят в открытый отбой. Избавился от карт (и его последние карты не поймали) — вышел.
 * Последний с картами — проиграл.
 * Варианты: проверка одной карты наугад; без подкладывания («верю» — стопка сразу в отбой, поверивший заходит).
 */
import type { Options, Rng } from '../../core/types';
import { makeDeck, sameCard, type Card } from '../../cards/deck';
import { shuffle } from '../../core/rng';

export interface Cfg {
  deck: 36 | 52;
  /** Проверяют одну карту наугад, а не все. */
  one: boolean;
  /** Подкладывать нельзя: «верю» — стопка в отбой. */
  noAdd: boolean;
  /** Четвёрки с руки — в отбой. */
  quads: boolean;
}

export function cfgFrom(o: Options): Cfg {
  return { deck: Number(o.deck) === 52 ? 52 : 36, one: !!o.one, noAdd: !!o.noAdd, quads: o.quads !== false };
}

export const ranksOf = (cfg: Cfg) => Array.from({ length: cfg.deck === 52 ? 13 : 9 }, (_, i) => (cfg.deck === 52 ? 2 : 6) + i);

export interface Play {
  seat: number;
  n: number;
}

export interface State {
  cfg: Cfg;
  seats: number[];
  hands: Card[][];
  /** Стопка на столе (все карты рубашкой). */
  pile: Card[];
  /** Кто сколько положил в эту стопку, по порядку. */
  plays: Play[];
  /** Заявленный ранг стопки (null — стопки нет, ход — заход). */
  rank: number | null;
  /** Последние положенные карты — их и проверяют. */
  last: { seat: number; cards: Card[] } | null;
  turn: number;
  /** Вышедшие по порядку (первый — лучший). */
  done: number[];
  /** Сколько карт в закрытом отбое (сыгранные стопки и остаток раздачи). */
  discard: number;
  /** Ранги, сброшенные четвёрками с рук (открыто). */
  quads: number[];
  /** Чем кончилась последняя проверка — для показа. */
  reveal: { checker: number; liar: boolean; seat: number; cards: Card[]; taker: number } | null;
  loser: number | null;
}

export interface View extends State {
  counts: number[];
  pileCount: number;
}

export type Action =
  | { type: 'lead'; cards: Card[]; rank: number }
  | { type: 'add'; cards: Card[] }
  | { type: 'believe' }
  | { type: 'check'; index?: number };

export type Event =
  | { type: 'deal'; counts: number[]; discard: number }
  | { type: 'lead'; seat: number; n: number; rank: number; cards?: Card[] }
  | { type: 'add'; seat: number; n: number; rank: number; cards?: Card[] }
  | { type: 'believe'; seat: number }
  | { type: 'check'; seat: number; of: number; cards: Card[]; shown: Card[]; liar: boolean; taker: number; count: number }
  | { type: 'bin'; count: number; next: number }
  | { type: 'quad'; seat: number; rank: number }
  | { type: 'done'; seat: number; place: number }
  | { type: 'end'; loser: number };

const nextIn = (list: number[], seat: number) => list[(list.indexOf(seat) + 1) % list.length];
const has = (hand: Card[], c: Card) => hand.some((x) => sameCard(x, c));
const hasAll = (hand: Card[], cs: Card[]) => cs.every((c) => has(hand, c)) && new Set(cs.map((c) => c.s + c.r)).size === cs.length;
const without = (hand: Card[], cs: Card[]) => hand.filter((c) => !cs.some((x) => sameCard(x, c)));

/** Кто ещё в игре: есть карты или его последние карты лежат непроверенными. */
export const inGame = (s: State) => s.seats.filter((p) => !s.done.includes(p));

export function newState(cfg: Cfg, seats: number[]): State {
  return { cfg, seats: seats.slice(), hands: [[], [], [], [], [], []], pile: [], plays: [], rank: null, last: null, turn: seats[0], done: [], discard: 0, quads: [], reveal: null, loser: null };
}

/** Четвёрки с руки — в отбой. */
function dropQuads(s: State, seat: number, ev: Event[]) {
  if (!s.cfg.quads) return;
  for (const r of ranksOf(s.cfg)) {
    const same = s.hands[seat].filter((c) => c.r === r);
    if (same.length === 4) {
      s.hands[seat] = without(s.hands[seat], same);
      s.quads = [...s.quads, r];
      s.discard += 4;
      ev.push({ type: 'quad', seat, rank: r });
    }
  }
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  const s = newState(cfgFrom(opts), seats);
  const deck = shuffle(makeDeck(s.cfg.deck), rng);
  const each = Math.floor(deck.length / seats.length);
  seats.forEach((p, i) => (s.hands[p] = deck.slice(i * each, (i + 1) * each)));
  s.discard = deck.length - each * seats.length;
  s.turn = seats[rng.int(seats.length)];
  for (const p of seats) dropQuads(s, p, []);
  // четвёрки на раздаче могли опустошить руку — такого почти не бывает, но пусть заходит тот, у кого есть карты
  while (!s.hands[s.turn].length) s.turn = nextIn(seats, s.turn);
  return s;
}

export const toAct = (s: State): number[] => (s.loser != null ? [] : [s.turn]);

/** Следующий после seat, кто ещё в игре и с картами. */
function nextActive(s: State, seat: number): number {
  let p = seat;
  for (let i = 0; i < s.seats.length; i++) {
    p = nextIn(s.seats, p);
    if (!s.done.includes(p) && s.hands[p].length) return p;
  }
  return seat;
}

/** Проверить, не вышел ли кто (пустая рука, и его карты на столе уже не под вопросом), и не конец ли партии. */
function settle(s: State, ev: Event[], keep: number | null) {
  for (const p of s.seats)
    if (!s.done.includes(p) && !s.hands[p].length && p !== keep) {
      s.done = [...s.done, p];
      ev.push({ type: 'done', seat: p, place: s.done.length });
    }
  const left = inGame(s);
  if (left.length <= 1) {
    s.loser = left[0] ?? s.done[s.done.length - 1];
    ev.push({ type: 'end', loser: s.loser });
    return true;
  }
  return false;
}

/** Стопка уходит в отбой, заходит lead. */
function binPile(s: State, lead: number, ev: Event[]) {
  ev.push({ type: 'bin', count: s.pile.length, next: lead });
  s.discard += s.pile.length;
  s.pile = [];
  s.plays = [];
  s.rank = null;
  s.last = null;
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.loser != null || seat !== s0.turn || !a || typeof a !== 'object') return null;
  const s: State = { ...s0, hands: s0.hands.slice(), done: s0.done.slice(), reveal: null };
  const ev: Event[] = [];
  const hand = s.hands[seat];
  const cardsOk = (cs: unknown): cs is Card[] => Array.isArray(cs) && cs.length >= 1 && cs.length <= 4 && hasAll(hand, cs as Card[]);

  if (a.type === 'lead') {
    if (s.rank != null || !cardsOk(a.cards) || !ranksOf(s.cfg).includes(a.rank)) return null;
    s.hands[seat] = without(hand, a.cards);
    s.pile = [...a.cards];
    s.plays = [{ seat, n: a.cards.length }];
    s.rank = a.rank;
    s.last = { seat, cards: a.cards.slice() };
    ev.push({ type: 'lead', seat, n: a.cards.length, rank: a.rank, cards: a.cards.slice() });
    s.turn = nextActive(s, seat);
    return { state: s, events: ev };
  }
  if (s.rank == null || !s.last) return null;
  const prev = s.last.seat;

  if (a.type === 'check') {
    const cards = s.last.cards;
    let shown = cards;
    if (s.cfg.one) {
      const i = typeof a.index === 'number' && a.index >= 0 && a.index < cards.length ? Math.floor(a.index) : rng.int(cards.length);
      shown = [cards[i]];
    }
    const liar = shown.some((c) => c.r !== s.rank);
    const taker = liar ? prev : seat;
    const right = liar ? seat : prev;
    const count = s.pile.length;
    s.hands[taker] = [...s.hands[taker], ...s.pile];
    ev.push({ type: 'check', seat, of: prev, cards: cards.slice(), shown: shown.slice(), liar, taker, count });
    s.reveal = { checker: seat, liar, seat: prev, cards: cards.slice(), taker };
    s.pile = [];
    s.plays = [];
    s.rank = null;
    s.last = null;
    dropQuads(s, taker, ev);
    if (settle(s, ev, null)) return { state: s, events: ev };
    s.turn = s.hands[right].length && !s.done.includes(right) ? right : nextActive(s, right);
    return { state: s, events: ev };
  }

  if (a.type === 'believe') {
    // без подкладывания: поверил — стопка в отбой, поверивший заходит
    if (!s.cfg.noAdd) return null;
    ev.push({ type: 'believe', seat });
    binPile(s, seat, ev);
    if (settle(s, ev, null)) return { state: s, events: ev };
    s.turn = seat;
    return { state: s, events: ev };
  }

  if (a.type === 'add') {
    if (s.cfg.noAdd || !cardsOk(a.cards)) return null;
    s.hands[seat] = without(hand, a.cards);
    s.pile = [...s.pile, ...a.cards];
    s.plays = [...s.plays, { seat, n: a.cards.length }];
    s.last = { seat, cards: a.cards.slice() };
    ev.push({ type: 'add', seat, n: a.cards.length, rank: s.rank, cards: a.cards.slice() });
    // предыдущему поверили — если его рука пуста, он вышел
    if (settle(s, ev, seat)) return { state: s, events: ev };
    const next = nextActive(s, seat);
    s.turn = next;
    // некому отвечать (все остальные вышли) — стопка в отбой
    if (next === seat) {
      binPile(s, seat, ev);
      if (settle(s, ev, null)) return { state: s, events: ev };
    }
    return { state: s, events: ev };
  }
  return null;
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const see = (x: number) => seats === 'all' || seats.includes(x);
  const v = s as Partial<View>;
  return {
    ...s,
    hands: s.hands.map((h, i) => (see(i) ? h.slice() : [])),
    pile: [],
    // свои положенные карты видно себе
    last: s.last ? { seat: s.last.seat, cards: see(s.last.seat) ? s.last.cards.slice() : [] } : null,
    counts: s.hands.map((h, i) => v.counts?.[i] ?? h.length),
    pileCount: v.pileCount ?? s.pile.length,
  };
}

export const countOf = (s: State, seat: number) => ((s as Partial<View>).counts ? (s as View).counts[seat] : s.hands[seat].length);
export const pileOf = (s: State) => (s as Partial<View>).pileCount ?? s.pile.length;
/** Сколько всего заявлено в стопке. */
export const claimed = (s: State) => s.plays.reduce((a, p) => a + p.n, 0);
