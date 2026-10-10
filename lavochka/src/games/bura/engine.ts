/* Бура — правила (без DOM). Колода 36 карт, 2–4 игрока, на руке по 3 карты, козырь — открытая карта под колодой.
 *
 * Очки: Т 11, 10 — 10, К 4, Д 3, В 2, остальные — 0 (всего 120). Старшинство: Т > 10 > К > Д > В > 9 > 8 > 7 > 6.
 * Заходят одной картой или двумя-тремя одной масти. Остальные по кругу кладут столько же карт: либо бьют каждую
 * (старшей той же масти или козырем), либо скидывают втёмную. Взятку берёт тот, кто побил последним (никто — заходивший).
 * После взятки добирают до трёх, первым — взявший; он и заходит.
 * Набрал 31 — на своём заходе «вскрываешься» и выигрываешь кон; ошибся (меньше 31) — проиграл кон.
 * Бура — три козыря на руке, москва — три туза: на своём заходе показал — выиграл кон сразу.
 * Карты кончились, а никто не вскрылся — выигрывает тот, у кого больше очков во взятках.
 * Проигравшим кон — палки: 2, без единой взятки — 4, после буры или москвы — 4. Набравший 12 палок проиграл партию.
 */
import type { Options, Rng } from '../../core/types';
import { sameCard, type Card, type Suit } from '../../cards/deck';

export interface Cfg {
  /** Москва — три туза. */
  moscow: boolean;
  /** Вслепую: свои очки не показываются — считай в уме. */
  blind: boolean;
  /** До скольких палок. */
  limit: number;
}

export function cfgFrom(o: Options): Cfg {
  return { moscow: o.moscow !== false, blind: !!o.blind, limit: [8, 12, 16].includes(Number(o.limit)) ? Number(o.limit) : 12 };
}

export const POINTS: Record<number, number> = { 14: 11, 10: 10, 13: 4, 12: 3, 11: 2, 9: 0, 8: 0, 7: 0, 6: 0 };
export const POWER: Record<number, number> = { 14: 9, 10: 8, 13: 7, 12: 6, 11: 5, 9: 4, 8: 3, 7: 2, 6: 1 };
export const TARGET = 31;

export interface State {
  cfg: Cfg;
  seats: number[];
  dealer: number;
  hands: Card[][];
  deck: Card[];
  trump: Suit;
  trumpCard: Card;
  /** Взятки каждого (в карты сюда же идут скинутые втёмную). */
  piles: Card[][];
  /** Сколько взяток. */
  tricks: number[];
  /** Текущий заход: кто зашёл, кто сейчас «держит» (побил последним) и чьи карты. */
  lead: { seat: number; cards: Card[] } | null;
  best: { seat: number; cards: Card[] } | null;
  /** Кто уже ответил на заход (по порядку) и как. */
  answers: { seat: number; beat: boolean; cards: Card[] }[];
  turn: number;
  phase: 'lead' | 'answer' | 'over';
  palki: number[];
  round: number;
  /** Чем кончился последний кон — для показа. */
  last: { winner: number | null; reason: 'declare' | 'wrong' | 'bura' | 'moscow' | 'cards'; pts: number[] } | null;
  loser: number | null;
}

export interface View extends State {
  counts: number[];
  deckCount: number;
  /** Очки во взятках — только свои (и то если не «вслепую»), у остальных -1. */
  pts: number[];
  me: number[];
}

export type Action = { type: 'lead'; cards: Card[] } | { type: 'beat'; cards: Card[] } | { type: 'skip'; cards: Card[] } | { type: 'declare' } | { type: 'show'; kind: 'bura' | 'moscow' };

export type Event =
  | { type: 'deal'; round: number; dealer: number; trump: Card; counts: number[]; hands?: Card[][] }
  | { type: 'lead'; seat: number; cards: Card[] }
  | { type: 'beat'; seat: number; cards: Card[] }
  | { type: 'skip'; seat: number; count: number; cards?: Card[] }
  | { type: 'take'; seat: number; count: number }
  | { type: 'draw'; seat: number; count: number; cards?: Card[] }
  | { type: 'declare'; seat: number; pts: number; ok: boolean }
  | { type: 'show'; seat: number; kind: 'bura' | 'moscow'; cards: Card[] }
  | { type: 'round'; winner: number | null; reason: 'declare' | 'wrong' | 'bura' | 'moscow' | 'cards'; pts: number[]; add: number[]; palki: number[] }
  | { type: 'end'; loser: number; palki: number[] };

// ---------------------------------------------------------------- карты

function makeDeck36(): Card[] {
  const out: Card[] = [];
  for (const s of ['S', 'C', 'D', 'H'] as Suit[]) for (let r = 6; r <= 14; r++) out.push({ s, r });
  return out;
}

export const has = (hand: Card[], c: Card) => hand.some((x) => sameCard(x, c));
const hasAll = (hand: Card[], cs: Card[]) => cs.every((c) => has(hand, c)) && new Set(cs.map((c) => c.s + c.r)).size === cs.length;
const without = (hand: Card[], cs: Card[]) => hand.filter((c) => !cs.some((x) => sameCard(x, c)));
export const pilePoints = (cs: Card[]) => cs.reduce((a, c) => a + POINTS[c.r], 0);

/** Бьёт ли карта a карту b. */
export const beatsCard = (a: Card, b: Card, trump: Suit) => (a.s === b.s ? POWER[a.r] > POWER[b.r] : a.s === trump);

/** Можно ли картами mine покрыть все карты target (каждую своей). */
export function covers(mine: Card[], target: Card[], trump: Suit): boolean {
  if (mine.length !== target.length) return false;
  const perm = (left: Card[], i: number): boolean => {
    if (i === target.length) return true;
    for (let k = 0; k < left.length; k++) if (beatsCard(left[k], target[i], trump) && perm([...left.slice(0, k), ...left.slice(k + 1)], i + 1)) return true;
    return false;
  };
  return perm(mine, 0);
}

/** Все наборы из k карт руки. */
export function combos(hand: Card[], k: number): Card[][] {
  const out: Card[][] = [];
  const rec = (start: number, acc: Card[]) => {
    if (acc.length === k) {
      out.push(acc.slice());
      return;
    }
    for (let i = start; i < hand.length; i++) rec(i + 1, [...acc, hand[i]]);
  };
  rec(0, []);
  return out;
}

/** Варианты захода: одна карта или 2–3 одной масти. */
export function leads(hand: Card[]): Card[][] {
  const out: Card[][] = [];
  for (let k = 1; k <= hand.length; k++) for (const c of combos(hand, k)) if (c.every((x) => x.s === c[0].s)) out.push(c);
  return out;
}

export const isBura = (hand: Card[], trump: Suit) => hand.length === 3 && hand.every((c) => c.s === trump);
export const isMoscow = (hand: Card[]) => hand.length === 3 && hand.every((c) => c.r === 14);

const nextIn = (list: number[], seat: number) => list[(list.indexOf(seat) + 1) % list.length];

// ---------------------------------------------------------------- партия

export function newState(cfg: Cfg, seats: number[]): State {
  return {
    cfg,
    seats: seats.slice(),
    dealer: seats[seats.length - 1],
    hands: [[], [], [], []],
    deck: [],
    trump: 'H',
    trumpCard: { s: 'H', r: 6 },
    piles: [[], [], [], []],
    tricks: [0, 0, 0, 0],
    lead: null,
    best: null,
    answers: [],
    turn: seats[0],
    phase: 'lead',
    palki: [0, 0, 0, 0],
    round: 0,
    last: null,
    loser: null,
  };
}

function shuffle<T>(a: T[], rng: Rng): T[] {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

export function deal(s0: State, rng: Rng): { state: State; events: Event[] } {
  const dealer = s0.round === 0 ? s0.seats[s0.seats.length - 1] : nextIn(s0.seats, s0.dealer);
  const deck = shuffle(makeDeck36(), rng);
  const hands: Card[][] = [[], [], [], []];
  for (const p of s0.seats) hands[p] = deck.splice(0, 3);
  // козырь — следующая карта, её кладут под колоду открытой: она уйдёт последней
  const trumpCard = deck.shift()!;
  deck.push(trumpCard);
  const s: State = {
    ...s0,
    dealer,
    hands,
    deck,
    trump: trumpCard.s,
    trumpCard,
    piles: [[], [], [], []],
    tricks: [0, 0, 0, 0],
    lead: null,
    best: null,
    answers: [],
    turn: nextIn(s0.seats, dealer),
    phase: 'lead',
    round: s0.round + 1,
  };
  return { state: s, events: [{ type: 'deal', round: s.round, dealer, trump: trumpCard, counts: hands.map((h) => h.length), hands: hands.map((h) => h.slice()) }] };
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  return deal(newState(cfgFrom(opts), seats), rng).state;
}

export const toAct = (s: State): number[] => (s.phase === 'over' ? [] : [s.turn]);

/** Конец кона: палки проигравшим, новая раздача или конец партии. */
function endRound(s: State, winner: number | null, reason: 'declare' | 'wrong' | 'bura' | 'moscow' | 'cards', ev: Event[], rng: Rng): { state: State; events: Event[] } {
  const pts = s.piles.map(pilePoints);
  const add = [0, 0, 0, 0];
  for (const p of s.seats) {
    if (reason === 'wrong') {
      // ошибся при вскрытии — палки только ему
      if (p === winner) add[p] = 4;
      continue;
    }
    if (p === winner) continue;
    if (winner == null) {
      // поровну у лучших — палки только тем, кто ниже
      const top = Math.max(...s.seats.map((x) => pts[x]));
      if (pts[p] === top) continue;
    }
    add[p] = reason === 'bura' || reason === 'moscow' || s.tricks[p] === 0 ? 4 : 2;
  }
  const palki = s.palki.map((x, i) => x + add[i]);
  const realWinner = reason === 'wrong' ? null : winner;
  ev.push({ type: 'round', winner: realWinner, reason, pts, add, palki: palki.slice() });
  const st: State = { ...s, palki, last: { winner: realWinner, reason, pts }, lead: null, best: null, answers: [] };
  const top = Math.max(...s.seats.map((x) => palki[x]));
  if (top >= s.cfg.limit) {
    st.phase = 'over';
    st.loser = s.seats.find((x) => palki[x] === top)!;
    ev.push({ type: 'end', loser: st.loser, palki: palki.slice() });
    return { state: st, events: ev };
  }
  const d = deal(st, rng);
  // следующий кон заходит выигравший прошлый (или следующий за сдающим)
  if (realWinner != null) d.state.turn = realWinner;
  return { state: d.state, events: [...ev, ...d.events] };
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.phase === 'over' || seat !== s0.turn || !a || typeof a !== 'object') return null;
  const ev: Event[] = [];
  const s: State = { ...s0, hands: s0.hands.slice(), piles: s0.piles.slice(), tricks: s0.tricks.slice(), answers: s0.answers.slice() };
  const hand = s.hands[seat];
  if (s0.phase === 'lead') {
    if (a.type === 'declare') {
      const pts = pilePoints(s.piles[seat]);
      const ok = pts >= TARGET;
      ev.push({ type: 'declare', seat, pts, ok });
      return endRound(s, seat, ok ? 'declare' : 'wrong', ev, rng);
    }
    if (a.type === 'show') {
      const ok = a.kind === 'bura' ? isBura(hand, s.trump) : s.cfg.moscow && isMoscow(hand);
      if (!ok) return null;
      ev.push({ type: 'show', seat, kind: a.kind, cards: hand.slice() });
      return endRound(s, seat, a.kind, ev, rng);
    }
    if (a.type !== 'lead' || !Array.isArray(a.cards) || !a.cards.length || !hasAll(hand, a.cards) || !a.cards.every((c) => c.s === a.cards[0].s)) return null;
    s.hands[seat] = without(hand, a.cards);
    s.lead = { seat, cards: a.cards.slice() };
    s.best = { seat, cards: a.cards.slice() };
    s.answers = [];
    s.phase = 'answer';
    s.turn = nextIn(s.seats, seat);
    ev.push({ type: 'lead', seat, cards: a.cards.slice() });
    return { state: s, events: ev };
  }
  // ответ на заход
  const lead = s.lead!;
  const best = s.best!;
  if (a.type !== 'beat' && a.type !== 'skip') return null;
  if (!Array.isArray(a.cards) || a.cards.length !== lead.cards.length || !hasAll(hand, a.cards)) return null;
  if (a.type === 'beat' && !covers(a.cards, best.cards, s.trump)) return null;
  s.hands[seat] = without(hand, a.cards);
  s.answers.push({ seat, beat: a.type === 'beat', cards: a.cards.slice() });
  if (a.type === 'beat') {
    s.best = { seat, cards: a.cards.slice() };
    ev.push({ type: 'beat', seat, cards: a.cards.slice() });
  } else ev.push({ type: 'skip', seat, count: a.cards.length, cards: a.cards.slice() });
  const next = nextIn(s.seats, seat);
  if (next !== lead.seat) {
    s.turn = next;
    return { state: s, events: ev };
  }
  // все ответили — взятка тому, кто держит
  const w = s.best!.seat;
  const all = [...lead.cards, ...s.answers.flatMap((x) => x.cards)];
  s.piles[w] = [...s.piles[w], ...all];
  s.tricks[w]++;
  ev.push({ type: 'take', seat: w, count: all.length });
  s.lead = null;
  s.best = null;
  s.answers = [];
  // добор до трёх, первым — взявший
  const deck = s.deck.slice();
  let p = w;
  for (let i = 0; i < s.seats.length; i++) {
    const need = Math.max(0, 3 - s.hands[p].length);
    const got = deck.splice(0, need);
    if (got.length) {
      s.hands[p] = [...s.hands[p], ...got];
      ev.push({ type: 'draw', seat: p, count: got.length, cards: got });
    }
    p = nextIn(s.seats, p);
  }
  s.deck = deck;
  s.phase = 'lead';
  s.turn = w;
  // карты кончились — у кого больше очков
  if (!s.seats.some((x) => s.hands[x].length)) {
    const pts = s.piles.map(pilePoints);
    const top = Math.max(...s.seats.map((x) => pts[x]));
    const best2 = s.seats.filter((x) => pts[x] === top);
    return endRound(s, best2.length === 1 ? best2[0] : null, 'cards', ev, rng);
  }
  // кому заходить нечем (рука пуста, а у других есть) — заходит следующий с картами
  while (!s.hands[s.turn].length) s.turn = nextIn(s.seats, s.turn);
  return { state: s, events: ev };
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const see = (x: number) => seats === 'all' || seats.includes(x);
  const v = s as Partial<View>;
  return {
    ...s,
    hands: s.hands.map((h, i) => (see(i) ? h.slice() : [])),
    deck: [],
    // скинутые втёмную и взятки соперников не видны
    piles: s.piles.map((p, i) => (see(i) ? p.slice() : [])),
    answers: s.answers.map((x) => (x.beat || see(x.seat) ? x : { ...x, cards: [] })),
    counts: s.hands.map((h, i) => v.counts?.[i] ?? h.length),
    deckCount: v.deckCount ?? s.deck.length,
    pts: s.piles.map((p, i) => (see(i) && (!s.cfg.blind || seats === 'all') ? pilePoints(p) : -1)),
    me: seats === 'all' ? s.seats.slice() : seats.slice(),
  };
}

export const handCount = (s: State, seat: number) => ((s as Partial<View>).counts ? (s as View).counts[seat] : s.hands[seat].length);
export const deckLeft = (s: State) => ((s as Partial<View>).deckCount ?? s.deck.length);
