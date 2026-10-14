/* Пьяница — правила (без DOM). 2–6 игроков, колода 36 (или 52) делится поровну, лишние карты «спят».
 *
 * Каждый держит стопку рубашкой вверх. Все открывают верхнюю карту; старшая забирает всё со стола под низ своей стопки
 * (в случайном порядке — так партия не зацикливается). Шестёрка (в 52 картах — двойка) бьёт туза.
 * Равенство старших — «спор»: спорщики кладут по карте рубашкой (в открытом споре — нет) и одну открыто; чья старше —
 * забирает весь стол. Кончились карты в споре — последняя карта уже лежит открытой и спорит; без карт вовсе — выбыл.
 * Без карт после взятки — выбыл. Кто собрал всю колоду — победил. Темнеет (лимит ходов) — побеждает тот, у кого больше карт.
 */
import type { Options, Rng } from '../../core/types';
import { makeDeck, type Card } from '../../cards/deck';
import { shuffle } from '../../core/rng';

export interface Cfg {
  deck: 36 | 52;
  /** Младшая (6 или 2) бьёт туза. */
  low: boolean;
  /** Спор с закрытой картой («подкладка»). */
  closed: boolean;
  /** Лимит конов, 0 — до победного (страховка всё равно есть). */
  limit: number;
}

/** Страховка от бесконечной партии: столько конов — и «по домам». */
export const HARD_LIMIT = 1500;

export function cfgFrom(o: Options): Cfg {
  return {
    deck: Number(o.deck) === 52 ? 52 : 36,
    low: o.low !== false,
    closed: o.closed !== false,
    limit: [0, 100, 200, 300].includes(Number(o.limit)) ? Number(o.limit) : 0,
  };
}

/** Карта на столе: open — лицом вверх. */
export interface TableCard {
  c: Card;
  up: boolean;
}

export interface State {
  cfg: Cfg;
  seats: number[];
  /** Стопки: [0] — верх. */
  stacks: Card[][];
  /** Что выложил каждый в этом коне (по порядку). */
  table: TableCard[][];
  /** Кто ещё не открыл карту в этом заходе. */
  pending: number[];
  /** Кто спорит (в обычном заходе — все живые). */
  contest: number[];
  /** Идёт спор (сколько раз подряд). */
  war: number;
  /** Сыгранных конов. */
  round: number;
  /** Выбывшие по порядку. */
  out: number[];
  /** Сколько карт спит (не делится поровну). */
  sleep: number;
  winner: number | null;
  over: boolean;
  /** Чем кончился последний кон — для показа. */
  last: { seat: number; count: number; war: number } | null;
}

export interface View extends State {
  counts: number[];
}

export type Action = { type: 'flip' };

export type Event =
  | { type: 'deal'; counts: number[]; sleep: number }
  | { type: 'flip'; seat: number; card: Card; closed: boolean }
  | { type: 'war'; seats: number[]; n: number }
  | { type: 'take'; seat: number; count: number; war: number; by: Card }
  | { type: 'out'; seat: number }
  | { type: 'end'; winner: number; reason: 'all' | 'dark'; counts: number[] };

const lowRank = (cfg: Cfg) => (cfg.deck === 52 ? 2 : 6);

/** Верхняя открытая карта места на столе. */
export const topUp = (t: TableCard[]) => {
  for (let i = t.length - 1; i >= 0; i--) if (t[i].up) return t[i].c;
  return null;
};

/** Кто старший среди открытых карт: один — победитель, несколько — спор. */
export function leaders(cfg: Cfg, cards: { seat: number; c: Card }[]): number[] {
  if (!cards.length) return [];
  const max = Math.max(...cards.map((x) => x.c.r));
  const low = lowRank(cfg);
  // младшая бьёт туза: если старший — туз, а у кого-то лежит 6 (2), спорят шестёрки
  if (cfg.low && max === 14 && cards.some((x) => x.c.r === low)) return cards.filter((x) => x.c.r === low).map((x) => x.seat);
  return cards.filter((x) => x.c.r === max).map((x) => x.seat);
}

export function newState(cfg: Cfg, seats: number[]): State {
  return { cfg, seats: seats.slice(), stacks: [[], [], [], [], [], []], table: [[], [], [], [], [], []], pending: seats.slice(), contest: seats.slice(), war: 0, round: 0, out: [], sleep: 0, winner: null, over: false, last: null };
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  const s = newState(cfgFrom(opts), seats);
  const deck = shuffle(makeDeck(s.cfg.deck), rng);
  const each = Math.floor(deck.length / seats.length);
  seats.forEach((p, i) => (s.stacks[p] = deck.slice(i * each, (i + 1) * each)));
  s.sleep = deck.length - each * seats.length;
  return s;
}

export const alive = (s: State) => s.seats.filter((p) => !s.out.includes(p));
export const toAct = (s: State): number[] => (s.over ? [] : s.pending.slice());

function finish(s: State, winner: number, reason: 'all' | 'dark', ev: Event[]) {
  s.over = true;
  s.winner = winner;
  s.pending = [];
  ev.push({ type: 'end', winner, reason, counts: s.stacks.map((x) => x.length) });
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over || !a || a.type !== 'flip' || !s0.pending.includes(seat)) return null;
  const s: State = { ...s0, stacks: s0.stacks.slice(), table: s0.table.slice(), pending: s0.pending.filter((x) => x !== seat), out: s0.out.slice() };
  const ev: Event[] = [];
  const st = s.stacks[seat].slice();
  const put: TableCard[] = [];
  // в споре: сначала подкладка рубашкой (если карт хватает на две)
  if (s.war && s.cfg.closed && st.length >= 2) {
    const c = st.shift()!;
    put.push({ c, up: false });
    ev.push({ type: 'flip', seat, card: c, closed: true });
  }
  if (st.length) {
    const c = st.shift()!;
    put.push({ c, up: true });
    ev.push({ type: 'flip', seat, card: c, closed: false });
  }
  s.stacks[seat] = st;
  s.table[seat] = [...s.table[seat], ...put];
  if (s.pending.length) return { state: s, events: ev };
  resolve(s, ev, rng);
  return { state: s, events: ev };
}

/** Все открыли — кто берёт, или спор. */
function resolve(s: State, ev: Event[], rng: Rng) {
  const cards = s.contest.map((seat) => ({ seat, c: topUp(s.table[seat]) })).filter((x): x is { seat: number; c: Card } => !!x.c);
  const lead = leaders(s.cfg, cards);
  if (lead.length > 1) {
    // спорить дальше могут только те, у кого остались карты
    const can = lead.filter((p) => s.stacks[p].length > 0);
    if (can.length >= 2) {
      s.war++;
      s.contest = lead;
      s.pending = can;
      ev.push({ type: 'war', seats: lead.slice(), n: s.war });
      return;
    }
    // у одного карты есть — он и забирает (остальным спорить нечем); ни у кого — жребий
    lead.splice(0, lead.length, can.length === 1 ? can[0] : lead[rng.int(lead.length)]);
  }
  const w = lead[0];
  const pile = s.seats.flatMap((p) => s.table[p].map((x) => x.c));
  const by = topUp(s.table[w])!;
  s.stacks[w] = [...s.stacks[w], ...shuffle(pile, rng)];
  ev.push({ type: 'take', seat: w, count: pile.length, war: s.war, by });
  s.last = { seat: w, count: pile.length, war: s.war };
  s.table = s.table.map(() => []);
  s.round++;
  s.war = 0;
  for (const p of alive(s))
    if (!s.stacks[p].length) {
      s.out.push(p);
      ev.push({ type: 'out', seat: p });
    }
  const left = alive(s);
  if (left.length === 1) return finish(s, left[0], 'all', ev);
  const cap = s.cfg.limit || HARD_LIMIT;
  if (s.round >= cap) {
    const best = Math.max(...left.map((p) => s.stacks[p].length));
    const top = left.filter((p) => s.stacks[p].length === best);
    return finish(s, top[rng.int(top.length)], 'dark', ev);
  }
  s.contest = left;
  s.pending = left.slice();
}

export function makeView(s: State, _seats: number[] | 'all'): View {
  const v = s as Partial<View>;
  return {
    ...s,
    // порядок карт в стопке не знает никто — только сколько
    stacks: s.stacks.map(() => []),
    table: s.table.map((t) => t.map((x) => (x.up ? x : { c: { s: 'S', r: 0 } as Card, up: false }))),
    counts: s.stacks.map((x, i) => v.counts?.[i] ?? x.length),
  };
}

export const countOf = (s: State, seat: number) => ((s as Partial<View>).counts ? (s as View).counts[seat] : s.stacks[seat].length);
