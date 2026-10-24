/* Рамми, джин-рамми и кункен — правила (без DOM). Сводка источников — docs/analysis/rules-rummy.md.
 *
 * Рамми: 52 карты, вдвоём по 10, втроём–вчетвером по 7, впятером–вшестером по 6. Ход: взять карту из колоды или верхнюю из сброса,
 * выложить комбинации (3–4 одного достоинства или 3+ подряд одной масти, туз — младший), доложить к любым на столе, сбросить карту.
 * Избавился от всех карт — кон твой: тебе очки карт, оставшихся у соперников (картинки 10, туз 1). Партия — до 100.
 * Джин-рамми: вдвоём по 10, на стол не выкладывают. Сбросив карту, можно «постучать», если вне комбинаций (дедвуд) не больше 10 очков.
 * Джин (дедвуд 0) — 25 + дедвуд соперника. Иначе соперник докладывает свои карты к комбинациям постучавшего; у постучавшего меньше —
 * ему разница, у защитника столько же или меньше — «андеркат»: защитнику разница + 25. Партия — до 100.
 * Кункен: две колоды и 4 джокера, по 12. Первая выкладка — комбинации на 40 очков и больше; докладывать к чужим — только выложившись.
 * Последнюю карту сброса берут, только чтобы сразу пустить её в дело. Последовательности бывают и через туза (К-Т-2), джокеров —
 * не больше половины комбинации. Вышел — остальным штраф очками карт на руке (джокер на руке удваивает), «экспресс» (вышел за один ход,
 * не выкладываясь раньше) — штраф вдвойне. Набравший 100 штрафных проиграл; побеждает тот, у кого меньше.
 */
import type { Options, Rng } from '../../core/types';
import { makeDeck, type Suit } from '../../cards/deck';
import { shuffle } from '../../core/rng';
import { bestSplit, canLayoff, isJoker, isMeld, meldValue, same, value, type MeldRules, type RCard } from './melds';

export type Mode = 'rummy' | 'gin' | 'kunken';

export interface Cfg {
  mode: Mode;
  target: number;
}

export function cfgFrom(o: Options): Cfg {
  const mode: Mode = o.mode === 'gin' || o.mode === 'kunken' ? o.mode : 'rummy';
  return { mode, target: [50, 100, 150].includes(Number(o.target)) ? Number(o.target) : 100 };
}

export const rulesOf = (cfg: Cfg): MeldRules => ({ aceHigh: false, wrap: cfg.mode === 'kunken', jokers: cfg.mode === 'kunken' });
export const OPEN_MIN = 40;
export const KNOCK = 10;
export const GIN_BONUS = 25;
export const UNDERCUT = 25;
/** Ходов в сдаче до пересдачи без победителя. */
export const MAX_MOVES = 300;

export interface Meld {
  id: number;
  owner: number;
  cards: RCard[];
}

export type Phase = 'draw' | 'play' | 'over';

export interface State {
  cfg: Cfg;
  seats: number[];
  dealer: number;
  stock: RCard[];
  discard: RCard[];
  hands: RCard[][];
  melds: Meld[];
  nextMeld: number;
  /** Кункен: выложился ли (первая выкладка на 40). */
  opened: boolean[];
  /** Кункен: карта из сброса, которую надо пустить в дело в этот ход. */
  mustUse: RCard | null;
  /** Выкладывал ли что-то до этого хода (для «экспресса»). */
  laidBefore: boolean[];
  /** Что каждый брал из сброса в этой сдаче (все видели). */
  took: RCard[][];
  phase: Phase;
  turn: number;
  score: number[];
  deal: number;
  /** Ходов в этой сдаче (предел — пересдача без победителя). */
  moves: number;
  last: { winner: number; lines: string[]; add: number[] } | null;
  over: boolean;
  winner: number | null;
}

export interface View extends Omit<State, 'stock'> {
  stockLeft: number;
  counts: number[];
}

export type Action =
  | { type: 'draw'; from: 'stock' | 'discard' }
  /** Выложить карты (одной или несколькими комбинациями — делятся сами). */
  | { type: 'meld'; cards: RCard[] }
  | { type: 'layoff'; card: RCard; meld: number }
  | { type: 'discard'; card: RCard; knock?: boolean };

export type Event =
  | { type: 'deal'; deal: number; dealer: number; hands?: RCard[][]; up: RCard }
  | { type: 'draw'; seat: number; from: 'stock' | 'discard'; card?: RCard }
  | { type: 'meld'; seat: number; cards: RCard[]; id: number }
  | { type: 'layoff'; seat: number; card: RCard; meld: number }
  | { type: 'discard'; seat: number; card: RCard; knock?: boolean }
  | { type: 'reshuffle' }
  | { type: 'show'; seat: number; melds: RCard[][]; dead: RCard[]; deadValue: number }
  | { type: 'hand'; winner: number | null; lines: string[]; add: number[]; score: number[] }
  | { type: 'end'; winner: number; score: number[] };

const nextIn = (list: number[], seat: number) => list[(list.indexOf(seat) + 1) % list.length];
const handSize = (cfg: Cfg, n: number) => (cfg.mode === 'kunken' ? 12 : cfg.mode === 'gin' || n === 2 ? 10 : n <= 4 ? 7 : 6);

function freshDeck(cfg: Cfg, rng: Rng): RCard[] {
  if (cfg.mode !== 'kunken') return shuffle(makeDeck(52), rng);
  const out: RCard[] = [];
  for (const d of [0, 1]) for (const c of makeDeck(52)) out.push({ ...c, d });
  const js: Suit[] = ['H', 'S', 'H', 'S'];
  js.forEach((s, i) => out.push({ s, r: 15, d: i }));
  return shuffle(out, rng);
}

export function newState(cfg: Cfg, seats: number[]): State {
  const z = () => seats.reduce((a, x) => ((a[x] = 0), a), [] as number[]);
  return {
    cfg,
    seats: seats.slice(),
    dealer: seats[seats.length - 1],
    stock: [],
    discard: [],
    hands: seats.reduce((a, x) => ((a[x] = []), a), [] as RCard[][]),
    melds: [],
    nextMeld: 1,
    opened: seats.reduce((a, x) => ((a[x] = false), a), [] as boolean[]),
    mustUse: null,
    laidBefore: seats.reduce((a, x) => ((a[x] = false), a), [] as boolean[]),
    took: seats.reduce((a, x) => ((a[x] = []), a), [] as RCard[][]),
    phase: 'draw',
    turn: seats[0],
    score: z(),
    deal: 0,
    moves: 0,
    last: null,
    over: false,
    winner: null,
  };
}

function dealHand(s: State, rng: Rng, ev: Event[]) {
  s.deal++;
  if (s.deal > 1) s.dealer = nextIn(s.seats, s.dealer);
  const deck = freshDeck(s.cfg, rng);
  const n = handSize(s.cfg, s.seats.length);
  for (const x of s.seats) {
    s.hands[x] = deck.splice(0, n);
    s.opened[x] = false;
    s.laidBefore[x] = false;
    s.took[x] = [];
  }
  s.discard = [deck.shift()!];
  s.stock = deck;
  s.melds = [];
  s.moves = 0;
  s.mustUse = null;
  s.phase = 'draw';
  s.turn = nextIn(s.seats, s.dealer);
  ev.push({ type: 'deal', deal: s.deal, dealer: s.dealer, hands: s.hands.map((h) => (h ? h.slice() : h)), up: s.discard[0] });
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  const s = newState(cfgFrom(opts), seats);
  dealHand(s, rng, []);
  return s;
}

export const toAct = (s: State): number[] => (s.over ? [] : [s.turn]);
const has = (hand: RCard[], c: RCard) => hand.some((x) => same(x, c));
const without = (hand: RCard[], cs: RCard[]) => hand.filter((x) => !cs.some((c) => same(c, x)));

/** Можно ли сейчас выкладывать и докладывать (джин — нет; кункен — доклад только выложившись). */
export const canMeldNow = (s: State | View, seat: number) => s.phase === 'play' && s.turn === seat && s.cfg.mode !== 'gin';

export function canTakeDiscard(s: State | View, seat: number): boolean {
  if (s.phase !== 'draw' || s.turn !== seat || !s.discard.length) return false;
  if (s.cfg.mode !== 'kunken') return true;
  // кункен: карту из сброса — только сразу в дело (в комбинацию с картами руки или к комбинации на столе, если выложился)
  const top = s.discard[s.discard.length - 1];
  const hand = [...s.hands[seat], top];
  const rules = rulesOf(s.cfg);
  if (bestSplit(hand, rules).melds.some((m) => m.some((c) => same(c, top))) && (s.opened[seat] || openValue(hand, rules) >= OPEN_MIN)) return true;
  return s.opened[seat] && s.melds.some((m) => canLayoff(m.cards, top, rules));
}

/** Сколько очков можно выложить из руки за раз (для первой выкладки). */
export function openValue(hand: RCard[], rules: MeldRules): number {
  return bestSplit(hand, rules, 0).melds.reduce((x, m) => x + meldValue(m, rules), 0);
}

function clone(s0: State): State {
  return {
    ...s0,
    stock: s0.stock.slice(),
    discard: s0.discard.slice(),
    hands: s0.hands.map((h) => (h ? h.slice() : h)),
    melds: s0.melds.map((m) => ({ ...m, cards: m.cards.slice() })),
    opened: s0.opened.slice(),
    laidBefore: s0.laidBefore.slice(),
    took: s0.took.map((t) => (t ? t.slice() : t)),
    score: s0.score.slice(),
  };
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn || !a) return null;
  const s = clone(s0);
  const ev: Event[] = [];
  const rules = rulesOf(s.cfg);
  const hand = s.hands[seat];
  if (a.type === 'draw') {
    if (s.phase !== 'draw') return null;
    if (a.from === 'discard') {
      if (!canTakeDiscard(s, seat)) return null;
      const c = s.discard.pop()!;
      s.hands[seat] = [...hand, c];
      if (s.cfg.mode === 'kunken') s.mustUse = c;
      s.took[seat].push(c);
      ev.push({ type: 'draw', seat, from: 'discard', card: c });
    } else {
      if (!s.stock.length) {
        // колода кончилась: сброс (кроме верхней) — в колоду
        if (s.discard.length <= 1) return endNoWinner(s, rng, ev);
        const top = s.discard.pop()!;
        s.stock = shuffle(s.discard, rng);
        s.discard = [top];
        ev.push({ type: 'reshuffle' });
      }
      const c = s.stock.shift()!;
      s.hands[seat] = [...hand, c];
      ev.push({ type: 'draw', seat, from: 'stock', card: c });
    }
    s.phase = 'play';
      return { state: s, events: ev };
  }
  if (s.phase !== 'play') return null;
  if (a.type === 'meld') {
    if (!canMeldNow(s, seat) || !Array.isArray(a.cards) || !a.cards.length || !a.cards.every((c) => has(hand, c)) || new Set(a.cards.map((c) => `${c.s}${c.r}.${c.d ?? 0}`)).size !== a.cards.length) return null;
    const cards = a.cards.map((c) => hand.find((x) => same(x, c))!);
    // выбранные карты делятся на комбинации целиком
    const parts = splitAll(cards, rules);
    if (!parts) return null;
    if (s.cfg.mode === 'kunken' && !s.opened[seat]) {
      if (parts.reduce((x, m) => x + meldValue(m, rules), 0) < OPEN_MIN) return null;
      s.opened[seat] = true;
    }
    s.hands[seat] = without(hand, cards);
    for (const m of parts) {
      const id = s.nextMeld++;
      s.melds.push({ id, owner: seat, cards: m });
      ev.push({ type: 'meld', seat, cards: m, id });
    }
    if (s.mustUse && cards.some((c) => same(c, s.mustUse!))) s.mustUse = null;
    return afterPlay(s, seat, rng, ev);
  }
  if (a.type === 'layoff') {
    if (!canMeldNow(s, seat) || !has(hand, a.card)) return null;
    if (s.cfg.mode === 'kunken' && !s.opened[seat]) return null;
    const m = s.melds.find((x) => x.id === a.meld);
    if (!m) return null;
    const card = hand.find((x) => same(x, a.card))!;
    if (!canLayoff(m.cards, card, rules)) return null;
    m.cards = [...m.cards, card];
    s.hands[seat] = without(hand, [card]);
    if (s.mustUse && same(card, s.mustUse)) s.mustUse = null;
    ev.push({ type: 'layoff', seat, card, meld: m.id });
    return afterPlay(s, seat, rng, ev);
  }
  if (a.type === 'discard') {
    if (!has(hand, a.card) || s.mustUse) return null;
    const card = hand.find((x) => same(x, a.card))!;
    const rest = without(hand, [card]);
    if (a.knock) {
      if (s.cfg.mode !== 'gin' || bestSplit(rest, rules).deadValue > KNOCK) return null;
    }
    s.hands[seat] = rest;
    s.discard.push(card);
    ev.push({ type: 'discard', seat, card, knock: !!a.knock });
    if (a.knock) return knock(s, seat, rng, ev);
    if (!rest.length) return goOut(s, seat, rng, ev);
    if (s.melds.some((m) => m.owner === seat)) s.laidBefore[seat] = true;
    // сдача затянулась (карту гоняют туда-сюда через сброс) — пересдача
    if (++s.moves >= MAX_MOVES) return endNoWinner(s, rng, ev);
    s.turn = nextIn(s.seats, seat);
    s.phase = 'draw';
      return { state: s, events: ev };
  }
  return null;
}

function afterPlay(s: State, seat: number, rng: Rng, ev: Event[]) {
  if (!s.hands[seat].length) return goOut(s, seat, rng, ev);
  return { state: s, events: ev };
}

/** Разбить карты на комбинации без остатка (или null). */
export function splitAll(cards: RCard[], rules: MeldRules): RCard[][] | null {
  if (isMeld(cards, rules)) return [cards];
  const sp = bestSplit(cards, rules, 1000);
  return sp.dead.length ? null : sp.melds;
}

/** Выход в рамми и кункене. */
function goOut(s: State, seat: number, rng: Rng, ev: Event[]) {
  const add = s.seats.reduce((a, x) => ((a[x] = 0), a), [] as number[]);
  const lines: string[] = [];
  if (s.cfg.mode === 'rummy') {
    let sum = 0;
    for (const x of s.seats) if (x !== seat) sum += s.hands[x].reduce((t, c) => t + value(c), 0);
    add[seat] = sum;
    lines.push(`+${sum} за карты соперников`);
  } else {
    const express = !s.laidBefore[seat];
    for (const x of s.seats) {
      if (x === seat) continue;
      let pen = s.hands[x].reduce((t, c) => t + (isJoker(c) ? 0 : c.r === 14 ? 1 : Math.min(10, c.r)), 0);
      if (s.hands[x].some(isJoker)) pen *= 2;
      if (express) pen *= 2;
      add[x] = pen;
    }
    if (express) lines.push('экспресс — штраф вдвойне');
  }
  return finishHand(s, seat, add, lines, rng, ev);
}

/** Стук в джин-рамми: раскрытие, доклад защитника, подсчёт. */
function knock(s: State, seat: number, rng: Rng, ev: Event[]) {
  const rules = rulesOf(s.cfg);
  const opp = s.seats.find((x) => x !== seat)!;
  const mine = bestSplit(s.hands[seat], rules);
  ev.push({ type: 'show', seat, melds: mine.melds, dead: mine.dead, deadValue: mine.deadValue });
  const theirs = bestSplit(s.hands[opp], rules);
  let defDead = theirs.dead.slice();
  // защитник докладывает к комбинациям постучавшего (не после джина)
  if (mine.deadValue > 0) {
    const ms = mine.melds.map((m) => m.slice());
    let changed = true;
    while (changed) {
      changed = false;
      for (const c of defDead)
        for (const m of ms)
          if (canLayoff(m, c, rules)) {
            m.push(c);
            defDead = defDead.filter((x) => x !== c);
            changed = true;
            break;
          }
    }
  }
  const dv = defDead.reduce((x, c) => x + value(c), 0);
  ev.push({ type: 'show', seat: opp, melds: theirs.melds, dead: defDead, deadValue: dv });
  const add = s.seats.reduce((a, x) => ((a[x] = 0), a), [] as number[]);
  const lines: string[] = [];
  let winner = seat;
  if (mine.deadValue === 0) {
    add[seat] = GIN_BONUS + dv;
    lines.push(`джин: ${GIN_BONUS} + ${dv}`);
  } else if (dv <= mine.deadValue) {
    winner = opp;
    add[opp] = mine.deadValue - dv + UNDERCUT;
    lines.push(`андеркат: ${mine.deadValue - dv} + ${UNDERCUT}`);
  } else {
    add[seat] = dv - mine.deadValue;
    lines.push(`стук: ${dv} − ${mine.deadValue}`);
  }
  return finishHand(s, winner, add, lines, rng, ev);
}

function endNoWinner(s: State, rng: Rng, ev: Event[]) {
  const add = s.seats.reduce((a, x) => ((a[x] = 0), a), [] as number[]);
  ev.push({ type: 'hand', winner: null, lines: ['никто не вышел — пересдача'], add, score: s.score.slice() });
  if (s.deal >= 60) {
    s.over = true;
    s.phase = 'over';
    const best = s.cfg.mode === 'kunken' ? Math.min(...s.seats.map((x) => s.score[x])) : Math.max(...s.seats.map((x) => s.score[x]));
    s.winner = s.seats.find((x) => s.score[x] === best)!;
    ev.push({ type: 'end', winner: s.winner, score: s.score.slice() });
    return { state: s, events: ev };
  }
  dealHand(s, rng, ev);
  return { state: s, events: ev };
}

function finishHand(s: State, winner: number, add: number[], lines: string[], rng: Rng, ev: Event[]) {
  for (const x of s.seats) s.score[x] += add[x];
  s.last = { winner, lines, add };
  ev.push({ type: 'hand', winner, lines, add, score: s.score.slice() });
  const penalty = s.cfg.mode === 'kunken';
  const reached = s.seats.filter((x) => s.score[x] >= s.cfg.target);
  if (reached.length || s.deal >= 60) {
    s.over = true;
    s.phase = 'over';
    const best = penalty ? Math.min(...s.seats.map((x) => s.score[x])) : Math.max(...s.seats.map((x) => s.score[x]));
    s.winner = s.seats.find((x) => s.score[x] === best)!;
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

export const countOf = (s: State | View, seat: number) => ('counts' in s ? (s as View).counts[seat] : s.hands[seat].length);
