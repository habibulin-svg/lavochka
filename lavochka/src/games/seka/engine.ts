/* Сека (и Свара) — правила (без DOM).
 *
 * У каждого 100 рублей. Сдача: все кладут кон (анте), каждому по три карты рубашкой. Торговля по кругу слева от сдающего:
 * «пас», «доставить» (уравнять уровень ставки), «набавить» (поднять уровень). Можно играть втёмную, не глядя в карты:
 * тёмный платит половину уровня, а посмотрев, доплачивает до полного («зрячий платит вдвое»). Уровень не выше того,
 * что может покрыть самый бедный из оставшихся, — побочных банков нет. Каждый поднимает не больше трёх раз за сдачу.
 * Все уравняли после последнего «набавить» — вскрытие. Остался один — забирает банк, карты не показывает.
 *
 * Очки: туз 11, картинки и десятка 10, остальные по числу. Считается лучшее: сумма карт одной масти, два туза — 22,
 * три одинаковые — втрое (три туза 33; в Сваре три семёрки — 34). Джокер (6♣, все шестёрки или 7♠) — любая карта.
 * Равенство лучших — «свара»: банк остаётся, равные играют бесплатно, остальные могут «примазаться» за долю банка.
 */
import type { Options, Rng } from '../../core/types';
import { makeDeck, type Card } from '../../cards/deck';
import { shuffle } from '../../core/rng';

export type Joker = 'none' | 'c6' | 'six' | 's7';

export interface Cfg {
  deck: 32 | 36;
  joker: Joker;
  /** Три семёрки — 34, старше трёх тузов (Свара). */
  sevens: boolean;
  /** Можно играть втёмную. */
  dark: boolean;
  /** Плата за вход в свару: доля банка (2 — половина, 3 — треть). */
  join: 2 | 3;
  ante: number;
  purse: number;
  /** Сколько сдач в партии. */
  deals: number;
}

export function cfgFrom(o: Options): Cfg {
  const pick = (v: unknown, ok: number[], d: number) => (ok.includes(Number(v)) ? Number(v) : d);
  const joker = (['none', 'c6', 'six', 's7'] as Joker[]).includes(o.joker as Joker) ? (o.joker as Joker) : 'c6';
  return {
    deck: Number(o.deck) === 32 ? 32 : 36,
    joker,
    sevens: o.sevens === true,
    dark: o.dark !== false,
    join: Number(o.join) === 3 ? 3 : 2,
    ante: pick(o.ante, [1, 2, 5], 1),
    purse: 100,
    deals: pick(o.deals, [10, 20, 30], 20),
  };
}

/** Сколько раз один игрок может набавить за сдачу. */
export const MAX_RAISES = 3;
/** Страховка от бесконечной партии (свары не считаются в обычные сдачи). */
export const MAX_DEALS = 200;

export type Phase = 'bet' | 'join' | 'over';

export interface State {
  cfg: Cfg;
  seats: number[];
  money: number[];
  /** Сдающий этой сдачи. */
  dealer: number;
  /** Номер обычной сдачи (свары не в счёт). */
  deal: number;
  deck: Card[];
  hands: Card[][];
  /** Кто посмотрел карты. */
  seen: boolean[];
  /** Кто в игре в этой сдаче (не спасовал). */
  live: number[];
  /** Сколько каждый вложил в банк за сдачу. */
  put: number[];
  /** Уровень ставки (для зрячих). */
  level: number;
  pot: number;
  /** Кто ходил после последнего «набавить». */
  acted: number[];
  raises: number[];
  phase: Phase;
  turn: number | null;
  /** Идёт свара: кто в ней. */
  svara: number[] | null;
  /** Вскрытые руки последней сдачи (для показа): место → очки. */
  shown: Record<number, number>;
  /** Кто решает о входе в свару (по очереди). */
  joiners: number[];
  out: number[];
  over: boolean;
  winner: number | null;
}

export interface View extends Omit<State, 'deck'> {
  deckLeft: number;
}

export type Action = { type: 'look' } | { type: 'call' } | { type: 'raise'; to: number } | { type: 'fold' } | { type: 'join'; yes: boolean };

export type Event =
  | { type: 'deal'; n: number; dealer: number; seats: number[]; hands: Card[][]; svara: boolean; ante: number }
  | { type: 'look'; seat: number; cards: Card[] }
  | { type: 'call'; seat: number; paid: number; dark: boolean }
  | { type: 'raise'; seat: number; to: number; paid: number; dark: boolean }
  | { type: 'fold'; seat: number }
  | { type: 'show'; seat: number; cards: Card[]; score: number }
  | { type: 'win'; seat: number; pot: number; shown: boolean }
  | { type: 'svara'; seats: number[]; pot: number }
  | { type: 'join'; seat: number; fee: number; yes: boolean }
  | { type: 'out'; seat: number }
  | { type: 'end'; winner: number; money: number[] };

// ---------------------------------------------------------------- очки

const pts = (r: number) => (r === 14 ? 11 : r >= 10 ? 10 : r);

export const isJoker = (cfg: Cfg, c: Card) =>
  (cfg.joker === 'c6' && c.s === 'C' && c.r === 6) || (cfg.joker === 'six' && c.r === 6) || (cfg.joker === 's7' && c.s === 'S' && c.r === 7);

function plain(cfg: Cfg, cs: Card[]): number {
  let best = 0;
  if (cs[0].r === cs[1].r && cs[1].r === cs[2].r) best = cs[0].r === 14 ? 33 : cfg.sevens && cs[0].r === 7 ? 34 : 3 * pts(cs[0].r);
  for (const s of ['S', 'C', 'D', 'H']) best = Math.max(best, cs.filter((c) => c.s === s).reduce((a, c) => a + pts(c.r), 0));
  if (cs.filter((c) => c.r === 14).length >= 2) best = Math.max(best, 22);
  return best;
}

/** Очки руки из трёх карт (джокер — лучшая из подходящих карт). */
export function score(cfg: Cfg, cs: Card[]): number {
  if (cs.length !== 3 || cs.some((c) => !c.r)) return 0;
  const j = cs.filter((c) => isJoker(cfg, c));
  if (!j.length) return plain(cfg, cs);
  const rest = cs.filter((c) => !isJoker(cfg, c));
  // кандидаты: туз любой масти и карты рангов из руки любой масти
  const ranks = new Set([14, ...rest.map((c) => c.r)]);
  if (cfg.sevens) ranks.add(7);
  const cand: Card[] = [];
  for (const s of ['S', 'C', 'D', 'H'] as const) for (const r of ranks) cand.push({ s, r });
  let best = 0;
  const go = (k: number, acc: Card[]) => {
    if (k === j.length) return void (best = Math.max(best, plain(cfg, [...rest, ...acc])));
    for (const c of cand) go(k + 1, [...acc, c]);
  };
  go(0, []);
  return best;
}

// ---------------------------------------------------------------- ход партии

export function newState(cfg: Cfg, seats: number[]): State {
  return {
    cfg,
    seats: seats.slice(),
    money: [0, 0, 0, 0, 0, 0].map(() => cfg.purse),
    dealer: seats[0],
    deal: 0,
    deck: [],
    hands: [[], [], [], [], [], []],
    seen: [false, false, false, false, false, false],
    live: [],
    put: [0, 0, 0, 0, 0, 0],
    level: 0,
    pot: 0,
    acted: [],
    raises: [0, 0, 0, 0, 0, 0],
    phase: 'bet',
    turn: null,
    svara: null,
    shown: {},
    joiners: [],
    out: [],
    over: false,
    winner: null,
  };
}

const clone = (s: State): State => ({
  ...s,
  money: s.money.slice(),
  deck: s.deck.slice(),
  hands: s.hands.map((h) => h.slice()),
  seen: s.seen.slice(),
  live: s.live.slice(),
  put: s.put.slice(),
  acted: s.acted.slice(),
  raises: s.raises.slice(),
  svara: s.svara ? s.svara.slice() : null,
  shown: { ...s.shown },
  joiners: s.joiners.slice(),
  out: s.out.slice(),
});

export function setup(seats: number[], opts: Options, rng: Rng): State {
  const s = newState(cfgFrom(opts), seats);
  s.dealer = seats[rng.int(seats.length)];
  startDeal(s, rng, [], null);
  return s;
}

/** Места по кругу, начиная после seat. */
function after(s: State, seat: number): number[] {
  const i = s.seats.indexOf(seat);
  return s.seats.map((_, k) => s.seats[(i + 1 + k) % s.seats.length]);
}

/** Сколько месту надо доложить, чтобы уравнять уровень. */
export function owe(s: State | View, p: number): number {
  const need = s.seen[p] || !s.cfg.dark ? s.level : Math.ceil(s.level / 2);
  return Math.max(0, need - s.put[p]);
}

/** Выше какого уровня поднимать нельзя: самый бедный из оставшихся должен смочь доставить зрячим. */
export function cap(s: State | View): number {
  return Math.min(...s.live.map((p) => s.put[p] + s.money[p]));
}

/** Шаги «набавить» для места: допустимые новые уровни. */
export function raiseTo(s: State | View, p: number): number[] {
  if (s.raises[p] >= MAX_RAISES) return [];
  const top = cap(s);
  const a = s.cfg.ante;
  const out: number[] = [];
  for (const d of [a, 2 * a, 5 * a, 10 * a]) {
    const to = s.level + d;
    const cost = (s.seen[p] || !s.cfg.dark ? to : Math.ceil(to / 2)) - s.put[p];
    if (to <= top && cost <= s.money[p]) out.push(to);
  }
  return out;
}

function startDeal(s: State, rng: Rng, ev: Event[], svara: number[] | null) {
  const cfg = s.cfg;
  s.deck = shuffle(makeDeck(cfg.deck), rng);
  s.hands = s.hands.map(() => []);
  s.seen = s.seen.map(() => !cfg.dark);
  s.put = s.put.map(() => 0);
  s.raises = s.raises.map(() => 0);
  s.shown = {};
  s.acted = [];
  s.joiners = [];
  s.svara = svara;
  let ante = 0;
  if (svara) {
    s.live = s.seats.filter((p) => svara.includes(p));
  } else {
    s.deal++;
    s.dealer = after(s, s.dealer).find((p) => !s.out.includes(p))!;
    s.live = s.seats.filter((p) => !s.out.includes(p));
    ante = cfg.ante;
    for (const p of s.live) {
      s.money[p] -= ante;
      s.pot += ante;
    }
  }
  for (const p of s.live) s.hands[p] = s.deck.splice(0, 3);
  // кон уже на столе: торговля с нуля, первый «набавить» задаёт ставку
  s.level = 0;
  s.phase = 'bet';
  ev.push({ type: 'deal', n: s.deal, dealer: s.dealer, seats: s.live.slice(), hands: s.hands.map((h) => h.slice()), svara: !!svara, ante });
  s.turn = after(s, s.dealer).find((p) => s.live.includes(p))!;
}

export const toAct = (s: State): number[] => (s.over || s.turn == null ? [] : [s.turn]);

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over || !a || seat !== s0.turn) return null;
  const s = clone(s0);
  const ev: Event[] = [];

  if (s.phase === 'join') {
    if (a.type !== 'join') return null;
    const fee = joinFee(s);
    if (a.yes && s.money[seat] < fee) return null;
    if (a.yes) {
      s.money[seat] -= fee;
      s.pot += fee;
      s.svara!.push(seat);
    }
    ev.push({ type: 'join', seat, fee, yes: a.yes });
    s.joiners.shift();
    if (s.joiners.length) s.turn = s.joiners[0];
    else startDeal(s, rng, ev, s.seats.filter((p) => s.svara!.includes(p)));
    return { state: s, events: ev };
  }

  if (s.phase !== 'bet') return null;
  const dark = !s.seen[seat];
  switch (a.type) {
    case 'look':
      if (s.seen[seat]) return null;
      s.seen[seat] = true;
      ev.push({ type: 'look', seat, cards: s.hands[seat].slice() });
      return { state: s, events: ev };
    case 'fold':
      s.live = s.live.filter((p) => p !== seat);
      ev.push({ type: 'fold', seat });
      break;
    case 'call': {
      const n = owe(s, seat);
      if (n > s.money[seat]) return null;
      pay(s, seat, n);
      ev.push({ type: 'call', seat, paid: n, dark });
      s.acted.push(seat);
      break;
    }
    case 'raise': {
      if (!raiseTo(s, seat).includes(a.to)) return null;
      s.level = a.to;
      const n = owe(s, seat);
      pay(s, seat, n);
      s.raises[seat]++;
      s.acted = [seat];
      ev.push({ type: 'raise', seat, to: a.to, paid: n, dark });
      break;
    }
    default:
      return null;
  }
  next(s, seat, rng, ev);
  return { state: s, events: ev };
}

function pay(s: State, p: number, n: number) {
  s.money[p] -= n;
  s.put[p] += n;
  s.pot += n;
}

export const joinFee = (s: State | View) => Math.max(1, Math.ceil(s.pot / s.cfg.join));

/** После хода: один остался, все уравняли — вскрытие, иначе ход следующему. */
function next(s: State, seat: number, rng: Rng, ev: Event[]) {
  if (s.live.length === 1) {
    const w = s.live[0];
    ev.push({ type: 'win', seat: w, pot: s.pot, shown: false });
    s.money[w] += s.pot;
    s.pot = 0;
    return endDeal(s, rng, ev);
  }
  if (s.live.every((p) => s.acted.includes(p) && owe(s, p) === 0)) return showdown(s, rng, ev);
  s.turn = after(s, seat).find((p) => s.live.includes(p))!;
}

function showdown(s: State, rng: Rng, ev: Event[]) {
  for (const p of s.live) {
    s.seen[p] = true;
    s.shown[p] = score(s.cfg, s.hands[p]);
    ev.push({ type: 'show', seat: p, cards: s.hands[p].slice(), score: s.shown[p] });
  }
  const best = Math.max(...s.live.map((p) => s.shown[p]));
  const top = s.live.filter((p) => s.shown[p] === best);
  if (top.length === 1) {
    ev.push({ type: 'win', seat: top[0], pot: s.pot, shown: true });
    s.money[top[0]] += s.pot;
    s.pot = 0;
    return endDeal(s, rng, ev);
  }
  // свара: банк остаётся; остальные решают, входить ли
  ev.push({ type: 'svara', seats: top.slice(), pot: s.pot });
  s.svara = top.slice();
  const fee = joinFee(s);
  s.joiners = after(s, s.dealer).filter((p) => !top.includes(p) && !s.out.includes(p) && s.money[p] >= fee);
  s.live = [];
  if (s.joiners.length) {
    s.phase = 'join';
    s.turn = s.joiners[0];
    return;
  }
  startDeal(s, rng, ev, top);
}

function endDeal(s: State, rng: Rng, ev: Event[]) {
  s.turn = null;
  s.svara = null;
  for (const p of s.seats)
    if (!s.out.includes(p) && s.money[p] < s.cfg.ante) {
      s.out.push(p);
      ev.push({ type: 'out', seat: p });
    }
  const left = s.seats.filter((p) => !s.out.includes(p));
  if (left.length < 2 || s.deal >= s.cfg.deals || s.deal >= MAX_DEALS) {
    const best = Math.max(...s.seats.map((p) => s.money[p]));
    s.winner = s.seats.find((p) => s.money[p] === best)!;
    s.over = true;
    s.phase = 'over';
    ev.push({ type: 'end', winner: s.winner, money: s.money.slice() });
    return;
  }
  startDeal(s, rng, ev, null);
}

const HIDDEN: Card = { s: 'S', r: 0 };

export function makeView(s: State, seats: number[] | 'all'): View {
  const all = seats === 'all';
  const { deck, ...rest } = s;
  // свои карты видно, только если посмотрел; чужие — после вскрытия
  const vis = (p: number) => all || ((seats as number[]).includes(p) && s.seen[p]) || p in s.shown;
  return { ...rest, deckLeft: deck.length, hands: s.hands.map((h, p) => (vis(p) ? h.slice() : h.map(() => HIDDEN))) };
}
