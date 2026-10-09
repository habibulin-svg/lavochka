/* Дурак — правила (без DOM): подкидной, переводной, «простой», японский, длинный, со званиями.
 *
 * Места за столом идут по кругу (s.seats), ход — по часовой стрелке: ходящий атакует следующего за ним.
 * Розыгрыш кона:
 *   attack — ходящий кладёт карту (или несколько одного достоинства);
 *   defend — отбивающийся кроет карты по одной, переводит (в переводном) или берёт;
 *   throw  — всё покрыто: подкидывающие по очереди (сначала ходивший, дальше по кругу) подкидывают или пасуют;
 *            кто подкинуть не может — пропускается сам; все спасовали — «бито»;
 *   take   — отбивающийся берёт: подкидывающие ещё могут подкинуть «вдогонку», потом он забирает всё.
 * После кона добирают из колоды до шести: сначала ходивший, потом остальные, отбивающийся последним.
 * Колода кончилась и карт на руках нет — игрок вышел. Последний с картами — дурак.
 */
import { shuffle } from '../../core/rng';
import type { Options, Rng } from '../../core/types';
import { makeDeck, sameCard, type Card, type Suit, SUITS } from '../../cards/deck';

export type Throwers = 'all' | 'neighbors' | 'attacker' | 'none';
export type Phase = 'trump' | 'attack' | 'defend' | 'throw' | 'take' | 'over';

export interface Cfg {
  /** Размер колоды. */
  deck: 24 | 32 | 36 | 52;
  /** Сколько карт держать на руках (добор до этого числа). */
  hand: number;
  /** Кто подкидывает. */
  throwers: Throwers;
  /** Переводной. */
  transfer: boolean;
  /** Переводить можно, показав козырь того же достоинства (карта остаётся на руке). */
  transferShow: boolean;
  /** Первый отбой — не больше пяти карт. */
  firstFive: boolean;
  /** Ходить сразу несколькими картами одного достоинства. */
  multiLead: boolean;
  /** Японский: пики бьются только пиками (если козырь не пики). */
  spades: boolean;
  /** Козырь всегда бубны (японский); иначе — нижняя карта колоды. */
  diamonds: boolean;
  /** Со званиями: серия партий, лучший выбирает козырь, худший тасует (г*вно). */
  ranks: boolean;
  /** Погоны: кто остался с картами против последних шестёрок — получает погоны. */
  pogony: boolean;
  /** Сколько партий в серии (1 — одна партия). */
  games: number;
  /** Командами: напарники сидят через одного (на четверых — 2×2, на шестерых — 3×3). */
  teams: boolean;
}

export const DEFAULT_CFG: Cfg = {
  deck: 36,
  hand: 6,
  throwers: 'all',
  transfer: false,
  transferShow: true,
  firstFive: true,
  multiLead: true,
  spades: false,
  diamonds: false,
  ranks: false,
  pogony: false,
  games: 1,
  teams: false,
};

export function cfgFrom(o: Options): Cfg {
  const pick = <T extends string | number>(v: unknown, list: readonly T[], def: T): T => ((list as readonly unknown[]).includes(v) ? (v as T) : def);
  const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
  const ranks = bool(o.ranks, false);
  return {
    deck: pick(Number(o.deck), [24, 32, 36, 52] as const, 36),
    hand: Math.max(4, Math.min(12, Number(o.hand) || 6)),
    throwers: pick(o.throwers, ['all', 'neighbors', 'attacker', 'none'] as const, 'all'),
    transfer: bool(o.transfer, false),
    transferShow: bool(o.transferShow, true),
    firstFive: bool(o.firstFive, true),
    multiLead: bool(o.multiLead, true),
    spades: bool(o.spades, false),
    diamonds: bool(o.diamonds, false),
    ranks,
    pogony: bool(o.pogony, false),
    games: Math.max(1, Math.min(20, Number(o.games) || (ranks ? 5 : 1))),
    teams: bool(o.teams, false),
  };
}

export interface Pair {
  a: Card;
  d: Card | null;
}

export interface State {
  cfg: Cfg;
  /** Занятые места по кругу. */
  seats: number[];
  /** Руки по номеру места. */
  hands: Card[][];
  /** Карты в руке, которые видели все (взятые со стола, вытянутый козырь). */
  known: Card[][];
  /** Колода: [0] — верх; последняя карта — открытый козырь. */
  deck: Card[];
  trump: Suit;
  trumpCard: Card | null;
  table: Pair[];
  /** Ушло в отбой (лежало открыто — помнить может каждый). */
  bito: Card[];
  /** Козыри, показанные для перевода в этом коне (второй раз тем же не переведёшь). */
  shown: Card[];
  phase: Phase;
  attacker: number;
  defender: number;
  /** Кого сейчас спрашиваем подкинуть (throw / take). */
  asker: number;
  passed: number[];
  /** Сколько карт всего можно положить в этот кон. */
  cap: number;
  /** Идёт первый кон партии (первый отбой). */
  first: boolean;
  /** Кто вышел, по порядку. */
  out: number[];
  /** Итог партии. */
  fool: number | null;
  draw: boolean;
  /** Номер партии в серии и сколько раз каждый был дураком. */
  game: number;
  fools: number[];
  /** Погоны: сколько шестёрок «повесили» на погоны каждому. */
  pogony: number[];
  /** Команда места (0 / 1) или −1, если играют каждый за себя. */
  team: number[];
  /** Проигравшие партии (дурак; в командной игре — вся его команда). */
  losers: number[];
  /** Звания по итогам прошлой партии: места от лучшего к худшему. */
  ranking: number[];
  /** Сколько конов сыграно в партии. */
  bouts: number;
  /** Последние выложенные на стол карты атаки (для погон). */
  lastPlay: Card[];
  /** Сколько карт в колоде этой партии. */
  size: number;
}

/** Что видит игрок: чужие руки и колода скрыты, вместо них — сколько карт. */
export interface View extends State {
  counts: number[];
  deckCount: number;
  /** Чьи руки показаны. */
  me: number[];
}

/** Сколько карт на руке (в view чужие руки пусты — берём счётчик). */
export function handSize(s: State, seat: number): number {
  const c = (s as Partial<View>).counts;
  return c ? c[seat] : s.hands[seat].length;
}

export function deckLeft(s: State): number {
  const d = (s as Partial<View>).deckCount;
  return d ?? s.deck.length;
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const see = (x: number) => seats === 'all' || seats.includes(x);
  return {
    ...s,
    hands: s.hands.map((h, x) => (see(x) ? h.slice() : [])),
    deck: [],
    counts: s.hands.map((h) => h.length),
    deckCount: s.deck.length,
    me: seats === 'all' ? s.seats.slice() : seats.slice(),
  };
}

export type Action =
  | { type: 'trump'; suit: Suit }
  | { type: 'attack'; cards: Card[] }
  | { type: 'beat'; i: number; card: Card }
  | { type: 'transfer'; card: Card }
  | { type: 'show'; card: Card }
  | { type: 'take' }
  | { type: 'throw'; cards: Card[] }
  | { type: 'pass' };

export type Event =
  | { type: 'deal'; game: number; dealer: number | null; counts: number[]; trumpCard: Card | null; trump: Suit; first: number; low: Card | null; chooser?: number }
  | { type: 'trump'; seat: number; suit: Suit; first: number }
  | { type: 'attack'; seat: number; cards: Card[] }
  | { type: 'beat'; seat: number; i: number; card: Card }
  | { type: 'transfer'; seat: number; card: Card | null; shown?: Card; to: number }
  | { type: 'take'; seat: number }
  | { type: 'throw'; seat: number; cards: Card[] }
  | { type: 'pass'; seat: number; take: boolean }
  | { type: 'bito'; count: number }
  | { type: 'pickup'; seat: number; cards: Card[] }
  | { type: 'draw'; seat: number; count: number; cards?: Card[]; trump?: Card }
  | { type: 'out'; seat: number; place: number }
  | { type: 'gameEnd'; game: number; fool: number | null; draw: boolean; pogony: number; ranking: number[]; fools: number[]; last: boolean; losers: number[] };

// ---------------------------------------------------------------- карты

export const has = (hand: Card[], c: Card) => hand.some((x) => sameCard(x, c));
const without = (hand: Card[], cards: Card[]) => hand.filter((x) => !cards.some((c) => sameCard(c, x)));

/** Бьёт ли карта d карту a. */
export function beats(s: Pick<State, 'trump' | 'cfg'>, a: Card, d: Card): boolean {
  const t = s.trump;
  if (s.cfg.spades && t !== 'S' && a.s === 'S') return d.s === 'S' && d.r > a.r;
  if (d.s === a.s) return d.r > a.r;
  return d.s === t;
}

export function tableRanks(table: Pair[]): Set<number> {
  const r = new Set<number>();
  for (const p of table) {
    r.add(p.a.r);
    if (p.d) r.add(p.d.r);
  }
  return r;
}

export const unbeaten = (table: Pair[]) => table.filter((p) => !p.d).length;

// ---------------------------------------------------------------- места

export const isOut = (s: State, seat: number) => s.out.includes(seat);

/** Следующий по кругу, кто ещё в игре. */
export function nextSeat(s: State, seat: number): number {
  const n = s.seats.length;
  let i = s.seats.indexOf(seat);
  for (let k = 0; k < n; k++) {
    i = (i + 1) % n;
    if (!isOut(s, s.seats[i])) return s.seats[i];
  }
  return seat;
}

export function prevSeat(s: State, seat: number): number {
  const n = s.seats.length;
  let i = s.seats.indexOf(seat);
  for (let k = 0; k < n; k++) {
    i = (i - 1 + n) % n;
    if (!isOut(s, s.seats[i])) return s.seats[i];
  }
  return seat;
}

/** Команды через одного — только на четверых и шестерых. */
export function teamsOf(cfg: Cfg, seats: number[]): number[] {
  const t = [-1, -1, -1, -1, -1, -1];
  if (cfg.teams && (seats.length === 4 || seats.length === 6)) seats.forEach((x, i) => (t[x] = i % 2));
  return t;
}

export const teamsOn = (s: State) => s.team.some((t) => t >= 0);
export const mates = (s: State, a: number, b: number) => a !== b && s.team[a] >= 0 && s.team[a] === s.team[b];

/** Следующий по кругу соперник (в командной игре напарников пропускаем). */
export function nextOpp(s: State, seat: number): number {
  let x = seat;
  for (let k = 0; k < s.seats.length; k++) {
    x = nextSeat(s, x);
    if (x === seat) break;
    if (!mates(s, seat, x)) return x;
  }
  return nextSeat(s, seat);
}

/** Все, кто в игре, по кругу начиная с from. */
export function circleFrom(s: State, from: number): number[] {
  const out: number[] = [];
  const n = s.seats.length;
  const i0 = s.seats.indexOf(from);
  for (let k = 0; k < n; k++) {
    const seat = s.seats[(i0 + k) % n];
    if (!isOut(s, seat)) out.push(seat);
  }
  return out;
}

/** Кто может подкидывать в этом коне, в порядке очереди (сначала ходивший). */
export function throwersOf(s: State): number[] {
  // напарник отбивающегося на него не подкидывает
  const order = circleFrom(s, s.attacker).filter((x) => x !== s.defender && !mates(s, x, s.defender));
  if (s.cfg.throwers === 'none') return [];
  if (s.cfg.throwers === 'attacker') return [s.attacker];
  if (s.cfg.throwers === 'neighbors') {
    const left = nextSeat(s, s.defender);
    return order.filter((x) => x === s.attacker || x === left);
  }
  return order;
}

/** Сколько ещё карт можно положить в кон. */
export function room(s: State): number {
  const byCap = s.cap - s.table.length;
  // у отбивающегося должно хватать карт на все непокрытые
  const byHand = handSize(s, s.defender) - unbeaten(s.table);
  return Math.max(0, Math.min(byCap, byHand));
}

/** Карты, которые seat может подкинуть сейчас. */
export function throwable(s: State, seat: number): Card[] {
  if (room(s) <= 0) return [];
  const ranks = tableRanks(s.table);
  return s.hands[seat].filter((c) => ranks.has(c.r));
}

/** Можно ли перевести и на кого. */
export function transferTarget(s: State): number | null {
  if (!s.cfg.transfer || s.phase !== 'defend' || !s.table.length) return null;
  if (s.table.some((p) => p.d)) return null;
  const to = nextOpp(s, s.defender);
  if (to === s.defender) return null;
  return to;
}

export function canTransfer(s: State, card: Card, show: boolean): boolean {
  const to = transferTarget(s);
  if (to == null) return false;
  const r = s.table[0].a.r;
  if (card.r !== r || !has(s.hands[s.defender], card)) return false;
  const n = s.table.length + (show ? 0 : 1);
  const limit = s.first && s.cfg.firstFive ? 5 : s.cfg.hand;
  if (n > limit || handSize(s, to) < n) return false;
  if (show) return s.cfg.transferShow && card.s === s.trump && !s.shown.some((x) => sameCard(x, card));
  return true;
}

// ---------------------------------------------------------------- партия

function emptyHands(): Card[][] {
  return [[], [], [], [], [], []];
}

export function newState(cfg: Cfg, seats: number[]): State {
  return {
    cfg,
    seats,
    hands: emptyHands(),
    known: emptyHands(),
    deck: [],
    trump: 'H',
    trumpCard: null,
    table: [],
    bito: [],
    shown: [],
    phase: 'attack',
    attacker: seats[0],
    defender: seats[1 % seats.length],
    asker: -1,
    passed: [],
    cap: 6,
    first: true,
    out: [],
    fool: null,
    draw: false,
    game: 0,
    fools: [0, 0, 0, 0, 0, 0],
    pogony: [0, 0, 0, 0, 0, 0],
    ranking: [],
    bouts: 0,
    lastPlay: [],
    team: teamsOf(cfg, seats),
    losers: [],
    size: 36,
  };
}

/** Колода под число игроков: 36 карт на шестерых — без колоды, на большее — 52. */
export function deckSize(cfg: Cfg, players: number): 24 | 32 | 36 | 52 {
  let size: number = cfg.deck;
  while (size < players * cfg.hand && size < 52) size = size === 24 ? 32 : size === 32 ? 36 : 52;
  return size as 24 | 32 | 36 | 52;
}

function lowestTrump(s: State): { seat: number; card: Card } | null {
  let best: { seat: number; card: Card } | null = null;
  for (const seat of s.seats)
    for (const c of s.hands[seat]) if (c.s === s.trump && (!best || c.r < best.card.r)) best = { seat, card: c };
  return best;
}

/** Раздать новую партию. Звания прошлой партии решают, кто тасует и кто выбирает козырь. */
export function deal(prev: State, rng: Rng): { state: State; events: Event[] } {
  const cfg = prev.cfg;
  const s: State = {
    ...newState(cfg, prev.seats),
    game: prev.game + 1,
    fools: prev.fools.slice(),
    pogony: prev.pogony.slice(),
    ranking: prev.ranking.slice(),
  };
  const size = deckSize(cfg, s.seats.length);
  const deck = shuffle(makeDeck(size), rng);
  s.size = size;
  // раздают по одной по кругу, начиная со следующего за сдающим
  const dealer = prev.game > 0 ? (prev.fool ?? (prev.ranking.length ? prev.ranking[prev.ranking.length - 1] : null)) : null;
  const order = dealer != null ? circleFrom(s, dealer).slice(1).concat(dealer) : s.seats.slice();
  for (let k = 0; k < cfg.hand; k++)
    for (const seat of order) {
      const c = deck.shift();
      if (c) s.hands[seat].push(c);
    }
  s.deck = deck;
  // со званиями король (лучший прошлой партии) сам назначает козырь — до этого колода закрыта
  const chooser = cfg.ranks && !teamsOn(s) && !cfg.diamonds && s.game > 1 && prev.ranking.length ? prev.ranking[0] : null;
  if (chooser != null) {
    s.trumpCard = null;
    s.phase = 'trump';
    s.asker = chooser;
    const ev: Event = { type: 'deal', game: s.game, dealer, counts: s.seats.map((x) => s.hands[x].length), trumpCard: null, trump: s.trump, first: -1, low: null, chooser };
    return { state: s, events: [ev] };
  }
  const last = deck.length ? deck[deck.length - 1] : s.hands[order[order.length - 1]][cfg.hand - 1];
  s.trump = cfg.diamonds ? 'D' : last.s;
  s.trumpCard = deck.length && !cfg.diamonds ? last : null;
  const { first, low } = firstAttacker(s, prev);
  startBout(s, first, nextOpp(s, first));
  const ev: Event = { type: 'deal', game: s.game, dealer, counts: s.seats.map((x) => s.hands[x].length), trumpCard: s.trumpCard, trump: s.trump, first, low };
  return { state: s, events: [ev] };
}

/** Кто ходит первым: в первой партии — у кого младший козырь; дальше «под дурака» — сосед справа от дурака ходит на него. */
function firstAttacker(s: State, prev: State): { first: number; low: Card | null } {
  if (prev.game > 0 && prev.fool != null && s.seats.includes(prev.fool)) return { first: prevSeat(s, prev.fool), low: null };
  const lt = lowestTrump(s);
  if (lt) return { first: lt.seat, low: lt.card };
  return { first: s.seats[0], low: null };
}

function boutLimit(s: State) {
  return s.first && s.cfg.firstFive ? 5 : s.cfg.hand;
}

function startBout(s: State, attacker: number, defender: number) {
  s.attacker = attacker;
  s.defender = defender;
  s.table = [];
  s.shown = [];
  s.passed = [];
  s.asker = -1;
  s.phase = 'attack';
  s.cap = Math.min(boutLimit(s), s.hands[defender].length);
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  return deal(newState(cfgFrom(opts), seats), rng).state;
}

export function toAct(s: State): number[] {
  switch (s.phase) {
    case 'attack':
      return [s.attacker];
    case 'defend':
      return [s.defender];
    case 'throw':
    case 'take':
    case 'trump':
      return s.asker >= 0 ? [s.asker] : [];
    default:
      return [];
  }
}

function clone(s: State): State {
  return {
    ...s,
    seats: s.seats.slice(),
    hands: s.hands.map((h) => h.slice()),
    known: s.known.map((h) => h.slice()),
    deck: s.deck.slice(),
    table: s.table.map((p) => ({ ...p })),
    bito: s.bito.slice(),
    shown: s.shown.slice(),
    passed: s.passed.slice(),
    out: s.out.slice(),
    fools: s.fools.slice(),
    pogony: s.pogony.slice(),
    ranking: s.ranking.slice(),
    lastPlay: s.lastPlay.slice(),
    team: s.team.slice(),
    losers: s.losers.slice(),
  };
}

function removeFromHand(s: State, seat: number, cards: Card[]) {
  s.hands[seat] = without(s.hands[seat], cards);
  s.known[seat] = without(s.known[seat], cards);
}

const sameRank = (cards: Card[]) => cards.every((c) => c.r === cards[0].r);
const distinct = (cards: Card[]) => cards.every((c, i) => cards.findIndex((x) => sameCard(x, c)) === i);

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (!toAct(s0).includes(seat) || !a || typeof a !== 'object') return null;
  const s = clone(s0);
  const ev: Event[] = [];
  switch (a.type) {
    case 'trump': {
      if (s.phase !== 'trump' || !SUITS.includes(a.suit)) return null;
      s.trump = a.suit;
      s.trumpCard = null;
      const { first } = firstAttacker(s, { ...s0, game: s.game - 1, fool: s.ranking[s.ranking.length - 1] ?? null } as State);
      startBout(s, first, nextOpp(s, first));
      ev.push({ type: 'trump', seat, suit: a.suit, first });
      break;
    }
    case 'attack': {
      if (s.phase !== 'attack' || !Array.isArray(a.cards) || !a.cards.length) return null;
      const cards = a.cards;
      if (!distinct(cards) || !sameRank(cards) || !cards.every((c) => has(s.hands[seat], c))) return null;
      if (cards.length > 1 && !s.cfg.multiLead) return null;
      if (cards.length > room(s)) return null;
      removeFromHand(s, seat, cards);
      for (const c of cards) s.table.push({ a: c, d: null });
      s.phase = 'defend';
      s.lastPlay = cards;
      ev.push({ type: 'attack', seat, cards });
      break;
    }
    case 'beat': {
      if (s.phase !== 'defend') return null;
      const p = s.table[a.i];
      if (!p || p.d || !a.card || !has(s.hands[seat], a.card) || !beats(s, p.a, a.card)) return null;
      removeFromHand(s, seat, [a.card]);
      p.d = a.card;
      ev.push({ type: 'beat', seat, i: a.i, card: a.card });
      if (!unbeaten(s.table)) {
        s.phase = 'throw';
        s.passed = [];
        askNext(s, ev, rng);
      }
      break;
    }
    case 'transfer':
    case 'show': {
      const show = a.type === 'show';
      if (!a.card || !canTransfer(s, a.card, show)) return null;
      const to = transferTarget(s)!;
      if (show) s.shown.push(a.card);
      else {
        removeFromHand(s, seat, [a.card]);
        s.table.push({ a: a.card, d: null });
        s.lastPlay = [a.card];
      }
      ev.push({ type: 'transfer', seat, card: show ? null : a.card, shown: show ? a.card : undefined, to });
      const shown = s.shown;
      const table = s.table;
      startBout(s, seat, to);
      s.table = table;
      s.shown = shown;
      s.phase = 'defend';
      break;
    }
    case 'take': {
      if (s.phase !== 'defend') return null;
      s.phase = 'take';
      s.passed = [];
      ev.push({ type: 'take', seat });
      askNext(s, ev, rng);
      break;
    }
    case 'throw': {
      if (s.phase !== 'throw' && s.phase !== 'take') return null;
      const cards = a.cards;
      if (!Array.isArray(cards) || !cards.length || !distinct(cards)) return null;
      const ranks = tableRanks(s.table);
      if (!cards.every((c) => has(s.hands[seat], c) && ranks.has(c.r))) return null;
      if (cards.length > room(s)) return null;
      removeFromHand(s, seat, cards);
      for (const c of cards) s.table.push({ a: c, d: null });
      s.lastPlay = cards;
      ev.push({ type: 'throw', seat, cards });
      s.passed = [];
      if (s.phase === 'throw') {
        s.phase = 'defend';
        s.asker = -1;
      } else askNext(s, ev, rng);
      break;
    }
    case 'pass': {
      if (s.phase !== 'throw' && s.phase !== 'take') return null;
      s.passed.push(seat);
      ev.push({ type: 'pass', seat, take: s.phase === 'take' });
      askNext(s, ev, rng);
      break;
    }
    default:
      return null;
  }
  return { state: s, events: ev };
}

/** Следующий, кого спросить «подкинешь?». Никого — кон закончен. */
function askNext(s: State, ev: Event[], rng: Rng) {
  for (const t of throwersOf(s)) {
    if (s.passed.includes(t)) continue;
    if (throwable(s, t).length) {
      s.asker = t;
      return;
    }
  }
  s.asker = -1;
  if (s.phase === 'take') pickup(s, ev, rng);
  else bito(s, ev, rng);
}

function bito(s: State, ev: Event[], rng: Rng) {
  const cards = s.table.flatMap((p) => (p.d ? [p.a, p.d] : [p.a]));
  s.bito.push(...cards);
  ev.push({ type: 'bito', count: cards.length });
  const lastAttacker = s.attacker;
  const def = s.defender;
  refill(s, ev, def);
  s.table = [];
  endBout(s, ev, def, false, lastAttacker, rng);
}

function pickup(s: State, ev: Event[], rng: Rng) {
  const def = s.defender;
  const cards = s.table.flatMap((p) => (p.d ? [p.a, p.d] : [p.a]));
  s.hands[def].push(...cards);
  s.known[def].push(...cards);
  ev.push({ type: 'pickup', seat: def, cards });
  const lastAttacker = s.attacker;
  s.table = [];
  refill(s, ev, def, true);
  endBout(s, ev, def, true, lastAttacker, rng);
}

/** Добор: ходивший, остальные по кругу, отбивающийся последним (если брал — не добирает). */
function refill(s: State, ev: Event[], def: number, took = false) {
  const order = circleFrom(s, s.attacker).filter((x) => x !== def);
  if (!took) order.push(def);
  for (const seat of order) {
    const need = s.cfg.hand - s.hands[seat].length;
    if (need <= 0 || !s.deck.length) continue;
    const got = s.deck.splice(0, need);
    s.hands[seat].push(...got);
    let trump: Card | undefined;
    if (!s.deck.length && s.trumpCard && got.some((c) => sameCard(c, s.trumpCard!))) {
      trump = s.trumpCard;
      s.known[seat].push(trump);
    }
    if (!s.deck.length) s.trumpCard = null;
    ev.push({ type: 'draw', seat, count: got.length, cards: got, trump });
  }
}

function endBout(s: State, ev: Event[], def: number, took: boolean, lastAttacker: number, rng: Rng) {
  s.bouts++;
  s.first = false;
  // кто вышел: колода пуста, карт нет
  if (!s.deck.length) {
    for (const seat of circleFrom(s, lastAttacker)) {
      if (!s.hands[seat].length && !isOut(s, seat)) {
        s.out.push(seat);
        ev.push({ type: 'out', seat, place: s.out.length });
      }
    }
  }
  const left = s.seats.filter((x) => !isOut(s, x));
  if (left.length <= 1) return finishGame(s, ev, left[0] ?? null, rng);
  // командная игра кончается, когда в игре осталась одна команда: она и проиграла
  if (teamsOn(s) && new Set(left.map((x) => s.team[x])).size === 1) return finishGame(s, ev, left[0], rng);
  // следующий кон: после отбоя ходит отбивавшийся, после взятия — следующий за ним
  let att = took ? nextSeat(s, def) : isOut(s, def) ? nextSeat(s, def) : def;
  if (isOut(s, att)) att = nextSeat(s, att);
  startBout(s, att, nextOpp(s, att));
}

function finishGame(s: State, ev: Event[], fool: number | null, rng: Rng) {
  s.fool = fool;
  s.draw = fool == null;
  s.losers = fool == null ? [] : teamsOn(s) ? s.seats.filter((x) => x === fool || mates(s, x, fool)) : [fool];
  let pog = 0;
  if (fool != null) {
    for (const x of s.losers) s.fools[x]++;
    // погоны: последний кон против дурака закончили шестёрками
    const lp = s.lastPlay;
    if (s.cfg.pogony && lp.length && lp.length <= 2 && lp.every((c) => c.r === 6)) {
      pog = lp.length;
      s.pogony[fool] += pog;
    }
  }
  // звания: кто раньше вышел — тот выше; дурак — последний
  s.ranking = fool != null ? [...s.out, ...s.seats.filter((x) => !s.out.includes(x))] : s.out.slice();
  s.table = [];
  s.asker = -1;
  const last = s.game >= s.cfg.games;
  ev.push({ type: 'gameEnd', game: s.game, fool, draw: s.draw, pogony: pog, ranking: s.ranking.slice(), fools: s.fools.slice(), last, losers: s.losers.slice() });
  if (last) {
    s.phase = 'over';
    return;
  }
  const next = deal(s, rng);
  Object.assign(s, next.state);
  ev.push(...next.events);
}

/** Итог серии: меньше всего раз был дураком — победитель (без дураков в одной партии — все, кроме дурака). */
export function winners(s: State): number[] {
  if (s.phase !== 'over') return [];
  if (s.cfg.games <= 1) return s.fool == null ? s.seats.slice() : s.seats.filter((x) => !s.losers.includes(x));
  const min = Math.min(...s.seats.map((x) => s.fools[x]));
  return s.seats.filter((x) => s.fools[x] === min);
}
