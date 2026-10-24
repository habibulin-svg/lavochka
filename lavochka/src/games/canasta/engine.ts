/* Канаста — правила (без DOM). Классическая (pagat.com, «Canasta»): две колоды и 4 джокера (108 карт).
 * Вчетвером пара на пару (напротив), по 11 карт; вдвоём — по 15, за ход берут две карты из колоды, для выхода — две канасты.
 *
 * Двойки и джокеры — дикие. Красная тройка сразу выкладывается (премия 100, все четыре — 800) и заменяется картой из колоды.
 * Комбинации — только из карт одного достоинства (от четвёрки до туза): не меньше трёх, натуральных не меньше двух
 * и больше, чем диких (диких — не больше трёх). Канаста — 7 карт и больше: «чистая» (без диких) — 500, «грязная» — 300.
 * Чёрные тройки выкладывают только при выходе. Комбинации общие у пары.
 * Первая выкладка пары — на минимум по её счёту: меньше 0 — 15, до 1495 — 50, до 2995 — 90, дальше — 120.
 * Ход: взять карту из колоды или всю колоду сброса, выложить, сбросить карту. Колоду сброса берут, если верхнюю карту
 * сразу выкладывают с двумя натуральными той же масти с руки (если колода не «заморожена» и пара уже выложилась — хватит
 * одной натуральной и дикой, или доложить к своей комбинации). Колода заморожена, если в ней дикая карта, а для пары,
 * ещё не выложившейся, — всегда. Чёрная тройка или дикая сверху — взять нельзя.
 * Выход — избавиться от карт, если у пары есть канаста: +100 (сразу всё и без выкладок раньше — +200).
 * Счёт: очки карт в комбинациях (джокер 50, двойка и туз 20, К–8 — 10, 7–4 и чёрная тройка — 5) + канасты + тройки +
 * выход − карты на руках. Красные тройки у пары без выкладки — в минус. Партия — до 5000.
 */
import type { Options, Rng } from '../../core/types';
import { makeDeck, type Suit } from '../../cards/deck';
import { shuffle } from '../../core/rng';

export interface CCard {
  s: Suit;
  r: number;
  d: number;
}

export interface Cfg {
  target: number;
}

export function cfgFrom(o: Options): Cfg {
  return { target: [2500, 5000].includes(Number(o.target)) ? Number(o.target) : 5000 };
}

export const isWild = (c: CCard) => c.r === 15 || c.r === 2;
export const isRed3 = (c: CCard) => c.r === 3 && (c.s === 'H' || c.s === 'D');
export const isBlack3 = (c: CCard) => c.r === 3 && (c.s === 'S' || c.s === 'C');
export const sameC = (a: CCard, b: CCard) => a.s === b.s && a.r === b.r && a.d === b.d;

export function cardValue(c: CCard): number {
  if (c.r === 15) return 50;
  if (c.r === 2 || c.r === 14) return 20;
  if (c.r >= 8) return 10;
  if (c.r === 3) return isRed3(c) ? 100 : 5;
  return 5;
}

export function minMeld(score: number): number {
  if (score < 0) return 15;
  if (score < 1500) return 50;
  if (score < 3000) return 90;
  return 120;
}

export interface Meld {
  rank: number;
  cards: CCard[];
}

export const naturals = (cs: CCard[]) => cs.filter((c) => !isWild(c)).length;
export const wilds = (cs: CCard[]) => cs.filter(isWild).length;
export const isCanasta = (m: Meld) => m.cards.length >= 7;
export const cleanCanasta = (m: Meld) => isCanasta(m) && wilds(m.cards) === 0;

/** Правильная комбинация достоинства rank (rank 3 — только чёрные тройки, без диких). */
export function validMeld(rank: number, cs: CCard[]): boolean {
  if (cs.length < 3) return false;
  const nat = cs.filter((c) => !isWild(c));
  if (!nat.every((c) => c.r === rank)) return false;
  if (rank === 3) return nat.length === cs.length && nat.every(isBlack3);
  const w = cs.length - nat.length;
  return nat.length >= 2 && w < nat.length && w <= 3;
}

export interface State {
  cfg: Cfg;
  seats: number[];
  dealer: number;
  stock: CCard[];
  pile: CCard[];
  hands: CCard[][];
  /** Комбинации пары (0 — места 0 и 2, 1 — места 1 и 3; вдвоём — каждый сам). */
  melds: Meld[][];
  red3: CCard[][];
  opened: boolean[];
  /** Пара выкладывала что-то до этого хода (для «скрытого» выхода). */
  laid: boolean[];
  phase: 'draw' | 'play';
  turn: number;
  score: number[];
  deal: number;
  last: { lines: string[]; add: number[] } | null;
  over: boolean;
  winner: number | null;
}

export interface View extends Omit<State, 'stock'> {
  stockLeft: number;
  counts: number[];
}

export type Action =
  | { type: 'draw' }
  | { type: 'pile'; cards: CCard[] }
  | { type: 'meld'; groups: { rank: number; cards: CCard[] }[] }
  | { type: 'discard'; card: CCard };

export type Event =
  | { type: 'deal'; deal: number; dealer: number; hands?: CCard[][]; up: CCard }
  | { type: 'red3'; seat: number; card: CCard }
  | { type: 'draw'; seat: number; cards?: CCard[]; n: number }
  | { type: 'pile'; seat: number; top: CCard; n: number; cards?: CCard[] }
  | { type: 'meld'; seat: number; rank: number; cards: CCard[]; canasta: boolean }
  | { type: 'discard'; seat: number; card: CCard }
  | { type: 'hand'; out: number | null; lines: string[]; add: number[]; score: number[] }
  | { type: 'end'; winner: number; score: number[] };

const nextIn = (list: number[], seat: number) => list[(list.indexOf(seat) + 1) % list.length];
export const teamOf = (s: State | View, seat: number) => (s.seats.length === 4 ? s.seats.indexOf(seat) % 2 : s.seats.indexOf(seat));
const pair = (s: State | View) => s.seats.length !== 4;
export const canastasNeeded = (s: State | View) => (pair(s) ? 2 : 1);

export function newState(cfg: Cfg, seats: number[]): State {
  const teams = seats.length === 4 ? 2 : seats.length;
  return {
    cfg,
    seats: seats.slice(),
    dealer: seats[seats.length - 1],
    stock: [],
    pile: [],
    hands: seats.reduce((a, x) => ((a[x] = []), a), [] as CCard[][]),
    melds: Array.from({ length: teams }, () => []),
    red3: Array.from({ length: teams }, () => []),
    opened: Array.from({ length: teams }, () => false),
    laid: Array.from({ length: teams }, () => false),
    phase: 'draw',
    turn: seats[0],
    score: Array.from({ length: teams }, () => 0),
    deal: 0,
    last: null,
    over: false,
    winner: null,
  };
}

function deck(rng: Rng): CCard[] {
  const out: CCard[] = [];
  for (const d of [0, 1]) for (const c of makeDeck(52)) out.push({ ...c, d });
  (['H', 'S', 'H', 'S'] as Suit[]).forEach((s, i) => out.push({ s, r: 15, d: i }));
  return shuffle(out, rng);
}

/** Взять карту из колоды; красные тройки — сразу в премию и добрать ещё. */
function drawOne(s: State, seat: number, ev: Event[]): CCard | null {
  for (;;) {
    const c = s.stock.shift();
    if (!c) return null;
    if (isRed3(c)) {
      s.red3[teamOf(s, seat)].push(c);
      ev.push({ type: 'red3', seat, card: c });
      continue;
    }
    s.hands[seat].push(c);
    return c;
  }
}

function dealHand(s: State, rng: Rng, ev: Event[]) {
  s.deal++;
  if (s.deal > 1) s.dealer = nextIn(s.seats, s.dealer);
  s.stock = deck(rng);
  const n = pair(s) ? 15 : 11;
  for (let t = 0; t < s.melds.length; t++) {
    s.melds[t] = [];
    s.red3[t] = [];
    s.opened[t] = false;
    s.laid[t] = false;
  }
  for (const x of s.seats) s.hands[x] = s.stock.splice(0, n);
  const reds: Event[] = [];
  for (const x of s.seats) {
    const r3 = s.hands[x].filter(isRed3);
    s.hands[x] = s.hands[x].filter((c) => !isRed3(c));
    for (const c of r3) {
      s.red3[teamOf(s, x)].push(c);
      reds.push({ type: 'red3', seat: x, card: c });
      drawOne(s, x, reds);
    }
  }
  // открытая карта сброса: не красная тройка и не дикая (иначе — ещё одну сверху)
  let up = s.stock.shift()!;
  s.pile = [up];
  while (isRed3(up) || isWild(up)) {
    up = s.stock.shift()!;
    s.pile.push(up);
  }
  s.phase = 'draw';
  s.turn = nextIn(s.seats, s.dealer);
  ev.push({ type: 'deal', deal: s.deal, dealer: s.dealer, hands: s.hands.map((h) => (h ? h.slice() : h)), up });
  ev.push(...reds);
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  const s = newState(cfgFrom(opts), seats);
  dealHand(s, rng, []);
  return s;
}

export const toAct = (s: State): number[] => (s.over ? [] : [s.turn]);
const has = (h: CCard[], c: CCard) => h.some((x) => sameC(x, c));
const without = (h: CCard[], cs: CCard[]) => h.filter((x) => !cs.some((c) => sameC(c, x)));

/** Колода сброса заморожена для пары (дикая внутри или пара не выложилась). */
export const frozen = (s: State | View, team: number) => !s.opened[team] || s.pile.some(isWild);

function meldScore(groups: { cards: CCard[] }[]) {
  return groups.reduce((x, g) => x + g.cards.reduce((y, c) => y + cardValue(c), 0), 0);
}

/** Проверка выкладки: группы в комбинации (новые или к своим), минимум для первой выкладки, чёрные тройки — только на выход. */
function checkGroups(s: State | View, seat: number, groups: { rank: number; cards: CCard[] }[], handAfter: number): boolean {
  const team = teamOf(s, seat);
  const own = s.melds[team];
  const seen = new Set<string>();
  for (const g of groups) {
    if (seen.has(String(g.rank))) return false;
    seen.add(String(g.rank));
    if (!g.cards.length) return false;
    const old = own.find((m) => m.rank === g.rank);
    const all = old ? [...old.cards, ...g.cards] : g.cards;
    if (!validMeld(g.rank, all)) return false;
    if (g.rank === 3 && handAfter > 0) return false;
  }
  if (!s.opened[team]) {
    const sum = meldScore(groups);
    if (sum < minMeld(s.score[team])) return false;
  }
  // выход — только с канастой (вдвоём — двумя); оставить одну карту — значит выходить следующим сбросом
  if (handAfter <= 1) {
    const after = own.map((m) => ({ ...m, cards: [...m.cards, ...(groups.find((g) => g.rank === m.rank)?.cards ?? [])] }));
    for (const g of groups) if (!own.some((m) => m.rank === g.rank)) after.push({ rank: g.rank, cards: g.cards });
    if (after.filter(isCanasta).length < canastasNeeded(s)) return false;
  }
  return true;
}

/** Можно ли выложить эти группы сейчас (для стола и ботов). */
export function canMeld(s: State | View, seat: number, groups: { rank: number; cards: CCard[] }[]): boolean {
  if (s.phase !== 'play' || s.turn !== seat || !groups.length) return false;
  const cards = groups.flatMap((g) => g.cards);
  if (!cards.every((c) => has(s.hands[seat], c))) return false;
  return checkGroups(s, seat, groups, s.hands[seat].length - cards.length);
}

function clone(s0: State): State {
  return {
    ...s0,
    stock: s0.stock.slice(),
    pile: s0.pile.slice(),
    hands: s0.hands.map((h) => (h ? h.slice() : h)),
    melds: s0.melds.map((ms) => ms.map((m) => ({ ...m, cards: m.cards.slice() }))),
    red3: s0.red3.map((r) => r.slice()),
    opened: s0.opened.slice(),
    laid: s0.laid.slice(),
    score: s0.score.slice(),
  };
}

function putGroups(s: State, seat: number, groups: { rank: number; cards: CCard[] }[], ev: Event[]) {
  const team = teamOf(s, seat);
  for (const g of groups) {
    let m = s.melds[team].find((x) => x.rank === g.rank);
    if (!m) {
      m = { rank: g.rank, cards: [] };
      s.melds[team].push(m);
    }
    const was = isCanasta(m);
    m.cards.push(...g.cards);
    ev.push({ type: 'meld', seat, rank: g.rank, cards: g.cards.slice(), canasta: !was && isCanasta(m) });
  }
  s.opened[team] = true;
}

/** Можно ли взять колоду сброса с этими картами с руки (вместе с верхней они ложатся в комбинации). */
export function canTakePile(s: State | View, seat: number, cards: CCard[]): boolean {
  if (s.phase !== 'draw' || s.turn !== seat || !s.pile.length) return false;
  const top = s.pile[s.pile.length - 1];
  if (isWild(top) || isBlack3(top)) return false;
  if (!cards.every((c) => has(s.hands[seat], c))) return false;
  const team = teamOf(s, seat);
  const groups = groupCards([top, ...cards], top.r);
  if (!groups) return false;
  const g = groups.find((x) => x.rank === top.r)!;
  const fromHand = g.cards.filter((c) => !sameC(c, top));
  const natHand = fromHand.filter((c) => !isWild(c)).length;
  const hasOwn = s.melds[team].some((m) => m.rank === top.r);
  const wildHand = fromHand.length - natHand;
  // заморожена — две натуральные с руки; нет — ещё и натуральная с дикой или к своей комбинации
  const ok = frozen(s, team) ? natHand >= 2 : natHand >= 2 || (natHand >= 1 && wildHand >= 1) || hasOwn;
  if (!ok) return false;
  return checkGroups(s, seat, groups, s.hands[seat].length - cards.length + (s.pile.length - 1));
}

/** Разложить выбранные карты по достоинствам; дикие — к группе указанного достоинства (или к единственной). */
export function groupCards(cards: CCard[], wildTo?: number): { rank: number; cards: CCard[] }[] | null {
  const nat = cards.filter((c) => !isWild(c));
  const wild = cards.filter(isWild);
  const ranks = [...new Set(nat.map((c) => c.r))];
  if (!ranks.length) return null;
  const groups = ranks.map((r) => ({ rank: r, cards: nat.filter((c) => c.r === r) }));
  if (wild.length) {
    const to = wildTo != null && ranks.includes(wildTo) ? wildTo : ranks.length === 1 ? ranks[0] : null;
    if (to == null) {
      // дикие — туда, где их не хватает до трёх, остальные — в самую большую
      const left = wild.slice();
      for (const g of groups.filter((x) => x.cards.length === 2)) if (left.length) g.cards.push(left.shift()!);
      if (left.length) groups.sort((a, b) => b.cards.length - a.cards.length)[0].cards.push(...left);
    } else groups.find((g) => g.rank === to)!.cards.push(...wild);
  }
  return groups;
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn || !a) return null;
  const s = clone(s0);
  const ev: Event[] = [];
  const team = teamOf(s, seat);
  if (a.type === 'draw') {
    if (s.phase !== 'draw') return null;
    const n = pair(s) ? 2 : 1;
    const got: CCard[] = [];
    for (let k = 0; k < n; k++) {
      const c = drawOne(s, seat, ev);
      if (c) got.push(c);
    }
    if (!got.length) return endHand(s, null, rng, ev);
    ev.push({ type: 'draw', seat, cards: got, n: got.length });
    s.phase = 'play';
    return { state: s, events: ev };
  }
  if (a.type === 'pile') {
    if (!Array.isArray(a.cards) || !canTakePile(s, seat, a.cards)) return null;
    const top = s.pile.pop()!;
    const cards = a.cards.map((c) => s.hands[seat].find((x) => sameC(x, c))!);
    s.hands[seat] = without(s.hands[seat], cards);
    const rest = s.pile;
    s.pile = [];
    ev.push({ type: 'pile', seat, top, n: rest.length + 1, cards: rest.slice() });
    putGroups(s, seat, groupCards([top, ...cards], top.r)!, ev);
    s.hands[seat].push(...rest);
    s.phase = 'play';
    return { state: s, events: ev };
  }
  if (s.phase !== 'play') return null;
  if (a.type === 'meld') {
    if (!Array.isArray(a.groups) || !a.groups.length) return null;
    const cards = a.groups.flatMap((g) => g.cards);
    if (!cards.every((c) => has(s.hands[seat], c)) || new Set(cards.map((c) => `${c.s}${c.r}.${c.d}`)).size !== cards.length) return null;
    const groups = a.groups.map((g) => ({ rank: g.rank, cards: g.cards.map((c) => s.hands[seat].find((x) => sameC(x, c))!) }));
    const left = s.hands[seat].length - cards.length;
    if (!checkGroups(s, seat, groups, left)) return null;
    s.hands[seat] = without(s.hands[seat], cards);
    putGroups(s, seat, groups, ev);
    if (!s.hands[seat].length) return endHand(s, seat, rng, ev);
    return { state: s, events: ev };
  }
  if (a.type === 'discard') {
    if (!has(s.hands[seat], a.card)) return null;
    const left = s.hands[seat].length - 1;
    if (left === 0 && s.melds[team].filter(isCanasta).length < canastasNeeded(s)) return null;
    const card = s.hands[seat].find((x) => sameC(x, a.card))!;
    s.hands[seat] = without(s.hands[seat], [card]);
    s.pile.push(card);
    ev.push({ type: 'discard', seat, card });
    if (s.melds[team].length) s.laid[team] = true;
    if (!left) return endHand(s, seat, rng, ev);
    s.turn = nextIn(s.seats, seat);
    s.phase = 'draw';
    if (!s.stock.length) return endHand(s, null, rng, ev);
    return { state: s, events: ev };
  }
  return null;
}

function endHand(s: State, out: number | null, rng: Rng, ev: Event[]) {
  const add = s.score.map(() => 0);
  const lines: string[] = [];
  for (let t = 0; t < s.melds.length; t++) {
    const ms = s.melds[t];
    let v = 0;
    for (const m of ms) {
      v += m.cards.reduce((x, c) => x + cardValue(c), 0);
      if (isCanasta(m)) v += cleanCanasta(m) ? 500 : 300;
    }
    const r3 = s.red3[t].length;
    const r3v = r3 === 4 ? 800 : r3 * 100;
    v += ms.length ? r3v : -r3v;
    const handPen = s.seats.filter((x) => teamOf(s, x) === t).reduce((x, k) => x + s.hands[k].reduce((y, c) => y + cardValue(c), 0), 0);
    v -= handPen;
    if (out != null && teamOf(s, out) === t) {
      const concealed = !s.laid[t];
      v += concealed ? 200 : 100;
      lines.push(concealed ? 'скрытый выход +200' : 'выход +100');
    }
    add[t] = v;
  }
  for (let t = 0; t < add.length; t++) s.score[t] += add[t];
  s.last = { lines, add };
  ev.push({ type: 'hand', out, lines, add, score: s.score.slice() });
  const top = Math.max(...s.score);
  if (top >= s.cfg.target || s.deal >= 40) {
    s.over = true;
    s.winner = s.score.indexOf(top);
    ev.push({ type: 'end', winner: s.winner, score: s.score.slice() });
    return { state: s, events: ev };
  }
  dealHand(s, rng, ev);
  return { state: s, events: ev };
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const see = (x: number) => seats === 'all' || seats.includes(x);
  const v = s as unknown as Partial<View>;
  const { stock, ...rest } = s as State;
  return {
    ...rest,
    hands: s.hands.map((h, i) => (h ? (see(i) ? h.slice() : []) : h)),
    counts: s.hands.map((h, i) => (h ? (v.counts?.[i] ?? h.length) : 0)),
    stockLeft: v.stockLeft ?? stock?.length ?? 0,
  };
}
