/* Шнапсен и «Шестьдесят шесть» — правила (без DOM). Вдвоём.
 *
 * Шнапсен: 20 карт (Т, 10, К, Д, В). 66: 24 карты (с девятками). Очки: Т 11, 10 — 10, К 4, Д 3, В 2, 9 — 0 (всего 120).
 * Старшинство: Т > 10 > К > Д > В > 9. Раздача по 5 (66 — по 6) карт, следующая — открытый козырь под прикупом.
 * Первым ходит сосед сдающего. Пока прикуп открыт, ходить можно чем угодно; взявший добирает первым, за ним второй.
 * Марьяж (К и Д одной масти) объявляют, заходя одной из них: 20, козырный — 40; очки засчитываются, когда у объявившего
 * есть хоть одна взятка. Младший козырь (валет, в 66 — девятка) можно на своём заходе обменять на открытый козырь.
 * Закрыть прикуп можно на своём заходе. Когда прикуп закрыт или кончился — в масть и перебить, нет масти — козырем.
 * Набравший 66 «выходит» (объявляет после своей взятки или марьяжа) и выигрывает сдачу: 1 очко, если у соперника 33 и больше,
 * 2 — меньше 33, 3 — у соперника ни одной взятки. Ошибся (меньше 66) — сопернику 2 очка, а если у соперника не было взяток — 3.
 * Обмен младшего козыря — пока прикуп открыт и не кончился (в 66 — только имея взятку); марьяж в 66 после закрытия не объявляют.
 * Закрывший обязан выйти; не вышел — сопернику 2 очка (3, если у соперника в миг закрытия не было ни одной взятки).
 * Никто не вышел, карты кончились — сдачу берёт взявший последнюю взятку (в 66 за неё ещё 10 очков): 1 очко.
 * Партия (бумерль) — до 7 очков.
 */
import type { Options, Rng } from '../../core/types';
import { makeDeck, sameCard, SUITS, type Card, type Suit } from '../../cards/deck';
import { shuffle } from '../../core/rng';

export interface Cfg {
  /** 20 карт (шнапсен) или 24 (шестьдесят шесть, с девятками). */
  deck: 20 | 24;
  /** Последняя взятка — ещё 10 очков (66). */
  last10: boolean;
  /** До скольких очков партия. */
  target: number;
  /** Выходить самому («Хватит!») и считать в уме; иначе 66 засчитывается сразу и очки видны. */
  manual: boolean;
}

export function cfgFrom(o: Options): Cfg {
  const deck = Number(o.deck) === 24 ? 24 : 20;
  return {
    deck,
    last10: o.last10 == null ? deck === 24 : !!o.last10,
    target: [1, 7, 11].includes(Number(o.target)) ? Number(o.target) : 7,
    manual: !!o.manual,
  };
}

export const POINTS: Record<number, number> = { 14: 11, 10: 10, 13: 4, 12: 3, 11: 2, 9: 0 };
export const POWER: Record<number, number> = { 14: 6, 10: 5, 13: 4, 12: 3, 11: 2, 9: 1 };
export const GOAL = 66;
export const handSize = (cfg: Cfg) => (cfg.deck === 24 ? 6 : 5);
/** Младший козырь, который меняют на открытый. */
export const lowTrump = (cfg: Cfg) => (cfg.deck === 24 ? 9 : 11);

export interface State {
  cfg: Cfg;
  seats: number[];
  dealer: number;
  hands: Card[][];
  /** Закрытый прикуп (верх — первым); открытый козырь — отдельно, его берут последним. */
  stock: Card[];
  trumpCard: Card | null;
  trump: Suit;
  /** Кто закрыл прикуп и сколько взяток было у соперника в тот миг. */
  closed: { seat: number; oppTricks: number } | null;
  /** Заход: кто зашёл и чем. */
  lead: { seat: number; card: Card } | null;
  turn: number;
  /** Очки во взятках. */
  pts: number[];
  /** Марьяжи, ещё не засчитанные (нет взятки). */
  pending: number[];
  tricks: number[];
  /** Объявленные марьяжи (масти) — показаны всем. */
  melds: { seat: number; suit: Suit }[];
  /** Сыгранные в этой сдаче карты (видны всем). */
  gone: Card[];
  /** Карты на руке, которые видел соперник: марьяж, взятый обменом или последним козырь. */
  shown: Card[][];
  /** Марьяж только что объявлен — ходить надо королём или дамой этой масти. */
  meld: Suit | null;
  /** Очки партии. */
  game: number[];
  deal: number;
  last: { winner: number; gp: number; reason: Reason; pts: number[] } | null;
  over: boolean;
  winner: number | null;
}

export type Reason = 'claim' | 'wrong' | 'closed' | 'last';

export interface View extends Omit<State, 'stock'> {
  stockLeft: number;
  counts: number[];
  /** Только для показа: ответная карта, пока взятка не ушла. */
  answer?: { seat: number; card: Card };
}

export type Action =
  | { type: 'play'; card: Card; meld?: boolean }
  | { type: 'exchange' }
  | { type: 'close' }
  | { type: 'claim'; meld?: Suit };

export type Event =
  | { type: 'deal'; deal: number; dealer: number; trumpCard: Card; hands?: Card[][] }
  | { type: 'meld'; seat: number; suit: Suit; pts: number }
  | { type: 'exchange'; seat: number; card: Card; took: Card }
  | { type: 'close'; seat: number }
  | { type: 'play'; seat: number; card: Card }
  | { type: 'trick'; seat: number; cards: Card[]; pts: number }
  | { type: 'draw'; seat: number; card?: Card; trump?: boolean }
  | { type: 'claim'; seat: number; ok: boolean; pts: number }
  | { type: 'hand'; winner: number; gp: number; reason: Reason; pts: number[]; game: number[] }
  | { type: 'end'; winner: number; game: number[] };

const other = (s: State, seat: number) => (seat === s.seats[0] ? s.seats[1] : s.seats[0]);

export function newState(cfg: Cfg, seats: number[]): State {
  return {
    cfg,
    seats: seats.slice(0, 2),
    dealer: seats[1],
    hands: [[], []],
    stock: [],
    trumpCard: null,
    trump: 'H',
    closed: null,
    lead: null,
    turn: seats[0],
    pts: [0, 0],
    pending: [0, 0],
    tricks: [0, 0],
    melds: [],
    gone: [],
    shown: [[], []],
    meld: null,
    game: [0, 0],
    deal: 0,
    last: null,
    over: false,
    winner: null,
  };
}

function deck(cfg: Cfg): Card[] {
  return makeDeck(24).filter((c) => cfg.deck === 24 || c.r !== 9);
}

function dealHand(s: State, rng: Rng, ev: Event[]) {
  s.deal++;
  s.dealer = s.deal === 1 ? s.dealer : other(s, s.dealer);
  const d = shuffle(deck(s.cfg), rng);
  const n = handSize(s.cfg);
  const first = other(s, s.dealer);
  s.hands = [[], []];
  s.hands[first] = d.slice(0, n);
  s.hands[s.dealer] = d.slice(n, 2 * n);
  s.trumpCard = d[2 * n];
  s.trump = s.trumpCard.s;
  s.stock = d.slice(2 * n + 1);
  s.closed = null;
  s.lead = null;
  s.turn = first;
  s.pts = [0, 0];
  s.pending = [0, 0];
  s.tricks = [0, 0];
  s.melds = [];
  s.gone = [];
  s.shown = [[], []];
  s.meld = null;
  ev.push({ type: 'deal', deal: s.deal, dealer: s.dealer, trumpCard: s.trumpCard, hands: s.hands.map((h) => h.slice()) });
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  const s = newState(cfgFrom(opts), seats);
  s.dealer = s.seats[1];
  dealHand(s, rng, []);
  return s;
}

export const toAct = (s: State): number[] => (s.over ? [] : [s.turn]);

/** Сколько карт осталось добирать (с открытым козырем). */
export const stockCount = (s: State | View) => ('stockLeft' in s ? s.stockLeft : s.stock.length + (s.trumpCard ? 1 : 0));
/** Строгие правила: прикуп закрыт или кончился. */
export const strict = (s: State | View) => !!s.closed || stockCount(s) === 0;

export function beats(a: Card, b: Card, trump: Suit): boolean {
  // b — побьёт ли карта b карту a
  if (b.s === a.s) return POWER[b.r] > POWER[a.r];
  return b.s === trump;
}

export function legal(s: State | View, seat: number): Card[] {
  const hand = s.hands[seat];
  if (!s.lead) {
    if (s.meld) return hand.filter((c) => c.s === s.meld && (c.r === 12 || c.r === 13));
    return hand;
  }
  if (!strict(s)) return hand;
  const lc = s.lead.card;
  const same = hand.filter((c) => c.s === lc.s);
  if (same.length) {
    const over = same.filter((c) => POWER[c.r] > POWER[lc.r]);
    return over.length ? over : same;
  }
  const tr = hand.filter((c) => c.s === s.trump);
  return tr.length ? tr : hand;
}

/** Марьяжи на руке (масти, где есть и король, и дама). */
export function marriages(s: State | View, seat: number): Suit[] {
  const hand = s.hands[seat];
  return SUITS.filter((x) => hand.some((c) => c.s === x && c.r === 13) && hand.some((c) => c.s === x && c.r === 12));
}

export const meldValue = (s: State | View, suit: Suit) => (suit === s.trump ? 40 : 20);

/** Можно ли сейчас объявить марьяж (на заходе; в первый заход сдачи — тоже, очки ждут взятки; в 66 — не после закрытия). */
export const canMeld = (s: State | View, seat: number) => !s.over && s.turn === seat && !s.lead && !s.meld && !(s.cfg.deck === 24 && s.closed);

export function canExchange(s: State | View, seat: number): boolean {
  if (s.over || s.turn !== seat || s.lead || s.meld || s.closed || !s.trumpCard) return false;
  // в 66 — только когда уже есть своя взятка
  if (s.cfg.deck === 24 && !s.tricks[seat]) return false;
  return s.hands[seat].some((c) => c.s === s.trump && c.r === lowTrump(s.cfg));
}

export const canClose = (s: State | View, seat: number) => !s.over && s.turn === seat && !s.lead && !s.meld && !s.closed && stockCount(s) > 0;

/** Засчитанные очки: взятки + марьяжи (если есть взятка). */
export const score = (s: State | View, seat: number) => s.pts[seat] + (s.tricks[seat] ? s.pending[seat] : 0);

/** «Хватит!» — на своём заходе, когда есть своя взятка (после взятки или марьяжа). */
export const canClaim = (s: State | View, seat: number) => s.cfg.manual && !s.over && s.turn === seat && !s.lead && s.tricks[seat] > 0;

function cloneState(s0: State): State {
  return { ...s0, hands: s0.hands.map((h) => h.slice()), stock: s0.stock.slice(), pts: s0.pts.slice(), pending: s0.pending.slice(), tricks: s0.tricks.slice(), melds: s0.melds.slice(), gone: s0.gone.slice(), shown: s0.shown.map((x) => x.slice()), game: s0.game.slice() };
}

/** Очки за выигранную сдачу по взяткам и очкам проигравшего. */
function gpFor(s: State, loser: number) {
  if (!s.tricks[loser]) return 3;
  return score(s, loser) < 33 ? 2 : 1;
}

function finishHand(s: State, winner: number, gp: number, reason: Reason, rng: Rng, ev: Event[]) {
  s.game[winner] += gp;
  const pts = [score(s, s.seats[0]), score(s, s.seats[1])];
  s.last = { winner, gp, reason, pts };
  s.lead = null;
  s.meld = null;
  ev.push({ type: 'hand', winner, gp, reason, pts, game: s.game.slice() });
  if (s.game[winner] >= s.cfg.target) {
    s.over = true;
    s.winner = winner;
    ev.push({ type: 'end', winner, game: s.game.slice() });
    return;
  }
  dealHand(s, rng, ev);
}

/** Выход: набрал 66 — выиграл сдачу; нет — проиграл. */
function claim(s: State, seat: number, rng: Rng, ev: Event[]) {
  const me = score(s, seat);
  const opp = other(s, seat);
  const ok = me >= GOAL;
  ev.push({ type: 'claim', seat, ok, pts: me });
  if (ok) {
    // закрыл соперник, а вышел я — мне как за неудачное закрытие
    if (s.closed && s.closed.seat === opp) return finishHand(s, seat, s.closed.oppTricks ? 2 : 3, 'closed', rng, ev);
    return finishHand(s, seat, gpFor(s, opp), 'claim', rng, ev);
  }
  finishHand(s, opp, s.tricks[opp] ? 2 : 3, 'wrong', rng, ev);
}

/** Само засчитывание 66 (когда выходить не надо вручную). */
function autoClaim(s: State, seat: number, rng: Rng, ev: Event[]): boolean {
  if (s.cfg.manual || score(s, seat) < GOAL) return false;
  claim(s, seat, rng, ev);
  return true;
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn || !a) return null;
  const s = cloneState(s0);
  const ev: Event[] = [];
  if (a.type === 'claim') {
    if (!canClaim(s, seat)) return null;
    if (a.meld) {
      // марьяж — и сразу выход, не играя карты
      if (!canMeld(s, seat) || !marriages(s, seat).includes(a.meld)) return null;
      const v = meldValue(s, a.meld);
      s.pending[seat] += v;
      s.melds.push({ seat, suit: a.meld });
      ev.push({ type: 'meld', seat, suit: a.meld, pts: v });
    }
    claim(s, seat, rng, ev);
    return { state: s, events: ev };
  }
  if (a.type === 'exchange') {
    if (!canExchange(s, seat)) return null;
    const low = s.hands[seat].find((c) => c.s === s.trump && c.r === lowTrump(s.cfg))!;
    const took = s.trumpCard!;
    s.hands[seat] = [...s.hands[seat].filter((c) => !sameCard(c, low)), took];
    s.trumpCard = low;
    s.shown[seat].push(took);
    ev.push({ type: 'exchange', seat, card: low, took });
    return { state: s, events: ev };
  }
  if (a.type === 'close') {
    if (!canClose(s, seat)) return null;
    s.closed = { seat, oppTricks: s.tricks[other(s, seat)] };
    ev.push({ type: 'close', seat });
    return { state: s, events: ev };
  }
  if (a.type !== 'play' || !a.card) return null;
  const card = s.hands[seat].find((c) => sameCard(c, a.card));
  if (!card) return null;
  if (a.meld) {
    if (!canMeld(s, seat) || (card.r !== 12 && card.r !== 13) || !marriages(s, seat).includes(card.s)) return null;
    const v = meldValue(s, card.s);
    s.pending[seat] += v;
    s.melds.push({ seat, suit: card.s });
    for (const c of s.hands[seat]) if (c.s === card.s && (c.r === 12 || c.r === 13) && !s.shown[seat].some((x) => sameCard(x, c))) s.shown[seat].push(c);
    ev.push({ type: 'meld', seat, suit: card.s, pts: v });
    if (s.tricks[seat] && autoClaim(s, seat, rng, ev)) return { state: s, events: ev };
    s.meld = card.s;
  }
  if (!legal(s, seat).some((c) => sameCard(c, card))) return null;
  s.hands[seat] = s.hands[seat].filter((c) => !sameCard(c, card));
  s.meld = null;
  s.shown[seat] = s.shown[seat].filter((c) => !sameCard(c, card));
  s.gone.push(card);
  ev.push({ type: 'play', seat, card });
  if (!s.lead) {
    s.lead = { seat, card };
    s.turn = other(s, seat);
    return { state: s, events: ev };
  }
  const lead = s.lead;
  const w = beats(lead.card, card, s.trump) ? seat : lead.seat;
  const cards = [lead.card, card];
  const pts = POINTS[lead.card.r] + POINTS[card.r];
  s.pts[w] += pts;
  s.tricks[w]++;
  s.lead = null;
  s.turn = w;
  ev.push({ type: 'trick', seat: w, cards, pts });
  if (autoClaim(s, w, rng, ev)) return { state: s, events: ev };
  // добор: взявший первым
  if (!s.closed && stockCount(s) > 0) {
    for (const p of [w, other(s, w)]) {
      if (s.stock.length) {
        const c = s.stock.shift()!;
        s.hands[p].push(c);
        ev.push({ type: 'draw', seat: p, card: c });
      } else if (s.trumpCard) {
        s.hands[p].push(s.trumpCard);
        s.shown[p].push(s.trumpCard);
        ev.push({ type: 'draw', seat: p, card: s.trumpCard, trump: true });
        s.trumpCard = null;
      }
    }
  }
  if (!s.hands[w].length) {
    // карты кончились без выхода
    if (s.cfg.last10 && !s.closed) s.pts[w] += 10;
    if (s.closed) {
      const c = s.closed.seat;
      if (score(s, c) >= GOAL) claim(s, c, rng, ev);
      else finishHand(s, other(s, c), s.closed.oppTricks ? 2 : 3, 'closed', rng, ev);
    } else if (!autoClaim(s, w, rng, ev)) {
      if (s.cfg.manual && score(s, w) >= GOAL) claim(s, w, rng, ev);
      else finishHand(s, w, 1, 'last', rng, ev);
    }
  }
  return { state: s, events: ev };
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const see = (x: number) => seats === 'all' || seats.includes(x);
  const v = s as Partial<View>;
  const { stock, ...rest } = s as State;
  return {
    ...rest,
    hands: s.hands.map((h, i) => (see(i) ? h.slice() : [])),
    counts: s.hands.map((h, i) => v.counts?.[i] ?? h.length),
    stockLeft: v.stockLeft ?? (stock ? stock.length + (s.trumpCard ? 1 : 0) : 0),
  };
}

export const countOf = (s: State | View, seat: number) => ('counts' in s ? s.counts[seat] : s.hands[seat].length);
