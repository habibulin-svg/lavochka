/* 101 — правила (без DOM). Колода 36 (или 52) карт, 2–6 игроков, на руке по 4 (или 5), остальное — колода.
 *
 * Первым ходит следующий за сдающим, любой картой. Дальше кладут карту той же масти или того же достоинства, что сверху.
 * Особые карты:
 *   6 — её надо «покрыть»: тот же игрок кладёт ещё карту (в масть, шестёрку или даму); нечем — тянет, пока не найдёт;
 *   7 — следующий берёт 2 карты и пропускает ход;  8 — следующий берёт 1 и пропускает;
 *   туз — следующий пропускает ход;  король пик — следующий берёт 4 и пропускает;
 *   дама — на любую карту, игрок заказывает масть;  10 — разворот (если включено).
 * Нечем ходить — берут из колоды по одной, пока не найдётся (или одну и пропуск — настройка). Колода кончилась — сброс, кроме верхней, перемешивают.
 * Кто первым избавился от карт — выиграл кон. Остальные пишут очки с рук: 6–10 по номиналу, В 2, Д 3, К 4, Т 11.
 * Кончил на даме — себе минус 20 (на пиковой — минус 40). Набрал больше 101 (121) — выбыл; ровно 101 — обнуление (настройка).
 * Партию выигрывает последний оставшийся.
 */
import type { Options, Rng } from '../../core/types';
import { sameCard, type Card, type Suit } from '../../cards/deck';

export interface Cfg {
  deck: 36 | 52;
  hand: 4 | 5;
  limit: 101 | 121;
  /** Ровно до предела — обнуление. */
  reset: boolean;
  /** Десятка разворачивает ход. */
  reverse: boolean;
  /** Нечем ходить — одна карта и пропуск (иначе — тянуть, пока не найдётся). */
  drawOne: boolean;
}

export function cfgFrom(o: Options): Cfg {
  return {
    deck: Number(o.deck) === 52 ? 52 : 36,
    hand: Number(o.hand) === 5 ? 5 : 4,
    limit: Number(o.limit) === 121 ? 121 : 101,
    reset: o.reset !== false,
    reverse: !!o.reverse,
    drawOne: !!o.drawOne,
  };
}

/** Сколько действий может длиться кон. */
export const LONG_ROUND = 400;

export const POINTS = (c: Card) => (c.r <= 10 ? c.r : c.r === 11 ? 2 : c.r === 12 ? 3 : c.r === 13 ? 4 : 11);

export interface State {
  cfg: Cfg;
  seats: number[];
  /** Кто ещё в игре. */
  alive: number[];
  dealer: number;
  hands: Card[][];
  stock: Card[];
  pile: Card[];
  /** Заказанная дамой масть (или null — масть верхней карты). */
  suit: Suit | null;
  turn: number;
  /** 1 — по кругу, -1 — назад. */
  dir: 1 | -1;
  /** Надо покрыть шестёрку (ходящий кладёт ещё). */
  cover: boolean;
  /** Уже тянул в этот ход (для «одна и пропуск»). */
  drew: boolean;
  /** Пропусков подряд: все пропустили, а тянуть нечего — кон кончается. */
  passes: number;
  /** Действий в коне: затянувшийся кон (штрафные карты ходят по кругу через сброс) кончается на LONG_ROUND. */
  steps: number;
  scores: number[];
  round: number;
  phase: 'play' | 'over';
  winner: number | null;
}

export interface View extends State {
  counts: number[];
  stockCount: number;
  me: number[];
}

export type Action = { type: 'play'; card: Card; suit?: Suit } | { type: 'draw' } | { type: 'pass' };

export type Event =
  | { type: 'deal'; round: number; dealer: number; counts: number[]; hands?: Card[][]; first: number }
  | { type: 'play'; seat: number; card: Card; suit?: Suit }
  | { type: 'draw'; seat: number; count: number; cards?: Card[]; forced?: boolean }
  | { type: 'skip'; seat: number }
  | { type: 'reverse'; dir: 1 | -1 }
  | { type: 'pass'; seat: number }
  | { type: 'reshuffle'; count: number }
  | { type: 'round'; winner: number; pts: number[]; scores: number[]; bonus: number; out: number[]; reset: number[] }
  | { type: 'end'; winner: number; scores: number[] };

const SUITS: Suit[] = ['S', 'C', 'D', 'H'];

function makeDeck(n: 36 | 52): Card[] {
  const out: Card[] = [];
  for (const s of SUITS) for (let r = n === 36 ? 6 : 2; r <= 14; r++) out.push({ s, r });
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

export const top = (s: Pick<State, 'pile'>) => s.pile[s.pile.length - 1] ?? null;
export const handPoints = (h: Card[]) => h.reduce((a, c) => a + POINTS(c), 0);
const has = (h: Card[], c: Card) => h.some((x) => sameCard(x, c));

/** Можно ли положить карту. */
export function canPlay(s: Pick<State, 'pile' | 'suit' | 'cover'>, c: Card): boolean {
  const t = top(s);
  if (!t) return true;
  if (c.r === 12) return true;
  const suit = s.suit ?? t.s;
  if (s.cover) return c.s === suit || c.r === 6;
  return c.s === suit || (c.r === t.r && !s.suit);
}

export const playable = (s: Pick<State, 'pile' | 'suit' | 'cover'>, h: Card[]) => h.filter((c) => canPlay(s, c));

/** Следующий живой игрок по направлению. */
export function nextOf(s: Pick<State, 'alive' | 'seats' | 'dir'>, seat: number, dir = s.dir): number {
  const ring = s.seats.filter((x) => s.alive.includes(x) || x === seat);
  const i = ring.indexOf(seat);
  let j = (i + dir + ring.length) % ring.length;
  while (!s.alive.includes(ring[j])) j = (j + dir + ring.length) % ring.length;
  return ring[j];
}

export function newState(cfg: Cfg, seats: number[]): State {
  return {
    cfg,
    seats: seats.slice(),
    alive: seats.slice(),
    dealer: seats[seats.length - 1],
    hands: [[], [], [], [], [], []],
    stock: [],
    pile: [],
    suit: null,
    turn: seats[0],
    dir: 1,
    cover: false,
    drew: false,
    passes: 0,
    steps: 0,
    scores: [0, 0, 0, 0, 0, 0],
    round: 0,
    phase: 'play',
    winner: null,
  };
}

export function deal(s0: State, rng: Rng): { state: State; events: Event[] } {
  const dealer = s0.round === 0 ? s0.alive[s0.alive.length - 1] : nextOf({ ...s0, dir: 1 }, s0.dealer, 1);
  const deck = shuffle(makeDeck(s0.cfg.deck), rng);
  const hands: Card[][] = [[], [], [], [], [], []];
  for (const p of s0.alive) hands[p] = deck.splice(0, s0.cfg.hand);
  const s: State = { ...s0, dealer, hands, stock: deck, pile: [], suit: null, dir: 1, cover: false, drew: false, passes: 0, steps: 0, round: s0.round + 1 };
  s.turn = nextOf(s, dealer, 1);
  return { state: s, events: [{ type: 'deal', round: s.round, dealer, counts: hands.map((h) => h.length), hands: hands.map((h) => h.slice()), first: s.turn }] };
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  return deal(newState(cfgFrom(opts), seats), rng).state;
}

export const toAct = (s: State): number[] => (s.phase === 'over' ? [] : [s.turn]);

/** Взять из колоды n карт (колода кончилась — перемешать сброс, кроме верхней). */
function take(s: State, seat: number, n: number, ev: Event[], rng: Rng, forced: boolean): number {
  const got: Card[] = [];
  for (let i = 0; i < n; i++) {
    if (!s.stock.length && s.pile.length > 1) {
      const keep = s.pile[s.pile.length - 1];
      s.stock = shuffle(s.pile.slice(0, -1), rng);
      s.pile = [keep];
      ev.push({ type: 'reshuffle', count: s.stock.length });
    }
    const c = s.stock.shift();
    if (!c) break;
    got.push(c);
  }
  if (got.length) {
    s.hands = s.hands.map((h, i) => (i === seat ? [...h, ...got] : h));
    ev.push({ type: 'draw', seat, count: got.length, cards: got, forced });
  }
  return got.length;
}

function endRound(s: State, winner: number, ev: Event[], rng: Rng): { state: State; events: Event[] } {
  const last = top(s)!;
  const bonus = last.r === 12 && !s.hands[winner].length ? (last.s === 'S' ? -40 : -20) : 0;
  const pts = [0, 0, 0, 0, 0, 0];
  const scores = s.scores.slice();
  const out: number[] = [];
  const reset: number[] = [];
  for (const p of s.alive) {
    pts[p] = p === winner ? (s.hands[p].length ? handPoints(s.hands[p]) : bonus) : handPoints(s.hands[p]);
    scores[p] += pts[p];
    if (s.cfg.reset && scores[p] === s.cfg.limit) {
      scores[p] = 0;
      reset.push(p);
    } else if (scores[p] > s.cfg.limit) out.push(p);
  }
  const alive = s.alive.filter((x) => !out.includes(x));
  ev.push({ type: 'round', winner, pts, scores: scores.slice(), bonus, out, reset });
  const st: State = { ...s, scores, alive };
  if (alive.length <= 1) {
    // остался один — он и выиграл; выбыли все разом — у кого меньше
    const w = alive[0] ?? s.alive.slice().sort((a, b) => scores[a] - scores[b])[0];
    st.phase = 'over';
    st.winner = w;
    ev.push({ type: 'end', winner: w, scores: scores.slice() });
    return { state: st, events: ev };
  }
  const d = deal(st, rng);
  // следующий кон начинает выигравший прошлый (если он ещё в игре)
  if (alive.includes(winner)) d.state.turn = winner;
  return { state: d.state, events: [...ev, ...d.events] };
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.phase === 'over' || seat !== s0.turn || !a || typeof a !== 'object') return null;
  const ev: Event[] = [];
  const s: State = { ...s0, hands: s0.hands.slice(), stock: s0.stock.slice(), pile: s0.pile.slice(), steps: s0.steps + 1 };
  const hand = s.hands[seat];
  // кон затянулся — его выигрывает тот, у кого на руках меньше очков
  if (s.steps > LONG_ROUND) {
    const w = s.alive.slice().sort((x, y) => handPoints(s.hands[x]) - handPoints(s.hands[y]))[0];
    return endRound(s, w, ev, rng);
  }
  if (a.type === 'draw') {
    if (playable(s, hand).length) return null;
    if (s.cfg.drawOne && s.drew && !s.cover) return null;
    const got = take(s, seat, 1, ev, rng, false);
    if (!got) return null;
    s.drew = true;
    return { state: s, events: ev };
  }
  if (a.type === 'pass') {
    // пропустить можно, если ходить нечем и тянуть уже нельзя
    if (playable(s, hand).length) return null;
    const canDraw = s.stock.length > 0 || s.pile.length > 1;
    if (canDraw && !(s.cfg.drawOne && s.drew && !s.cover)) return null;
    ev.push({ type: 'pass', seat });
    s.cover = false;
    s.drew = false;
    s.passes = s0.passes + 1;
    // ходить не может никто и тянуть нечего — кон тому, у кого меньше очков на руках
    if (s.passes >= s.alive.length) {
      const w = s.alive.slice().sort((x, y) => handPoints(s.hands[x]) - handPoints(s.hands[y]))[0];
      return endRound(s, w, ev, rng);
    }
    s.turn = nextOf(s, seat);
    return { state: s, events: ev };
  }
  if (a.type !== 'play' || !a.card || !has(hand, a.card) || !canPlay(s, a.card)) return null;
  const card = a.card;
  if (card.r === 12 && (!a.suit || !SUITS.includes(a.suit))) return null;
  s.hands[seat] = hand.filter((c) => !sameCard(c, card));
  s.pile.push(card);
  s.suit = card.r === 12 ? a.suit! : null;
  s.drew = false;
  s.passes = 0;
  ev.push({ type: 'play', seat, card, suit: card.r === 12 ? a.suit : undefined });
  // шестёрку надо покрыть — даже последней картой
  if (card.r === 6) {
    s.cover = true;
    s.turn = seat;
    return { state: s, events: ev };
  }
  s.cover = false;
  if (!s.hands[seat].length) return endRound(s, seat, ev, rng);
  if (card.r === 10 && s.cfg.reverse && s.alive.length > 2) {
    s.dir = (s.dir === 1 ? -1 : 1) as 1 | -1;
    ev.push({ type: 'reverse', dir: s.dir });
  }
  const next = nextOf(s, seat);
  const punish = card.r === 7 ? 2 : card.r === 8 ? 1 : card.r === 13 && card.s === 'S' ? 4 : 0;
  if (punish || card.r === 14) {
    if (punish) take(s, next, punish, ev, rng, true);
    ev.push({ type: 'skip', seat: next });
    s.turn = nextOf(s, next);
  } else s.turn = next;
  return { state: s, events: ev };
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const see = (x: number) => seats === 'all' || seats.includes(x);
  const v = s as Partial<View>;
  return {
    ...s,
    hands: s.hands.map((h, i) => (see(i) ? h.slice() : [])),
    stock: [],
    counts: s.hands.map((h, i) => v.counts?.[i] ?? h.length),
    stockCount: v.stockCount ?? s.stock.length,
    me: seats === 'all' ? s.seats.slice() : seats.slice(),
  };
}

export const handCount = (s: State, seat: number) => ((s as Partial<View>).counts ? (s as View).counts[seat] : s.hands[seat].length);
export const stockLeft = (s: State) => ((s as Partial<View>).stockCount ?? s.stock.length);
