/* Кончинка (скопа) и её родня — правила (без DOM). 2–4 игрока, вчетвером — пара на пару (напарники напротив).
 *
 * Кончинка (по русской Википедии): 52 карты, по 4 на руку, на стол — 4 открытые. Ход по кругу от соседа сдатчика: картой с руки
 * берут со стола карту того же достоинства или несколько карт с той же суммой очков (туз — 1, двойка–десятка — по номиналу);
 * валет, дама и король берут только такую же картинку. Взять нечем — карту кладут на стол. Руки кончились — сдатчик сдаёт ещё по 4
 * (на стол больше не кладут), пока не кончится колода; остаток стола забирает тот, кто брал последним.
 * Очки за кон: больше всех карт — 2 (поровну у лучших — по 1), больше всех треф — 1, двойка треф — 1, десятка бубен — 1.
 * Вариант «по червям»: черви вместо треф и туз пик вместо двойки треф. Игра — до 21.
 *
 * Скопа (Италия): 40 карт (туз–семёрка, валет 8, дама 9, король 10), по 3, на стол 4. Если на столе есть карта того же значения,
 * брать можно только её; иначе — несколько карт на ту же сумму. Забрал весь стол — «скопа», очко (кроме последнего хода кона).
 * Очки: больше карт, больше бубен, семёрка бубен, «примиера» (лучшая карта каждой масти: 7 — 21, 6 — 18, туз — 16, 5 — 15,
 * 4 — 14, 3 — 13, 2 — 12, картинки — 10; нужны все четыре масти) — по 1, поровну — никому; плюс скопы. Игра — до 11.
 * Скопоне: вчетвером парами, по 9 и 4 на стол; «научное» — по 10, стол пуст. Эскоба (Испания): берут карты, которые вместе с
 * сыгранной дают 15; очки — карты, бубны, больше семёрок, семёрка бубен, эскобы; до 21.
 * Если взять можно, брать обязательно.
 */
import type { Options, Rng } from '../../core/types';
import { makeDeck, sameCard, type Card, type Suit } from '../../cards/deck';
import { shuffle } from '../../core/rng';

export type Rules = 'konch' | 'scopa' | 'escoba';

export interface Cfg {
  rules: Rules;
  deck: 52 | 40;
  hand: number;
  table: number;
  /** Кончинка: масть, за которую очко (трефы или черви). */
  suit: Suit;
  /** Вчетвером — пара на пару. */
  pairs: boolean;
  target: number;
}

export function cfgFrom(o: Options): Cfg {
  const rules: Rules = o.rules === 'scopa' || o.rules === 'escoba' ? o.rules : 'konch';
  const deck = rules === 'konch' ? 52 : 40;
  const hand = [3, 4, 9, 10].includes(Number(o.hand)) ? Number(o.hand) : rules === 'konch' ? 4 : 3;
  return {
    rules,
    deck,
    hand,
    table: hand === 10 ? 0 : 4,
    suit: o.suit === 'H' ? 'H' : 'C',
    pairs: o.pairs !== false,
    target: [11, 16, 21, 31].includes(Number(o.target)) ? Number(o.target) : rules === 'scopa' ? 11 : 21,
  };
}

/** Значение карты для взятия. */
export function value(cfg: Cfg, c: Card): number {
  if (c.r === 14) return 1;
  if (cfg.deck === 40 && c.r >= 11) return c.r - 3; // валет 8, дама 9, король 10
  return c.r;
}

/** Картинка в кончинке — берёт только такую же. */
const face = (cfg: Cfg, c: Card) => cfg.deck === 52 && c.r >= 11 && c.r <= 13;

export interface State {
  cfg: Cfg;
  seats: number[];
  dealer: number;
  deck: Card[];
  hands: Card[][];
  table: Card[];
  /** Взятое (видно всем — брали открыто). */
  piles: Card[][];
  /** Скопы (забрал весь стол). */
  sweeps: number[];
  lastCap: number | null;
  turn: number;
  score: number[];
  round: number;
  last: { lines: Line[]; add: number[] } | null;
  over: boolean;
  winners: number[];
}

export interface Line {
  /** Кто получил (место; в паре — первое место пары). */
  seat: number;
  what: string;
  pts: number;
}

export interface View extends Omit<State, 'deck'> {
  deckLeft: number;
  counts: number[];
}

export type Action = { type: 'play'; card: Card; take: Card[] };

export type Event =
  | { type: 'deal'; round: number; dealer: number; first: boolean; hands?: Card[][]; table: Card[] }
  | { type: 'play'; seat: number; card: Card; take: Card[]; sweep: boolean }
  | { type: 'rest'; seat: number; cards: Card[] }
  | { type: 'score'; lines: Line[]; add: number[]; score: number[] }
  | { type: 'end'; winners: number[]; score: number[] };

const nextIn = (list: number[], seat: number) => list[(list.indexOf(seat) + 1) % list.length];
export const teamOf = (s: State | View, seat: number) => (s.cfg.pairs && s.seats.length === 4 ? s.seats.indexOf(seat) % 2 : s.seats.indexOf(seat));
/** Места одной стороны (пара или один). */
export const sideOf = (s: State | View, seat: number) => s.seats.filter((x) => teamOf(s, x) === teamOf(s, seat));

export function newState(cfg: Cfg, seats: number[]): State {
  const z = () => seats.reduce((a, x) => ((a[x] = 0), a), [] as number[]);
  return {
    cfg,
    seats: seats.slice(),
    dealer: seats[seats.length - 1],
    deck: [],
    hands: seats.reduce((a, x) => ((a[x] = []), a), [] as Card[][]),
    table: [],
    piles: seats.reduce((a, x) => ((a[x] = []), a), [] as Card[][]),
    sweeps: z(),
    lastCap: null,
    turn: seats[0],
    score: z(),
    round: 0,
    last: null,
    over: false,
    winners: [],
  };
}

function fullDeck(cfg: Cfg): Card[] {
  return makeDeck(52).filter((c) => cfg.deck === 52 || c.r <= 7 || c.r >= 11);
}

/** Раздать по руке каждому (и на стол — в начале кона). */
function dealHands(s: State, first: boolean, ev: Event[]) {
  if (first && s.cfg.table) s.table = s.deck.splice(0, s.cfg.table);
  let p = nextIn(s.seats, s.dealer);
  for (let k = 0; k < s.cfg.hand * s.seats.length && s.deck.length; k++) {
    s.hands[p].push(s.deck.shift()!);
    p = nextIn(s.seats, p);
  }
  s.turn = nextIn(s.seats, s.dealer);
  ev.push({ type: 'deal', round: s.round, dealer: s.dealer, first, hands: s.hands.map((h) => (h ? h.slice() : h)), table: s.table.slice() });
}

function startRound(s: State, rng: Rng, ev: Event[]) {
  s.round++;
  if (s.round > 1) s.dealer = nextIn(s.seats, s.dealer);
  s.deck = shuffle(fullDeck(s.cfg), rng);
  for (const x of s.seats) {
    s.hands[x] = [];
    s.piles[x] = [];
    s.sweeps[x] = 0;
  }
  s.table = [];
  s.lastCap = null;
  // скопа: три-четыре короля на столе — пересдать стол
  if (s.cfg.deck === 40 && s.cfg.table) {
    for (let i = 0; i < 20 && s.deck.slice(0, 4).filter((c) => c.r === 13).length >= 3; i++) s.deck = shuffle(s.deck, rng);
  }
  dealHands(s, true, ev);
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  const s = newState(cfgFrom(opts), seats);
  startRound(s, rng, []);
  return s;
}

export const toAct = (s: State): number[] => (s.over ? [] : [s.turn]);

/** Все наборы со стола, которые можно взять этой картой. */
export function captures(cfg: Cfg, table: Card[], c: Card): Card[][] {
  const out: Card[][] = [];
  const v = value(cfg, c);
  if (cfg.rules === 'konch' && face(cfg, c)) return table.filter((t) => t.r === c.r).map((t) => [t]);
  if (cfg.rules === 'scopa') {
    const same = table.filter((t) => value(cfg, t) === v);
    if (same.length) return same.map((t) => [t]);
  }
  const pool = cfg.rules === 'konch' ? table.filter((t) => !face(cfg, t)) : table;
  const want = cfg.rules === 'escoba' ? 15 - v : v;
  if (want <= 0) return out;
  const n = pool.length;
  for (let m = 1; m < 1 << n; m++) {
    let sum = 0;
    const set: Card[] = [];
    for (let i = 0; i < n; i++)
      if (m & (1 << i)) {
        sum += value(cfg, pool[i]);
        set.push(pool[i]);
        if (sum > want) break;
      }
    if (sum === want) out.push(set);
  }
  return out;
}

/** Все допустимые ходы места: если взять можно — только взятия этой картой (картами, которыми можно взять, — только брать). */
export function moves(s: State | View, seat: number): Action[] {
  const out: Action[] = [];
  const caps = s.hands[seat].map((c) => ({ c, sets: captures(s.cfg, s.table, c) }));
  const any = caps.some((x) => x.sets.length);
  for (const { c, sets } of caps) {
    if (sets.length) for (const t of sets) out.push({ type: 'play', card: c, take: t });
    else if (!any) out.push({ type: 'play', card: c, take: [] });
  }
  return out;
}

const sameSet = (a: Card[], b: Card[]) => a.length === b.length && a.every((x) => b.some((y) => sameCard(x, y)));

function cloneState(s0: State): State {
  return { ...s0, deck: s0.deck.slice(), hands: s0.hands.map((h) => (h ? h.slice() : h)), table: s0.table.slice(), piles: s0.piles.map((p) => (p ? p.slice() : p)), sweeps: s0.sweeps.slice(), score: s0.score.slice() };
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn || !a || a.type !== 'play' || !a.card || !Array.isArray(a.take)) return null;
  const ok = moves(s0, seat).some((m) => sameCard(m.card, a.card) && sameSet(m.take, a.take));
  if (!ok) return null;
  const s = cloneState(s0);
  const ev: Event[] = [];
  const card = s.hands[seat].find((c) => sameCard(c, a.card))!;
  s.hands[seat] = s.hands[seat].filter((c) => !sameCard(c, card));
  const take = a.take.map((t) => s.table.find((c) => sameCard(c, t))!);
  let sweep = false;
  if (take.length) {
    s.table = s.table.filter((c) => !take.some((t) => sameCard(t, c)));
    s.piles[seat].push(card, ...take);
    s.lastCap = seat;
    const lastPlay = !s.deck.length && s.seats.every((x) => !s.hands[x].length);
    if (!s.table.length && s.cfg.rules !== 'konch' && !lastPlay) {
      sweep = true;
      s.sweeps[seat]++;
    }
  } else s.table.push(card);
  ev.push({ type: 'play', seat, card, take, sweep });
  s.turn = nextIn(s.seats, seat);
  if (s.seats.some((x) => s.hands[x].length)) return { state: s, events: ev };
  if (s.deck.length) {
    dealHands(s, false, ev);
    return { state: s, events: ev };
  }
  endRound(s, rng, ev);
  return { state: s, events: ev };
}

/** Примиера: лучшая карта каждой масти; без какой-то масти — нет примиеры. */
const PRIM: Record<number, number> = { 7: 21, 6: 18, 14: 16, 5: 15, 4: 14, 3: 13, 2: 12, 11: 10, 12: 10, 13: 10 };
export function primiera(cards: Card[]): number {
  let sum = 0;
  for (const su of ['S', 'C', 'D', 'H'] as Suit[]) {
    const best = Math.max(0, ...cards.filter((c) => c.s === su).map((c) => PRIM[c.r] ?? 0));
    if (!best) return 0;
    sum += best;
  }
  return sum;
}

/** Подсчёт кона по сторонам (пара или игрок). */
export function tally(s: State | View): { lines: Line[]; add: number[] } {
  const sides = [...new Set(s.seats.map((x) => teamOf(s, x)))];
  const head = (t: number) => s.seats.find((x) => teamOf(s, x) === t)!;
  const cards = (t: number) => s.seats.filter((x) => teamOf(s, x) === t).flatMap((x) => s.piles[x]);
  const lines: Line[] = [];
  const most = (what: string, f: (cs: Card[]) => number, pts: number, tieSplit: boolean) => {
    const vals = sides.map((t) => f(cards(t)));
    const best = Math.max(...vals);
    if (best <= 0) return;
    const top = sides.filter((_, i) => vals[i] === best);
    if (top.length === 1) lines.push({ seat: head(top[0]), what, pts });
    else if (tieSplit) for (const t of top) lines.push({ seat: head(t), what: `${what} (поровну)`, pts: 1 });
  };
  const holder = (what: string, test: (c: Card) => boolean) => {
    const t = sides.find((x) => cards(x).some(test));
    if (t != null) lines.push({ seat: head(t), what, pts: 1 });
  };
  const cfg = s.cfg;
  if (cfg.rules === 'konch') {
    const red = cfg.suit === 'H';
    most('больше всех карт', (cs) => cs.length, 2, true);
    most(red ? 'больше всех червей' : 'больше всех треф', (cs) => cs.filter((c) => c.s === cfg.suit).length, 1, false);
    if (red) holder('туз пик', (c) => c.s === 'S' && c.r === 14);
    else holder('двойка треф', (c) => c.s === 'C' && c.r === 2);
    holder('десятка бубен', (c) => c.s === 'D' && c.r === 10);
  } else {
    most('больше карт', (cs) => cs.length, 1, false);
    most(cfg.rules === 'escoba' ? 'больше бубен (оро)' : 'больше бубен (денари)', (cs) => cs.filter((c) => c.s === 'D').length, 1, false);
    holder(cfg.rules === 'escoba' ? 'семёрка бубен' : 'сеттебелло — семёрка бубен', (c) => c.s === 'D' && c.r === 7);
    if (cfg.rules === 'scopa') most('примиера', primiera, 1, false);
    else most('больше семёрок', (cs) => cs.filter((c) => c.r === 7).length, 1, false);
    for (const t of sides) {
      const n = s.seats.filter((x) => teamOf(s, x) === t).reduce((a, x) => a + s.sweeps[x], 0);
      if (n) lines.push({ seat: head(t), what: cfg.rules === 'escoba' ? `эскобы ×${n}` : `скопы ×${n}`, pts: n });
    }
  }
  const add = s.seats.reduce((a, x) => ((a[x] = 0), a), [] as number[]);
  for (const l of lines) for (const x of sideOf(s, l.seat)) add[x] += l.pts;
  return { lines, add };
}

function endRound(s: State, rng: Rng, ev: Event[]) {
  if (s.table.length && s.lastCap != null) {
    ev.push({ type: 'rest', seat: s.lastCap, cards: s.table.slice() });
    s.piles[s.lastCap].push(...s.table);
    s.table = [];
  }
  const { lines, add } = tally(s);
  for (const x of s.seats) s.score[x] += add[x];
  s.last = { lines, add };
  ev.push({ type: 'score', lines, add, score: s.score.slice() });
  const best = Math.max(...s.seats.map((x) => s.score[x]));
  const top = s.seats.filter((x) => s.score[x] === best);
  // до цели — и один лидер (ничья на цели — играют ещё кон)
  if (best >= s.cfg.target && new Set(top.map((x) => teamOf(s, x))).size === 1) {
    s.over = true;
    s.winners = top;
    ev.push({ type: 'end', winners: top, score: s.score.slice() });
    return;
  }
  if (s.round >= 60) {
    s.over = true;
    s.winners = top;
    ev.push({ type: 'end', winners: top, score: s.score.slice() });
    return;
  }
  startRound(s, rng, ev);
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const see = (x: number) => seats === 'all' || seats.includes(x);
  const v = s as Partial<View>;
  const { deck, ...rest } = s as State;
  return {
    ...rest,
    hands: s.hands.map((h, i) => (h ? (see(i) ? h.slice() : []) : h)),
    piles: s.piles.map((p) => (p ? p.slice() : p)),
    counts: s.hands.map((h, i) => (h ? (v.counts?.[i] ?? h.length) : 0)),
    deckLeft: v.deckLeft ?? deck?.length ?? 0,
  };
}

export const countOf = (s: State | View, seat: number) => ('counts' in s ? s.counts[seat] : s.hands[seat].length);
