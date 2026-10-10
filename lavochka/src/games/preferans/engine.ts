/* Преферанс — правила (без DOM): «Сочи» и «Ленинград». Колода 32 карты (7…Т), трое (вчетвером сдающий не играет).
 *
 * По 10 карт, 2 — прикуп. Торговля: 6♠ < 6♣ < 6♦ < 6♥ < 6БК < 7♠ … < 8БК < мизер < 9♠ … < 10БК; кто спасовал — больше не торгуется.
 * Мизер можно заявить только первым своим словом. Все спасовали — распасы.
 * Взявший игру берёт прикуп (его видят все), сносит две карты и заказывает игру не ниже своей ставки.
 * Вистующие по очереди: «вист» или «пас». Оба спасовали — игра считается сыгранной. Один вистует — играет «в светлую»: карты пасующего открыты, ходит за него вистующий.
 * Ход: в масть; нет масти — козырем; нет и козыря — любую. Первым ходит первая рука (следующий за сдающим).
 * Мизер: заказчик не должен взять ни одной взятки; ловящие открывают карты после первой взятки.
 * Распасы: каждый старается взять меньше; первые две взятки заходят картами прикупа.
 *
 * Запись: пуля (сыгранные игры: 6 — 2, 7 — 4, 8 — 6, 9 — 8, 10 — 10, мизер — 10), гора (штраф), висты (на других игроков).
 * Обязательные взятки вистующих: на 6 — 4, на 7 — 2, на 8–10 — 1. Вистующий пишет на заказчика цену игры за каждую свою взятку.
 * Недобор заказчика — в гору цену за каждую недобранную, вистующим — «консоляция» (столько же вистов на заказчика).
 * Распасы: каждая взятка — в гору (в «Ленинграде» — с прогрессией подряд идущих распасов), ни одной — в пулю 1.
 * Пуля переполнена — лишнее закрывает пулю другим, а за помощь пишутся висты на них. Партия кончается, когда все пули закрыты.
 * Итог: висты на других минус висты на тебя плюс разница горы (гора — по 10 вистов за очко, делится между всеми).
 */
import type { Options, Rng } from '../../core/types';
import { sameCard, type Card, type Suit } from '../../cards/deck';

export type Variant = 'sochi' | 'leningrad';
export type Trump = Suit | 'NT';

export interface Cfg {
  variant: Variant;
  /** Пуля — до скольких. */
  pulya: number;
}

export function cfgFrom(o: Options): Cfg {
  return { variant: o.variant === 'leningrad' ? 'leningrad' : 'sochi', pulya: [10, 20, 30].includes(Number(o.pulya)) ? Number(o.pulya) : 10 };
}

/** Ставка: уровень 6–10 и масть, или мизер. */
export type Bid = { level: number; trump: Trump } | { misere: true };

export const BID_SUITS: Trump[] = ['S', 'C', 'D', 'H', 'NT'];
export const VALUE: Record<number, number> = { 6: 2, 7: 4, 8: 6, 9: 8, 10: 10 };
export const MISERE_VALUE = 10;
/** Сколько взяток должны взять вистующие вместе. */
export const DUTY: Record<number, number> = { 6: 4, 7: 2, 8: 1, 9: 1, 10: 1 };
export const RANKS = [7, 8, 9, 10, 11, 12, 13, 14];

const isMis = (b: Bid): b is { misere: true } => 'misere' in b;
export const isMisere = isMis;

/** Номер ставки для сравнения: 6♠ = 0 … 8БК = 14, мизер = 14.5, 9♠ = 15 … 10БК = 24. */
export function bidRank(b: Bid): number {
  if (isMis(b)) return 14.5;
  return (b.level - 6) * 5 + BID_SUITS.indexOf(b.trump);
}

export function allBids(): Bid[] {
  const out: Bid[] = [];
  for (let l = 6; l <= 10; l++) {
    for (const t of BID_SUITS) out.push({ level: l, trump: t });
    if (l === 8) out.push({ misere: true });
  }
  return out;
}

export const sameBid = (a: Bid, b: Bid) => bidRank(a) === bidRank(b);

export interface Trick {
  leader: number;
  cards: { seat: number; card: Card }[];
  /** Распасы: карта прикупа, задающая масть. */
  prikup?: Card;
}

export type Phase = 'bid' | 'discard' | 'contract' | 'whist' | 'play' | 'over';

export interface State {
  cfg: Cfg;
  seats: number[];
  players: number[];
  dealer: number;
  hands: Card[][];
  prikup: Card[];
  /** Снос (видит только заказчик). */
  discard: Card[];
  phase: Phase;
  turn: number;
  /** Торговля. */
  bid: Bid | null;
  bidder: number;
  /** Кто уже говорил что-то кроме паса (для мизера). */
  spoke: number[];
  passed: number[];
  /** Игра: заказ или распасы. */
  kind: 'game' | 'misere' | 'raspasy' | null;
  contract: Bid | null;
  declarer: number;
  /** Решения вистующих: 'whist' | 'pass'. */
  whist: Record<number, 'whist' | 'pass'>;
  /** Игра в светлую: карты этого пасующего открыты, за него ходит вистующий. */
  open: number | null;
  trump: Trump | null;
  trick: Trick | null;
  lastTrick: Trick | null;
  tricks: number[];
  tricksPlayed: number;
  /** Подряд идущих распасов (Ленинград: прогрессия). */
  raspasyRun: number;
  pulya: number[];
  gora: number[];
  /** whists[a][b] — висты игрока a на игрока b. */
  whists: number[][];
  round: number;
  /** Итоговые очки в вистах (после закрытия пули). */
  final: number[] | null;
}

export interface View extends State {
  counts: number[];
  me: number[];
}

export type Action =
  | { type: 'bid'; bid: Bid }
  | { type: 'pass' }
  | { type: 'discard'; cards: Card[] }
  | { type: 'contract'; bid: Bid }
  | { type: 'whist' }
  | { type: 'pass-whist' }
  | { type: 'play'; card: Card };

export type Event =
  | { type: 'deal'; round: number; dealer: number; counts: number[]; hands?: Card[][] }
  | { type: 'bid'; seat: number; bid: Bid }
  | { type: 'pass'; seat: number }
  | { type: 'prikup'; seat: number; cards: Card[] }
  | { type: 'raspasy' }
  | { type: 'discard'; seat: number; cards?: Card[] }
  | { type: 'contract'; seat: number; bid: Bid }
  | { type: 'whist'; seat: number; whist: boolean }
  | { type: 'open'; seat: number; cards: Card[] }
  | { type: 'play'; seat: number; card: Card }
  | { type: 'trick'; winner: number; prikup?: Card }
  | { type: 'score'; kind: 'game' | 'misere' | 'raspasy' | 'free'; players: number[]; declarer: number; contract: Bid | null; tricks: number[]; made: boolean; pulya: number[]; gora: number[]; whists: number[][]; notes: string[] }
  | { type: 'end'; final: number[] };

// ---------------------------------------------------------------- карты

export function makeDeck32(): Card[] {
  const out: Card[] = [];
  for (const s of ['S', 'C', 'D', 'H'] as Suit[]) for (const r of RANKS) out.push({ s, r });
  return out;
}

export const has = (h: Card[], c: Card) => h.some((x) => sameCard(x, c));
const nextIn = (list: number[], seat: number) => list[(list.indexOf(seat) + 1) % list.length];

export function legalCards(s: Pick<State, 'trick' | 'trump' | 'hands'>, seat: number): Card[] {
  const hand = s.hands[seat];
  const t = s.trick;
  const lead = t ? (t.cards.length ? t.cards[0].card.s : t.prikup?.s) : undefined;
  if (!lead) return hand.slice();
  const follow = hand.filter((c) => c.s === lead);
  if (follow.length) return follow;
  if (s.trump && s.trump !== 'NT') {
    const tr = hand.filter((c) => c.s === s.trump);
    if (tr.length) return tr;
  }
  return hand.slice();
}

export function trickWinner(t: Trick, trump: Trump | null): number {
  const lead = t.cards.length ? (t.prikup ? t.prikup.s : t.cards[0].card.s) : t.prikup!.s;
  let best: { seat: number; card: Card } | null = null;
  for (const x of t.cards) {
    const c = x.card;
    if (!best) {
      if (c.s === lead || (trump && trump !== 'NT' && c.s === trump)) best = x;
      continue;
    }
    const b = best.card;
    const tr = trump && trump !== 'NT' ? trump : null;
    const better = c.s === b.s ? c.r > b.r : tr != null && c.s === tr && b.s !== tr;
    if (better) best = x;
  }
  // распасы: в масть прикупа не пошёл никто — взятка заходившему
  return best ? best.seat : t.leader;
}

// ---------------------------------------------------------------- партия

export function newState(cfg: Cfg, seats: number[]): State {
  return {
    cfg,
    seats: seats.slice(),
    players: [],
    dealer: seats[seats.length - 1],
    hands: [[], [], [], []],
    prikup: [],
    discard: [],
    phase: 'bid',
    turn: seats[0],
    bid: null,
    bidder: -1,
    spoke: [],
    passed: [],
    kind: null,
    contract: null,
    declarer: -1,
    whist: {},
    open: null,
    trump: null,
    trick: null,
    lastTrick: null,
    tricks: [0, 0, 0, 0],
    tricksPlayed: 0,
    raspasyRun: 0,
    pulya: [0, 0, 0, 0],
    gora: [0, 0, 0, 0],
    whists: [0, 1, 2, 3].map(() => [0, 0, 0, 0]),
    round: 0,
    final: null,
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
  const players = s0.seats.length === 4 ? s0.seats.filter((x) => x !== dealer) : s0.seats.slice();
  const deck = shuffle(makeDeck32(), rng);
  const hands: Card[][] = [[], [], [], []];
  for (const p of players) hands[p] = deck.splice(0, 10);
  const first = s0.seats.length === 4 ? nextIn(s0.seats, dealer) : nextIn(players, dealer);
  const s: State = {
    ...s0,
    dealer,
    players,
    hands,
    prikup: deck.splice(0, 2),
    discard: [],
    phase: 'bid',
    turn: first,
    bid: null,
    bidder: -1,
    spoke: [],
    passed: [],
    kind: null,
    contract: null,
    declarer: -1,
    whist: {},
    open: null,
    trump: null,
    trick: null,
    lastTrick: null,
    tricks: [0, 0, 0, 0],
    tricksPlayed: 0,
    round: s0.round + 1,
  };
  return { state: s, events: [{ type: 'deal', round: s.round, dealer, counts: hands.map((h) => h.length), hands: hands.map((h) => h.slice()) }] };
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  return deal(newState(cfgFrom(opts), seats), rng).state;
}

/** Кто действует: при игре в светлую за открытого пасующего ходит вистующий. */
export function toAct(s: State): number[] {
  if (s.phase === 'over') return [];
  if (s.phase === 'play' && s.open != null && s.turn === s.open) {
    const w = s.players.find((x) => s.whist[x] === 'whist');
    return w != null ? [w] : [s.turn];
  }
  return [s.turn];
}

/** Первая рука — следующий за сдающим среди играющих. */
const firstHand = (s: State) => (s.seats.length === 4 ? nextIn(s.seats, s.dealer) : nextIn(s.players, s.dealer));

function nextBidder(s: State, seat: number): number {
  let x = seat;
  for (let i = 0; i < 4; i++) {
    x = nextIn(s.players, x);
    if (!s.passed.includes(x)) return x;
  }
  return seat;
}

function startRaspasy(s: State, ev: Event[]) {
  s.kind = 'raspasy';
  s.contract = null;
  s.declarer = -1;
  s.trump = null;
  s.phase = 'play';
  const lead = firstHand(s);
  s.trick = { leader: lead, cards: [], prikup: s.prikup[0] };
  s.turn = lead;
  ev.push({ type: 'raspasy' });
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.phase === 'over' || !a || typeof a !== 'object') return null;
  // за открытого пасующего ходит вистующий
  const actor = toAct(s0)[0];
  if (seat !== actor) return null;
  const who = s0.turn;
  const ev: Event[] = [];
  const s: State = { ...s0, hands: s0.hands.slice(), passed: s0.passed.slice(), spoke: s0.spoke.slice(), tricks: s0.tricks.slice(), whist: { ...s0.whist } };
  switch (s0.phase) {
    case 'bid': {
      if (a.type === 'bid') {
        const b = a.bid;
        if (!b || (isMis(b) ? false : !(b.level >= 6 && b.level <= 10 && BID_SUITS.includes(b.trump)))) return null;
        if (s.bid && bidRank(b) <= bidRank(s.bid)) return null;
        if (isMis(b) && s.spoke.includes(who)) return null;
        // после мизера играть можно только девятерную и выше
        s.bid = b;
        s.bidder = who;
        if (!s.spoke.includes(who)) s.spoke.push(who);
        ev.push({ type: 'bid', seat: who, bid: b });
      } else if (a.type === 'pass') {
        s.passed.push(who);
        ev.push({ type: 'pass', seat: who });
      } else return null;
      const left = s.players.filter((x) => !s.passed.includes(x));
      if (!left.length || (left.length === 1 && s.bid && left[0] === s.bidder)) {
        if (!s.bid) startRaspasy(s, ev);
        else {
          // игра — заказчику: прикуп ему в руку
          s.declarer = s.bidder;
          s.kind = isMis(s.bid) ? 'misere' : 'game';
          ev.push({ type: 'prikup', seat: s.declarer, cards: s.prikup.slice() });
          s.hands[s.declarer] = [...s.hands[s.declarer], ...s.prikup];
          s.phase = 'discard';
          s.turn = s.declarer;
        }
      } else if (left.length === 1 && !s.bid) {
        // остался один, а ставок не было — он ещё может сказать или спасовать (тогда распасы)
        s.turn = left[0];
      } else s.turn = nextBidder(s, who);
      return { state: s, events: ev };
    }
    case 'discard': {
      if (a.type !== 'discard' || !Array.isArray(a.cards) || a.cards.length !== 2 || sameCard(a.cards[0], a.cards[1])) return null;
      const hand = s.hands[who];
      if (!a.cards.every((c) => has(hand, c))) return null;
      s.hands[who] = hand.filter((c) => !a.cards.some((x) => sameCard(x, c)));
      s.discard = a.cards.slice();
      ev.push({ type: 'discard', seat: who, cards: a.cards.slice() });
      if (s.kind === 'misere') {
        s.contract = { misere: true };
        s.trump = null;
        beginPlay(s);
      } else s.phase = 'contract';
      return { state: s, events: ev };
    }
    case 'contract': {
      if (a.type !== 'contract' || !a.bid || isMis(a.bid) || bidRank(a.bid) < bidRank(s.bid!) || !BID_SUITS.includes(a.bid.trump)) return null;
      s.contract = a.bid;
      s.trump = a.bid.trump;
      ev.push({ type: 'contract', seat: who, bid: a.bid });
      s.phase = 'whist';
      s.turn = nextIn(s.players, who);
      return { state: s, events: ev };
    }
    case 'whist': {
      if (a.type !== 'whist' && a.type !== 'pass-whist') return null;
      s.whist[who] = a.type === 'whist' ? 'whist' : 'pass';
      ev.push({ type: 'whist', seat: who, whist: a.type === 'whist' });
      const defs = s.players.filter((x) => x !== s.declarer);
      const next = defs.find((x) => !s.whist[x]);
      if (next != null) {
        s.turn = next;
        return { state: s, events: ev };
      }
      const ws = defs.filter((x) => s.whist[x] === 'whist');
      if (!ws.length) return scoreRound(s, ev, rng, true);
      if (ws.length === 1) {
        // в светлую: карты пасующего открыты, за него ходит вистующий
        s.open = defs.find((x) => s.whist[x] === 'pass')!;
        ev.push({ type: 'open', seat: s.open, cards: s.hands[s.open].slice() });
      }
      beginPlay(s);
      return { state: s, events: ev };
    }
    case 'play': {
      if (a.type !== 'play' || !has(s.hands[who], a.card) || !legalCards(s, who).some((c) => sameCard(c, a.card))) return null;
      s.hands[who] = s.hands[who].filter((c) => !sameCard(c, a.card));
      const t: Trick = s.trick ? { ...s.trick, cards: s.trick.cards.slice() } : { leader: who, cards: [] };
      t.cards.push({ seat: who, card: a.card });
      ev.push({ type: 'play', seat: who, card: a.card });
      if (t.cards.length < s.players.length) {
        s.trick = t;
        s.turn = nextIn(s.players, who);
        return { state: s, events: ev };
      }
      const w = trickWinner(t, s.trump);
      s.tricks[w]++;
      s.tricksPlayed++;
      s.lastTrick = t;
      ev.push({ type: 'trick', winner: w, prikup: t.prikup });
      // мизер: после первой взятки ловящие открываются
      if (s.kind === 'misere' && s.tricksPlayed === 1) for (const d of s.players.filter((x) => x !== s.declarer)) ev.push({ type: 'open', seat: d, cards: s.hands[d].slice() });
      if (!s.hands[w].length) return scoreRound(s, ev, rng, false);
      // распасы: вторая взятка тоже заходит прикупом
      if (s.kind === 'raspasy' && s.tricksPlayed === 1) {
        s.trick = { leader: firstHand(s), cards: [], prikup: s.prikup[1] };
        s.turn = firstHand(s);
      } else {
        s.trick = null;
        s.turn = w;
      }
      return { state: s, events: ev };
    }
  }
  return null;
}

function beginPlay(s: State) {
  s.phase = 'play';
  s.trick = null;
  // заходит первая рука
  s.turn = firstHand(s);
}

/** Пуля переполнена — лишнее закрывает пулю другим, а за помощь пишутся висты. */
function addPulya(s: State, p: number, v: number, notes: string[]) {
  const limit = s.cfg.pulya;
  const room = limit - s.pulya[p];
  if (v <= room) {
    s.pulya[p] += v;
    return;
  }
  s.pulya[p] = limit;
  let extra = v - Math.max(0, room);
  const others = s.players.filter((x) => x !== p).sort((a, b) => s.pulya[b] - s.pulya[a]);
  for (const o of others) {
    if (extra <= 0) break;
    const r = limit - s.pulya[o];
    if (r <= 0) continue;
    const give = Math.min(r, extra);
    s.pulya[o] += give;
    s.whists[p][o] += give * 10;
    extra -= give;
    notes.push(`help:${p}:${o}:${give}`);
  }
  // закрывать некому — остаток списывает гору
  if (extra > 0) s.gora[p] = Math.max(0, s.gora[p] - extra);
}

function scoreRound(s0: State, ev: Event[], rng: Rng, free: boolean): { state: State; events: Event[] } {
  const s: State = { ...s0, pulya: s0.pulya.slice(), gora: s0.gora.slice(), whists: s0.whists.map((r) => r.slice()) };
  const notes: string[] = [];
  const k2 = s.cfg.variant === 'leningrad' ? 2 : 1;
  let made = true;
  const kind: 'game' | 'misere' | 'raspasy' | 'free' = s.kind === 'raspasy' ? 'raspasy' : s.kind === 'misere' ? 'misere' : free ? 'free' : 'game';
  if (s.kind === 'raspasy') {
    const mult = s.cfg.variant === 'leningrad' ? s.raspasyRun + 1 : 1;
    for (const p of s.players) {
      if (s.tricks[p] === 0) addPulya(s, p, 1, notes);
      else s.gora[p] += s.tricks[p] * mult;
    }
    s.raspasyRun = s0.raspasyRun + 1;
  } else if (s.kind === 'misere') {
    const d = s.declarer;
    made = s.tricks[d] === 0;
    if (made) addPulya(s, d, MISERE_VALUE, notes);
    else s.gora[d] += MISERE_VALUE * s.tricks[d];
    s.raspasyRun = 0;
  } else {
    const c = s.contract as { level: number; trump: Trump };
    const d = s.declarer;
    const val = VALUE[c.level];
    const defs = s.players.filter((x) => x !== d);
    const ws = defs.filter((x) => s.whist[x] === 'whist');
    if (free) {
      // оба спасовали — игра сыграна
      addPulya(s, d, val, notes);
    } else {
      const got = s.tricks[d];
      made = got >= c.level;
      if (made) addPulya(s, d, val, notes);
      else {
        const under = c.level - got;
        s.gora[d] += val * under;
        // консоляция обоим обороняющимся
        for (const x of defs) s.whists[x][d] += val * under * k2;
      }
      // висты: вистующий пишет за свои взятки (в светлую — и за взятки пасующего)
      for (const x of ws) {
        const own = s.tricks[x] + (s.open != null && ws.length === 1 ? s.tricks[s.open] : 0);
        s.whists[x][d] += val * own * k2;
      }
      // недовист: вистующие вместе взяли меньше обязательного
      const duty = DUTY[c.level];
      const total = defs.reduce((a, x) => a + s.tricks[x], 0);
      if (made && total < duty && ws.length) {
        const short = duty - total;
        for (const x of ws) {
          s.gora[x] += Math.ceil((val * short) / ws.length);
          notes.push(`short:${x}`);
        }
      }
    }
    s.raspasyRun = 0;
  }
  ev.push({ type: 'score', kind, players: s.players.slice(), declarer: s.declarer, contract: s.contract, tricks: s.tricks.slice(), made, pulya: s.pulya.slice(), gora: s.gora.slice(), whists: s.whists.map((r) => r.slice()), notes });
  if (s.seats.every((p) => s.pulya[p] >= s.cfg.pulya)) {
    s.final = finalScores(s);
    s.phase = 'over';
    ev.push({ type: 'end', final: s.final.slice() });
    return { state: s, events: ev };
  }
  const d = deal(s, rng);
  return { state: d.state, events: [...ev, ...d.events] };
}

/** Итог в вистах: висты на других минус висты на тебя, плюс гора (10 вистов за очко) поровну на всех. */
export function finalScores(s: Pick<State, 'seats' | 'gora' | 'whists'>): number[] {
  const n = s.seats.length;
  const out = [0, 0, 0, 0];
  const goraSum = s.seats.reduce((a, p) => a + s.gora[p], 0);
  for (const p of s.seats) {
    let v = 0;
    for (const q of s.seats) if (q !== p) v += s.whists[p][q] - s.whists[q][p];
    v += ((goraSum - n * s.gora[p]) * 10) / n;
    out[p] = Math.round(v);
  }
  // из-за округления подгоняем последнего, чтобы сумма была ноль
  const last = s.seats[s.seats.length - 1];
  out[last] = -s.seats.slice(0, -1).reduce((a, p) => a + out[p], 0);
  return out;
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const misOpen = s.kind === 'misere' && s.tricksPlayed >= 1;
  const see = (x: number) =>
    seats === 'all' ||
    seats.includes(x) ||
    (s.open != null && x === s.open) ||
    (misOpen && x !== s.declarer);
  const v = s as Partial<View>;
  const prikupShown = s.phase !== 'bid' || s.kind === 'raspasy';
  return {
    ...s,
    hands: s.hands.map((h, i) => (see(i) ? h.slice() : [])),
    prikup: prikupShown ? s.prikup.slice() : [],
    discard: seats === 'all' || seats.includes(s.declarer) ? s.discard.slice() : [],
    counts: s.hands.map((h, i) => v.counts?.[i] ?? h.length),
    me: seats === 'all' ? s.seats.slice() : seats.slice(),
  };
}

export const handCount = (s: State, seat: number) => ((s as Partial<View>).counts ? (s as View).counts[seat] : s.hands[seat].length);

export function bidName(b: Bid | null): string {
  if (!b) return '—';
  if (isMis(b)) return 'мизер';
  return `${b.level}${b.trump === 'NT' ? ' БК' : { S: '♠', C: '♣', D: '♦', H: '♥' }[b.trump]}`;
}
