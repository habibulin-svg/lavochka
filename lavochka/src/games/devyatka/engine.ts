/* Девятка — правила (без DOM). 2–4 игрока, колода 36 раздаётся вся (в варианте «Семёрка» — 52 карты, ряды от семёрок).
 *
 * На столе растут четыре ряда мастей от девяток: вверх по одной (10, В, Д, К, Т), вниз по одной (8, 7, 6). Ход — одна карта:
 * новая девятка или соседняя к краю ряда своей масти. Есть ход — обязан ходить; нечем — пас (стук), это происходит само.
 * Первым ходит обладатель девятки бубен и ею же (в варианте «с любой» — сосед сдающего, любой девяткой).
 * Кто первым избавился от карт — выиграл кон; остальным штраф за оставшиеся карты: по карте (или по очкам: 6–10 по номиналу,
 * В 2, Д 3, К 4, Т 11). Партия — по кону на сдатчика или до 50/100; меньше штрафа — лучше.
 * На банк: каждый кон все ставят по фишке, за каждый пас — ещё фишка в банк, выигравший кон забирает банк.
 */
import type { Options, Rng } from '../../core/types';
import { makeDeck, sameCard, SUITS, type Card, type Suit } from '../../cards/deck';
import { shuffle } from '../../core/rng';

export interface Cfg {
  deck: 36 | 52;
  /** Первый ход — девяткой бубен (иначе сосед сдающего, любой девяткой). */
  diamond: boolean;
  scoring: 'cards' | 'points' | 'bank';
  /** 0 — по кону на каждого сдатчика; 50/100 — до стольких штрафных. */
  limit: number;
}

export function cfgFrom(o: Options): Cfg {
  const scoring = o.scoring === 'points' || o.scoring === 'bank' ? o.scoring : 'cards';
  return { deck: Number(o.deck) === 52 ? 52 : 36, diamond: o.diamond !== false, scoring, limit: scoring === 'bank' ? 0 : [50, 100].includes(Number(o.limit)) ? Number(o.limit) : 0 };
}

export const baseRank = (cfg: Cfg) => (cfg.deck === 52 ? 7 : 9);
export const lowRank = (cfg: Cfg) => (cfg.deck === 52 ? 2 : 6);
export const PENALTY: Record<number, number> = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, 11: 2, 12: 3, 13: 4, 14: 11 };
/** Фишек на руках в игре на банк. */
export const CHIPS = 20;

export interface Row {
  lo: number;
  hi: number;
}

export interface State {
  cfg: Cfg;
  seats: number[];
  hands: Card[][];
  /** Ряды мастей: null — ряд ещё не открыт. */
  rows: Record<Suit, Row | null>;
  turn: number;
  dealer: number;
  round: number;
  /** Штраф (или фишки в игре на банк). */
  score: number[];
  bank: number;
  /** Пасы в этом коне. */
  passes: number[];
  last: { winner: number; add: number[] } | null;
  over: boolean;
}

export interface View extends State {
  counts: number[];
}

export type Action = { type: 'play'; card: Card };

export type Event =
  | { type: 'deal'; round: number; dealer: number; hands?: Card[][]; counts: number[] }
  | { type: 'play'; seat: number; card: Card }
  | { type: 'pass'; seat: number }
  | { type: 'round'; winner: number; add: number[]; score: number[]; bank: number }
  | { type: 'end'; winners: number[]; score: number[] };

const nextIn = (list: number[], seat: number) => list[(list.indexOf(seat) + 1) % list.length];

/** Можно ли положить карту. */
export function canPlay(s: State, c: Card): boolean {
  const row = s.rows[c.s];
  const base = baseRank(s.cfg);
  if (!row) {
    if (c.r !== base) return false;
    // самый первый ход кона — девяткой бубен
    if (s.cfg.diamond && SUITS.every((x) => !s.rows[x])) return c.s === 'D';
    return true;
  }
  return c.r === row.hi + 1 || c.r === row.lo - 1;
}

export const legal = (s: State, seat: number) => s.hands[seat].filter((c) => canPlay(s, c));

export function newState(cfg: Cfg, seats: number[]): State {
  return {
    cfg,
    seats: seats.slice(),
    hands: [[], [], [], []],
    rows: { S: null, C: null, D: null, H: null },
    turn: seats[0],
    dealer: seats[seats.length - 1],
    round: 0,
    score: seats.reduce((a, p) => ((a[p] = cfg.scoring === 'bank' ? CHIPS : 0), a), [0, 0, 0, 0]),
    bank: 0,
    passes: [0, 0, 0, 0],
    last: null,
    over: false,
  };
}

function deal(s: State, rng: Rng, ev: Event[]) {
  s.dealer = s.round === 0 ? s.seats[s.seats.length - 1] : nextIn(s.seats, s.dealer);
  s.round++;
  const deck = shuffle(makeDeck(s.cfg.deck), rng);
  s.hands = [[], [], [], []];
  let p = nextIn(s.seats, s.dealer);
  for (const c of deck) {
    s.hands[p].push(c);
    p = nextIn(s.seats, p);
  }
  s.rows = { S: null, C: null, D: null, H: null };
  s.passes = [0, 0, 0, 0];
  if (s.cfg.scoring === 'bank') for (const x of s.seats) if (s.score[x] > 0) (s.score[x]--, s.bank++);
  ev.push({ type: 'deal', round: s.round, dealer: s.dealer, hands: s.hands.map((h) => h.slice()), counts: s.hands.map((h) => h.length) });
  if (s.cfg.diamond) s.turn = s.seats.find((x) => s.hands[x].some((c) => c.s === 'D' && c.r === baseRank(s.cfg)))!;
  else s.turn = nextIn(s.seats, s.dealer);
  skipPasses(s, ev);
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  const s = newState(cfgFrom(opts), seats);
  deal(s, rng, []);
  return s;
}

/** Нечем ходить — пас (стук), ход дальше. */
function skipPasses(s: State, ev: Event[]) {
  for (let i = 0; i < s.seats.length && !legal(s, s.turn).length; i++) {
    s.passes[s.turn]++;
    if (s.cfg.scoring === 'bank' && s.score[s.turn] > 0) (s.score[s.turn]--, s.bank++);
    ev.push({ type: 'pass', seat: s.turn });
    s.turn = nextIn(s.seats, s.turn);
  }
}

export const toAct = (s: State): number[] => (s.over ? [] : [s.turn]);

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn || !a || a.type !== 'play' || !a.card) return null;
  if (!s0.hands[seat].some((c) => sameCard(c, a.card)) || !canPlay(s0, a.card)) return null;
  const s: State = { ...s0, hands: s0.hands.slice(), rows: { ...s0.rows }, score: s0.score.slice(), passes: s0.passes.slice() };
  const ev: Event[] = [];
  const c = a.card;
  s.hands[seat] = s.hands[seat].filter((x) => !sameCard(x, c));
  const row = s.rows[c.s];
  s.rows[c.s] = row ? { lo: Math.min(row.lo, c.r), hi: Math.max(row.hi, c.r) } : { lo: c.r, hi: c.r };
  ev.push({ type: 'play', seat, card: { s: c.s, r: c.r } });
  if (!s.hands[seat].length) {
    endRound(s, seat, rng, ev);
    return { state: s, events: ev };
  }
  s.turn = nextIn(s.seats, seat);
  skipPasses(s, ev);
  return { state: s, events: ev };
}

function endRound(s: State, winner: number, rng: Rng, ev: Event[]) {
  const add = [0, 0, 0, 0];
  if (s.cfg.scoring === 'bank') {
    add[winner] = s.bank;
    s.score[winner] += s.bank;
    s.bank = 0;
  } else
    for (const p of s.seats) {
      add[p] = s.cfg.scoring === 'points' ? s.hands[p].reduce((a, c) => a + PENALTY[c.r], 0) : s.hands[p].length;
      s.score[p] += add[p];
    }
  s.last = { winner, add };
  ev.push({ type: 'round', winner, add, score: s.score.slice(), bank: s.bank });
  const n = s.seats.length;
  const done = s.cfg.limit ? s.seats.some((p) => s.score[p] >= s.cfg.limit) : s.round >= (s.cfg.scoring === 'bank' ? n * 2 : n);
  // на банк: кто без фишек — партия окончена
  if (done || (s.cfg.scoring === 'bank' && s.seats.filter((p) => s.score[p] > 0).length < 2)) {
    s.over = true;
    ev.push({ type: 'end', winners: winnersOf(s), score: s.score.slice() });
    return;
  }
  deal(s, rng, ev);
}

export function winnersOf(s: State): number[] {
  const vals = s.seats.map((p) => s.score[p]);
  const best = s.cfg.scoring === 'bank' ? Math.max(...vals) : Math.min(...vals);
  return s.seats.filter((p) => s.score[p] === best);
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const see = (x: number) => seats === 'all' || seats.includes(x);
  const v = s as Partial<View>;
  return { ...s, hands: s.hands.map((h, i) => (see(i) ? h.slice() : [])), counts: s.hands.map((h, i) => v.counts?.[i] ?? h.length) };
}

export const countOf = (s: State, seat: number) => ((s as Partial<View>).counts ? (s as View).counts[seat] : s.hands[seat].length);
