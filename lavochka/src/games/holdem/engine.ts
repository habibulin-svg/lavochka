/* Техасский холдем — правила (без DOM). 52 карты, 2–9 игроков, у каждого стек фишек; играют, пока у одного не окажутся все фишки.
 *
 * Раздача: каждому по две закрытые карты, малый и большой блайнды ставят слева от баттона (вдвоём баттон — малый блайнд).
 * Торговля: префлоп (первым ходит следующий за большим блайндом), флоп (3 общие карты), тёрн, ривер (по одной). После префлопа первым — следующий за баттоном.
 * Ход: пас (сбросить), чек (если ставки нет), колл (уравнять), рейз (поднять не меньше прошлого повышения), ва-банк.
 * Круг кончается, когда все, кто не спасовал и не пошёл ва-банк, уравняли ставку и сказали своё слово.
 * Вскрытие: лучшая пятёрка из семи карт. Ва-банк — побочные банки: каждый претендует только на ту часть, которую покрыл.
 * Комбинации снизу вверх: старшая карта, пара, две пары, сет, стрит, флеш, фулл-хаус, каре, стрит-флеш.
 * Блайнды растут каждые N раздач (настройка), чтобы партия не тянулась вечно.
 */
import type { Options, Rng } from '../../core/types';
import type { Card, Suit } from '../../cards/deck';

export interface Cfg {
  chips: number;
  blind: number;
  /** Удваивать блайнды каждые столько раздач (0 — не расти). */
  every: number;
}

export function cfgFrom(o: Options): Cfg {
  const chips = [500, 1000, 2000].includes(Number(o.chips)) ? Number(o.chips) : 1000;
  const blind = [10, 20, 50].includes(Number(o.blind)) ? Number(o.blind) : 20;
  const every = [0, 5, 10, 20].includes(Number(o.every)) ? Number(o.every) : 10;
  return { chips, blind, every };
}

export type Street = 'preflop' | 'flop' | 'turn' | 'river';

export interface State {
  cfg: Cfg;
  seats: number[];
  chips: number[];
  /** Номер раздачи. */
  hand: number;
  button: number;
  sb: number;
  bb: number;
  /** Текущий большой блайнд. */
  big: number;
  deck: Card[];
  hole: Card[][];
  board: Card[];
  street: Street;
  /** Ставка в этом круге и за всю раздачу. */
  bet: number[];
  total: number[];
  folded: boolean[];
  allin: boolean[];
  /** Кто в этой раздаче (не выбывшие). */
  inHand: number[];
  /** Сказали слово в этом круге после последнего повышения. */
  acted: number[];
  current: number;
  minRaise: number;
  turn: number;
  phase: 'play' | 'over';
  /** Открытые на вскрытии карты. */
  shown: Record<number, Card[]>;
  /** Итог прошлой раздачи — для показа. */
  last: { winners: { seat: number; amount: number; hand: string }[] } | null;
  winner: number | null;
}

export interface View extends State {
  me: number[];
}

export type Action = { type: 'fold' } | { type: 'check' } | { type: 'call' } | { type: 'raise'; to: number } | { type: 'allin' };

export type Event =
  | { type: 'deal'; hand: number; button: number; sb: number; bb: number; big: number; hole?: Card[][]; seats: number[] }
  | { type: 'blind'; seat: number; amount: number; big: boolean }
  | { type: 'act'; seat: number; action: Action['type']; amount: number; to: number }
  | { type: 'street'; street: Street; cards: Card[] }
  | { type: 'show'; seat: number; cards: Card[]; hand: string }
  | { type: 'win'; seat: number; amount: number; hand: string; uncontested: boolean }
  | { type: 'bust'; seat: number }
  | { type: 'blinds'; big: number }
  | { type: 'end'; winner: number };

// ---------------------------------------------------------------- оценка рук

const SUITS: Suit[] = ['S', 'C', 'D', 'H'];
export const HAND_NAMES = ['старшая карта', 'пара', 'две пары', 'сет', 'стрит', 'флеш', 'фулл-хаус', 'каре', 'стрит-флеш'];

/** Сила пятёрки или лучшей из 5–7 карт: [категория, ...кикеры] — сравниваются лексикографически, упакованы в число. */
export function evaluate(cards: Card[]): number {
  const ranks = cards.map((c) => c.r).sort((a, b) => b - a);
  const bySuit = new Map<Suit, number[]>();
  for (const c of cards) bySuit.set(c.s, [...(bySuit.get(c.s) ?? []), c.r]);
  const cnt = new Map<number, number>();
  for (const r of ranks) cnt.set(r, (cnt.get(r) ?? 0) + 1);
  const straightTop = (rs: number[]): number => {
    const u = [...new Set(rs)].sort((a, b) => b - a);
    if (u.includes(14)) u.push(1);
    for (let i = 0; i + 4 < u.length; i++) if (u[i] - u[i + 4] === 4) return u[i];
    return 0;
  };
  const pack = (cat: number, ks: number[]) => ks.slice(0, 5).reduce((a, k) => a * 15 + k, cat) * Math.pow(15, 5 - Math.min(5, ks.length));
  // стрит-флеш и флеш
  for (const s of SUITS) {
    const rs = bySuit.get(s);
    if (rs && rs.length >= 5) {
      const sf = straightTop(rs);
      if (sf) return pack(8, [sf]);
    }
  }
  const groups = [...cnt.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  if (groups[0][1] === 4) return pack(7, [groups[0][0], ...ranks.filter((r) => r !== groups[0][0])]);
  if (groups[0][1] === 3 && groups[1] && groups[1][1] >= 2) return pack(6, [groups[0][0], groups[1][0]]);
  for (const s of SUITS) {
    const rs = bySuit.get(s);
    if (rs && rs.length >= 5) return pack(5, rs.sort((a, b) => b - a));
  }
  const st = straightTop(ranks);
  if (st) return pack(4, [st]);
  if (groups[0][1] === 3) return pack(3, [groups[0][0], ...ranks.filter((r) => r !== groups[0][0])]);
  if (groups[0][1] === 2 && groups[1] && groups[1][1] === 2) {
    const hi = groups[0][0];
    const lo = groups[1][0];
    return pack(2, [hi, lo, ...ranks.filter((r) => r !== hi && r !== lo)]);
  }
  if (groups[0][1] === 2) return pack(1, [groups[0][0], ...ranks.filter((r) => r !== groups[0][0])]);
  return pack(0, ranks);
}

export const category = (v: number) => Math.floor(v / Math.pow(15, 5));
export const handName = (v: number) => HAND_NAMES[category(v)];

// ---------------------------------------------------------------- партия

function makeDeck52(): Card[] {
  const out: Card[] = [];
  for (const s of SUITS) for (let r = 2; r <= 14; r++) out.push({ s, r });
  return out;
}

function shuffle<T>(a: T[], rng: Rng): T[] {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

const N = 9;
const live = (s: Pick<State, 'chips' | 'seats'>) => s.seats.filter((x) => s.chips[x] > 0);
const nextIn = (list: number[], seat: number) => {
  const all = [...list].sort((a, b) => a - b);
  const after = all.find((x) => x > seat);
  return after ?? all[0];
};

export function newState(cfg: Cfg, seats: number[]): State {
  const z = () => Array(N).fill(0);
  return {
    cfg,
    seats: seats.slice(),
    chips: Array.from({ length: N }, (_, i) => (seats.includes(i) ? cfg.chips : 0)),
    hand: 0,
    button: seats[seats.length - 1],
    sb: -1,
    bb: -1,
    big: cfg.blind,
    deck: [],
    hole: Array.from({ length: N }, () => []),
    board: [],
    street: 'preflop',
    bet: z(),
    total: z(),
    folded: Array(N).fill(false),
    allin: Array(N).fill(false),
    inHand: [],
    acted: [],
    current: 0,
    minRaise: cfg.blind,
    turn: seats[0],
    phase: 'play',
    shown: {},
    last: null,
    winner: null,
  };
}

/** Поставить из стека (не больше, чем есть). */
function put(s: State, seat: number, amount: number): number {
  const a = Math.min(amount, s.chips[seat]);
  s.chips[seat] -= a;
  s.bet[seat] += a;
  s.total[seat] += a;
  if (s.chips[seat] === 0) s.allin[seat] = true;
  return a;
}

export function deal(s0: State, rng: Rng): { state: State; events: Event[] } {
  const ev: Event[] = [];
  const players = live(s0);
  const hand = s0.hand + 1;
  let big = s0.big;
  if (s0.cfg.every && hand > 1 && (hand - 1) % s0.cfg.every === 0) {
    big = s0.big * 2;
    ev.push({ type: 'blinds', big });
  }
  const button = s0.hand === 0 ? players[players.length - 1] : nextIn(players, s0.button);
  const heads = players.length === 2;
  const sb = heads ? button : nextIn(players, button);
  const bb = nextIn(players, sb);
  const deck = shuffle(makeDeck52(), rng);
  const hole: Card[][] = Array.from({ length: N }, () => []);
  for (const p of players) hole[p] = deck.splice(0, 2);
  const z = () => Array(N).fill(0);
  const s: State = {
    ...s0,
    hand,
    big,
    button,
    sb,
    bb,
    deck,
    hole,
    board: [],
    street: 'preflop',
    bet: z(),
    total: z(),
    folded: Array(N).fill(false),
    allin: Array(N).fill(false),
    inHand: players.slice(),
    acted: [],
    current: 0,
    minRaise: big,
    shown: {},
    chips: s0.chips.slice(),
  };
  ev.push({ type: 'deal', hand, button, sb, bb, big, hole: hole.map((h) => h.slice()), seats: players.slice() });
  ev.push({ type: 'blind', seat: sb, amount: put(s, sb, big / 2), big: false });
  ev.push({ type: 'blind', seat: bb, amount: put(s, bb, big), big: true });
  s.current = big;
  s.turn = nextIn(players, bb);
  // все, кроме одного, уже ва-банк на блайндах — сразу открываем
  return advance(s, ev, rng, true);
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  return deal(newState(cfgFrom(opts), seats), rng).state;
}

export const toAct = (s: State): number[] => (s.phase === 'over' ? [] : [s.turn]);

const contenders = (s: State) => s.inHand.filter((x) => !s.folded[x]);
const canAct = (s: State, x: number) => !s.folded[x] && !s.allin[x];

/** Кому ходить дальше в круге (или null — круг окончен). */
function nextToAct(s: State, from: number): number | null {
  const order = [...s.inHand].sort((a, b) => a - b);
  let x = from;
  for (let i = 0; i < order.length; i++) {
    x = nextIn(order, x);
    if (canAct(s, x) && (!s.acted.includes(x) || s.bet[x] < s.current)) return x;
  }
  return null;
}

/** После действия: следующий игрок, следующая улица или вскрытие. */
function advance(s: State, ev: Event[], rng: Rng, fromDeal = false): { state: State; events: Event[] } {
  if (contenders(s).length === 1) return finishHand(s, ev, rng, true);
  const startFrom = fromDeal ? s.bb : s.turn;
  const nx = fromDeal ? nextToAct(s, s.bb) : nextToAct(s, startFrom);
  const active = contenders(s).filter((x) => !s.allin[x]);
  // уравнивать некому: остальные ва-банк
  if (nx != null && !(active.length === 1 && s.bet[active[0]] >= s.current)) {
    s.turn = nx;
    return { state: s, events: ev };
  }
  // круг окончен
  while (true) {
    if (s.street === 'river') return finishHand(s, ev, rng, false);
    const nextStreet: Street = s.street === 'preflop' ? 'flop' : s.street === 'flop' ? 'turn' : 'river';
    const n = nextStreet === 'flop' ? 3 : 1;
    s.deck = s.deck.slice();
    s.deck.shift(); // карта в сброс
    const cards = s.deck.splice(0, n);
    s.board = [...s.board, ...cards];
    s.street = nextStreet;
    s.bet = Array(N).fill(0);
    s.current = 0;
    s.minRaise = s.big;
    s.acted = [];
    ev.push({ type: 'street', street: nextStreet, cards });
    const can = contenders(s).filter((x) => !s.allin[x]);
    if (can.length >= 2) {
      const first = nextToAct(s, s.button);
      if (first != null) {
        s.turn = first;
        return { state: s, events: ev };
      }
    }
    // торговаться некому — открываем следующие карты
  }
}

function finishHand(s: State, ev: Event[], rng: Rng, uncontested: boolean): { state: State; events: Event[] } {
  const alive = contenders(s);
  const winners: { seat: number; amount: number; hand: string }[] = [];
  if (uncontested) {
    const w = alive[0];
    const pot = s.inHand.reduce((a, x) => a + s.total[x], 0);
    s.chips[w] += pot;
    ev.push({ type: 'win', seat: w, amount: pot, hand: '', uncontested: true });
    winners.push({ seat: w, amount: pot, hand: '' });
  } else {
    // вскрытие
    const val = new Map<number, number>();
    for (const p of alive) {
      const v = evaluate([...s.hole[p], ...s.board]);
      val.set(p, v);
      s.shown[p] = s.hole[p].slice();
      ev.push({ type: 'show', seat: p, cards: s.hole[p].slice(), hand: handName(v) });
    }
    // побочные банки по уровням вложений
    const levels = [...new Set(s.inHand.map((x) => s.total[x]).filter((v) => v > 0))].sort((a, b) => a - b);
    let prev = 0;
    for (const lv of levels) {
      const layer = s.inHand.reduce((a, x) => a + Math.max(0, Math.min(s.total[x], lv) - prev), 0);
      const elig = alive.filter((x) => s.total[x] >= lv);
      prev = lv;
      if (!layer) continue;
      if (!elig.length) {
        // вложения спасовавших сверх всех претендентов — тому, кто дальше всех дошёл
        const best = alive.slice().sort((a, b) => val.get(b)! - val.get(a)!)[0];
        s.chips[best] += layer;
        continue;
      }
      const top = Math.max(...elig.map((x) => val.get(x)!));
      const ws = elig.filter((x) => val.get(x) === top).sort((a, b) => a - b);
      const share = Math.floor(layer / ws.length);
      let rest = layer - share * ws.length;
      for (const w of ws) {
        const amt = share + (rest-- > 0 ? 1 : 0);
        s.chips[w] += amt;
        const ex = winners.find((x) => x.seat === w);
        if (ex) ex.amount += amt;
        else winners.push({ seat: w, amount: amt, hand: handName(top) });
      }
    }
    for (const w of winners) ev.push({ type: 'win', seat: w.seat, amount: w.amount, hand: w.hand, uncontested: false });
  }
  s.last = { winners };
  for (const p of s.inHand) if (s.chips[p] === 0) ev.push({ type: 'bust', seat: p });
  const left = live(s);
  if (left.length <= 1) {
    s.phase = 'over';
    s.winner = left[0] ?? winners[0]?.seat ?? null;
    ev.push({ type: 'end', winner: s.winner! });
    return { state: s, events: ev };
  }
  const d = deal(s, rng);
  return { state: d.state, events: [...ev, ...d.events] };
}

/** Сколько игроку нужно добавить, чтобы уравнять. */
export const toCall = (s: Pick<State, 'current' | 'bet' | 'chips'>, seat: number) => Math.min(s.chips[seat], Math.max(0, s.current - s.bet[seat]));
/** Наименьший допустимый рейз «до». */
export const minRaiseTo = (s: Pick<State, 'current' | 'minRaise'>) => s.current + s.minRaise;

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.phase === 'over' || seat !== s0.turn || !a || typeof a !== 'object' || !canAct(s0, seat)) return null;
  const s: State = { ...s0, chips: s0.chips.slice(), bet: s0.bet.slice(), total: s0.total.slice(), folded: s0.folded.slice(), allin: s0.allin.slice(), acted: s0.acted.slice(), shown: { ...s0.shown } };
  const ev: Event[] = [];
  const need = s.current - s.bet[seat];
  const markActed = () => {
    if (!s.acted.includes(seat)) s.acted.push(seat);
  };
  switch (a.type) {
    case 'fold':
      s.folded[seat] = true;
      ev.push({ type: 'act', seat, action: 'fold', amount: 0, to: s.bet[seat] });
      break;
    case 'check':
      if (need > 0) return null;
      markActed();
      ev.push({ type: 'act', seat, action: 'check', amount: 0, to: s.bet[seat] });
      break;
    case 'call': {
      if (need <= 0) return null;
      const amt = put(s, seat, need);
      markActed();
      ev.push({ type: 'act', seat, action: s.allin[seat] ? 'allin' : 'call', amount: amt, to: s.bet[seat] });
      break;
    }
    case 'raise':
    case 'allin': {
      const to = a.type === 'allin' ? s.bet[seat] + s.chips[seat] : a.to;
      if (!Number.isInteger(to) || to <= s.current) {
        // ва-банк меньше ставки — это просто колл на все
        if (a.type === 'allin' && to > s.bet[seat]) {
          const amt = put(s, seat, to - s.bet[seat]);
          markActed();
          ev.push({ type: 'act', seat, action: 'allin', amount: amt, to: s.bet[seat] });
          break;
        }
        return null;
      }
      const max = s.bet[seat] + s.chips[seat];
      if (to > max) return null;
      if (a.type === 'raise' && to < minRaiseTo(s) && to < max) return null;
      const raiseBy = to - s.current;
      const amt = put(s, seat, to - s.bet[seat]);
      if (raiseBy >= s.minRaise) {
        // полноценное повышение — все снова должны сказать слово
        s.minRaise = raiseBy;
        s.acted = [];
      }
      s.current = Math.max(s.current, s.bet[seat]);
      markActed();
      ev.push({ type: 'act', seat, action: s.allin[seat] ? 'allin' : 'raise', amount: amt, to: s.bet[seat] });
      break;
    }
    default:
      return null;
  }
  return advance(s, ev, rng);
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const see = (x: number) => seats === 'all' || seats.includes(x) || !!s.shown[x];
  return {
    ...s,
    hole: s.hole.map((h, i) => (see(i) ? h.slice() : [])),
    deck: [],
    me: seats === 'all' ? s.seats.slice() : seats.slice(),
  };
}

/** Есть ли у игрока карты (в виде — по признаку участия в раздаче). */
export const holding = (s: State, seat: number) => s.inHand.includes(seat) && !s.folded[seat];
