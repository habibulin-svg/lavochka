/* Черви — правила (без DOM). Ровно 4 игрока, 52 карты по 13 (дворовый вариант — 36 по 9), козырей нет.
 *
 * Перед коном все разом отдают по три карты: влево, вправо, напротив, четвёртый кон — без обмена, и по кругу.
 * Первым ходит обладатель двойки треф (в 36 картах — шестёрки треф) ею же. В масть ходить обязательно, нет масти — сбрасывай
 * что угодно, кроме первой взятки: туда черви и даму пик нельзя (если только кроме них ничего нет).
 * С червей заходить нельзя, пока черву никто не сбросил (или когда на руке одни черви). Взятку берёт старшая карта масти захода.
 * Очки (штраф): черва — 1, дама пик — 13. Собрал все черви и даму пик — «выстрелил в луну»: всем остальным по 26 (22), себе 0.
 * Омнибус: валет бубен во взятке — минус 10. Партия до 100 (или 50): у кого меньше — победил.
 */
import type { Options, Rng } from '../../core/types';
import { makeDeck, sameCard, type Card } from '../../cards/deck';
import { shuffle } from '../../core/rng';

export interface Cfg {
  deck: 36 | 52;
  pass: boolean;
  omnibus: boolean;
  limit: number;
}

export function cfgFrom(o: Options): Cfg {
  return { deck: Number(o.deck) === 36 ? 36 : 52, pass: o.pass !== false, omnibus: !!o.omnibus, limit: Number(o.limit) === 50 ? 50 : 100 };
}

export const isQS = (c: Card) => c.s === 'S' && c.r === 12;
export const isJD = (c: Card) => c.s === 'D' && c.r === 11;
/** Штраф карты (без омнибуса). */
export const cardPts = (c: Card) => (c.s === 'H' ? 1 : isQS(c) ? 13 : 0);
export const lowClub = (cfg: Cfg): Card => ({ s: 'C', r: cfg.deck === 36 ? 6 : 2 });
/** Всего штрафа в коне (луна). */
export const moonTotal = (cfg: Cfg) => (cfg.deck === 36 ? 9 : 13) + 13;

/** Куда отдают карты в этом коне: 1 — влево (следующему), 3 — вправо, 2 — напротив, 0 — без обмена. */
export const passShift = (cfg: Cfg, round: number) => (cfg.pass ? [1, 3, 2, 0][(round - 1) % 4] : 0);

export interface State {
  cfg: Cfg;
  seats: number[];
  hands: Card[][];
  phase: 'pass' | 'play' | 'over';
  /** Выбранные к обмену карты (null — ещё не выбрал). */
  passing: (Card[] | null)[];
  trick: { seat: number; card: Card }[];
  turn: number;
  /** Взятые за кон карты. */
  taken: Card[][];
  tricks: number[];
  broken: boolean;
  /** Сколько взяток сыграно в коне. */
  played: number;
  round: number;
  score: number[];
  last: { add: number[]; moon: number | null } | null;
}

export interface View extends State {
  counts: number[];
}

export type Action = { type: 'pass'; cards: Card[] } | { type: 'play'; card: Card };

export type Event =
  | { type: 'deal'; round: number; shift: number; hands?: Card[][] }
  | { type: 'passed'; seat: number }
  | { type: 'swap'; shift: number; got?: Card[][]; gave?: Card[][] }
  | { type: 'play'; seat: number; card: Card }
  | { type: 'trick'; seat: number; cards: Card[]; pts: number }
  | { type: 'round'; add: number[]; score: number[]; moon: number | null }
  | { type: 'end'; winners: number[]; score: number[] };

export function newState(cfg: Cfg, seats: number[]): State {
  return {
    cfg,
    seats: seats.slice(),
    hands: [[], [], [], []],
    phase: 'play',
    passing: [null, null, null, null],
    trick: [],
    turn: seats[0],
    taken: [[], [], [], []],
    tricks: [0, 0, 0, 0],
    broken: false,
    played: 0,
    round: 0,
    score: [0, 0, 0, 0],
    last: null,
  };
}

const nextIn = (list: number[], seat: number, k = 1) => list[(list.indexOf(seat) + k) % list.length];
const has = (hand: Card[], c: Card) => hand.some((x) => sameCard(x, c));

function deal(s: State, rng: Rng, ev: Event[]) {
  s.round++;
  const deck = shuffle(makeDeck(s.cfg.deck), rng);
  const each = deck.length / 4;
  s.hands = s.seats.map((_, i) => deck.slice(i * each, (i + 1) * each));
  s.taken = [[], [], [], []];
  s.tricks = [0, 0, 0, 0];
  s.trick = [];
  s.broken = false;
  s.played = 0;
  s.passing = [null, null, null, null];
  const shift = passShift(s.cfg, s.round);
  ev.push({ type: 'deal', round: s.round, shift, hands: s.hands.map((h) => h.slice()) });
  if (shift) s.phase = 'pass';
  else startPlay(s);
}

function startPlay(s: State) {
  s.phase = 'play';
  const lc = lowClub(s.cfg);
  s.turn = s.seats.find((p) => has(s.hands[p], lc))!;
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  const s = newState(cfgFrom(opts), seats);
  deal(s, rng, []);
  return s;
}

export const toAct = (s: State): number[] => (s.phase === 'over' ? [] : s.phase === 'pass' ? s.seats.filter((p) => !s.passing[p]) : [s.turn]);

/** Какие карты можно сыграть. */
export function legal(s: State, seat: number): Card[] {
  const hand = s.hands[seat];
  if (!s.trick.length) {
    // самый первый заход кона — младшей трефой
    if (s.played === 0) {
      const lc = lowClub(s.cfg);
      return hand.filter((c) => sameCard(c, lc));
    }
    if (!s.broken) {
      const non = hand.filter((c) => c.s !== 'H');
      if (non.length) return non;
    }
    return hand;
  }
  const suit = s.trick[0].card.s;
  const follow = hand.filter((c) => c.s === suit);
  if (follow.length) return follow;
  if (s.played === 0) {
    const clean = hand.filter((c) => !cardPts(c));
    if (clean.length) return clean;
  }
  return hand;
}

export function trickWinner(trick: { seat: number; card: Card }[]): number {
  const suit = trick[0].card.s;
  return trick.filter((t) => t.card.s === suit).sort((a, b) => b.card.r - a.card.r)[0].seat;
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.phase === 'over' || !a) return null;
  const ev: Event[] = [];
  if (s0.phase === 'pass') {
    if (a.type !== 'pass' || s0.passing[seat] || !s0.seats.includes(seat)) return null;
    const cs = a.cards;
    if (!Array.isArray(cs) || cs.length !== 3 || !cs.every((c) => has(s0.hands[seat], c)) || new Set(cs.map((c) => c.s + c.r)).size !== 3) return null;
    const s: State = { ...s0, passing: s0.passing.slice() };
    s.passing[seat] = cs.map((c) => ({ s: c.s, r: c.r }));
    ev.push({ type: 'passed', seat });
    if (s.seats.every((p) => s.passing[p])) {
      const shift = passShift(s.cfg, s.round);
      const hands = s.hands.slice();
      const got: Card[][] = [[], [], [], []];
      for (const p of s.seats) {
        const to = nextIn(s.seats, p, shift);
        got[to] = s.passing[p]!;
        hands[p] = hands[p].filter((c) => !has(s.passing[p]!, c));
      }
      for (const p of s.seats) hands[p] = [...hands[p], ...got[p]];
      s.hands = hands;
      ev.push({ type: 'swap', shift, got, gave: s.passing.map((x) => x ?? []) });
      s.passing = [null, null, null, null];
      startPlay(s);
    }
    return { state: s, events: ev };
  }
  if (a.type !== 'play' || seat !== s0.turn || !a.card || !legal(s0, seat).some((c) => sameCard(c, a.card))) return null;
  const s: State = { ...s0, hands: s0.hands.slice(), trick: [...s0.trick, { seat, card: { s: a.card.s, r: a.card.r } }], taken: s0.taken.slice(), tricks: s0.tricks.slice(), score: s0.score.slice() };
  s.hands[seat] = s.hands[seat].filter((c) => !sameCard(c, a.card));
  if (a.card.s === 'H') s.broken = true;
  ev.push({ type: 'play', seat, card: a.card });
  if (s.trick.length < s.seats.length) {
    s.turn = nextIn(s.seats, seat);
    return { state: s, events: ev };
  }
  const w = trickWinner(s.trick);
  const cards = s.trick.map((t) => t.card);
  const pts = cards.reduce((x, c) => x + cardPts(c) - (s.cfg.omnibus && isJD(c) ? 10 : 0), 0);
  s.taken[w] = [...s.taken[w], ...cards];
  s.tricks[w]++;
  s.trick = [];
  s.played++;
  s.turn = w;
  ev.push({ type: 'trick', seat: w, cards, pts });
  if (s.hands[w].length) return { state: s, events: ev };
  endRound(s, rng, ev);
  return { state: s, events: ev };
}

function endRound(s: State, rng: Rng, ev: Event[]) {
  const add = [0, 0, 0, 0];
  const total = moonTotal(s.cfg);
  let moon: number | null = null;
  for (const p of s.seats) {
    const raw = s.taken[p].reduce((x, c) => x + cardPts(c), 0);
    if (raw === total) moon = p;
  }
  for (const p of s.seats) {
    const bonus = s.cfg.omnibus && s.taken[p].some(isJD) ? -10 : 0;
    add[p] = (moon == null ? s.taken[p].reduce((x, c) => x + cardPts(c), 0) : p === moon ? 0 : total) + bonus;
    s.score[p] += add[p];
  }
  s.last = { add, moon };
  ev.push({ type: 'round', add, score: s.score.slice(), moon });
  if (s.seats.some((p) => s.score[p] >= s.cfg.limit)) {
    s.phase = 'over';
    ev.push({ type: 'end', winners: winnersOf(s), score: s.score.slice() });
    return;
  }
  deal(s, rng, ev);
}

export function winnersOf(s: State): number[] {
  const low = Math.min(...s.seats.map((p) => s.score[p]));
  return s.seats.filter((p) => s.score[p] === low);
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const see = (x: number) => seats === 'all' || seats.includes(x);
  const v = s as Partial<View>;
  return {
    ...s,
    hands: s.hands.map((h, i) => (see(i) ? h.slice() : [])),
    passing: s.passing.map((p, i) => (see(i) ? p : p ? [] : null)),
    // взятое видно всем (карты взяток открыты по ходу игры)
    counts: s.hands.map((h, i) => v.counts?.[i] ?? h.length),
  };
}

export const countOf = (s: State, seat: number) => ((s as Partial<View>).counts ? (s as View).counts[seat] : s.hands[seat].length);
