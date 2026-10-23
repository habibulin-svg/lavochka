/* Баккара — правила (без DOM). Шуз из шести колод по 52 карты; туз — 1, двойка–девятка — по номиналу, десятки и картинки — 0;
 * сумма руки — последняя цифра суммы. Две руки: «Игрок» (понтёр) и «Банкир». 8 или 9 с двух карт — натуральная, добора нет.
 *
 * Пунто банко (банк держит заведение): каждый за столом ставит на Игрока, Банкира или ничью; карты раздаёт крупье строго по таблице.
 *   Игрок берёт третью карту при 0–5, стоит при 6–7. Банкир, если игрок стоял, — как игрок; если игрок брал, смотрит на его третью карту:
 *   0–2 — берёт всегда; 3 — кроме восьмёрки; 4 — на 2–7; 5 — на 4–7; 6 — на 6–7; 7 — стоит.
 *   Выплаты: на Игрока 1:1, на Банкира 1:1 минус 5% комиссии, ничья 8:1 (или 9:1); при ничьей ставки на Игрока и Банкира возвращаются.
 *
 * Шмен де фер: банк держат сами игроки по очереди. Банкир кладёт банк, понтёры по кругу ставят против него («Банко!» — на весь банк),
 * руку Игрока ведёт понтёр с самой крупной ставкой. Понтёр при 0–4 берёт, при 6–7 стоит, при 5 — решает сам. Банкир — по той же
 * таблице, но в клетках 3 против девятки, 4 против туза, 5 против четвёрки и 5, когда понтёр стоял, — решает сам.
 * Выиграл банк — ставки в банк, банкир решает, держать ли банк дальше; проиграл — платит из банка, банк переходит к соседу.
 * Ничья — ставки возвращаются. Партия — заранее оговорённое число сдач; побеждает тот, у кого больше денег.
 */
import type { Options, Rng } from '../../core/types';
import { makeDeck, type Card } from '../../cards/deck';
import { shuffle } from '../../core/rng';

export type Mode = 'pb' | 'chemmy';
export type Side = 'P' | 'B' | 'T';

export interface Cfg {
  mode: Mode;
  /** Сколько сдач в партии. */
  coups: number;
  /** Ничья платит 8:1 или 9:1 (пунто банко). */
  tie: 8 | 9;
  /** Комиссия с выигрыша на Банкира, % (пунто банко). */
  vig: number;
  purse: number;
}

export function cfgFrom(o: Options): Cfg {
  return {
    mode: o.mode === 'chemmy' ? 'chemmy' : 'pb',
    coups: [10, 20, 40].includes(Number(o.coups)) ? Number(o.coups) : 20,
    tie: Number(o.tie) === 9 ? 9 : 8,
    vig: o.vig === false ? 0 : 5,
    purse: 1000,
  };
}

export const MIN_BET = 10;
export const SHOE_DECKS = 6;

export const val = (c: Card) => (c.r === 14 ? 1 : c.r >= 10 ? 0 : c.r);
export const total = (cs: Card[]) => cs.reduce((x, c) => x + val(c), 0) % 10;
export const natural = (cs: Card[]) => cs.length === 2 && total(cs) >= 8;

/** Банкир по таблице пунто банко: p3 — третья карта игрока (null — игрок стоял). */
export function bankerDraws(b: number, p3: number | null): boolean {
  if (p3 == null) return b <= 5;
  if (b <= 2) return true;
  if (b === 3) return p3 !== 8;
  if (b === 4) return p3 >= 2 && p3 <= 7;
  if (b === 5) return p3 >= 4 && p3 <= 7;
  if (b === 6) return p3 === 6 || p3 === 7;
  return false;
}

/** Шмен де фер: клетки, где банкир решает сам. */
export function bankerFree(b: number, p3: number | null): boolean {
  if (p3 == null) return b === 5;
  return (b === 3 && p3 === 9) || (b === 4 && p3 === 1) || (b === 5 && p3 === 4);
}

export type Phase = 'open' | 'bet' | 'punter' | 'banker' | 'keep' | 'over';

export interface Bet {
  seat: number;
  side: Side;
  n: number;
}

export interface State {
  cfg: Cfg;
  seats: number[];
  money: number[];
  shoe: Card[];
  /** Номер сдачи (с 1). */
  coup: number;
  phase: Phase;
  turn: number | null;
  /** Кто ещё не ставил в этой сдаче (по порядку). */
  order: number[];
  bets: Bet[];
  player: Card[];
  banker: Card[];
  /** Шмен де фер: банкир, банк и с чего он начался. */
  bankSeat: number | null;
  bank: number;
  bankStart: number;
  /** Шмен де фер: кто ведёт руку Игрока. */
  punter: number | null;
  last: { p: number; b: number; win: Side; pay: number[] } | null;
  over: boolean;
  winner: number | null;
}

export interface View extends Omit<State, 'shoe'> {
  shoeLeft: number;
}

export type Action =
  | { type: 'bet'; side: Side; n: number }
  | { type: 'banco' }
  | { type: 'skip' }
  | { type: 'bank'; n: number }
  | { type: 'draw' }
  | { type: 'stand' }
  | { type: 'keep' }
  | { type: 'pass' };

export type Event =
  | { type: 'coup'; coup: number; banker: number | null; bank: number }
  | { type: 'shuffle' }
  | { type: 'bank'; seat: number; n: number }
  | { type: 'bet'; seat: number; side: Side; n: number; banco?: boolean }
  | { type: 'skip'; seat: number }
  | { type: 'card'; hand: 'P' | 'B'; card: Card; third?: boolean }
  | { type: 'choice'; seat: number; draw: boolean }
  | { type: 'result'; p: number; b: number; win: Side; pay: number[]; natural: boolean }
  | { type: 'keep'; seat: number; keep: boolean; bank: number }
  | { type: 'end'; winner: number; money: number[] };

const nextIn = (list: number[], seat: number) => list[(list.indexOf(seat) + 1) % list.length];

export function newState(cfg: Cfg, seats: number[]): State {
  const money: number[] = [];
  for (const x of seats) money[x] = cfg.purse;
  return {
    cfg,
    seats: seats.slice(),
    money,
    shoe: [],
    coup: 0,
    phase: 'bet',
    turn: null,
    order: [],
    bets: [],
    player: [],
    banker: [],
    bankSeat: null,
    bank: 0,
    bankStart: 0,
    punter: null,
    last: null,
    over: false,
    winner: null,
  };
}

const alive = (s: State) => s.seats.filter((x) => s.money[x] >= MIN_BET || x === s.bankSeat);

function newShoe(s: State, rng: Rng, ev: Event[]) {
  const cards: Card[] = [];
  for (let i = 0; i < SHOE_DECKS; i++) cards.push(...makeDeck(52));
  s.shoe = shuffle(cards, rng);
  ev.push({ type: 'shuffle' });
}

function take(s: State, rng: Rng, ev: Event[]): Card {
  if (!s.shoe.length) newShoe(s, rng, ev);
  return s.shoe.shift()!;
}

/** Новая сдача: ставки (пунто банко) или банк (шмен де фер). */
function startCoup(s: State, rng: Rng, ev: Event[]) {
  if (s.coup >= s.cfg.coups || alive(s).length < (s.cfg.mode === 'pb' ? 1 : 2)) return finish(s, ev);
  s.coup++;
  if (s.shoe.length < 30) newShoe(s, rng, ev);
  s.player = [];
  s.banker = [];
  s.bets = [];
  s.punter = null;
  if (s.cfg.mode === 'pb') {
    s.order = s.seats.filter((x) => s.money[x] >= MIN_BET);
    s.phase = 'bet';
    s.turn = s.order[0] ?? null;
    ev.push({ type: 'coup', coup: s.coup, banker: null, bank: 0 });
    if (s.turn == null) return finish(s, ev);
    return;
  }
  if (s.bankSeat == null) {
    // банк — следующему, у кого есть деньги
    let b = s.seats[(s.coup - 1) % s.seats.length];
    for (let i = 0; i < s.seats.length && s.money[b] < MIN_BET; i++) b = nextIn(s.seats, b);
    s.bankSeat = b;
    s.phase = 'open';
    s.turn = b;
    ev.push({ type: 'coup', coup: s.coup, banker: b, bank: 0 });
    return;
  }
  ev.push({ type: 'coup', coup: s.coup, banker: s.bankSeat, bank: s.bank });
  openBets(s);
}

function openBets(s: State) {
  const b = s.bankSeat!;
  const list: number[] = [];
  for (let x = nextIn(s.seats, b); x !== b; x = nextIn(s.seats, x)) if (s.money[x] >= MIN_BET) list.push(x);
  s.order = list;
  s.phase = 'bet';
  s.turn = list[0] ?? null;
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  const s = newState(cfgFrom(opts), seats);
  const ev: Event[] = [];
  newShoe(s, rng, ev);
  startCoup(s, rng, ev);
  return s;
}

export const toAct = (s: State): number[] => (s.over || s.turn == null ? [] : [s.turn]);

/** Сколько ещё не покрыто в банке (шмен де фер). */
export const uncovered = (s: State | View) => s.bank - s.bets.reduce((x, b) => x + b.n, 0);

/** Пределы ставки для места. */
export function betRange(s: State | View, seat: number): [number, number] {
  const cap = s.cfg.mode === 'chemmy' ? Math.min(s.money[seat], uncovered(s)) : s.money[seat];
  return [Math.min(MIN_BET, cap), cap];
}

/** Шмен де фер: размеры банка на выбор. */
export function bankChoices(s: State | View, seat: number): number[] {
  return [50, 100, 200, 500].filter((n) => n <= s.money[seat]).concat(s.money[seat] < 50 ? [s.money[seat]] : []);
}

function cloneState(s0: State): State {
  return { ...s0, money: s0.money.slice(), shoe: s0.shoe.slice(), order: s0.order.slice(), bets: s0.bets.map((b) => ({ ...b })), player: s0.player.slice(), banker: s0.banker.slice() };
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn || !a) return null;
  const s = cloneState(s0);
  const ev: Event[] = [];
  const pb = s.cfg.mode === 'pb';
  switch (s.phase) {
    case 'open': {
      if (a.type !== 'bank' || !bankChoices(s, seat).includes(a.n)) return null;
      s.money[seat] -= a.n;
      s.bank = s.bankStart = a.n;
      ev.push({ type: 'bank', seat, n: a.n });
      openBets(s);
      if (s.turn == null) passBank(s, rng, ev);
      return { state: s, events: ev };
    }
    case 'bet': {
      if (a.type === 'skip') ev.push({ type: 'skip', seat });
      else if (a.type === 'banco' && !pb) {
        const n = uncovered(s);
        if (s.money[seat] < n) return null;
        s.money[seat] -= n;
        s.bets.push({ seat, side: 'P', n });
        ev.push({ type: 'bet', seat, side: 'P', n, banco: true });
      } else if (a.type === 'bet') {
        const [lo, hi] = betRange(s, seat);
        const n = Math.floor(a.n);
        if (!(n >= lo && n <= hi && n > 0) || (!pb && a.side !== 'P') || !['P', 'B', 'T'].includes(a.side)) return null;
        s.money[seat] -= n;
        s.bets.push({ seat, side: a.side, n });
        ev.push({ type: 'bet', seat, side: a.side, n });
      } else return null;
      s.order.shift();
      // банк покрыт — остальные не ставят
      if (!pb && uncovered(s) <= 0) s.order = [];
      s.turn = s.order[0] ?? null;
      if (s.turn == null) {
        if (!pb && !s.bets.length) passBank(s, rng, ev);
        else deal(s, rng, ev);
      }
      return { state: s, events: ev };
    }
    case 'punter': {
      if (a.type !== 'draw' && a.type !== 'stand') return null;
      ev.push({ type: 'choice', seat, draw: a.type === 'draw' });
      if (a.type === 'draw') s.player.push(card(s, 'P', rng, ev, true));
      bankerTurn(s, rng, ev);
      return { state: s, events: ev };
    }
    case 'banker': {
      if (a.type !== 'draw' && a.type !== 'stand') return null;
      ev.push({ type: 'choice', seat, draw: a.type === 'draw' });
      if (a.type === 'draw') s.banker.push(card(s, 'B', rng, ev, true));
      settle(s, rng, ev);
      return { state: s, events: ev };
    }
    case 'keep': {
      if (a.type !== 'keep' && a.type !== 'pass') return null;
      ev.push({ type: 'keep', seat, keep: a.type === 'keep', bank: s.bank });
      if (a.type === 'pass') passBank(s, rng, ev);
      else startCoup(s, rng, ev);
      return { state: s, events: ev };
    }
  }
  return null;
}

function card(s: State, hand: 'P' | 'B', rng: Rng, ev: Event[], third = false): Card {
  const c = take(s, rng, ev);
  ev.push({ type: 'card', hand, card: c, third });
  return c;
}

function deal(s: State, rng: Rng, ev: Event[]) {
  s.turn = null;
  if (s.cfg.mode === 'chemmy') {
    // руку Игрока ведёт самая крупная ставка (первая из равных)
    s.punter = s.bets.slice().sort((a, b) => b.n - a.n)[0].seat;
  }
  s.player.push(card(s, 'P', rng, ev));
  s.banker.push(card(s, 'B', rng, ev));
  s.player.push(card(s, 'P', rng, ev));
  s.banker.push(card(s, 'B', rng, ev));
  if (natural(s.player) || natural(s.banker)) return settle(s, rng, ev);
  const p = total(s.player);
  if (s.cfg.mode === 'chemmy' && p === 5) {
    s.phase = 'punter';
    s.turn = s.punter;
    return;
  }
  if (p <= 5) s.player.push(card(s, 'P', rng, ev, true));
  bankerTurn(s, rng, ev);
}

function bankerTurn(s: State, rng: Rng, ev: Event[]) {
  const p3 = s.player.length === 3 ? val(s.player[2]) : null;
  const b = total(s.banker);
  if (s.cfg.mode === 'chemmy' && bankerFree(b, p3)) {
    s.phase = 'banker';
    s.turn = s.bankSeat;
    return;
  }
  if (bankerDraws(b, p3)) s.banker.push(card(s, 'B', rng, ev, true));
  settle(s, rng, ev);
}

function settle(s: State, rng: Rng, ev: Event[]) {
  s.turn = null;
  const p = total(s.player);
  const b = total(s.banker);
  const win: Side = p > b ? 'P' : b > p ? 'B' : 'T';
  const nat = natural(s.player) || natural(s.banker);
  const pay: number[] = [];
  for (const x of s.seats) pay[x] = 0;
  if (s.cfg.mode === 'pb') {
    for (const bet of s.bets) {
      let back = 0;
      if (win === 'T') back = bet.side === 'T' ? bet.n * (s.cfg.tie + 1) : bet.side === 'P' || bet.side === 'B' ? bet.n : 0;
      else if (bet.side === win) back = win === 'B' ? bet.n * 2 - Math.floor((bet.n * s.cfg.vig) / 100) : bet.n * 2;
      s.money[bet.seat] += back;
      pay[bet.seat] += back - bet.n;
    }
  } else {
    const bk = s.bankSeat!;
    for (const bet of s.bets) {
      if (win === 'P') {
        s.money[bet.seat] += bet.n * 2;
        s.bank -= bet.n;
        pay[bet.seat] += bet.n;
        pay[bk] -= bet.n;
      } else if (win === 'B') {
        s.bank += bet.n;
        pay[bet.seat] -= bet.n;
        pay[bk] += bet.n;
      } else s.money[bet.seat] += bet.n;
    }
  }
  s.last = { p, b, win, pay };
  ev.push({ type: 'result', p, b, win, pay, natural: nat });
  if (s.cfg.mode === 'pb') return startCoup(s, rng, ev);
  if (win === 'P') return passBank(s, rng, ev);
  if (win === 'T' || s.coup >= s.cfg.coups) return startCoup(s, rng, ev);
  // выиграл банк — держать ли дальше
  s.phase = 'keep';
  s.turn = s.bankSeat;
}

/** Банк уходит: остаток — банкиру, банкир — следующий. */
function passBank(s: State, rng: Rng, ev: Event[]) {
  const b = s.bankSeat!;
  s.money[b] += s.bank;
  s.bank = 0;
  s.bankStart = 0;
  let nb = nextIn(s.seats, b);
  for (let i = 0; i < s.seats.length && s.money[nb] < MIN_BET; i++) nb = nextIn(s.seats, nb);
  s.bankSeat = null;
  if (s.coup >= s.cfg.coups || alive(s).length < 2) return finish(s, ev);
  s.coup++;
  s.player = [];
  s.banker = [];
  s.bets = [];
  s.punter = null;
  if (s.shoe.length < 30) newShoe(s, rng, ev);
  s.bankSeat = nb;
  s.phase = 'open';
  s.turn = nb;
  ev.push({ type: 'coup', coup: s.coup, banker: nb, bank: 0 });
}

function finish(s: State, ev: Event[]) {
  if (s.bankSeat != null) {
    s.money[s.bankSeat] += s.bank;
    s.bank = 0;
  }
  s.over = true;
  s.phase = 'over';
  s.turn = null;
  const best = Math.max(...s.seats.map((x) => s.money[x]));
  s.winner = s.seats.find((x) => s.money[x] === best)!;
  ev.push({ type: 'end', winner: s.winner, money: s.money.slice() });
}

export function makeView(s: State, _seats: number[] | 'all'): View {
  const { shoe, ...rest } = s as State;
  const v = s as Partial<View>;
  return { ...rest, money: s.money.slice(), bets: s.bets.map((b) => ({ ...b })), player: s.player.slice(), banker: s.banker.slice(), shoeLeft: v.shoeLeft ?? shoe?.length ?? 0 };
}
