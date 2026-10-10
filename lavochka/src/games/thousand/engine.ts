/* Тысяча — правила (без DOM). Колода 24 карты (9…Т), втроём или вчетвером (сдающий тогда «на прикупе» и не играет).
 *
 * Очки карт: Т 11, 10 — 10, К 4, Д 3, В 2, 9 — 0; всего в колоде 120. Старшинство: Т > 10 > К > Д > В > 9.
 * Раздача: по 7 карт, 3 — в прикуп. Торговля с 100 (первый за сдающим «сидит на ста»), шаг 5; больше 120 — только с марьяжем на руке.
 * Взявший прикуп показывает его, отдаёт по карте каждому сопернику и может поднять заказ. Первым ходит он.
 * Ходят в масть; нет масти — козырем (если есть козырь); нет и козыря — чем угодно.
 * Марьяж (К и Д одной масти): ♥ 100, ♦ 80, ♣ 60, ♠ 40 — объявляют, заходя с короля или дамы пары, не в первый ход кона; масть становится козырем.
 * Итог: заказчик набрал заказ — пишет заказ, нет — минус заказ. Остальные — свои очки (взятки + марьяжи), округлённые до 5.
 * Бочка: с 880 очков — «на бочке»: выше не пишут, чтобы выйти на 1000, надо сыграть свой заказ; три неудачи — минус 120.
 * Болт: кон без единой взятки; три болта — минус 120. Самосвал: ровно 555 — сгорает до нуля. Партия до 1000.
 */
import type { Options, Rng } from '../../core/types';
import { sameCard, type Card, type Suit } from '../../cards/deck';

export interface Cfg {
  barrel: boolean;
  bolts: boolean;
  dump: boolean;
  /** Шаг торговли. */
  step: 5 | 10;
}

export function cfgFrom(o: Options): Cfg {
  return { barrel: o.barrel !== false, bolts: o.bolts !== false, dump: !!o.dump, step: Number(o.step) === 10 ? 10 : 5 };
}

export const POINTS: Record<number, number> = { 14: 11, 10: 10, 13: 4, 12: 3, 11: 2, 9: 0 };
/** Порядок старшинства (больше — старше). */
export const POWER: Record<number, number> = { 14: 6, 10: 5, 13: 4, 12: 3, 11: 2, 9: 1 };
export const MARRIAGE: Record<Suit, number> = { H: 100, D: 80, C: 60, S: 40 };
export const BARREL = 880;
export const GOAL = 1000;

export type Phase = 'bid' | 'give' | 'raise' | 'play' | 'over';

export interface Trick {
  leader: number;
  cards: { seat: number; card: Card }[];
}

export interface State {
  cfg: Cfg;
  seats: number[];
  /** Кто сдаёт (вчетвером не играет). */
  dealer: number;
  /** Кто играет этот кон (без сдающего, если игроков четверо). */
  players: number[];
  hands: Card[][];
  prikup: Card[];
  /** Прикуп открыт (после торговли). */
  shown: boolean;
  phase: Phase;
  turn: number;
  bid: number;
  bidder: number;
  /** Кто спасовал в торговле. */
  passed: number[];
  /** Кому заказчик уже отдал карту. */
  given: number[];
  trump: Suit | null;
  trick: Trick | null;
  /** Последняя взятка — показывается до следующего хода. */
  lastTrick: Trick | null;
  /** Очки за кон (взятки + марьяжи). */
  roundPts: number[];
  tricksTaken: number[];
  marriages: { seat: number; suit: Suit }[];
  /** Сколько ходов в коне сделано (первый ход — без марьяжа). */
  tricksPlayed: number;
  /** Общий счёт. */
  scores: number[];
  /** Запись по конам: строки «пули». */
  sheet: { round: number; deltas: number[]; bidder: number; bid: number; made: boolean }[];
  bolts: number[];
  /** Сколько конов сидит на бочке (0 — не на бочке). */
  barrel: number[];
  round: number;
  winner: number | null;
}

export interface View extends State {
  counts: number[];
  me: number[];
}

export type Action =
  | { type: 'bid'; value: number }
  | { type: 'pass' }
  | { type: 'give'; to: number; card: Card }
  | { type: 'raise'; value: number }
  | { type: 'play'; card: Card; marriage?: boolean };

export type Event =
  | { type: 'deal'; round: number; dealer: number; counts: number[]; hands?: Card[][]; dealerBonus?: number }
  | { type: 'bid'; seat: number; value: number }
  | { type: 'pass'; seat: number }
  | { type: 'prikup'; seat: number; bid: number; cards: Card[] }
  | { type: 'give'; seat: number; to: number; card?: Card }
  | { type: 'raise'; seat: number; value: number }
  | { type: 'play'; seat: number; card: Card; marriage?: Suit; trump: Suit | null }
  | { type: 'trick'; winner: number; points: number; cards: Card[] }
  | { type: 'score'; deltas: number[]; scores: number[]; bidder: number; bid: number; made: boolean; pts: number[]; notes: string[] }
  | { type: 'end'; winner: number; scores: number[] };

// ---------------------------------------------------------------- карты

export function makeDeck24(): Card[] {
  const out: Card[] = [];
  for (const s of ['S', 'C', 'D', 'H'] as Suit[]) for (const r of [9, 10, 11, 12, 13, 14]) out.push({ s, r });
  return out;
}

export const has = (hand: Card[], c: Card) => hand.some((x) => sameCard(x, c));
export const handPoints = (cards: Card[]) => cards.reduce((a, c) => a + POINTS[c.r], 0);
/** Марьяжи на руке. */
export const marriagesIn = (hand: Card[]): Suit[] =>
  (['H', 'D', 'C', 'S'] as Suit[]).filter((s) => hand.some((c) => c.s === s && c.r === 13) && hand.some((c) => c.s === s && c.r === 12));
/** Сколько можно заказать: 120 и марьяжи на руке. */
export const maxBid = (hand: Card[]) => 120 + marriagesIn(hand).reduce((a, s) => a + MARRIAGE[s], 0);
export const round5 = (n: number) => Math.round(n / 5) * 5;

const nextIn = (list: number[], seat: number) => list[(list.indexOf(seat) + 1) % list.length];

/** Какие карты можно положить. */
export function legalCards(s: Pick<State, 'trick' | 'trump' | 'hands'>, seat: number): Card[] {
  const hand = s.hands[seat];
  const t = s.trick;
  if (!t || !t.cards.length) return hand.slice();
  const lead = t.cards[0].card.s;
  const follow = hand.filter((c) => c.s === lead);
  if (follow.length) return follow;
  if (s.trump) {
    const tr = hand.filter((c) => c.s === s.trump);
    if (tr.length) return tr;
  }
  return hand.slice();
}

/** Кто берёт взятку. */
export function trickWinner(t: Trick, trump: Suit | null): number {
  const lead = t.cards[0].card.s;
  let best = t.cards[0];
  for (const x of t.cards.slice(1)) {
    const c = x.card;
    const b = best.card;
    const beats = c.s === b.s ? POWER[c.r] > POWER[b.r] : trump != null && c.s === trump && b.s !== trump ? true : false;
    if (beats && (c.s === lead || c.s === trump)) best = x;
  }
  return best.seat;
}

// ---------------------------------------------------------------- партия

export function newState(cfg: Cfg, seats: number[]): State {
  const n = 4;
  return {
    cfg,
    seats: seats.slice(),
    dealer: seats[seats.length - 1],
    players: [],
    hands: Array.from({ length: n }, () => []),
    prikup: [],
    shown: false,
    phase: 'bid',
    turn: seats[0],
    bid: 100,
    bidder: -1,
    passed: [],
    given: [],
    trump: null,
    trick: null,
    lastTrick: null,
    roundPts: Array(n).fill(0),
    tricksTaken: Array(n).fill(0),
    marriages: [],
    tricksPlayed: 0,
    scores: Array(n).fill(0),
    sheet: [],
    bolts: Array(n).fill(0),
    barrel: Array(n).fill(0),
    round: 0,
    winner: null,
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

/** Новый кон: сдаёт следующий по кругу. */
export function deal(s0: State, rng: Rng): { state: State; events: Event[] } {
  const dealer = s0.round === 0 ? s0.seats[s0.seats.length - 1] : nextIn(s0.seats, s0.dealer);
  const players = s0.seats.length === 4 ? s0.seats.filter((x) => x !== dealer) : s0.seats.slice();
  const deck = shuffle(makeDeck24(), rng);
  const hands: Card[][] = [[], [], [], []];
  for (const p of players) hands[p] = deck.splice(0, 7);
  const prikup = deck.splice(0, 3);
  // первым торгуется следующий за сдающим (вчетвером — среди играющих), он «сидит на ста»
  const first = s0.seats.length === 4 ? nextIn(s0.seats, dealer) : nextIn(players, dealer);
  const s: State = {
    ...s0,
    dealer,
    players,
    hands,
    prikup,
    shown: false,
    phase: 'bid',
    turn: nextIn(players, first),
    bid: 100,
    bidder: first,
    passed: [],
    given: [],
    trump: null,
    trick: null,
    lastTrick: null,
    roundPts: [0, 0, 0, 0],
    tricksTaken: [0, 0, 0, 0],
    marriages: [],
    tricksPlayed: 0,
    round: s0.round + 1,
    scores: s0.scores.slice(),
  };
  const ev: Event[] = [];
  // вчетвером сдающему — марьяж из прикупа
  let bonus = 0;
  if (s0.seats.length === 4) {
    for (const suit of marriagesIn(prikup)) bonus += MARRIAGE[suit];
    if (bonus) s.scores[dealer] = capScore(s, s.scores[dealer] + bonus);
  }
  ev.push({ type: 'deal', round: s.round, dealer, counts: hands.map((h) => h.length), hands: hands.map((h) => h.slice()), dealerBonus: bonus || undefined });
  return { state: s, events: ev };
}

/** На бочке выше 880 не пишут: выйти на 1000 можно только своим заказом. */
function capScore(s: State, v: number): number {
  return s.cfg.barrel && v > BARREL ? BARREL : v;
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  return deal(newState(cfgFrom(opts), seats), rng).state;
}

export const toAct = (s: State): number[] => (s.phase === 'over' ? [] : [s.turn]);

/** Следующий в торговле, кто ещё не спасовал. */
function nextBidder(s: State, seat: number): number {
  let x = seat;
  for (let i = 0; i < 4; i++) {
    x = nextIn(s.players, x);
    if (!s.passed.includes(x)) return x;
  }
  return seat;
}

function startPlay(s: State, ev: Event[]) {
  // прикуп — заказчику
  s.hands = s.hands.map((h, i) => (i === s.bidder ? [...h, ...s.prikup] : h));
  ev.push({ type: 'prikup', seat: s.bidder, bid: s.bid, cards: s.prikup.slice() });
  s.shown = true;
  s.phase = 'give';
  s.turn = s.bidder;
  s.given = [];
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.phase === 'over' || seat !== s0.turn || !a || typeof a !== 'object') return null;
  const ev: Event[] = [];
  const s: State = { ...s0, hands: s0.hands.slice(), passed: s0.passed.slice(), given: s0.given.slice(), roundPts: s0.roundPts.slice(), tricksTaken: s0.tricksTaken.slice() };
  switch (s0.phase) {
    case 'bid': {
      if (a.type === 'bid') {
        const step = s.cfg.step;
        if (!Number.isInteger(a.value) || a.value <= s.bid || a.value % 5 !== 0 || a.value < s.bid + step || a.value > maxBid(s.hands[seat])) return null;
        s.bid = a.value;
        s.bidder = seat;
        ev.push({ type: 'bid', seat, value: a.value });
      } else if (a.type === 'pass') {
        s.passed.push(seat);
        ev.push({ type: 'pass', seat });
      } else return null;
      const left = s.players.filter((x) => !s.passed.includes(x));
      // торговля кончилась: остался один, и он уже назвал (или все спасовали — играет тот, кто «на ста»)
      if (left.length === 1 && (left[0] === s.bidder || !s.players.includes(s.bidder))) {
        s.bidder = left[0];
        startPlay(s, ev);
      } else if (!left.length) startPlay(s, ev);
      else if (left.length === 1 && left[0] !== s.bidder) {
        // остался только «сидящий на ста», а выше никто не дал — он и играет
        s.bidder = left[0];
        startPlay(s, ev);
      } else s.turn = nextBidder(s, seat);
      return { state: s, events: ev };
    }
    case 'give': {
      if (a.type !== 'give' || !s.players.includes(a.to) || a.to === seat || s.given.includes(a.to) || !has(s.hands[seat], a.card)) return null;
      s.hands[seat] = s.hands[seat].filter((c) => !sameCard(c, a.card));
      s.hands[a.to] = [...s.hands[a.to], a.card];
      s.given.push(a.to);
      ev.push({ type: 'give', seat, to: a.to, card: a.card });
      if (s.given.length === s.players.length - 1) s.phase = 'raise';
      return { state: s, events: ev };
    }
    case 'raise': {
      if (a.type !== 'raise' || !Number.isInteger(a.value) || a.value < s.bid || a.value % 5 !== 0 || a.value > Math.max(s.bid, maxBid(s.hands[seat]))) return null;
      if (a.value > s.bid) ev.push({ type: 'raise', seat, value: a.value });
      s.bid = a.value;
      s.phase = 'play';
      s.turn = s.bidder;
      return { state: s, events: ev };
    }
    case 'play': {
      if (a.type !== 'play' || !has(s.hands[seat], a.card)) return null;
      if (!legalCards(s, seat).some((c) => sameCard(c, a.card))) return null;
      const leading = !s.trick || !s.trick.cards.length;
      let marriage: Suit | undefined;
      if (a.marriage) {
        const pair = marriagesIn(s.hands[seat]);
        if (!leading || s.tricksPlayed === 0 || (a.card.r !== 13 && a.card.r !== 12) || !pair.includes(a.card.s)) return null;
        marriage = a.card.s;
        s.trump = a.card.s;
        s.roundPts[seat] += MARRIAGE[marriage];
        s.marriages = [...s.marriages, { seat, suit: marriage }];
      }
      s.hands[seat] = s.hands[seat].filter((c) => !sameCard(c, a.card));
      const trick: Trick = leading ? { leader: seat, cards: [] } : { leader: s.trick!.leader, cards: s.trick!.cards.slice() };
      trick.cards.push({ seat, card: a.card });
      ev.push({ type: 'play', seat, card: a.card, marriage, trump: s.trump });
      if (trick.cards.length < s.players.length) {
        s.trick = trick;
        s.turn = nextIn(s.players, seat);
        return { state: s, events: ev };
      }
      const w = trickWinner(trick, s.trump);
      const pts = handPoints(trick.cards.map((x) => x.card));
      s.roundPts[w] += pts;
      s.tricksTaken[w]++;
      s.tricksPlayed++;
      s.trick = null;
      s.lastTrick = trick;
      ev.push({ type: 'trick', winner: w, points: pts, cards: trick.cards.map((x) => x.card) });
      if (s.hands[w].length) {
        s.turn = w;
        return { state: s, events: ev };
      }
      return scoreRound(s, ev, rng);
    }
  }
  return null;
}

function scoreRound(s: State, ev: Event[], rng: Rng): { state: State; events: Event[] } {
  const deltas = [0, 0, 0, 0];
  const notes: string[] = [];
  const scores = s.scores.slice();
  const bolts = s.bolts.slice();
  const barrel = s.barrel.slice();
  const made = s.roundPts[s.bidder] >= s.bid;
  const fresh: number[] = [];
  for (const p of s.players) {
    // на бочке очки обороняющегося не пишутся
    let d = p === s.bidder ? (made ? s.bid : -s.bid) : s.cfg.barrel && barrel[p] > 0 ? 0 : round5(s.roundPts[p]);
    let v = scores[p] + d;
    if (s.cfg.bolts && s.tricksTaken[p] === 0) {
      bolts[p]++;
      notes.push(`bolt:${p}`);
      if (bolts[p] >= 3) {
        bolts[p] = 0;
        v -= 120;
        notes.push(`bolt3:${p}`);
      }
    }
    if (s.cfg.barrel) {
      if (barrel[p] > 0) {
        if (v >= GOAL && p === s.bidder && made) barrel[p] = 0;
        else if (v < BARREL) barrel[p] = 0;
        else {
          v = BARREL;
          barrel[p]++;
          if (barrel[p] > 3) {
            barrel[p] = 0;
            v = BARREL - 120;
            notes.push(`fall:${p}`);
          }
        }
      } else if (v >= BARREL) {
        v = BARREL;
        barrel[p] = 1;
        fresh.push(p);
        notes.push(`barrel:${p}`);
      }
    }
    if (s.cfg.dump && v === 555) {
      v = 0;
      notes.push(`dump:${p}`);
    }
    d = v - scores[p];
    deltas[p] = d;
    scores[p] = v;
  }
  // двое на бочке не сидят: кто сел раньше — слетает
  if (fresh.length)
    for (const q of s.seats)
      if (!fresh.includes(q) && barrel[q] > 0) {
        barrel[q] = 0;
        deltas[q] += BARREL - 120 - scores[q];
        scores[q] = BARREL - 120;
        notes.push(`fall:${q}`);
      }
  const st: State = { ...s, scores, bolts, barrel, sheet: [...s.sheet, { round: s.round, deltas, bidder: s.bidder, bid: s.bid, made }] };
  ev.push({ type: 'score', deltas, scores: scores.slice(), bidder: s.bidder, bid: s.bid, made, pts: s.roundPts.slice(), notes });
  const top = Math.max(...s.seats.map((x) => scores[x]));
  if (top >= GOAL) {
    const winner = s.seats.filter((x) => scores[x] === top).sort((x, y) => (x === s.bidder ? -1 : y === s.bidder ? 1 : 0))[0];
    st.phase = 'over';
    st.winner = winner;
    ev.push({ type: 'end', winner, scores: scores.slice() });
    return { state: st, events: ev };
  }
  const d = deal(st, rng);
  return { state: d.state, events: [...ev, ...d.events] };
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const see = (x: number) => seats === 'all' || seats.includes(x);
  return {
    ...s,
    hands: s.hands.map((h, i) => (see(i) ? h.slice() : [])),
    prikup: s.shown ? s.prikup.slice() : [],
    // повторный вызов на готовом виде (превью) не теряет счётчиков
    counts: s.hands.map((h, i) => (s as Partial<View>).counts?.[i] ?? h.length),
    me: seats === 'all' ? s.seats.slice() : seats.slice(),
  };
}

export const handCount = (s: State, seat: number) => ((s as Partial<View>).counts ? (s as View).counts[seat] : s.hands[seat].length);
