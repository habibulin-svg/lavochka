/* Тысяча — правила (без DOM). Колода 24 карты (9…Т), втроём или вчетвером (сдающий тогда «на прикупе» и не играет).
 *
 * Очки карт: Т 11, 10 — 10, К 4, Д 3, В 2, 9 — 0; всего в колоде 120. Старшинство: Т > 10 > К > Д > В > 9.
 * Раздача: по 7 карт, 3 — в прикуп. Торговля с 100 (первый за сдающим «сидит на ста»), шаг 5; больше 120 — только с марьяжем на руке.
 * Взявший прикуп показывает его, отдаёт по карте каждому сопернику и может поднять заказ — или расписаться. Первым ходит он.
 * Ходят в масть; нет масти — козырем (если есть козырь); нет и козыря — чем угодно.
 * Марьяж (К и Д одной масти): ♥ 100, ♦ 80, ♣ 60, ♠ 40 — объявляют, заходя с короля или дамы пары, не в первый ход кона; масть становится козырем.
 * Тузовый марьяж (настройка): четыре туза — 200, заходом с туза; козырь не меняется.
 * Итог: заказчик набрал заказ — пишет заказ, нет — минус заказ. Остальные — свои очки (взятки + марьяжи), округлённые до 5.
 * Тёмная: первая рука, не глядя в карты, играет 120; очки заказчика ×2. Перебить тёмную можно только марьяжем (больше 120).
 * Роспись: заказчик сдаётся до первого хода — пишет минус заказ, соперникам по 60 (или по половине заказа).
 * Бочка: с 880 (900) очков — «на бочке»: выше не пишут, чтобы выйти на 1000 (1001), надо сыграть свой заказ; три кона без выхода — минус 120;
 * трижды слетел — счёт в ноль. Болт: кон без единой взятки; каждый третий (три подряд, каждый пятый) — минус 120.
 * Самосвал: ровно 555 (и −555) — в ноль. Пересдача: 4 девятки на руке; по выбору заказчика — две девятки или мало очков в прикупе.
 * Золотой кон: первые N конов (N — число игроков) каждый по очереди играет 120 без торговли, все очки ×2.
 */
import type { Options, Rng } from '../../core/types';
import { sameCard, type Card, type Suit } from '../../cards/deck';

export type BoltMode = 'off' | '3' | '3row' | '5';
export type DumpMode = 'off' | 'plus' | 'both';
export type RospisMode = 'off' | '60' | 'half';

export interface Cfg {
  barrel: boolean;
  /** С какого счёта бочка. */
  barrelAt: 880 | 900;
  /** До скольких выходить: 1000 или 1001 («набрать 121»). */
  goal: 1000 | 1001;
  /** Трижды слетел с бочки — счёт в ноль. */
  barrelZero: boolean;
  bolts: BoltMode;
  dump: DumpMode;
  /** Шаг торговли. */
  step: 5 | 10;
  dark: boolean;
  rospis: RospisMode;
  /** Пересдача: 4 девятки на руке. */
  redeal9: boolean;
  /** Пересдача по выбору заказчика: 2 девятки в прикупе. */
  redealPrikup9: boolean;
  /** Пересдача по выбору заказчика: в прикупе меньше N очков (0 — нет). */
  redealPrikupMin: number;
  /** Тузовый марьяж — 200. */
  aces: boolean;
  /** Марьяж можно объявить первым ходом кона. */
  firstMarriage: boolean;
  /** Золотой кон. */
  golden: boolean;
}

export function cfgFrom(o: Options): Cfg {
  // старые сохранённые настройки: bolts/dump были переключателями
  o = { ...o, bolts: o.boltMode ?? o.bolts, dump: o.dumpMode ?? o.dump } as Options;
  const bolts: BoltMode = o.bolts === false ? 'off' : o.bolts === true || o.bolts == null ? '3' : (['off', '3', '3row', '5'] as const).includes(o.bolts as BoltMode) ? (o.bolts as BoltMode) : '3';
  const dump: DumpMode = o.dump === true ? 'plus' : o.dump === false ? 'off' : o.dump === 'plus' || o.dump === 'both' ? o.dump : o.dump == null ? 'both' : 'off';
  const rospis: RospisMode = o.rospis === 'off' || o.rospis === 'half' ? o.rospis : o.rospis === false ? 'off' : '60';
  return {
    barrel: o.barrel !== false,
    barrelAt: Number(o.barrelAt) === 900 ? 900 : 880,
    goal: Number(o.goal) === 1001 ? 1001 : 1000,
    barrelZero: o.barrelZero !== false,
    bolts,
    dump,
    step: Number(o.step) === 10 ? 10 : 5,
    dark: o.dark !== false,
    rospis,
    redeal9: o.redeal9 !== false,
    redealPrikup9: o.redealPrikup9 !== false,
    redealPrikupMin: o.redealPrikupMin == null ? 5 : Math.max(0, Number(o.redealPrikupMin) || 0),
    aces: !!o.aces,
    firstMarriage: !!o.firstMarriage,
    golden: !!o.golden,
  };
}

export const POINTS: Record<number, number> = { 14: 11, 10: 10, 13: 4, 12: 3, 11: 2, 9: 0 };
/** Порядок старшинства (больше — старше). */
export const POWER: Record<number, number> = { 14: 6, 10: 5, 13: 4, 12: 3, 11: 2, 9: 1 };
export const MARRIAGE: Record<Suit, number> = { H: 100, D: 80, C: 60, S: 40 };
export const ACES = 200;
/** Марьяж в записи: масть или тузовый ('A'). */
export type MarriageKind = Suit | 'A';
export const marriageValue = (m: MarriageKind) => (m === 'A' ? ACES : MARRIAGE[m]);
export const PENALTY = 120;
/** Тёмная играется на 120. */
export const DARK_BID = 120;

export type Phase = 'dark' | 'bid' | 'give' | 'raise' | 'play' | 'over';

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
  /** Первая рука — «сидит на ста», может темнить. */
  first: number;
  /** Заказ играется втёмную. */
  dark: boolean;
  /** Золотой кон. */
  golden: boolean;
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
  marriages: { seat: number; suit: MarriageKind }[];
  /** Сколько ходов в коне сделано (первый ход — без марьяжа). */
  tricksPlayed: number;
  /** Общий счёт. */
  scores: number[];
  /** Запись по конам: строки «пули». */
  sheet: { round: number; deltas: number[]; bidder: number; bid: number; made: boolean; tag?: 'dark' | 'rospis' | 'golden' }[];
  bolts: number[];
  /** Сколько конов сидит на бочке (0 — не на бочке). */
  barrel: number[];
  /** Сколько раз слетал с бочки. */
  falls: number[];
  round: number;
  winner: number | null;
}

export interface View extends State {
  counts: number[];
  me: number[];
}

export type Action =
  | { type: 'dark' }
  | { type: 'light' }
  | { type: 'bid'; value: number }
  | { type: 'pass' }
  | { type: 'redeal' }
  | { type: 'give'; to: number; card: Card }
  | { type: 'raise'; value: number }
  | { type: 'rospis' }
  | { type: 'play'; card: Card; marriage?: boolean };

export type RedealReason = 'nines' | 'prikup9' | 'prikupLow';

export type Event =
  | { type: 'deal'; round: number; dealer: number; counts: number[]; hands?: Card[][]; golden?: boolean; darkSeat?: number }
  | { type: 'redeal'; seat: number; reason: RedealReason; cards?: Card[] }
  | { type: 'dark'; seat: number; dark: boolean }
  | { type: 'bid'; seat: number; value: number }
  | { type: 'pass'; seat: number }
  | { type: 'prikup'; seat: number; bid: number; cards: Card[]; dark?: boolean }
  | { type: 'give'; seat: number; to: number; card?: Card }
  | { type: 'raise'; seat: number; value: number }
  | { type: 'rospis'; seat: number; bid: number }
  | { type: 'play'; seat: number; card: Card; marriage?: MarriageKind; trump: Suit | null }
  | { type: 'trick'; winner: number; points: number; cards: Card[] }
  | { type: 'score'; deltas: number[]; scores: number[]; bidder: number; bid: number; made: boolean; pts: number[]; notes: string[]; dealerBonus?: number; dark?: boolean; rospis?: boolean; golden?: boolean }
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
export const fourAces = (hand: Card[]) => hand.filter((c) => c.r === 14).length === 4;
/** Сколько можно заказать: 120 и марьяжи на руке (с тузовым — если он в игре). */
export const maxBid = (hand: Card[], aces = false) => 120 + marriagesIn(hand).reduce((a, s) => a + MARRIAGE[s], 0) + (aces && fourAces(hand) ? ACES : 0);
export const round5 = (n: number) => Math.round(n / 5) * 5;
const nines = (cards: Card[]) => cards.filter((c) => c.r === 9).length;

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

/** Какой марьяж объявится этим заходом (или null). */
export function marriageFor(s: Pick<State, 'cfg' | 'tricksPlayed' | 'trick' | 'hands'>, seat: number, card: Card): MarriageKind | null {
  const leading = !s.trick || !s.trick.cards.length;
  if (!leading || (s.tricksPlayed === 0 && !s.cfg.firstMarriage)) return null;
  const hand = s.hands[seat];
  if ((card.r === 13 || card.r === 12) && marriagesIn(hand).includes(card.s)) return card.s;
  if (card.r === 14 && s.cfg.aces && fourAces(hand)) return 'A';
  return null;
}

/** Пересдачу по прикупу заказчик может потребовать, пока не отдал ни одной карты. */
export function prikupRedeal(s: Pick<State, 'cfg' | 'prikup' | 'phase' | 'given' | 'golden'>): RedealReason | null {
  if (s.phase !== 'give' || s.given.length) return null;
  if (s.cfg.redealPrikup9 && nines(s.prikup) >= 2) return 'prikup9';
  if (s.cfg.redealPrikupMin > 0 && handPoints(s.prikup) < s.cfg.redealPrikupMin) return 'prikupLow';
  return null;
}

/** Можно ли расписаться: не на бочке и не на золотом коне. */
export const canRospis = (s: Pick<State, 'cfg' | 'phase' | 'barrel' | 'bidder' | 'golden'>) =>
  s.cfg.rospis !== 'off' && s.phase === 'raise' && !s.golden && !(s.cfg.barrel && s.barrel[s.bidder] > 0);

/** Сколько пишут каждому сопернику при росписи. */
export const rospisPay = (s: Pick<State, 'cfg' | 'bid'>) => (s.cfg.rospis === 'half' ? round5(s.bid / 2) : 60);

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
    first: seats[0],
    dark: false,
    golden: false,
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
    falls: Array(n).fill(0),
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

/** Новый кон: сдаёт следующий по кругу. again — пересдача: тот же сдающий, тот же кон. */
export function deal(s0: State, rng: Rng, again = false): { state: State; events: Event[] } {
  const dealer = again ? s0.dealer : s0.round === 0 ? s0.seats[s0.seats.length - 1] : nextIn(s0.seats, s0.dealer);
  const players = s0.seats.length === 4 ? s0.seats.filter((x) => x !== dealer) : s0.seats.slice();
  const ev: Event[] = [];
  let hands: Card[][] = [[], [], [], []];
  let prikup: Card[] = [];
  // четыре девятки на руке — пересдают сразу (страховка от бесконечного круга)
  for (let tries = 0; ; tries++) {
    const deck = shuffle(makeDeck24(), rng);
    hands = [[], [], [], []];
    for (const p of players) hands[p] = deck.splice(0, 7);
    prikup = deck.splice(0, 3);
    const bad = s0.cfg.redeal9 && tries < 20 ? players.find((p) => nines(hands[p]) === 4) : undefined;
    if (bad == null) break;
    ev.push({ type: 'redeal', seat: bad, reason: 'nines', cards: hands[bad].filter((c) => c.r === 9) });
  }
  // первым торгуется следующий за сдающим (вчетвером — среди играющих), он «сидит на ста»
  const first = s0.seats.length === 4 ? nextIn(s0.seats, dealer) : nextIn(players, dealer);
  const round = again ? s0.round : s0.round + 1;
  const golden = s0.cfg.golden && round <= s0.seats.length;
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
    first,
    dark: false,
    golden,
    passed: [],
    given: [],
    trump: null,
    trick: null,
    lastTrick: null,
    roundPts: [0, 0, 0, 0],
    tricksTaken: [0, 0, 0, 0],
    marriages: [],
    tricksPlayed: 0,
    round,
    scores: s0.scores.slice(),
  };
  // тёмная: только первая рука, не в минусе и пока никто не сидит на бочке
  const darkOk = s.cfg.dark && !golden && s.scores[first] >= 0 && !(s.cfg.barrel && s.seats.some((x) => s.barrel[x] > 0));
  if (darkOk) {
    s.phase = 'dark';
    s.turn = first;
  }
  ev.push({ type: 'deal', round, dealer, counts: hands.map((h) => h.length), hands: hands.map((h) => h.slice()), golden: golden || undefined, darkSeat: darkOk ? first : undefined });
  if (golden) {
    // золотой кон: первая рука играет 120 без торговли
    s.bid = 120;
    startPlay(s, ev);
  }
  return { state: s, events: ev };
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
  ev.push({ type: 'prikup', seat: s.bidder, bid: s.bid, cards: s.prikup.slice(), dark: s.dark || undefined });
  s.shown = true;
  s.phase = 'give';
  s.turn = s.bidder;
  s.given = [];
}

/** Сохранённая партия старой версии: настройки и новые поля — по умолчанию. */
function migrate(s: State): State {
  if (s.cfg.goal && s.falls) return s;
  return { ...s, cfg: cfgFrom(s.cfg as unknown as Options), falls: s.falls ?? [0, 0, 0, 0], first: s.first ?? s.bidder, dark: !!s.dark, golden: !!s.golden };
}

export function apply(raw: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  const s0 = migrate(raw);
  if (s0.phase === 'over' || seat !== s0.turn || !a || typeof a !== 'object') return null;
  const ev: Event[] = [];
  const s: State = { ...s0, hands: s0.hands.slice(), passed: s0.passed.slice(), given: s0.given.slice(), roundPts: s0.roundPts.slice(), tricksTaken: s0.tricksTaken.slice() };
  switch (s0.phase) {
    case 'dark': {
      if (a.type !== 'dark' && a.type !== 'light') return null;
      s.phase = 'bid';
      s.turn = nextIn(s.players, seat);
      if (a.type === 'dark') {
        s.dark = true;
        s.bid = DARK_BID;
        s.bidder = seat;
      }
      ev.push({ type: 'dark', seat, dark: a.type === 'dark' });
      return { state: s, events: ev };
    }
    case 'bid': {
      if (a.type === 'bid') {
        const step = s.cfg.step;
        if (!Number.isInteger(a.value) || a.value <= s.bid || a.value % 5 !== 0 || a.value < s.bid + step || a.value > maxBid(s.hands[seat], s.cfg.aces)) return null;
        s.bid = a.value;
        s.bidder = seat;
        // тёмную перебили («растемнили») — дальше торгуются как обычно
        s.dark = false;
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
      if (a.type === 'redeal') {
        const why = prikupRedeal(s0);
        if (!why) return null;
        ev.push({ type: 'redeal', seat, reason: why, cards: s0.prikup.slice() });
        const d = deal(s0, rng, true);
        return { state: d.state, events: [...ev, ...d.events] };
      }
      if (a.type !== 'give' || !s.players.includes(a.to) || a.to === seat || s.given.includes(a.to) || !has(s.hands[seat], a.card)) return null;
      s.hands[seat] = s.hands[seat].filter((c) => !sameCard(c, a.card));
      s.hands[a.to] = [...s.hands[a.to], a.card];
      s.given.push(a.to);
      ev.push({ type: 'give', seat, to: a.to, card: a.card });
      if (s.given.length === s.players.length - 1) s.phase = 'raise';
      return { state: s, events: ev };
    }
    case 'raise': {
      if (a.type === 'rospis') {
        if (!canRospis(s)) return null;
        ev.push({ type: 'rospis', seat, bid: s.bid });
        return scoreRound(s, ev, rng, true);
      }
      if (a.type !== 'raise' || !Number.isInteger(a.value) || a.value < s.bid || a.value % 5 !== 0 || a.value > Math.max(s.bid, maxBid(s.hands[seat], s.cfg.aces))) return null;
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
      let marriage: MarriageKind | undefined;
      if (a.marriage) {
        const m = marriageFor(s, seat, a.card);
        if (!m) return null;
        marriage = m;
        if (m !== 'A') s.trump = m;
        s.roundPts[seat] += marriageValue(m);
        s.marriages = [...s.marriages, { seat, suit: m }];
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

function scoreRound(s: State, ev: Event[], rng: Rng, rospis = false): { state: State; events: Event[] } {
  const cfg = s.cfg;
  const deltas = [0, 0, 0, 0];
  const notes: string[] = [];
  const scores = s.scores.slice();
  const bolts = s.bolts.slice();
  const barrel = s.barrel.slice();
  const falls = s.falls.slice();
  const made = !rospis && s.roundPts[s.bidder] >= s.bid;
  const k = s.golden ? 2 : 1;
  const kb = k * (s.dark ? 2 : 1);
  const fresh: number[] = [];
  const BARREL = cfg.barrelAt;
  /** Слетел с бочки: минус 120 от бочки, а на третий раз — в ноль. */
  const fall = (p: number): number => {
    barrel[p] = 0;
    falls[p]++;
    if (cfg.barrelZero && falls[p] >= 3) {
      falls[p] = 0;
      notes.push(`zero:${p}`);
      return 0;
    }
    notes.push(`fall:${p}`);
    return BARREL - PENALTY;
  };
  // вчетвером сдающему — марьяж из прикупа
  let dealerBonus = 0;
  if (s.seats.length === 4) for (const suit of marriagesIn(s.prikup)) dealerBonus += MARRIAGE[suit];
  for (const p of s.seats) {
    const playing = s.players.includes(p);
    if (!playing && !(p === s.dealer && dealerBonus)) continue;
    const onBarrel = cfg.barrel && barrel[p] > 0;
    let d: number;
    if (!playing) d = onBarrel ? 0 : dealerBonus;
    else if (p === s.bidder) d = made ? s.bid * kb : -s.bid * kb;
    else if (onBarrel) d = 0; // на бочке очки обороняющегося не пишутся
    else d = rospis ? rospisPay(s) * k : round5(s.roundPts[p]) * k;
    let v = scores[p] + d;
    // болт — кон без взятки (на бочке не пишут)
    if (playing && !rospis && cfg.bolts !== 'off' && !onBarrel) {
      if (s.tricksTaken[p] === 0) {
        bolts[p]++;
        notes.push(`bolt:${p}`);
        const limit = cfg.bolts === '5' ? 5 : 3;
        if (bolts[p] >= limit) {
          bolts[p] = 0;
          v -= PENALTY * k;
          notes.push(`bolt${limit}:${p}`);
        }
      } else if (cfg.bolts === '3row') bolts[p] = 0;
    }
    if (cfg.barrel && !playing) {
      // сдающий вчетвером: марьяж из прикупа может посадить на бочку, но попытки у него не идут
      if (!onBarrel && v >= BARREL) {
        v = BARREL;
        barrel[p] = 1;
        fresh.push(p);
        notes.push(`barrel:${p}`);
      }
    } else if (cfg.barrel) {
      if (barrel[p] > 0) {
        if (v >= cfg.goal && p === s.bidder && made) barrel[p] = 0;
        else if (v < BARREL) barrel[p] = 0;
        else {
          v = BARREL;
          barrel[p]++;
          if (barrel[p] > 3) v = fall(p);
        }
      } else if (v >= BARREL) {
        v = BARREL;
        barrel[p] = 1;
        fresh.push(p);
        notes.push(`barrel:${p}`);
      }
    }
    if ((cfg.dump === 'plus' || cfg.dump === 'both') && v === 555) {
      v = 0;
      notes.push(`dump:${p}`);
    }
    if (cfg.dump === 'both' && v === -555) {
      v = 0;
      notes.push(`dumpm:${p}`);
    }
    deltas[p] = v - scores[p];
    scores[p] = v;
  }
  // двое на бочке не сидят: кто сел раньше — слетает
  if (fresh.length)
    for (const q of s.seats)
      if (!fresh.includes(q) && barrel[q] > 0) {
        const v = fall(q);
        deltas[q] += v - scores[q];
        scores[q] = v;
      }
  const tag = rospis ? 'rospis' : s.dark ? 'dark' : s.golden ? 'golden' : undefined;
  const st: State = { ...s, scores, bolts, barrel, falls, sheet: [...s.sheet, { round: s.round, deltas, bidder: s.bidder, bid: s.bid, made, tag }] };
  ev.push({
    type: 'score',
    deltas,
    scores: scores.slice(),
    bidder: s.bidder,
    bid: s.bid,
    made,
    pts: s.roundPts.slice(),
    notes,
    dealerBonus: dealerBonus || undefined,
    dark: s.dark || undefined,
    rospis: rospis || undefined,
    golden: s.golden || undefined,
  });
  const top = Math.max(...s.seats.map((x) => scores[x]));
  if (top >= cfg.goal) {
    const winner = s.seats.filter((x) => scores[x] === top).sort((x, y) => (x === s.bidder ? -1 : y === s.bidder ? 1 : 0))[0];
    st.phase = 'over';
    st.winner = winner;
    ev.push({ type: 'end', winner, scores: scores.slice() });
    return { state: st, events: ev };
  }
  const d = deal(st, rng);
  return { state: d.state, events: [...ev, ...d.events] };
}

/** Тёмная: первая рука свои карты не видит, пока не решит, а затемнив — до прикупа (если не растемнили). */
const blind = (s: State, i: number) => i === s.first && (s.phase === 'dark' || (s.phase === 'bid' && s.dark));

export function makeView(s: State, seats: number[] | 'all'): View {
  const see = (x: number) => (seats === 'all' || seats.includes(x)) && (seats === 'all' || !blind(s, x));
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
