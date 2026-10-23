/* Криббедж — правила (без DOM). 52 карты; вдвоём (по 6 карт), втроём (по 5 и одна из колоды в криб), вчетвером пара на пару (по 5).
 *
 * Сдача: каждый сбрасывает в «криб» (лишнюю руку сдатчика) две карты (втроём и вчетвером — одну). Сосед сдатчика снимает колоду,
 * верхнюю карту открывают — «стартер»; если это валет, сдатчику 2 очка («за пятки»).
 * Розыгрыш: по кругу, начиная с соседа сдатчика, кладут по карте и называют сумму (туз 1, картинки 10), не больше 31.
 * Очки: сумма 15 — 2, ровно 31 — 2; пара с предыдущей картой — 2, тройка — 6, четвёрка — 12; последние 3+ карты образуют
 * последовательность (в любом порядке) — по очку за карту. Нечем ходить — «пас» (go); когда не может никто, последний положивший
 * получает 1 (за 31 — уже получил 2), счёт сбрасывается, и ходит следующий за ним. Последняя карта розыгрыша — 1.
 * Показ (по порядку: сосед сдатчика … сдатчик, потом криб сдатчика), каждая рука вместе со стартером: каждая комбинация на 15 — 2,
 * пара — 2, последовательность — по очку за карту (каждая отдельно), масть: 4 карты руки — 4, со стартером — 5 (криб — только 5),
 * валет в масть стартера — 1 («за нос»). Партия — до 121 (или 61); кто дошёл, тот выиграл сразу, даже посреди сдачи.
 */
import type { Options, Rng } from '../../core/types';
import { makeDeck, sameCard, type Card } from '../../cards/deck';
import { shuffle } from '../../core/rng';

export interface Cfg {
  target: 61 | 121;
}

export function cfgFrom(o: Options): Cfg {
  return { target: Number(o.target) === 61 ? 61 : 121 };
}

/** Ранг для последовательностей: туз 1 … король 13. */
export const rank = (c: Card) => (c.r === 14 ? 1 : c.r);
/** Значение для счёта: туз 1, картинки 10. */
export const pip = (c: Card) => Math.min(10, rank(c));

export interface Item {
  what: string;
  pts: number;
  cards: Card[];
}

/** Подсчёт руки со стартером. */
export function scoreHand(hand: Card[], starter: Card | null, crib = false): Item[] {
  const all = starter ? [...hand, starter] : hand.slice();
  const out: Item[] = [];
  const n = all.length;
  // пятнадцать
  for (let m = 1; m < 1 << n; m++) {
    let sum = 0;
    const set: Card[] = [];
    for (let i = 0; i < n; i++) if (m & (1 << i)) (sum += pip(all[i])), set.push(all[i]);
    if (sum === 15) out.push({ what: 'пятнадцать', pts: 2, cards: set });
  }
  // пары
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (rank(all[i]) === rank(all[j])) out.push({ what: 'пара', pts: 2, cards: [all[i], all[j]] });
  // последовательности: самые длинные, каждая отдельно
  for (let len = n; len >= 3; len--) {
    const runs: Card[][] = [];
    for (let m = 1; m < 1 << n; m++) {
      if (popcount(m) !== len) continue;
      const set = all.filter((_, i) => m & (1 << i));
      const rs = set.map(rank).sort((a, b) => a - b);
      if (rs.every((r, i) => i === 0 || r === rs[i - 1] + 1)) runs.push(set);
    }
    if (runs.length) {
      for (const r of runs) out.push({ what: `последовательность из ${len}`, pts: len, cards: r });
      break;
    }
  }
  // масть
  if (hand.length >= 4) {
    const s = hand[0].s;
    if (hand.every((c) => c.s === s)) {
      if (starter && starter.s === s) out.push({ what: 'масть из 5', pts: 5, cards: all });
      else if (!crib) out.push({ what: 'масть из 4', pts: 4, cards: hand.slice() });
    }
  }
  // валет «за нос»
  if (starter) for (const c of hand) if (c.r === 11 && c.s === starter.s) out.push({ what: 'валет в масть стартера', pts: 1, cards: [c] });
  return out;
}

function popcount(m: number) {
  let k = 0;
  for (; m; m &= m - 1) k++;
  return k;
}

export const sumItems = (items: Item[]) => items.reduce((x, i) => x + i.pts, 0);

/** Очки за только что положенную карту в розыгрыше (pile — текущий отрезок до 31, уже с этой картой). */
export function pegScore(pile: Card[], count: number): Item[] {
  const out: Item[] = [];
  const last = pile[pile.length - 1];
  if (count === 15) out.push({ what: 'пятнадцать', pts: 2, cards: pile.slice() });
  if (count === 31) out.push({ what: 'тридцать один', pts: 2, cards: pile.slice() });
  let same = 1;
  for (let i = pile.length - 2; i >= 0 && rank(pile[i]) === rank(last); i--) same++;
  if (same >= 2) out.push({ what: same === 2 ? 'пара' : same === 3 ? 'тройка' : 'четвёрка', pts: same === 2 ? 2 : same === 3 ? 6 : 12, cards: pile.slice(-same) });
  for (let len = pile.length; len >= 3; len--) {
    const rs = pile.slice(-len).map(rank).sort((a, b) => a - b);
    if (rs.every((r, i) => i === 0 || r === rs[i - 1] + 1)) {
      out.push({ what: `последовательность из ${len}`, pts: len, cards: pile.slice(-len) });
      break;
    }
  }
  return out;
}

export type Phase = 'discard' | 'peg' | 'over';

export interface State {
  cfg: Cfg;
  seats: number[];
  dealer: number;
  deck: Card[];
  hands: Card[][];
  /** Карты, ещё не сыгранные в розыгрыше (по местам). */
  left: Card[][];
  /** Сброшено в криб (по местам: кто уже сбросил). */
  discards: (Card[] | null)[];
  crib: Card[];
  starter: Card | null;
  phase: Phase;
  turn: number | null;
  /** Розыгрыш: текущий отрезок до 31 и его сумма, все сыгранные карты по порядку. */
  pile: { seat: number; card: Card }[];
  count: number;
  played: { seat: number; card: Card }[];
  /** Сказали «пас» в этом отрезке. */
  gone: number[];
  lastPlayer: number | null;
  /** Очки сторон (по местам; в паре — одинаковые у напарников). Задний колышек — прежний счёт. */
  score: number[];
  back: number[];
  deal: number;
  over: boolean;
  winners: number[];
}

export interface View extends Omit<State, 'deck' | 'hands' | 'left'> {
  hands: Card[][];
  left: Card[][];
  counts: number[];
  deckLeft: number;
}

export type Action = { type: 'discard'; cards: Card[] } | { type: 'play'; card: Card };

export type Event =
  | { type: 'deal'; deal: number; dealer: number; hands?: Card[][] }
  | { type: 'discard'; seat: number; n: number; cards?: Card[] }
  | { type: 'starter'; card: Card; heels: boolean }
  | { type: 'play'; seat: number; card: Card; count: number; items: Item[] }
  | { type: 'go'; seat: number }
  | { type: 'goPoint'; seat: number; pts: number; last: boolean }
  | { type: 'reset' }
  | { type: 'show'; seat: number; crib: boolean; cards: Card[]; items: Item[] }
  | { type: 'score'; seat: number; pts: number; score: number[] }
  | { type: 'end'; winners: number[]; score: number[] };

const nextIn = (list: number[], seat: number) => list[(list.indexOf(seat) + 1) % list.length];
export const pairs = (s: { seats: number[] }) => s.seats.length === 4;
export const mates = (s: { seats: number[] }, seat: number) => (pairs(s) ? s.seats.filter((x) => s.seats.indexOf(x) % 2 === s.seats.indexOf(seat) % 2) : [seat]);
/** Сколько карт сбрасывает каждый. */
export const discardN = (s: { seats: number[] }) => (s.seats.length === 2 ? 2 : 1);
const handN = (n: number) => (n === 2 ? 6 : 5);

export function newState(cfg: Cfg, seats: number[]): State {
  const z = () => seats.reduce((a, x) => ((a[x] = 0), a), [] as number[]);
  const e = () => seats.reduce((a, x) => ((a[x] = []), a), [] as Card[][]);
  return {
    cfg,
    seats: seats.slice(),
    dealer: seats[seats.length - 1],
    deck: [],
    hands: e(),
    left: e(),
    discards: seats.reduce((a, x) => ((a[x] = null), a), [] as (Card[] | null)[]),
    crib: [],
    starter: null,
    phase: 'discard',
    turn: null,
    pile: [],
    count: 0,
    played: [],
    gone: [],
    lastPlayer: null,
    score: z(),
    back: z(),
    deal: 0,
    over: false,
    winners: [],
  };
}

function dealHand(s: State, rng: Rng, ev: Event[]) {
  s.deal++;
  if (s.deal > 1) s.dealer = nextIn(s.seats, s.dealer);
  s.deck = shuffle(makeDeck(52), rng);
  const n = handN(s.seats.length);
  for (const x of s.seats) {
    s.hands[x] = s.deck.splice(0, n);
    s.left[x] = [];
    s.discards[x] = null;
  }
  s.crib = s.seats.length === 3 ? [s.deck.shift()!] : [];
  s.starter = null;
  s.pile = [];
  s.count = 0;
  s.played = [];
  s.gone = [];
  s.lastPlayer = null;
  s.phase = 'discard';
  s.turn = null;
  ev.push({ type: 'deal', deal: s.deal, dealer: s.dealer, hands: s.hands.map((h) => (h ? h.slice() : h)) });
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  const s = newState(cfgFrom(opts), seats);
  // первый сдатчик — по жребию
  s.dealer = s.seats[rng.int(s.seats.length)];
  dealHand(s, rng, []);
  return s;
}

/** Сбрасывать — все сразу, в любом порядке (кто ещё не сбросил). */
export const toAct = (s: State): number[] => (s.over ? [] : s.phase === 'discard' ? s.seats.filter((x) => !s.discards[x]) : s.turn != null ? [s.turn] : []);

/** Можно ли положить карту в розыгрыше. */
export const canPlay = (s: State | View, seat: number, c: Card) => s.phase === 'peg' && s.turn === seat && s.count + pip(c) <= 31 && s.left[seat].some((x) => sameCard(x, c));

function add(s: State, seat: number, pts: number, ev: Event[]): boolean {
  if (!pts || s.over) return s.over;
  for (const x of mates(s, seat)) {
    s.back[x] = s.score[x];
    s.score[x] = Math.min(s.cfg.target, s.score[x] + pts);
  }
  ev.push({ type: 'score', seat, pts, score: s.score.slice() });
  if (s.score[seat] >= s.cfg.target) {
    s.over = true;
    s.phase = 'over';
    s.turn = null;
    s.winners = mates(s, seat);
    ev.push({ type: 'end', winners: s.winners, score: s.score.slice() });
    return true;
  }
  return false;
}

function cloneState(s0: State): State {
  return {
    ...s0,
    deck: s0.deck.slice(),
    hands: s0.hands.map((h) => (h ? h.slice() : h)),
    left: s0.left.map((h) => (h ? h.slice() : h)),
    discards: s0.discards.map((d) => (d ? d.slice() : d)),
    crib: s0.crib.slice(),
    pile: s0.pile.slice(),
    played: s0.played.slice(),
    gone: s0.gone.slice(),
    score: s0.score.slice(),
    back: s0.back.slice(),
  };
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over || !a || !toAct(s0).includes(seat)) return null;
  const s = cloneState(s0);
  const ev: Event[] = [];
  if (a.type === 'discard') {
    if (s.phase !== 'discard' || !Array.isArray(a.cards) || a.cards.length !== discardN(s)) return null;
    const cs = a.cards.map((c) => s.hands[seat].find((x) => sameCard(x, c)));
    if (cs.some((c) => !c) || (cs.length === 2 && sameCard(cs[0]!, cs[1]!))) return null;
    s.discards[seat] = cs as Card[];
    s.hands[seat] = s.hands[seat].filter((x) => !cs.some((c) => sameCard(c!, x)));
    ev.push({ type: 'discard', seat, n: cs.length, cards: cs as Card[] });
    if (s.seats.every((x) => s.discards[x])) startPegging(s, ev);
    return { state: s, events: ev };
  }
  if (a.type !== 'play' || !canPlay(s, seat, a.card)) return null;
  const card = s.left[seat].find((x) => sameCard(x, a.card))!;
  s.left[seat] = s.left[seat].filter((x) => !sameCard(x, card));
  s.pile.push({ seat, card });
  s.played.push({ seat, card });
  s.count += pip(card);
  s.lastPlayer = seat;
  const items = pegScore(
    s.pile.map((p) => p.card),
    s.count
  );
  ev.push({ type: 'play', seat, card, count: s.count, items });
  if (add(s, seat, sumItems(items), ev)) return { state: s, events: ev };
  advance(s, rng, ev);
  return { state: s, events: ev };
}

function startPegging(s: State, ev: Event[]) {
  for (const x of s.seats) s.crib.push(...s.discards[x]!);
  s.starter = s.deck.shift()!;
  const heels = s.starter.r === 11;
  ev.push({ type: 'starter', card: s.starter, heels });
  for (const x of s.seats) s.left[x] = s.hands[x].slice();
  s.phase = 'peg';
  s.turn = nextIn(s.seats, s.dealer);
  if (heels && add(s, s.dealer, 2, ev)) return;
  // первый может и не мочь — такого не бывает при пустом счёте
}

/** После хода: следующий, кто может; «пасы»; сброс счёта; конец розыгрыша — показ. */
function advance(s: State, rng: Rng, ev: Event[]) {
  if (s.count === 31) {
    resetCount(s, ev);
    if (allPlayed(s)) return show(s, rng, ev);
    s.turn = firstWithCards(s, nextIn(s.seats, s.lastPlayer!));
    return;
  }
  let p = nextIn(s.seats, s.lastPlayer!);
  for (let k = 0; k < s.seats.length; k++, p = nextIn(s.seats, p)) {
    if (s.left[p].some((c) => s.count + pip(c) <= 31)) {
      s.turn = p;
      return;
    }
    if (s.left[p].length && !s.gone.includes(p)) {
      s.gone.push(p);
      ev.push({ type: 'go', seat: p });
    }
  }
  // никто не может: очко последнему положившему
  const last = allPlayed(s);
  ev.push({ type: 'goPoint', seat: s.lastPlayer!, pts: 1, last });
  if (add(s, s.lastPlayer!, 1, ev)) return;
  resetCount(s, ev);
  if (last) return show(s, rng, ev);
  s.turn = firstWithCards(s, nextIn(s.seats, s.lastPlayer!));
}

const allPlayed = (s: State) => s.seats.every((x) => !s.left[x].length);
function firstWithCards(s: State, from: number) {
  let p = from;
  for (let k = 0; k < s.seats.length; k++, p = nextIn(s.seats, p)) if (s.left[p].length) return p;
  return from;
}
function resetCount(s: State, ev: Event[]) {
  s.pile = [];
  s.count = 0;
  s.gone = [];
  ev.push({ type: 'reset' });
}

function show(s: State, rng: Rng, ev: Event[]) {
  s.turn = null;
  let p = nextIn(s.seats, s.dealer);
  for (let k = 0; k < s.seats.length; k++, p = nextIn(s.seats, p)) {
    const items = scoreHand(s.hands[p], s.starter);
    ev.push({ type: 'show', seat: p, crib: false, cards: s.hands[p].slice(), items });
    if (add(s, p, sumItems(items), ev)) return;
  }
  const items = scoreHand(s.crib, s.starter, true);
  ev.push({ type: 'show', seat: s.dealer, crib: true, cards: s.crib.slice(), items });
  if (add(s, s.dealer, sumItems(items), ev)) return;
  dealHand(s, rng, ev);
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const see = (x: number) => seats === 'all' || seats.includes(x);
  const v = s as unknown as Partial<View>;
  const { deck, ...rest } = s as State;
  return {
    ...rest,
    hands: s.hands.map((h, i) => (h ? (see(i) ? h.slice() : []) : h)),
    left: s.left.map((h, i) => (h ? (see(i) ? h.slice() : []) : h)),
    discards: s.discards.map((d, i) => (d ? (see(i) ? d.slice() : d.map(() => ({ s: 'S', r: 0 }) as Card)) : d)),
    crib: seats === 'all' ? s.crib.slice() : s.crib.map(() => ({ s: 'S', r: 0 }) as Card),
    counts: s.left.map((h, i) => (h ? (s.phase === 'discard' ? s.hands[i].length : h.length) : 0)),
    deckLeft: v.deckLeft ?? deck?.length ?? 0,
  };
}
