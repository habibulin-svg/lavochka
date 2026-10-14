/* Г*вно (на внимательность) — правила (без DOM). Игра реального времени: комната крутит шаги по 50 мс.
 *
 * Колода — по четвёрке на каждого: при N игроках берут N достоинств (тузы, короли, дамы…) всех четырёх мастей, сдают по 4.
 * Каждый такт (1,5 с) все разом передают одну карту соседу слева и получают от соседа справа. Какую отдать — выбирает игрок;
 * не выбрал — уходит только что полученная (на первом такте — любая).
 * Собрал четыре одного достоинства — хлопай (кнопка, пробел). После первого хлопка передача встаёт, остальные хлопают
 * следом: кто хлопнул последним — «г*вно» кона. Хлопнул без четвёрки — сразу проиграл кон.
 * Проигравший кона получает букву: Г, *, В, Н, О. Собрал слово (или сколько договорились) — проиграл партию.
 * «Тихое»: собравший не кричит — про хлопок не объявляется, его видно только по ладони на столе.
 */
import type { Options, Rng } from '../../core/types';
import type { Card, Suit } from '../../cards/deck';

export const TICK_MS = 50;
/** Сколько ждать хлопков после первого: зевнувшие все разом — г*вно. */
export const SLAP_TIMEOUT = 6000;
/** Посмотреть карты перед первым тактом. */
const LOOK_MS = 2500;
/** Показ итога кона. */
const RESULT_MS = 4000;
export const WORD = ['Г', '*', 'В', 'Н', 'О'];
const RANKS = [14, 13, 12, 11, 10, 9];
const SUITS: Suit[] = ['S', 'C', 'D', 'H'];

export interface Cfg {
  /** Такт передачи, мс. */
  tact: number;
  /** Сколько букв до проигрыша партии. */
  limit: number;
  /** Тихое: о хлопке не объявляют. */
  silent: boolean;
}

export function cfgFrom(o: Options): Cfg {
  const tact = Number(o.tact);
  const limit = Number(o.limit);
  return { tact: [1000, 1500, 2000, 2500].includes(tact) ? tact : 1500, limit: [1, 3, 5].includes(limit) ? limit : 5, silent: !!o.silent };
}

export type Phase = 'look' | 'pass' | 'slap' | 'result' | 'over';

export interface State {
  cfg: Cfg;
  seats: number[];
  /** Часы партии, мс. */
  t: number;
  phase: Phase;
  /** Когда кончается текущая фаза (или следующий такт). */
  nextAt: number;
  hands: Card[][];
  /** Какую карту место хочет отдать на этом такте (id карты). */
  picks: (string | null)[];
  /** Последняя полученная карта — уходит дальше, если не выбрал другую. */
  lastIn: (Card | null)[];
  /** Сколько хлопков от места уже учтено (счётчик ввода). */
  slapN: number[];
  /** Тактов в этом коне. */
  tacts: number;
  /** Хлопки кона по порядку: dt — через сколько мс после первого. */
  slaps: { seat: number; dt: number }[];
  slapAt: number;
  /** Проигравшие кон и почему. */
  losers: number[];
  reason: 'last' | 'foul' | null;
  letters: number[];
  round: number;
  /** Позиция показа правил: apply разрешён. */
  demo?: boolean;
}

export interface View extends State {
  counts: number[];
}

/** Ввод места: выбранная карта (на такте tact) и счётчик хлопков. */
export interface Input {
  pick: string | null;
  tact: number;
  slap: number;
}

/** Показ правил: ввод места и сколько потом прождать. */
export type Action = { type: 'demo'; pick?: string; slap?: boolean; wait: number };

export type Event =
  | { k: 'deal'; round: number }
  | { k: 'go' }
  | { k: 'pass'; tact: number }
  | { k: 'slap'; seat: number; dt: number; first: boolean }
  | { k: 'round'; losers: number[]; reason: 'last' | 'foul'; letters: number[] }
  | { k: 'end'; losers: number[] };

export const cid = (c: Card) => c.s + c.r;
export const hasFour = (hand: Card[]) => hand.length === 4 && hand.every((c) => c.r === hand[0].r);
const nextIn = (list: number[], seat: number) => list[(list.indexOf(seat) + 1) % list.length];

export function newState(cfg: Cfg, seats: number[]): State {
  return {
    cfg,
    seats: seats.slice(),
    t: 0,
    phase: 'look',
    nextAt: 0,
    hands: [[], [], [], [], [], []],
    picks: [null, null, null, null, null, null],
    lastIn: [null, null, null, null, null, null],
    slapN: [0, 0, 0, 0, 0, 0],
    tacts: 0,
    slaps: [],
    slapAt: 0,
    losers: [],
    reason: null,
    letters: [0, 0, 0, 0, 0, 0],
    round: 0,
  };
}

function deal(s: State, rng: Rng, ev: Event[]) {
  s.round++;
  const deck: Card[] = [];
  for (const r of RANKS.slice(0, s.seats.length)) for (const su of SUITS) deck.push({ s: su, r });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  s.hands = [[], [], [], [], [], []];
  for (const p of s.seats) s.hands[p] = deck.splice(0, 4);
  s.picks = [null, null, null, null, null, null];
  s.lastIn = [null, null, null, null, null, null];
  s.tacts = 0;
  s.slaps = [];
  s.slapAt = 0;
  s.losers = [];
  s.reason = null;
  s.phase = 'look';
  s.nextAt = s.t + LOOK_MS;
  ev.push({ k: 'deal', round: s.round });
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  const s = newState(cfgFrom(opts), seats);
  deal(s, rng, []);
  return s;
}

function endRound(s: State, losers: number[], reason: 'last' | 'foul', ev: Event[]) {
  s.losers = losers;
  s.reason = reason;
  for (const p of losers) s.letters[p]++;
  ev.push({ k: 'round', losers, reason, letters: s.letters.slice() });
  const out = s.seats.filter((p) => s.letters[p] >= s.cfg.limit);
  if (out.length) {
    s.phase = 'over';
    ev.push({ k: 'end', losers: out });
    return;
  }
  s.phase = 'result';
  s.nextAt = s.t + RESULT_MS;
}

function slap(s: State, seat: number, ev: Event[]) {
  if (s.phase === 'look' || s.phase === 'pass') {
    if (!hasFour(s.hands[seat])) {
      // хлопнул без четвёрки — сразу проиграл
      ev.push({ k: 'slap', seat, dt: 0, first: true });
      endRound(s, [seat], 'foul', ev);
      return;
    }
    s.phase = 'slap';
    s.slapAt = s.t;
    s.slaps = [{ seat, dt: 0 }];
    ev.push({ k: 'slap', seat, dt: 0, first: true });
    return;
  }
  if (s.phase !== 'slap' || s.slaps.some((x) => x.seat === seat)) return;
  const dt = s.t - s.slapAt;
  s.slaps.push({ seat, dt });
  ev.push({ k: 'slap', seat, dt, first: false });
  if (s.slaps.length >= s.seats.length - 1)
    endRound(
      s,
      s.seats.filter((p) => !s.slaps.some((x) => x.seat === p)),
      'last',
      ev
    );
}

/** Такт: все разом отдают по карте соседу слева. */
function pass(s: State, rng: Rng, ev: Event[]) {
  const give: Card[] = [];
  for (const p of s.seats) {
    const hand = s.hands[p];
    let c = hand.find((x) => cid(x) === s.picks[p]);
    const li = s.lastIn[p];
    if (!c && li) c = hand.find((x) => x.s === li.s && x.r === li.r);
    if (!c) c = hand[rng.int(hand.length)];
    give[p] = c;
  }
  for (const p of s.seats) s.hands[p] = s.hands[p].filter((x) => x !== give[p]);
  for (const p of s.seats) {
    const to = nextIn(s.seats, p);
    s.hands[to].push(give[p]);
    s.lastIn[to] = give[p];
  }
  s.picks = [null, null, null, null, null, null];
  s.tacts++;
  ev.push({ k: 'pass', tact: s.tacts });
}

export function cleanInput(raw: unknown): Input | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const pick = typeof r.pick === 'string' && r.pick.length <= 4 ? r.pick : null;
  const tact = Number(r.tact);
  const slap = Number(r.slap);
  if (!Number.isFinite(tact) || !Number.isFinite(slap)) return null;
  return { pick, tact: Math.floor(tact), slap: Math.floor(slap) };
}

export const idleInput = (): Input => ({ pick: null, tact: -1, slap: 0 });

/** Шаг 50 мс. Состояние меняется на месте. */
export function step(s: State, inputs: (Input | null)[], rng: Rng): Event[] {
  const ev: Event[] = [];
  if (s.phase === 'over') return ev;
  s.t += TICK_MS;
  for (const p of s.seats) {
    const inp = inputs[p];
    if (!inp) continue;
    if (inp.tact === s.tacts && (s.phase === 'look' || s.phase === 'pass')) s.picks[p] = inp.pick;
    if (inp.slap > s.slapN[p]) {
      s.slapN[p] = inp.slap;
      if (s.phase !== 'result') slap(s, p, ev);
    }
  }
  if (s.phase === 'look' && s.t >= s.nextAt) {
    s.phase = 'pass';
    s.nextAt = s.t + s.cfg.tact;
    ev.push({ k: 'go' });
  } else if (s.phase === 'pass' && s.t >= s.nextAt) {
    pass(s, rng, ev);
    s.nextAt += s.cfg.tact;
  } else if (s.phase === 'slap' && s.t - s.slapAt >= SLAP_TIMEOUT) {
    endRound(
      s,
      s.seats.filter((p) => !s.slaps.some((x) => x.seat === p)),
      'last',
      ev
    );
  } else if (s.phase === 'result' && s.t >= s.nextAt) deal(s, rng, ev);
  return ev;
}

/** Показ правил: ввод места, затем wait мс без чьего-либо ввода. Только в позиции показа. */
export function applyDemo(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (!s0.demo || !a || a.type !== 'demo') return null;
  const s: State = JSON.parse(JSON.stringify(s0));
  const ev: Event[] = [];
  const first: (Input | null)[] = [];
  first[seat] = { pick: a.pick ?? s.picks[seat], tact: s.tacts, slap: s.slapN[seat] + (a.slap ? 1 : 0) };
  const n = Math.max(1, Math.round(a.wait / TICK_MS));
  for (let i = 0; i < n; i++) {
    ev.push(...step(s, i === 0 ? first : [], rng));
  }
  return { state: s, events: ev };
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const open = s.phase === 'result' || s.phase === 'over';
  const see = (p: number) => seats === 'all' || seats.includes(p) || open;
  const v = s as Partial<View>;
  return {
    ...s,
    hands: s.hands.map((h, p) => (see(p) ? h.slice() : [])),
    picks: s.picks.map((x, p) => (see(p) ? x : null)),
    lastIn: s.lastIn.map((x, p) => (see(p) ? x : null)),
    counts: s.hands.map((h, p) => v.counts?.[p] ?? h.length),
    slaps: s.slaps.slice(),
    losers: s.losers.slice(),
    letters: s.letters.slice(),
    slapN: s.slapN.slice(),
  };
}
