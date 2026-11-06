/* Штос (штосс, фараон, банк) — правила (без DOM). Азартная банковая игра XIX века: банкомёт держит банк и мечет колоду
 * парами («абцугами»): первая карта ложится направо — она банкомётова, вторая налево — понтёрова. Понтёры заранее ставят
 * куш на достоинство карты (масть не важна). Карта понтёра легла налево — понтёр выиграл куш, направо — проиграл в банк.
 * Обе карты пары одного достоинства — «плие» (дублет): в штосе куш берёт банкомёт, в фараоне — половину.
 *
 * Выигравший понтёр решает: снять куш с выигрышем; «пе» — выигрыш в карман, куш остаётся на карте; или «загнуть угол» —
 * оставить выигрыш на карте, ставка удваивается: пароли (3 куша чистыми), сетелева (7), кензелева (15), трантелева (31),
 * сонника (63). Играть «мирандолем» — ставить одно и то же и углов не гнуть.
 *
 * Фараон американский: первая карта — «сода», мёртвая; последняя — «хок», тоже не считается; можно поставить «медью» (копер) —
 * ставка наоборот, выигрывает направо. Банк: всё, что стоит на картах, не больше банка; банк сорван — талья кончилась.
 * Банк держат по очереди; партия — одна или две тальи на каждого банкомёта; побеждает, у кого больше фишек.
 */
import type { Options, Rng } from '../../core/types';
import { makeDeck, type Card } from '../../cards/deck';
import { shuffle } from '../../core/rng';

export interface Cfg {
  deck: 36 | 52;
  /** Плие: банкомёт берёт половину куша (фараон) или весь (штос). */
  split: boolean;
  /** Сода и хок: первая и последняя карты тальи мёртвые. */
  sodaHock: boolean;
  /** Можно гнуть углы (пароли и дальше). */
  corners: boolean;
  /** Можно ставить «медью» — наоборот. */
  copper: boolean;
  /** Сколько раз каждый держит банк. */
  rounds: number;
  purse: number;
}

export function cfgFrom(o: Options): Cfg {
  return {
    deck: Number(o.deck) === 36 ? 36 : 52,
    split: o.split === true,
    sodaHock: o.sodaHock === true,
    corners: o.corners !== false,
    copper: o.copper === true,
    rounds: Number(o.rounds) === 2 ? 2 : 1,
    purse: 1000,
  };
}

export const MIN_BET = 10;
export const MIN_BANK = 50;
export const MAX_BETS = 3;
/** Сколько углов можно загнуть: пароли, сетелева, кензелева, трантелева, сонника. */
export const MAX_LEVEL = 5;
export const LEVEL_NAME = ['куш', 'пароли', 'сетелева', 'кензелева', 'трантелева', 'сонника'];

export type Phase = 'bank' | 'stake' | 'deal' | 'over';

export interface Bet {
  seat: number;
  rank: number;
  /** Сколько стоит на карте сейчас. */
  amt: number;
  /** Выигрыш, о котором понтёр ещё не решил (0 — решать нечего). */
  win: number;
  /** Сколько углов загнуто. */
  level: number;
  copper: boolean;
}

export interface State {
  cfg: Cfg;
  seats: number[];
  money: number[];
  deck: Card[];
  /** Номер тальи (с 1) и сколько их в партии. */
  talia: number;
  talias: number;
  banker: number | null;
  bank: number;
  bankStart: number;
  phase: Phase;
  turn: number | null;
  /** Кого из понтёров ещё спросить до следующей пары. */
  order: number[];
  bets: Bet[];
  /** Направо (банкомёту) и налево (понтёрам) — вышедшие карты по порядку. */
  right: Card[];
  left: Card[];
  soda: Card | null;
  hock: Card | null;
  /** Понтёры, сказавшие «пас до конца тальи». */
  out: number[];
  over: boolean;
  winner: number | null;
}

export interface View extends Omit<State, 'deck'> {
  deckLeft: number;
  /** Сколько карт каждого достоинства ещё не вышло (индекс — достоинство). */
  rest: number[];
}

export type Action =
  | { type: 'bank'; n: number }
  | { type: 'stake'; rank: number; n: number; copper?: boolean }
  | { type: 'take'; rank: number }
  | { type: 'paix'; rank: number }
  | { type: 'paroli'; rank: number }
  | { type: 'done' }
  | { type: 'sitout' }
  | { type: 'deal' };

export type Outcome = 'win' | 'lose' | 'plie';
export interface Res {
  seat: number;
  rank: number;
  outcome: Outcome;
  /** Сколько стояло. */
  amt: number;
  /** Сколько ушло в банк (плие — половина или всё). */
  lost: number;
  copper: boolean;
}

export type Event =
  | { type: 'talia'; talia: number; banker: number }
  | { type: 'soda'; card: Card }
  | { type: 'bank'; seat: number; n: number }
  | { type: 'stake'; seat: number; rank: number; n: number; copper: boolean }
  | { type: 'decide'; seat: number; rank: number; how: 'take' | 'paix' | 'paroli'; amt: number; win: number; level: number }
  | { type: 'done'; seat: number; out: boolean; idle: boolean }
  | { type: 'pair'; right: Card; left: Card; res: Res[] }
  | { type: 'endTalia'; banker: number; bank: number; start: number; hock: Card | null; broke: boolean; returned: number }
  | { type: 'skipBank'; seat: number }
  | { type: 'end'; winner: number; money: number[] };

const nextIn = (list: number[], seat: number) => list[(list.indexOf(seat) + 1) % list.length];

export const ranksOf = (cfg: Cfg) => Array.from({ length: cfg.deck === 36 ? 9 : 13 }, (_, i) => (cfg.deck === 36 ? 6 : 2) + i);

export function newState(cfg: Cfg, seats: number[]): State {
  const money: number[] = [];
  for (const x of seats) money[x] = cfg.purse;
  return {
    cfg,
    seats: seats.slice(),
    money,
    deck: [],
    talia: 0,
    talias: cfg.rounds * seats.length,
    banker: null,
    bank: 0,
    bankStart: 0,
    phase: 'bank',
    turn: null,
    order: [],
    bets: [],
    right: [],
    left: [],
    soda: null,
    hock: null,
    out: [],
    over: false,
    winner: null,
  };
}

/** Сколько карт достоинства ещё не вышло. */
export function restOf(s: State | View, rank: number): number {
  const seen = [...s.right, ...s.left, ...(s.soda ? [s.soda] : []), ...(s.hock ? [s.hock] : [])].filter((c) => c.r === rank).length;
  return 4 - seen;
}

/** Всё, что стоит на картах под ударом (банк должен покрыть всё); выигравший куш, о котором ещё решают, не в счёт. */
export const atRisk = (s: State | View) => s.bets.reduce((x, b) => x + (b.win ? 0 : b.amt), 0);
/** Сколько ещё можно поставить против банка. */
export const room = (s: State | View) => s.bank - atRisk(s);

export const punters = (s: State | View) => {
  const b = s.banker!;
  const list: number[] = [];
  for (let x = nextIn(s.seats, b); x !== b; x = nextIn(s.seats, x)) list.push(x);
  return list;
};

export function bankChoices(s: State | View, seat: number): number[] {
  const m = s.money[seat];
  const list = [100, 200, 300, 500].filter((n) => n <= m);
  return list.length ? list : m >= MIN_BANK ? [m] : [];
}

export function stakeRange(s: State | View, seat: number): [number, number] {
  const hi = Math.min(s.money[seat], room(s));
  return [MIN_BET, hi];
}

export function canStake(s: State | View, seat: number, rank: number, n: number, copper = false): boolean {
  if (s.phase !== 'stake' || s.turn !== seat) return false;
  if (!ranksOf(s.cfg).includes(rank) || restOf(s, rank) <= 0) return false;
  if (copper && !s.cfg.copper) return false;
  const mine = s.bets.filter((b) => b.seat === seat);
  if (mine.length >= MAX_BETS || mine.some((b) => b.rank === rank)) return false;
  const [lo, hi] = stakeRange(s, seat);
  return Number.isInteger(n) && n >= lo && n <= hi;
}

export const pending = (s: State | View, seat: number) => s.bets.filter((b) => b.seat === seat && b.win > 0);

export function canParoli(s: State | View, b: Bet): boolean {
  return s.cfg.corners && b.win > 0 && b.level < MAX_LEVEL && room(s) >= b.amt + b.win && restOf(s, b.rank) > 0;
}

export function canPaix(s: State | View, b: Bet): boolean {
  return b.win > 0 && room(s) >= b.amt && restOf(s, b.rank) > 0;
}

function cloneState(s0: State): State {
  return {
    ...s0,
    money: s0.money.slice(),
    deck: s0.deck.slice(),
    order: s0.order.slice(),
    bets: s0.bets.map((b) => ({ ...b })),
    right: s0.right.slice(),
    left: s0.left.slice(),
    out: s0.out.slice(),
  };
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  const s = newState(cfgFrom(opts), seats);
  startTalia(s, rng, []);
  return s;
}

/** Новая талья: банк — следующему по кругу, у кого хватает на банк. */
function startTalia(s: State, rng: Rng, ev: Event[]) {
  for (;;) {
    if (s.talia >= s.talias || s.seats.filter((x) => s.money[x] >= MIN_BET).length < 2) return finish(s, ev);
    const b = s.seats[s.talia % s.seats.length];
    s.talia++;
    if (bankChoices(s, b).length) {
      s.banker = b;
      break;
    }
    ev.push({ type: 'skipBank', seat: b });
  }
  s.deck = shuffle(makeDeck(s.cfg.deck), rng);
  s.right = [];
  s.left = [];
  s.soda = null;
  s.hock = null;
  s.bets = [];
  s.out = [];
  s.bank = 0;
  s.bankStart = 0;
  s.phase = 'bank';
  s.turn = s.banker;
  ev.push({ type: 'talia', talia: s.talia, banker: s.banker! });
}

export const toAct = (s: State): number[] => (s.over || s.turn == null ? [] : [s.turn]);

/** Кого спросить: всех, кто выиграл (решить про угол) или проиграл в этой паре, и тех, у кого на картах пусто. */
function askOrder(s: State, touched: number[], all: boolean): number[] {
  return punters(s).filter((x) => {
    if (pending(s, x).length) return true;
    if (s.out.includes(x) || s.money[x] < MIN_BET || room(s) < MIN_BET) return false;
    if (all || touched.includes(x)) return true;
    return !s.bets.some((b) => b.seat === x);
  });
}

function nextTurn(s: State, rng: Rng, ev: Event[]) {
  s.turn = s.order[0] ?? null;
  if (s.turn != null) {
    s.phase = 'stake';
    return;
  }
  // никто не играет и никто не вернётся — талья кончилась
  const idle = punters(s).every((x) => s.out.includes(x) || s.money[x] < MIN_BET);
  if (idle && !s.bets.length) return endTalia(s, rng, ev, false);
  s.phase = 'deal';
  s.turn = s.banker;
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn || !a) return null;
  const s = cloneState(s0);
  const ev: Event[] = [];
  switch (s.phase) {
    case 'bank': {
      if (a.type !== 'bank' || !bankChoices(s, seat).includes(a.n)) return null;
      s.money[seat] -= a.n;
      s.bank = s.bankStart = a.n;
      ev.push({ type: 'bank', seat, n: a.n });
      if (s.cfg.sodaHock) {
        s.soda = s.deck.shift()!;
        ev.push({ type: 'soda', card: s.soda });
      }
      s.order = askOrder(s, [], true);
      nextTurn(s, rng, ev);
      return { state: s, events: ev };
    }
    case 'stake': {
      const bet = 'rank' in a ? s.bets.find((b) => b.seat === seat && b.rank === a.rank) : undefined;
      switch (a.type) {
        case 'stake': {
          const copper = !!a.copper;
          if (!canStake(s, seat, a.rank, a.n, copper)) return null;
          s.money[seat] -= a.n;
          s.bets.push({ seat, rank: a.rank, amt: a.n, win: 0, level: 0, copper });
          ev.push({ type: 'stake', seat, rank: a.rank, n: a.n, copper });
          return { state: s, events: ev };
        }
        case 'take': {
          if (!bet || !bet.win) return null;
          s.money[seat] += bet.amt + bet.win;
          ev.push({ type: 'decide', seat, rank: bet.rank, how: 'take', amt: bet.amt, win: bet.win, level: bet.level });
          s.bets = s.bets.filter((b) => b !== bet);
          return { state: s, events: ev };
        }
        case 'paix': {
          if (!bet || !canPaix(s, bet)) return null;
          s.money[seat] += bet.win;
          ev.push({ type: 'decide', seat, rank: bet.rank, how: 'paix', amt: bet.amt, win: bet.win, level: bet.level });
          bet.win = 0;
          return { state: s, events: ev };
        }
        case 'paroli': {
          if (!bet || !canParoli(s, bet)) return null;
          bet.level++;
          ev.push({ type: 'decide', seat, rank: bet.rank, how: 'paroli', amt: bet.amt, win: bet.win, level: bet.level });
          bet.amt += bet.win;
          bet.win = 0;
          return { state: s, events: ev };
        }
        case 'done':
        case 'sitout': {
          if (pending(s, seat).length) return null;
          const out = a.type === 'sitout';
          if (out) s.out.push(seat);
          ev.push({ type: 'done', seat, out, idle: !s.bets.some((b) => b.seat === seat) });
          s.order = s.order.filter((x) => x !== seat);
          nextTurn(s, rng, ev);
          return { state: s, events: ev };
        }
      }
      return null;
    }
    case 'deal': {
      if (a.type !== 'deal') return null;
      deal(s, rng, ev);
      return { state: s, events: ev };
    }
  }
  return null;
}

/** Сколько карт мечут парами: без соды и хока — вся колода, с ними — пока не останется одна (хок). */
const pairsLeft = (s: State) => (s.cfg.sodaHock ? s.deck.length - 1 : s.deck.length) >= 2;

function deal(s: State, rng: Rng, ev: Event[]) {
  const right = s.deck.shift()!;
  const left = s.deck.shift()!;
  s.right.push(right);
  s.left.push(left);
  const res: Res[] = [];
  const touched: number[] = [];
  for (const b of s.bets.slice()) {
    if (b.rank !== right.r && b.rank !== left.r) continue;
    touched.push(b.seat);
    if (right.r === left.r) {
      const lost = s.cfg.split ? Math.floor(b.amt / 2) : b.amt;
      s.bank += lost;
      s.money[b.seat] += b.amt - lost;
      res.push({ seat: b.seat, rank: b.rank, outcome: 'plie', amt: b.amt, lost, copper: b.copper });
      s.bets = s.bets.filter((x) => x !== b);
      continue;
    }
    const won = (b.rank === left.r) !== b.copper;
    if (won) {
      b.win = b.amt;
      s.bank -= b.amt;
      res.push({ seat: b.seat, rank: b.rank, outcome: 'win', amt: b.amt, lost: 0, copper: b.copper });
    } else {
      s.bank += b.amt;
      res.push({ seat: b.seat, rank: b.rank, outcome: 'lose', amt: b.amt, lost: b.amt, copper: b.copper });
      s.bets = s.bets.filter((x) => x !== b);
    }
  }
  ev.push({ type: 'pair', right, left, res });
  if (!pairsLeft(s)) return endTalia(s, rng, ev, false);
  if (s.bank <= 0) return endTalia(s, rng, ev, true);
  s.order = askOrder(s, touched, false);
  nextTurn(s, rng, ev);
}

function endTalia(s: State, rng: Rng, ev: Event[], broke: boolean) {
  if (s.cfg.sodaHock && s.deck.length === 1 && !broke) s.hock = s.deck[0];
  let returned = 0;
  for (const b of s.bets) {
    s.money[b.seat] += b.amt + b.win;
    returned += b.amt + b.win;
  }
  // невыплаченный выигрыш уже вычтен из банка, сам куш — нет: он стоял против банка и возвращается понтёру
  s.bets = [];
  const banker = s.banker!;
  s.money[banker] += s.bank;
  ev.push({ type: 'endTalia', banker, bank: s.bank, start: s.bankStart, hock: s.hock, broke, returned });
  s.bank = 0;
  s.order = [];
  s.turn = null;
  startTalia(s, rng, ev);
}

function finish(s: State, ev: Event[]) {
  s.over = true;
  s.phase = 'over';
  s.turn = null;
  s.banker = null;
  const best = Math.max(...s.seats.map((x) => s.money[x]));
  s.winner = s.seats.find((x) => s.money[x] === best)!;
  ev.push({ type: 'end', winner: s.winner, money: s.money.slice() });
}

export function makeView(s: State, _seats: number[] | 'all'): View {
  const { deck, ...rest } = s as State;
  const v = s as Partial<View>;
  const r: number[] = [];
  for (const k of ranksOf(s.cfg)) r[k] = restOf(s, k);
  return {
    ...rest,
    money: s.money.slice(),
    bets: s.bets.map((b) => ({ ...b })),
    right: s.right.slice(),
    left: s.left.slice(),
    order: s.order.slice(),
    out: s.out.slice(),
    deckLeft: v.deckLeft ?? deck?.length ?? 0,
    rest: r,
  };
}
