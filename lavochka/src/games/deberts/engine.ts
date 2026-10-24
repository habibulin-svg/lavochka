/* Деберц, клабор и белот — правила (без DOM). Сводка источников — docs/analysis/rules-deberts.md.
 *
 * 32 карты (7…Т). Козыри: В 20, 9 14, Т 11, 10 10, К 4, Д 3, 8, 7 (по старшинству так же); простые: Т 11, 10 10, К 4, Д 3, В 2, 9, 8, 7.
 * Последняя взятка — 10, всего 162.
 * Деберц (ru.wiki): вдвоём и втроём по 6 карт, открывают карту-козырь, торгуются, потом прикуп по 3 (на руках 9); вчетвером (пара на пару) —
 * по 6 и прикуп по 2, открытая карта уходит сдатчику. Торги: по кругу от соседа сдатчика — «играю» (масть открытой) или пас; все спасовали —
 * второй круг: назвать другую масть или пас; снова все — пересдача. Козырную семёрку можно обменять на открытый козырь (до первого хода).
 * Комбинации: терц (три подряд одной масти) 20, полтинник (четыре подряд) 50 — засчитываются только той стороне, у которой лучшая
 * (полтинник старше терца, равные — по старшей карте, козырная — старше); белла (К и Д козыря) 20 — всегда, при ходе первой из пары.
 * Семь подряд одной масти («деберц») — сразу победа в партии.
 * Ход: в масть; нет масти — козырем; если на столе козырь — перебить, если можно. Заказчик набрал меньше соперника — «байт»: его очки
 * уходят соперникам; поровну — «висячий»: очки заказчика достаются тому, кто выиграет следующую сдачу. Партия — до 501 (вчетвером — 1001).
 * Клабор (одесский): то же, но на втором круге сдатчик обязан назвать масть («обязон»), за сдачу без единой взятки («лыжи») −100,
 * каждый третий байт — ещё −100.
 * Белот (Франция): вчетвером пара на пару, по 5 карт, взявший козырь получает открытую и ещё 2, остальные по 3 (по 8). Комбинации:
 * 3 подряд — 20, 4 — 50, 5 — 100, четыре валета — 200, девятки — 150, тузы/десятки/короли/дамы — 100 (лучшей стороне); белот-ребелот 20.
 * Партнёр уже берёт взятку — можно не козырять. Заказчик набрал меньше — соперникам 162 и все комбинации; все взятки — «капот» 250. До 1000.
 */
import type { Options, Rng } from '../../core/types';
import { makeDeck, sameCard, SUITS, type Card, type Suit } from '../../cards/deck';
import { shuffle } from '../../core/rng';

export type Rules = 'deberts' | 'klabor' | 'belote';

export interface Cfg {
  rules: Rules;
  target: number;
}

export function cfgFrom(o: Options, n = 2): Cfg {
  const rules: Rules = o.rules === 'klabor' || o.rules === 'belote' ? o.rules : 'deberts';
  const t = Number(o.target);
  const target = [301, 501, 1001, 1000].includes(t) ? t : rules === 'belote' ? 1000 : n === 4 ? 1001 : 501;
  return { rules, target };
}

const TRUMP_POWER: Record<number, number> = { 11: 8, 9: 7, 14: 6, 10: 5, 13: 4, 12: 3, 8: 2, 7: 1 };
const PLAIN_POWER: Record<number, number> = { 14: 8, 10: 7, 13: 6, 12: 5, 11: 4, 9: 3, 8: 2, 7: 1 };
const TRUMP_PTS: Record<number, number> = { 11: 20, 9: 14, 14: 11, 10: 10, 13: 4, 12: 3, 8: 0, 7: 0 };
const PLAIN_PTS: Record<number, number> = { 14: 11, 10: 10, 13: 4, 12: 3, 11: 2, 9: 0, 8: 0, 7: 0 };
/** Порядок карт для последовательностей: 7 8 9 10 В Д К Т. */
const SEQ: Record<number, number> = { 7: 0, 8: 1, 9: 2, 10: 3, 11: 4, 12: 5, 13: 6, 14: 7 };

export const points = (c: Card, trump: Suit) => (c.s === trump ? TRUMP_PTS[c.r] : PLAIN_PTS[c.r]);
export const power = (c: Card, trump: Suit) => (c.s === trump ? 100 + TRUMP_POWER[c.r] : PLAIN_POWER[c.r]);

export interface Combo {
  kind: 'seq' | 'four';
  len: number;
  top: number;
  suit: Suit | null;
  pts: number;
  cards: Card[];
}

/** Комбинации руки (без беллы). */
export function combos(hand: Card[], rules: Rules): Combo[] {
  const out: Combo[] = [];
  for (const s of SUITS) {
    const ranks = hand.filter((c) => c.s === s).map((c) => SEQ[c.r]).sort((a, b) => a - b);
    let i = 0;
    while (i < ranks.length) {
      let j = i;
      while (j + 1 < ranks.length && ranks[j + 1] === ranks[j] + 1) j++;
      const len = j - i + 1;
      if (len >= 3) {
        const pts = len >= 5 ? (rules === 'belote' ? 100 : 50) : len === 4 ? 50 : 20;
        const cards = hand.filter((c) => c.s === s && SEQ[c.r] >= ranks[i] && SEQ[c.r] <= ranks[j]);
        out.push({ kind: 'seq', len, top: ranks[j], suit: s, pts, cards });
      }
      i = j + 1;
    }
  }
  if (rules === 'belote') {
    const FOUR: Record<number, number> = { 11: 200, 9: 150, 14: 100, 10: 100, 13: 100, 12: 100 };
    for (const r of [11, 9, 14, 10, 13, 12]) if (hand.filter((c) => c.r === r).length === 4) out.push({ kind: 'four', len: 4, top: r, suit: null, pts: FOUR[r], cards: hand.filter((c) => c.r === r) });
  }
  return out;
}

/** Сравнение лучших комбинаций: больше — старше. */
function comboRank(c: Combo, trump: Suit): number {
  return c.pts * 1000 + c.len * 100 + c.top * 2 + (c.suit === trump ? 1 : 0);
}

export const hasDeberts = (hand: Card[]) => SUITS.some((s) => hand.filter((c) => c.s === s).length >= 7 && combos(hand.filter((c) => c.s === s), 'deberts').some((x) => x.len >= 7));

export type Phase = 'bid1' | 'bid2' | 'play' | 'over';

export interface State {
  cfg: Cfg;
  seats: number[];
  dealer: number;
  deck: Card[];
  hands: Card[][];
  /** Открытая карта (кандидат в козыри). */
  up: Card | null;
  trump: Suit | null;
  taker: number | null;
  phase: Phase;
  turn: number;
  /** Кто уже высказался в этом круге торгов. */
  passed: number[];
  trick: { seat: number; card: Card }[];
  /** Сыгранные в сдаче карты (видели все). */
  gone: Card[];
  /** Очки карт сторон в сдаче. */
  pts: number[];
  tricksT: number[];
  tricks: number[];
  /** Объявленные комбинации и белла (стороны). */
  decl: { team: number; what: string; pts: number }[];
  /** Белла: у кого К и Д козыря (объявляется при первой из них). */
  bella: number | null;
  bellaSaid: boolean;
  score: number[];
  /** Висячие очки (после ничьей) и сколько. */
  hanging: number;
  bayts: number[];
  deal: number;
  last: { lines: string[]; add: number[] } | null;
  over: boolean;
  winner: number | null;
}

export interface View extends Omit<State, 'deck'> {
  counts: number[];
  deckLeft: number;
}

export type Action = { type: 'bid'; play: boolean; suit?: Suit } | { type: 'swap' } | { type: 'play'; card: Card };

export type Event =
  | { type: 'deal'; deal: number; dealer: number; up: Card; hands?: Card[][] }
  | { type: 'bid'; seat: number; play: boolean; suit?: Suit }
  | { type: 'redeal' }
  | { type: 'trump'; taker: number; suit: Suit; hands?: Card[][] }
  | { type: 'swap'; seat: number; card: Card; took: Card }
  | { type: 'decl'; team: number; seat: number; what: string; pts: number }
  | { type: 'play'; seat: number; card: Card; bella?: boolean }
  | { type: 'trick'; seat: number; cards: Card[]; pts: number }
  | { type: 'hand'; lines: string[]; add: number[]; score: number[] }
  | { type: 'end'; winner: number; score: number[] };

const nextIn = (list: number[], seat: number) => list[(list.indexOf(seat) + 1) % list.length];
export const pairs = (s: { seats: number[] }) => s.seats.length === 4;
export const teamOf = (s: { seats: number[] }, seat: number) => (pairs(s) ? s.seats.indexOf(seat) % 2 : s.seats.indexOf(seat));
export const nTeams = (s: { seats: number[] }) => (pairs(s) ? 2 : s.seats.length);

export function newState(cfg: Cfg, seats: number[]): State {
  const n = seats.length === 4 ? 2 : seats.length;
  return {
    cfg,
    seats: seats.slice(),
    dealer: seats[seats.length - 1],
    deck: [],
    hands: seats.reduce((a, x) => ((a[x] = []), a), [] as Card[][]),
    up: null,
    trump: null,
    taker: null,
    phase: 'bid1',
    turn: seats[0],
    passed: [],
    trick: [],
    gone: [],
    pts: Array(n).fill(0),
    tricksT: Array(n).fill(0),
    tricks: seats.reduce((a, x) => ((a[x] = 0), a), [] as number[]),
    decl: [],
    bella: null,
    bellaSaid: false,
    score: Array(n).fill(0),
    hanging: 0,
    bayts: Array(n).fill(0),
    deal: 0,
    last: null,
    over: false,
    winner: null,
  };
}

function dealHand(s: State, rng: Rng, ev: Event[], keepDealer = false) {
  s.deal++;
  if (s.deal > 1 && !keepDealer) s.dealer = nextIn(s.seats, s.dealer);
  s.deck = shuffle(makeDeck(32), rng);
  const n = s.cfg.rules === 'belote' ? 5 : 6;
  for (const x of s.seats) s.hands[x] = s.deck.splice(0, n);
  s.up = s.deck.shift()!;
  s.trump = null;
  s.taker = null;
  s.phase = 'bid1';
  s.turn = nextIn(s.seats, s.dealer);
  s.passed = [];
  s.trick = [];
  s.gone = [];
  s.pts = s.pts.map(() => 0);
  s.tricksT = s.tricksT.map(() => 0);
  for (const x of s.seats) s.tricks[x] = 0;
  s.decl = [];
  s.bella = null;
  s.bellaSaid = false;
  ev.push({ type: 'deal', deal: s.deal, dealer: s.dealer, up: s.up, hands: s.hands.map((h) => (h ? h.slice() : h)) });
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  const s = newState(cfgFrom(opts, seats.length), seats);
  dealHand(s, rng, []);
  return s;
}

export const toAct = (s: State): number[] => (s.over ? [] : [s.turn]);

/** Козырь назначен: прикуп, комбинации, белла. */
function startPlay(s: State, taker: number, suit: Suit, ev: Event[]) {
  s.trump = suit;
  s.taker = taker;
  if (s.cfg.rules === 'belote') {
    // взявший — открытую и ещё 2, остальные — по 3
    for (let k = 0; k < s.seats.length; k++) {
      const x = s.seats[(s.seats.indexOf(nextIn(s.seats, s.dealer)) + k) % s.seats.length];
      if (x === taker) s.hands[x].push(s.up!, ...s.deck.splice(0, 2));
      else s.hands[x].push(...s.deck.splice(0, 3));
    }
    s.up = null;
  } else {
    if (pairs(s)) {
      // вчетвером: по 2, сдатчику — одна и открытая карта
      for (const x of s.seats) s.hands[x].push(...s.deck.splice(0, x === s.dealer ? 1 : 2));
      s.hands[s.dealer].push(s.up!);
      s.up = null;
    } else for (const x of s.seats) s.hands[x].push(...s.deck.splice(0, 3));
  }
  ev.push({ type: 'trump', taker, suit, hands: s.hands.map((h) => (h ? h.slice() : h)) });
  // деберц — семь подряд — сразу победа
  for (const x of s.seats)
    if (s.cfg.rules !== 'belote' && hasDeberts(s.hands[x])) {
      const t = teamOf(s, x);
      ev.push({ type: 'decl', team: t, seat: x, what: 'деберц — семь подряд!', pts: 0 });
      s.over = true;
      s.phase = 'over';
      s.winner = t;
      ev.push({ type: 'end', winner: t, score: s.score.slice() });
      return;
    }
  // комбинации: лучшая сторона получает все свои
  let best: { team: number; c: Combo; seat: number } | null = null;
  for (const x of s.seats)
    for (const c of combos(s.hands[x], s.cfg.rules)) if (!best || comboRank(c, suit) > comboRank(best.c, suit)) best = { team: teamOf(s, x), c, seat: x };
  if (best) {
    for (const x of s.seats) {
      if (teamOf(s, x) !== best.team) continue;
      for (const c of combos(s.hands[x], s.cfg.rules)) {
        const what = c.kind === 'four' ? `четыре ${c.top === 11 ? 'вальта' : c.top === 9 ? 'девятки' : 'карты'}` : c.len >= 5 ? `${c.len} подряд` : c.len === 4 ? 'полтинник' : 'терц';
        s.decl.push({ team: best.team, what, pts: c.pts });
        ev.push({ type: 'decl', team: best.team, seat: x, what, pts: c.pts });
      }
    }
  }
  for (const x of s.seats) if (s.hands[x].some((c) => c.s === suit && c.r === 13) && s.hands[x].some((c) => c.s === suit && c.r === 12)) s.bella = x;
  s.phase = 'play';
  // первым ходит сосед сдатчика (в клаборе — «играющий»)
  s.turn = s.cfg.rules === 'klabor' ? taker : nextIn(s.seats, s.dealer);
}

export function canSwap(s: State | View, seat: number): boolean {
  if (s.cfg.rules === 'belote' || s.phase !== 'play' || !s.up || !s.trump || s.trick.length || s.seats.some((x) => s.tricks[x] > 0)) return false;
  return s.hands[seat].some((c) => c.s === s.trump && c.r === 7) && s.up.s === s.trump;
}

/** Допустимые карты. */
export function legal(s: State | View, seat: number): Card[] {
  const hand = s.hands[seat];
  if (!s.trick.length || !s.trump) return hand;
  const T = s.trump;
  const lead = s.trick[0].card;
  const follow = hand.filter((c) => c.s === lead.s);
  const tr = hand.filter((c) => c.s === T);
  const tableTr = s.trick.filter((t) => t.card.s === T).map((t) => power(t.card, T));
  const top = tableTr.length ? Math.max(...tableTr) : 0;
  const over = (cs: Card[]) => {
    const o = cs.filter((c) => power(c, T) > top);
    return o.length ? o : cs;
  };
  if (follow.length) return lead.s === T ? over(follow) : follow;
  if (!tr.length) return hand;
  // белот: партнёр уже берёт — можно не козырять
  if (s.cfg.rules === 'belote' && pairs(s)) {
    const w = trickWinner(s.trick, T);
    if (teamOf(s, w) === teamOf(s, seat)) return hand;
  }
  return over(tr);
}

export function trickWinner(trick: { seat: number; card: Card }[], trump: Suit): number {
  let best = trick[0];
  for (const t of trick.slice(1)) {
    const a = best.card;
    const b = t.card;
    if (b.s === trump && a.s !== trump) best = t;
    else if (b.s === a.s && power(b, trump) > power(a, trump)) best = t;
  }
  return best.seat;
}

function clone(s0: State): State {
  return { ...s0, deck: s0.deck.slice(), hands: s0.hands.map((h) => (h ? h.slice() : h)), passed: s0.passed.slice(), trick: s0.trick.slice(), gone: s0.gone.slice(), pts: s0.pts.slice(), tricksT: s0.tricksT.slice(), tricks: s0.tricks.slice(), decl: s0.decl.slice(), score: s0.score.slice(), bayts: s0.bayts.slice() };
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn || !a) return null;
  const s = clone(s0);
  const ev: Event[] = [];
  if (a.type === 'bid') {
    if (s.phase === 'bid1') {
      ev.push({ type: 'bid', seat, play: !!a.play });
      if (a.play) {
        startPlay(s, seat, s.up!.s, ev);
        return { state: s, events: ev };
      }
      s.passed.push(seat);
      if (s.passed.length >= s.seats.length) {
        s.phase = 'bid2';
        s.passed = [];
      }
      s.turn = nextIn(s.seats, seat);
      return { state: s, events: ev };
    }
    if (s.phase === 'bid2') {
      if (a.play) {
        if (!a.suit || a.suit === s.up!.s || !SUITS.includes(a.suit)) return null;
        ev.push({ type: 'bid', seat, play: true, suit: a.suit });
        startPlay(s, seat, a.suit, ev);
        return { state: s, events: ev };
      }
      // клабор: сдатчик на втором круге обязан назвать масть
      if (s.cfg.rules === 'klabor' && seat === s.dealer) return null;
      ev.push({ type: 'bid', seat, play: false });
      s.passed.push(seat);
      if (s.passed.length >= s.seats.length) {
        ev.push({ type: 'redeal' });
        dealHand(s, rng, ev);
        return { state: s, events: ev };
      }
      s.turn = nextIn(s.seats, seat);
      return { state: s, events: ev };
    }
    return null;
  }
  if (s.phase !== 'play') return null;
  if (a.type === 'swap') {
    if (!canSwap(s, seat)) return null;
    const seven = s.hands[seat].find((c) => c.s === s.trump && c.r === 7)!;
    const took = s.up!;
    s.hands[seat] = [...s.hands[seat].filter((c) => !sameCard(c, seven)), took];
    s.up = seven;
    ev.push({ type: 'swap', seat, card: seven, took });
    return { state: s, events: ev };
  }
  if (a.type !== 'play' || !legal(s, seat).some((c) => sameCard(c, a.card))) return null;
  const card = s.hands[seat].find((c) => sameCard(c, a.card))!;
  s.hands[seat] = s.hands[seat].filter((c) => !sameCard(c, card));
  // белла — при первой из пары
  let bella = false;
  if (s.bella === seat && !s.bellaSaid && card.s === s.trump && (card.r === 12 || card.r === 13)) {
    bella = true;
    s.bellaSaid = true;
    const t = teamOf(s, seat);
    s.decl.push({ team: t, what: s.cfg.rules === 'belote' ? 'белот' : 'белла', pts: 20 });
    ev.push({ type: 'decl', team: t, seat, what: s.cfg.rules === 'belote' ? 'белот' : 'белла', pts: 20 });
  }
  s.trick.push({ seat, card });
  ev.push({ type: 'play', seat, card, bella });
  if (s.trick.length < s.seats.length) {
    s.turn = nextIn(s.seats, seat);
    return { state: s, events: ev };
  }
  const w = trickWinner(s.trick, s.trump!);
  const cards = s.trick.map((t) => t.card);
  s.gone.push(...cards);
  let pts = cards.reduce((x, c) => x + points(c, s.trump!), 0);
  const last = s.seats.every((x) => !s.hands[x].length);
  if (last) pts += 10;
  const t = teamOf(s, w);
  s.pts[t] += pts;
  s.tricksT[t]++;
  s.tricks[w]++;
  s.trick = [];
  s.turn = w;
  ev.push({ type: 'trick', seat: w, cards, pts });
  if (last) endHand(s, rng, ev);
  return { state: s, events: ev };
}

function endHand(s: State, rng: Rng, ev: Event[]) {
  const n = nTeams(s);
  const taker = teamOf(s, s.taker!);
  const declOf = (t: number) => s.decl.filter((d) => d.team === t).reduce((x, d) => x + d.pts, 0);
  const total = Array.from({ length: n }, (_, t) => s.pts[t] + declOf(t));
  const add = Array(n).fill(0);
  const lines: string[] = [];
  if (s.cfg.rules === 'belote') {
    const def = 1 - taker;
    const capot = s.tricksT[taker] === 0 ? def : s.tricksT[def] === 0 ? taker : -1;
    if (capot >= 0) {
      add[capot] = 250 + declOf(0) + declOf(1);
      lines.push('капот — 250');
    } else if (total[taker] >= total[def]) {
      add[taker] = total[taker];
      add[def] = total[def];
    } else {
      add[def] = 162 + declOf(0) + declOf(1);
      lines.push('заказ не сыгран — всё соперникам');
    }
  } else {
    const others = Array.from({ length: n }, (_, t) => t).filter((t) => t !== taker);
    const bestOther = Math.max(...others.map((t) => total[t]));
    for (const t of others) add[t] = total[t];
    if (total[taker] > bestOther) {
      add[taker] = total[taker] + s.hanging;
      s.hanging = 0;
    } else if (total[taker] === bestOther) {
      s.hanging += total[taker];
      lines.push(`поровну — ${total[taker]} висят до следующей сдачи`);
    } else {
      // байт: очки заказчика — сильнейшему сопернику
      const to = others.find((t) => total[t] === bestOther)!;
      add[to] += total[taker] + s.hanging;
      s.hanging = 0;
      s.bayts[taker]++;
      lines.push('байт!');
      if (s.cfg.rules === 'klabor' && s.bayts[taker] % 3 === 0) {
        add[taker] -= 100;
        lines.push('третий байт — −100');
      }
    }
    if (s.cfg.rules === 'klabor') for (let t = 0; t < n; t++) if (!s.tricksT[t]) (add[t] -= 100), lines.push('лыжи — −100');
  }
  for (let t = 0; t < n; t++) s.score[t] += add[t];
  s.last = { lines, add };
  ev.push({ type: 'hand', lines, add, score: s.score.slice() });
  const top = Math.max(...s.score);
  if (top >= s.cfg.target || s.deal >= 80) {
    s.over = true;
    s.phase = 'over';
    s.winner = s.score.indexOf(top);
    ev.push({ type: 'end', winner: s.winner, score: s.score.slice() });
    return;
  }
  dealHand(s, rng, ev);
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const see = (x: number) => seats === 'all' || seats.includes(x);
  const v = s as unknown as Partial<View>;
  const { deck, ...rest } = s as State;
  return { ...rest, hands: s.hands.map((h, i) => (h ? (see(i) ? h.slice() : []) : h)), counts: s.hands.map((h, i) => (h ? (v.counts?.[i] ?? h.length) : 0)), deckLeft: v.deckLeft ?? deck?.length ?? 0 };
}

export const countOf = (s: State | View, seat: number) => ('counts' in s ? (s as View).counts[seat] : s.hands[seat].length);
