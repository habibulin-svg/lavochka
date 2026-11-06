/* Терц — правила (без DOM). Вдвоём. Источники: add-hobby.ru, fokusotmoryaka.ru, onlineigry.com, imrima.narod.ru.
 *
 * 32 карты. Сдают по 9 (по три), следующую открывают — её масть козырь, она ложится под низ колоды и уходит последней.
 * Старшинство: простые — 7 8 9 В Д К 10 Т; козыри — 7 8 Д К 10 Т 9 В (валет — «юс», девятка — «манела»).
 * Очки: простые Т 11, 10 — 10, К 3, Д 2, В 1; козыри В 20, 9 — 13, Т 11, 10 — 10, К 3, Д 2. Последняя взятка — 10. Всего 150.
 * Первым ходит сосед сдатчика. Пока есть колода — ходить можно чем угодно (в масть и бить не обязательно); взятку берёт
 * старшая карта масти захода или козырь. После взятки добирают до 9, взявший — первым. После первой взятки колоду «ломают»
 * (не взявший подснимает её — для игры это лишь обряд, добирают дальше «из-под низа», козырь всё равно последний).
 * Колода кончилась — «разбор фрица»: в масть обязательно и перебить, если можно; нет масти — козырем; нет — любую.
 * Козырного валета можно придержать (на него эти обязанности не распространяются).
 * Козырную семёрку на своём заходе можно обменять на открытый козырь, пока в колоде, кроме него, есть ещё хотя бы две карты.
 * Комбинации объявляют на своём заходе, имея 9 карт, по одной за заход (вариант — сколько угодно):
 *   четыре валета — 200; четыре туза, короля или дамы — 100 (только после ломки колоды); 5–8 карт подряд одной масти — 100;
 *   4 подряд («полтинник», кварта) — 50; 3 подряд («терц») — 20. Подряд — по порядку 7 8 9 10 В Д К Т.
 * Соперник может ответить «Рост?» — показать комбинацию старше (больше карт; при равных — по старшей карте; при равных — козырная;
 * совсем равные — у объявившего раньше): тогда очки пишет он, а перебитая комбинация сгорает. Иначе — «Годится», очки объявившему.
 * Последовательности одного игрока не делят карт; фигуры (четыре одинаковых) с ними пересекаться могут.
 * Марьяж (король и дама козыря) — 20, на своём ходу в любой момент, не перебивает и не перебивается.
 * Итог сдачи: каждому — очки его взяток (по договорённости округляют до десятков: 25 → 20, 26 → 30); комбинации — сразу.
 * Партия — до 501 (короткий терц — до 301). Добрали оба — выигрывает взявший последнюю взятку; сдаёт дальше он же.
 */
import type { Options, Rng } from '../../core/types';
import { makeDeck, sameCard, SUITS, type Card, type Suit } from '../../cards/deck';
import { shuffle } from '../../core/rng';

export interface Cfg {
  target: number;
  /** Округлять очки взяток до десятков. */
  round: boolean;
  /** Объявлять несколько комбинаций за заход. */
  multi: boolean;
}

export function cfgFrom(o: Options): Cfg {
  const t = Number(o.target);
  return { target: [301, 501].includes(t) ? t : 501, round: o.round == null ? true : !!o.round, multi: !!o.multi };
}

export const HAND = 9;
const TRUMP_POWER: Record<number, number> = { 11: 8, 9: 7, 14: 6, 10: 5, 13: 4, 12: 3, 8: 2, 7: 1 };
const PLAIN_POWER: Record<number, number> = { 14: 8, 10: 7, 13: 6, 12: 5, 11: 4, 9: 3, 8: 2, 7: 1 };
const TRUMP_PTS: Record<number, number> = { 11: 20, 9: 13, 14: 11, 10: 10, 13: 3, 12: 2, 8: 0, 7: 0 };
const PLAIN_PTS: Record<number, number> = { 14: 11, 10: 10, 13: 3, 12: 2, 11: 1, 9: 0, 8: 0, 7: 0 };
/** Порядок для последовательностей: 7 8 9 10 В Д К Т. */
export const SEQ: Record<number, number> = { 7: 0, 8: 1, 9: 2, 10: 3, 11: 4, 12: 5, 13: 6, 14: 7 };
const BY_SEQ = [7, 8, 9, 10, 11, 12, 13, 14];

export const points = (c: Card, trump: Suit) => (c.s === trump ? TRUMP_PTS[c.r] : PLAIN_PTS[c.r]);
export const power = (c: Card, trump: Suit) => (c.s === trump ? 100 + TRUMP_POWER[c.r] : PLAIN_POWER[c.r]);

export const RANK_NAME: Record<number, string> = { 7: 'семёрки', 8: 'восьмёрки', 9: 'девятки', 10: 'десятки', 11: 'валета', 12: 'дамы', 13: 'короля', 14: 'туза' };
const FOUR_NAME: Record<number, string> = { 11: 'двести валетов', 14: 'сто тузов', 13: 'сто королей', 12: 'сто дам' };

export interface Combo {
  kind: 'seq' | 'four';
  /** Для последовательности — масть, для фигуры — null. */
  suit: Suit | null;
  /** Длина последовательности (фигура — 4). */
  len: number;
  /** Старшая карта (ранг). */
  top: number;
  pts: number;
  cards: Card[];
}

export const comboKey = (c: Combo) => (c.kind === 'four' ? `F${c.top}` : `S${c.suit}${c.top}.${c.len}`);
export const sameCombo = (a: Combo, b: Combo) => comboKey(a) === comboKey(b);

export function comboName(c: Combo): string {
  if (c.kind === 'four') return FOUR_NAME[c.top];
  const from = `от ${RANK_NAME[c.top]}`;
  return c.len >= 5 ? `сто ${['', '', '', '', '', 'пять', 'шесть', 'семь', 'восемь'][c.len]} ${from}` : c.len === 4 ? `полтинник ${from}` : `терц ${from}`;
}

/** Сила комбинации для «Рост?»: больше — старше. */
export function comboRank(c: Combo, trump: Suit): number {
  if (c.kind === 'four') return c.top === 11 ? 10000 : 4000 + SEQ[c.top];
  const t = c.suit === trump ? 1 : 0;
  const base = c.len >= 5 ? 5000 + c.len * 100 : c.len === 4 ? 3000 : 2000;
  return base + SEQ[c.top] * 2 + t;
}

/** Все комбинации руки (наибольшие последовательности и фигуры). */
export function combosOf(hand: Card[]): Combo[] {
  const out: Combo[] = [];
  for (const s of SUITS) {
    const has = BY_SEQ.map((r) => hand.some((c) => c.s === s && c.r === r));
    let i = 0;
    while (i < 8) {
      if (!has[i]) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < 8 && has[j + 1]) j++;
      const len = j - i + 1;
      if (len >= 3) out.push({ kind: 'seq', suit: s, len, top: BY_SEQ[j], pts: len >= 5 ? 100 : len === 4 ? 50 : 20, cards: BY_SEQ.slice(i, j + 1).map((r) => ({ s, r })) });
      i = j + 1;
    }
  }
  for (const r of [11, 14, 13, 12]) if (hand.filter((c) => c.r === r).length === 4) out.push({ kind: 'four', suit: null, len: 4, top: r, pts: r === 11 ? 200 : 100, cards: SUITS.map((s) => ({ s, r })) });
  return out;
}

export type Phase = 'play' | 'answer' | 'over';

export interface Decl {
  seat: number;
  combo: Combo;
  /** Перебита «Ростом» — очков нет. */
  burned?: boolean;
  /** Записана (прошла или перебила). */
  pts: number;
}

export interface State {
  cfg: Cfg;
  seats: number[];
  dealer: number;
  hands: Card[][];
  /** Колода: берут с начала; открытый козырь — последним (trumpCard), отдельно. */
  stock: Card[];
  trumpCard: Card | null;
  trump: Suit;
  phase: Phase;
  turn: number;
  trick: { seat: number; card: Card }[];
  /** Сыгранные в сдаче карты. */
  gone: Card[];
  /** Очки карт во взятках. */
  pts: number[];
  tricks: number[];
  /** Колоду сломали (после первой взятки). */
  broken: boolean;
  /** Объявления в сдаче. */
  decls: Decl[];
  /** Ждёт ответа «Рост?» — объявление (индекс в decls). */
  pending: number | null;
  /** На этом заходе уже объявляли. */
  saidThisLead: boolean;
  marriage: boolean[];
  score: number[];
  deal: number;
  last: { add: number[]; pts: number[] } | null;
  over: boolean;
  winner: number | null;
}

export interface View extends Omit<State, 'stock' | 'hands'> {
  hands: Card[][];
  counts: number[];
  stockLeft: number;
}

export type Action =
  | { type: 'play'; card: Card }
  | { type: 'declare'; combo: Combo }
  | { type: 'answer'; rost: boolean }
  | { type: 'marriage' }
  | { type: 'swap' };

export type Event =
  | { type: 'deal'; deal: number; dealer: number; trumpCard: Card; hands?: Card[][] }
  | { type: 'declare'; seat: number; combo: Combo }
  | { type: 'answer'; seat: number; rost: boolean; combo?: Combo; pts: number; to: number }
  | { type: 'marriage'; seat: number }
  | { type: 'swap'; seat: number; card: Card; took: Card }
  | { type: 'play'; seat: number; card: Card }
  | { type: 'trick'; seat: number; cards: Card[]; pts: number }
  | { type: 'break'; seat: number }
  | { type: 'draw'; seat: number; card?: Card; open?: boolean }
  | { type: 'fritz' }
  | { type: 'hand'; pts: number[]; add: number[]; score: number[] }
  | { type: 'end'; winner: number; score: number[] };

export const other = (s: { seats: number[] }, seat: number) => (s.seats[0] === seat ? s.seats[1] : s.seats[0]);
const byIdx = <T>(seats: number[], f: (x: number) => T) => seats.reduce((a, x) => ((a[x] = f(x)), a), [] as T[]);

export function newState(cfg: Cfg, seats: number[]): State {
  return {
    cfg,
    seats: seats.slice(),
    dealer: seats[1],
    hands: byIdx(seats, () => []),
    stock: [],
    trumpCard: null,
    trump: 'H',
    phase: 'play',
    turn: seats[0],
    trick: [],
    gone: [],
    pts: byIdx(seats, () => 0),
    tricks: byIdx(seats, () => 0),
    broken: false,
    decls: [],
    pending: null,
    saidThisLead: false,
    marriage: byIdx(seats, () => false),
    score: byIdx(seats, () => 0),
    deal: 0,
    last: null,
    over: false,
    winner: null,
  };
}

function dealHand(s: State, rng: Rng, ev: Event[], dealer: number) {
  s.deal++;
  s.dealer = dealer;
  const deck = shuffle(makeDeck(32), rng);
  const first = other(s, dealer);
  s.hands[first] = [];
  s.hands[dealer] = [];
  for (let k = 0; k < 3; k++) for (const x of [first, dealer]) s.hands[x].push(...deck.splice(0, 3));
  s.trumpCard = deck.shift()!;
  s.trump = s.trumpCard.s;
  s.stock = deck;
  s.phase = 'play';
  s.turn = first;
  s.trick = [];
  s.gone = [];
  for (const x of s.seats) {
    s.pts[x] = 0;
    s.tricks[x] = 0;
    s.marriage[x] = false;
  }
  s.broken = false;
  s.decls = [];
  s.pending = null;
  s.saidThisLead = false;
  ev.push({ type: 'deal', deal: s.deal, dealer, trumpCard: s.trumpCard, hands: s.hands.map((h) => (h ? h.slice() : h)) });
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  const s = newState(cfgFrom(opts), seats);
  dealHand(s, rng, [], seats[seats.length - 1]);
  return s;
}

export const toAct = (s: State): number[] => (s.over ? [] : [s.turn]);

type Any = State | View;
const handOf = (s: Any, seat: number) => s.hands[seat];
export const stockLeft = (s: Any) => ('stockLeft' in s ? s.stockLeft : s.stock.length + (s.trumpCard ? 1 : 0));
/** Колода кончилась — «разбор фрица». */
export const fritz = (s: Any) => stockLeft(s) === 0;

/** Карты, уже занятые объявленными последовательностями этого игрока. */
function usedSeq(s: Any, seat: number): Card[] {
  return s.decls.filter((d) => d.seat === seat && d.combo.kind === 'seq').flatMap((d) => d.combo.cards);
}

/** Комбинации, которые игрок может предъявить сейчас (объявить или «Рост»). */
export function available(s: Any, seat: number): Combo[] {
  const used = usedSeq(s, seat);
  const said = s.decls.filter((d) => d.seat === seat).map((d) => comboKey(d.combo));
  return combosOf(handOf(s, seat)).filter((c) => {
    if (said.includes(comboKey(c))) return false;
    if (c.kind === 'four') return s.broken;
    return !c.cards.some((x) => used.some((u) => sameCard(u, x)));
  });
}

/** Можно ли сейчас объявлять (свой заход, 9 карт). */
export function canDeclare(s: Any, seat: number): boolean {
  return s.phase === 'play' && s.turn === seat && !s.trick.length && handOf(s, seat).length === HAND && (s.cfg.multi || !s.saidThisLead);
}

export function canMarriage(s: Any, seat: number): boolean {
  if (s.phase !== 'play' || s.turn !== seat || s.marriage[seat]) return false;
  const h = handOf(s, seat);
  return h.some((c) => c.s === s.trump && c.r === 13) && h.some((c) => c.s === s.trump && c.r === 12);
}

export function canSwap(s: Any, seat: number): boolean {
  if (s.phase !== 'play' || s.turn !== seat || s.trick.length || !s.trumpCard) return false;
  if (stockLeft(s) - 1 < 2) return false;
  return handOf(s, seat).some((c) => c.s === s.trump && c.r === 7);
}

/** Чем можно ответить «Рост?» на ждущее объявление: лучшая комбинация старше (или null). */
export function rostCombo(s: Any, seat: number): Combo | null {
  if (s.pending == null) return null;
  const d = s.decls[s.pending];
  const need = comboRank(d.combo, s.trump);
  const better = available(s, seat).filter((c) => comboRank(c, s.trump) > need);
  if (!better.length) return null;
  return better.sort((a, b) => b.pts - a.pts || comboRank(b, s.trump) - comboRank(a, s.trump))[0];
}

/** Допустимые карты. */
export function legal(s: Any, seat: number): Card[] {
  const hand = handOf(s, seat);
  if (!s.trick.length || !fritz(s)) return hand;
  const strict = (cs: Card[]) => {
    const lead = s.trick[0].card;
    const T = s.trump;
    const follow = cs.filter((c) => c.s === lead.s);
    if (follow.length) {
      const over = follow.filter((c) => power(c, T) > power(lead, T));
      return over.length ? over : follow;
    }
    const tr = cs.filter((c) => c.s === T);
    return tr.length ? tr : cs;
  };
  const J = hand.find((c) => c.s === s.trump && c.r === 11);
  if (!J) return strict(hand);
  const rest = hand.filter((c) => c !== J);
  if (!rest.length) return hand;
  const out = strict(rest);
  if (strict(hand).some((c) => sameCard(c, J))) out.push(J);
  return out;
}

export function trickWinner(trick: { seat: number; card: Card }[], trump: Suit): number {
  const [a, b] = trick;
  if (b.card.s === trump && a.card.s !== trump) return b.seat;
  if (b.card.s === a.card.s && power(b.card, trump) > power(a.card, trump)) return b.seat;
  return a.seat;
}

function clone(s0: State): State {
  return {
    ...s0,
    hands: s0.hands.map((h) => (h ? h.slice() : h)),
    stock: s0.stock.slice(),
    trick: s0.trick.slice(),
    gone: s0.gone.slice(),
    pts: s0.pts.slice(),
    tricks: s0.tricks.slice(),
    decls: s0.decls.map((d) => ({ ...d })),
    marriage: s0.marriage.slice(),
    score: s0.score.slice(),
  };
}

const sameSet = (a: Card[], b: Card[]) => a.length === b.length && a.every((x) => b.some((y) => sameCard(x, y)));

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn || !a) return null;
  const s = clone(s0);
  const ev: Event[] = [];
  if (s.phase === 'answer') {
    if (a.type !== 'answer' || s.pending == null) return null;
    const d = s.decls[s.pending];
    const by = d.seat;
    const c = a.rost ? rostCombo(s, seat) : null;
    if (a.rost && !c) return null;
    if (c) {
      d.burned = true;
      s.decls.push({ seat, combo: c, pts: c.pts });
      s.score[seat] += c.pts;
      ev.push({ type: 'answer', seat, rost: true, combo: c, pts: c.pts, to: seat });
    } else {
      d.pts = d.combo.pts;
      s.score[by] += d.pts;
      ev.push({ type: 'answer', seat, rost: false, pts: d.pts, to: by });
    }
    s.pending = null;
    s.phase = 'play';
    s.turn = by;
    return { state: s, events: ev };
  }
  if (s.phase !== 'play') return null;
  if (a.type === 'declare') {
    if (!canDeclare(s, seat) || !a.combo) return null;
    const c = available(s, seat).find((x) => comboKey(x) === comboKey(a.combo) && sameSet(x.cards, a.combo.cards));
    if (!c) return null;
    s.decls.push({ seat, combo: c, pts: 0 });
    s.pending = s.decls.length - 1;
    s.saidThisLead = true;
    s.phase = 'answer';
    s.turn = other(s, seat);
    ev.push({ type: 'declare', seat, combo: c });
    return { state: s, events: ev };
  }
  if (a.type === 'marriage') {
    if (!canMarriage(s, seat)) return null;
    s.marriage[seat] = true;
    s.score[seat] += 20;
    ev.push({ type: 'marriage', seat });
    return { state: s, events: ev };
  }
  if (a.type === 'swap') {
    if (!canSwap(s, seat)) return null;
    const seven = s.hands[seat].find((c) => c.s === s.trump && c.r === 7)!;
    const took = s.trumpCard!;
    s.hands[seat] = [...s.hands[seat].filter((c) => c !== seven), took];
    s.trumpCard = seven;
    ev.push({ type: 'swap', seat, card: seven, took });
    return { state: s, events: ev };
  }
  if (a.type !== 'play' || !a.card || !legal(s, seat).some((c) => sameCard(c, a.card))) return null;
  const card = s.hands[seat].find((c) => sameCard(c, a.card))!;
  s.hands[seat] = s.hands[seat].filter((c) => c !== card);
  s.trick.push({ seat, card });
  ev.push({ type: 'play', seat, card });
  if (s.trick.length < 2) {
    s.turn = other(s, seat);
    return { state: s, events: ev };
  }
  const w = trickWinner(s.trick, s.trump);
  const cards = s.trick.map((t) => t.card);
  s.gone.push(...cards);
  let pts = cards.reduce((x, c) => x + points(c, s.trump), 0);
  const last = s.seats.every((x) => !s.hands[x].length);
  if (last) pts += 10;
  s.pts[w] += pts;
  s.tricks[w]++;
  s.trick = [];
  s.turn = w;
  s.saidThisLead = false;
  ev.push({ type: 'trick', seat: w, cards, pts });
  if (!s.broken) {
    s.broken = true;
    ev.push({ type: 'break', seat: other(s, w) });
  }
  const wasStock = stockLeft(s) > 0;
  if (wasStock) {
    for (const x of [w, other(s, w)]) {
      if (s.stock.length) {
        const c = s.stock.shift()!;
        s.hands[x].push(c);
        ev.push({ type: 'draw', seat: x, card: c });
      } else if (s.trumpCard) {
        const c = s.trumpCard;
        s.trumpCard = null;
        s.hands[x].push(c);
        ev.push({ type: 'draw', seat: x, card: c, open: true });
      }
    }
    if (fritz(s)) ev.push({ type: 'fritz' });
  }
  if (last) endHand(s, rng, ev, w);
  return { state: s, events: ev };
}

/** Округление до десятков: 25 → 20, 26 → 30. */
export const round10 = (x: number) => Math.floor((x + 4) / 10) * 10;

function endHand(s: State, rng: Rng, ev: Event[], lastWinner: number) {
  const add = byIdx(s.seats, (x) => (s.cfg.round ? round10(s.pts[x]) : s.pts[x]));
  for (const x of s.seats) s.score[x] += add[x];
  s.last = { add, pts: s.pts.slice() };
  ev.push({ type: 'hand', pts: s.pts.slice(), add, score: s.score.slice() });
  const reached = s.seats.filter((x) => s.score[x] >= s.cfg.target);
  if (reached.length || s.deal >= 60) {
    const top = Math.max(...s.seats.map((x) => s.score[x]));
    const win = reached.length === 2 ? lastWinner : reached.length === 1 ? reached[0] : s.seats.find((x) => s.score[x] === top)!;
    s.over = true;
    s.phase = 'over';
    s.winner = win;
    ev.push({ type: 'end', winner: win, score: s.score.slice() });
    return;
  }
  dealHand(s, rng, ev, lastWinner);
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const see = (x: number) => seats === 'all' || seats.includes(x);
  const { stock, ...rest } = s;
  return {
    ...rest,
    decls: s.decls.map((d) => ({ ...d })),
    hands: s.hands.map((h, i) => (h ? (see(i) ? h.slice() : []) : h)),
    counts: s.hands.map((h) => (h ? h.length : 0)),
    stockLeft: stock.length + (s.trumpCard ? 1 : 0),
  };
}

export const countOf = (s: Any, seat: number) => ('counts' in s ? s.counts[seat] : s.hands[seat].length);
