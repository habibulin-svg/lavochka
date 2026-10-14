/* Кинг («дамский преферанс») — правила (без DOM). Ровно 4 игрока, 32 карты по 8 (или 36 по 9), каждый за себя.
 *
 * Партия — 11 сдач: семь отрицательных («не брать») и четыре положительных («брать»). Отрицательные:
 *  взятки (−2 за каждую), черви (−2 за черву), мальчики (−4 за валета), девочки (−4 за даму), две последние (−8 за каждую),
 *  кинг (−16 за короля червей), ералаш — всё сразу. Положительные: сдающий назначает козырь или бескозырку, +6 за взятку.
 * В масть ходить обязательно. Нет масти: в отрицательных — сброс любой карты (короля червей на «кинге» и «ералаше» — обязательно
 * при первой возможности), в положительной — обязан бить козырем. С червей нельзя заходить на «червях», «кинге» и «ералаше»,
 * пока есть другие масти. Сдача «кинг» кончается, как только взят король червей; «мальчики», «девочки», «черви» — когда взяты все.
 * Строгий кинг: отрицательные по порядку. Заказной: сдающий, посмотрев карты, выбирает любую ещё не сыгранную отрицательную.
 */
import type { Options, Rng } from '../../core/types';
import { makeDeck, sameCard, type Card, type Suit } from '../../cards/deck';
import { shuffle } from '../../core/rng';

export type Contract = 'tricks' | 'hearts' | 'boys' | 'girls' | 'last2' | 'king' | 'erash' | 'plus';
export const NEGATIVE: Contract[] = ['tricks', 'hearts', 'boys', 'girls', 'last2', 'king', 'erash'];
export const CONTRACT_NAME: Record<Contract, string> = {
  tricks: 'Не брать взяток',
  hearts: 'Не брать червей',
  boys: 'Не брать мальчиков',
  girls: 'Не брать девочек',
  last2: 'Не брать две последние',
  king: 'Не брать кинга',
  erash: 'Ералаш',
  plus: 'Брать взятки',
};

export interface Cfg {
  deck: 32 | 36;
  /** Заказной: отрицательные выбирает сдающий. */
  ordered: boolean;
  /** Сколько положительных сдач (каждый сдающий по разу — 4, или без них). */
  plus: 0 | 4;
}

export function cfgFrom(o: Options): Cfg {
  return { deck: Number(o.deck) === 36 ? 36 : 32, ordered: !!o.ordered, plus: Number(o.plus) === 0 ? 0 : 4 };
}

export const KH = (c: Card) => c.s === 'H' && c.r === 13;

export interface State {
  cfg: Cfg;
  seats: number[];
  hands: Card[][];
  phase: 'order' | 'trump' | 'play' | 'over';
  /** Сыгранные (или идущая) отрицательные. */
  used: Contract[];
  contract: Contract;
  /** Козырь положительной сдачи (null — бескозырка). */
  trump: Suit | null;
  deal: number;
  dealer: number;
  trick: { seat: number; card: Card }[];
  turn: number;
  taken: Card[][];
  tricks: number[];
  /** Номер взятки по порядку в сдаче (для «двух последних»). */
  played: number;
  /** Очки за сдачу (по ходу). */
  now: number[];
  score: number[];
  last: { contract: Contract; add: number[] } | null;
}

export interface View extends State {
  counts: number[];
}

export type Action = { type: 'order'; contract: Contract } | { type: 'trump'; suit: Suit | null } | { type: 'play'; card: Card };

export type Event =
  | { type: 'deal'; deal: number; dealer: number; hands?: Card[][] }
  | { type: 'contract'; seat: number; contract: Contract }
  | { type: 'trump'; seat: number; suit: Suit | null }
  | { type: 'play'; seat: number; card: Card }
  | { type: 'trick'; seat: number; cards: Card[]; pts: number }
  | { type: 'round'; contract: Contract; add: number[]; score: number[]; early: boolean }
  | { type: 'end'; winners: number[]; score: number[] };

const nextIn = (list: number[], seat: number) => list[(list.indexOf(seat) + 1) % list.length];
export const totalDeals = (cfg: Cfg) => NEGATIVE.length + cfg.plus;
const tricksIn = (cfg: Cfg) => cfg.deck / 4;

/** Штраф (или плюс) за взятку с этими картами при этом контракте. */
export function trickPts(cfg: Cfg, contract: Contract, cards: Card[], index: number): number {
  const n = tricksIn(cfg);
  const part = (k: Contract) => {
    switch (k) {
      case 'tricks':
        return -2;
      case 'hearts':
        return -2 * cards.filter((c) => c.s === 'H').length;
      case 'boys':
        return -4 * cards.filter((c) => c.r === 11).length;
      case 'girls':
        return -4 * cards.filter((c) => c.r === 12).length;
      case 'last2':
        return index >= n - 2 ? -8 : 0;
      case 'king':
        return cards.some(KH) ? -16 : 0;
      case 'plus':
        return 6;
      default:
        return 0;
    }
  };
  if (contract === 'erash') return (['tricks', 'hearts', 'boys', 'girls', 'last2', 'king'] as Contract[]).reduce((a, k) => a + part(k), 0);
  return part(contract);
}

export function newState(cfg: Cfg, seats: number[]): State {
  return {
    cfg,
    seats: seats.slice(),
    hands: [[], [], [], []],
    phase: 'play',
    used: [],
    contract: 'tricks',
    trump: null,
    deal: 0,
    dealer: seats[3],
    trick: [],
    turn: seats[0],
    taken: [[], [], [], []],
    tricks: [0, 0, 0, 0],
    played: 0,
    now: [0, 0, 0, 0],
    score: [0, 0, 0, 0],
    last: null,
  };
}

function deal(s: State, rng: Rng, ev: Event[]) {
  s.deal++;
  s.dealer = s.deal === 1 ? s.seats[3] : nextIn(s.seats, s.dealer);
  const deck = shuffle(makeDeck(s.cfg.deck), rng);
  const each = deck.length / 4;
  s.hands = s.seats.map((_, i) => deck.slice(i * each, (i + 1) * each));
  s.taken = [[], [], [], []];
  s.tricks = [0, 0, 0, 0];
  s.now = [0, 0, 0, 0];
  s.trick = [];
  s.played = 0;
  s.trump = null;
  ev.push({ type: 'deal', deal: s.deal, dealer: s.dealer, hands: s.hands.map((h) => h.slice()) });
  const negLeft = NEGATIVE.filter((k) => !s.used.includes(k));
  if (negLeft.length) {
    if (s.cfg.ordered) {
      s.phase = 'order';
      s.turn = s.dealer;
      return;
    }
    start(s, negLeft[0], ev);
    return;
  }
  // положительная: сдающий назначает козырь
  s.contract = 'plus';
  s.phase = 'trump';
  s.turn = s.dealer;
}

function start(s: State, k: Contract, ev: Event[]) {
  s.contract = k;
  if (k !== 'plus') s.used = [...s.used, k];
  ev.push({ type: 'contract', seat: s.dealer, contract: k });
  s.phase = 'play';
  s.turn = nextIn(s.seats, s.dealer);
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  const s = newState(cfgFrom(opts), seats);
  deal(s, rng, []);
  return s;
}

export const toAct = (s: State): number[] => (s.phase === 'over' ? [] : [s.turn]);

/** Нельзя заходить с червей (пока есть другие масти). */
const noHeartLead = (k: Contract) => k === 'hearts' || k === 'king' || k === 'erash';

export function legal(s: State, seat: number): Card[] {
  const hand = s.hands[seat];
  if (!s.trick.length) {
    if (noHeartLead(s.contract)) {
      const non = hand.filter((c) => c.s !== 'H');
      if (non.length) return non;
    }
    return hand;
  }
  const suit = s.trick[0].card.s;
  const follow = hand.filter((c) => c.s === suit);
  if (follow.length) return follow;
  if ((s.contract === 'king' || s.contract === 'erash') && hand.some(KH)) return hand.filter(KH);
  if (s.contract === 'plus' && s.trump) {
    const tr = hand.filter((c) => c.s === s.trump);
    if (tr.length) return tr;
  }
  return hand;
}

export function trickWinner(trick: { seat: number; card: Card }[], trump: Suit | null): number {
  const tr = trump ? trick.filter((t) => t.card.s === trump) : [];
  const pool = tr.length ? tr : trick.filter((t) => t.card.s === trick[0].card.s);
  return pool.sort((a, b) => b.card.r - a.card.r)[0].seat;
}

/** Сдача кончается досрочно: все штрафные карты взяты. */
function doneEarly(s: State): boolean {
  const all = s.taken.flat();
  switch (s.contract) {
    case 'king':
      return all.some(KH);
    case 'hearts':
      return all.filter((c) => c.s === 'H').length === s.cfg.deck / 4;
    case 'boys':
      return all.filter((c) => c.r === 11).length === 4;
    case 'girls':
      return all.filter((c) => c.r === 12).length === 4;
    default:
      return false;
  }
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.phase === 'over' || seat !== s0.turn || !a) return null;
  const ev: Event[] = [];
  if (s0.phase === 'order') {
    if (a.type !== 'order' || !NEGATIVE.includes(a.contract) || s0.used.includes(a.contract)) return null;
    const s: State = { ...s0 };
    start(s, a.contract, ev);
    return { state: s, events: ev };
  }
  if (s0.phase === 'trump') {
    if (a.type !== 'trump' || (a.suit !== null && !['S', 'C', 'D', 'H'].includes(a.suit))) return null;
    const s: State = { ...s0, trump: a.suit };
    ev.push({ type: 'trump', seat, suit: a.suit });
    start(s, 'plus', ev);
    return { state: s, events: ev };
  }
  if (a.type !== 'play' || !a.card || !legal(s0, seat).some((c) => sameCard(c, a.card))) return null;
  const s: State = { ...s0, hands: s0.hands.slice(), trick: [...s0.trick, { seat, card: { s: a.card.s, r: a.card.r } }], taken: s0.taken.slice(), tricks: s0.tricks.slice(), now: s0.now.slice(), score: s0.score.slice() };
  s.hands[seat] = s.hands[seat].filter((c) => !sameCard(c, a.card));
  ev.push({ type: 'play', seat, card: a.card });
  if (s.trick.length < 4) {
    s.turn = nextIn(s.seats, seat);
    return { state: s, events: ev };
  }
  const w = trickWinner(s.trick, s.contract === 'plus' ? s.trump : null);
  const cards = s.trick.map((t) => t.card);
  const pts = trickPts(s.cfg, s.contract, cards, s.played);
  s.taken[w] = [...s.taken[w], ...cards];
  s.tricks[w]++;
  s.now[w] += pts;
  s.trick = [];
  s.played++;
  s.turn = w;
  ev.push({ type: 'trick', seat: w, cards, pts });
  const early = doneEarly(s);
  if (s.hands[w].length && !early) return { state: s, events: ev };
  for (const p of s.seats) s.score[p] += s.now[p];
  s.last = { contract: s.contract, add: s.now.slice() };
  ev.push({ type: 'round', contract: s.contract, add: s.now.slice(), score: s.score.slice(), early: early && s.hands[w].length > 0 });
  if (s.deal >= totalDeals(s.cfg)) {
    s.phase = 'over';
    ev.push({ type: 'end', winners: winnersOf(s), score: s.score.slice() });
    return { state: s, events: ev };
  }
  deal(s, rng, ev);
  return { state: s, events: ev };
}

export function winnersOf(s: State): number[] {
  const top = Math.max(...s.seats.map((p) => s.score[p]));
  return s.seats.filter((p) => s.score[p] === top);
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const see = (x: number) => seats === 'all' || seats.includes(x);
  const v = s as Partial<View>;
  return { ...s, hands: s.hands.map((h, i) => (see(i) ? h.slice() : [])), counts: s.hands.map((h, i) => v.counts?.[i] ?? h.length) };
}

export const countOf = (s: State, seat: number) => ((s as Partial<View>).counts ? (s as View).counts[seat] : s.hands[seat].length);
