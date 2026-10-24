/* Французское таро — правила (без DOM). Сводка — docs/analysis/tarot-research.md, раздел 5 (Pagat, регламент FFT).
 *
 * 78 карт (колода Уэйта — Смит 1909): 21 козырь (старшие арканы I–XXI), Эскюз (Шут, 0) и четыре масти по 14 карт
 * (жезлы, кубки, мечи, пентакли: король, дама, рыцарь, паж, 10…1). Втроём — по 24 и 6 в прикуп, вчетвером — по 18 и 6,
 * впятером — по 15 и 3 (взявший называет короля, его хозяин — тайный напарник).
 * Торги в один круг: пас или выше прежнего — малая (×1), гард (×2), гард без прикупа (×4), гард против прикупа (×6).
 * Малая и гард: прикуп открывают, взявший берёт его и сносит столько же (не королей и не удлеров; козыри — только если больше
 * нечего, их показывают). Без прикупа — прикуп в очки взявшему, против — защите.
 * Ход: в масть — обязательно; нет масти — бить козырем; на козырь — перебивать, если можешь; нечем — любую. Эскюз можно
 * сыграть всегда: взятку он не берёт, остаётся у хозяина, а взявшему тот отдаёт карту в полочка (кроме последней взятки —
 * там Эскюз уходит взявшему, если хозяин не взял все взятки до неё).
 * Очки (всего 91): удлеры (XXI, I, Эскюз) и короли — 4,5, дамы 3,5, рыцари 2,5, пажи 1,5, остальные 0,5.
 * Взявшему нужно 56 очков без удлеров, 51 с одним, 41 с двумя, 36 с тремя.
 * Сдача: (25 + разница) × множитель, «пти о бу» (I в последней взятке) — 10 × множитель тому, кто взял; пуанье (10/13/15
 * козырей вчетвером) — 20/30/40 выигравшей заявку стороне; шлем (все взятки) — 200. Взявший получает с каждого защитника.
 * Решения без пользователя: объявленного шлема нет (только сделанный — 200, защита взяла все — −200); половинки очков
 * в разнице округляются вверх; пуанье предлагается перед первой картой, показывается ровно столько козырей, сколько нужно.
 */
import type { Options, Rng } from '../../core/types';
import { shuffle } from '../../core/rng';
import { isMajor, rankOf, suitOf as suitOfCard, TAROT_SIZE, type TarotSuit } from '../../cards/tarot';

export const EXCUSE = 0;
export const PETIT = 1;
export const MONDE = 21;
export const OUDLERS = [EXCUSE, PETIT, MONDE];

export type Contract = 1 | 2 | 4 | 6;
export const CONTRACTS: Contract[] = [1, 2, 4, 6];
export const CONTRACT_RU: Record<Contract, string> = { 1: 'малая', 2: 'гард', 4: 'гард без прикупа', 6: 'гард против прикупа' };
/** Нужно очков взявшему по числу удлеров. */
export const NEED = [56, 51, 41, 36];
/** Пуанье: сколько козырей нужно (одинарная, двойная, тройная) по числу игроков. */
export const POIGNEE: Record<number, number[]> = { 3: [13, 15, 18], 4: [10, 13, 15], 5: [8, 10, 13] };
export const POIGNEE_BONUS = [0, 20, 30, 40];

export interface Cfg {
  rounds: number;
  /** Пуанье и «пти о бу». */
  bonuses: boolean;
}

export function cfgFrom(o: Options): Cfg {
  return { rounds: [1, 2, 3, 4].includes(Number(o.rounds)) ? Number(o.rounds) : 2, bonuses: o.bonuses !== false };
}

/** Козырь (I–XXI). */
export const isTrump = (c: number) => c >= 1 && c <= 21;
/** «Масть» карты в игре: козырь 'T', Эскюз 'E', иначе масть. */
export type Kind = TarotSuit | 'T' | 'E';
export const kindOf = (c: number): Kind => (c === EXCUSE ? 'E' : isMajor(c) ? 'T' : suitOfCard(c)!);
/** Очки в половинках (91 очко = 182). */
export function half(c: number): number {
  if (OUDLERS.includes(c)) return 9;
  if (isMajor(c)) return 1;
  const r = rankOf(c);
  return r === 14 ? 9 : r === 13 ? 7 : r === 12 ? 5 : r === 11 ? 3 : 1;
}
export const isKing = (c: number) => !isMajor(c) && rankOf(c) === 14;

export type Phase = 'bid' | 'call' | 'discard' | 'play' | 'over';

export interface Taken {
  w: number;
  cards: number[];
  /** Кто сыграл Эскюз в этой взятке. */
  ex?: number;
}

export interface State {
  cfg: Cfg;
  seats: number[];
  dealer: number;
  hands: number[][];
  chien: number[];
  /** Снос взявшего (видит только он; показанные козыри — в ecartShown). */
  ecart: number[];
  ecartShown: number[];
  /** Прикуп открыт всем (малая и гард). */
  chienOpen: boolean;
  phase: Phase;
  turn: number;
  /** Заявки по кругу: null — ещё не говорил, 0 — пас. */
  bids: (number | null)[];
  contract: Contract | null;
  taker: number | null;
  /** Впятером: названный король, тайный напарник и открыт ли он (король сыгран). */
  called: number | null;
  partner: number | null;
  partnerShown: boolean;
  /** Пуанье: null — не решал, 0 — не объявил, 1–3 — объявил. */
  poignee: (number | null)[];
  shown: Record<number, number[]>;
  trick: { seat: number; card: number }[];
  taken: Taken[];
  /** Сыгранные карты (для ботов и счёта). */
  gone: number[];
  tricks: number[];
  score: number[];
  deal: number;
  last: HandResult | null;
  over: boolean;
  winner: number | null;
}

export interface HandResult {
  taker: number;
  partner: number | null;
  contract: Contract;
  pts: number;
  need: number;
  oudlers: number;
  won: boolean;
  lines: string[];
  add: number[];
}

export interface View extends State {
  counts: number[];
}

export type Action =
  | { type: 'bid'; c: Contract }
  | { type: 'pass' }
  | { type: 'call'; card: number }
  | { type: 'discard'; cards: number[] }
  | { type: 'poignee'; level: number }
  | { type: 'play'; card: number };

export type Event =
  | { type: 'deal'; deal: number; dealer: number; hands?: number[][] }
  | { type: 'petitSec'; seat: number }
  | { type: 'bid'; seat: number; c: Contract }
  | { type: 'pass'; seat: number }
  | { type: 'redeal' }
  | { type: 'won'; seat: number; c: Contract }
  | { type: 'call'; seat: number; card: number }
  | { type: 'chien'; cards?: number[]; to: 'taker' | 'defence' }
  | { type: 'discard'; seat: number; trumps: number[] }
  | { type: 'poignee'; seat: number; level: number; cards: number[] }
  | { type: 'play'; seat: number; card: number }
  | { type: 'partner'; seat: number }
  | { type: 'trick'; seat: number; cards: number[] }
  | { type: 'hand'; res: HandResult; score: number[] }
  | { type: 'end'; winner: number; score: number[] };

const nextIn = (list: number[], seat: number) => list[(list.indexOf(seat) + 1) % list.length];
export const handSize = (n: number) => (n === 3 ? 24 : n === 4 ? 18 : 15);
export const chienSize = (n: number) => (n === 5 ? 3 : 6);

export function newState(cfg: Cfg, seats: number[]): State {
  const z = <T>(v: T) => seats.reduce((a, x) => ((a[x] = v), a), [] as T[]);
  return {
    cfg,
    seats: seats.slice(0, 5),
    dealer: seats[seats.length - 1],
    hands: z<number[]>([]),
    chien: [],
    ecart: [],
    ecartShown: [],
    chienOpen: false,
    phase: 'bid',
    turn: seats[0],
    bids: z<number | null>(null),
    contract: null,
    taker: null,
    called: null,
    partner: null,
    partnerShown: false,
    poignee: z<number | null>(null),
    shown: {},
    trick: [],
    taken: [],
    gone: [],
    tricks: z(0),
    score: z(0),
    deal: 0,
    last: null,
    over: false,
    winner: null,
  };
}

/** Первая рука — следующий за сдатчиком: начинает торги и первую взятку. */
export const fore = (s: State | View) => nextIn(s.seats, s.dealer);

function dealHand(s: State, rng: Rng, ev: Event[]) {
  const n = s.seats.length;
  for (let tries = 0; tries < 50; tries++) {
    if (tries === 0) {
      s.deal++;
      if (s.deal > 1) s.dealer = nextIn(s.seats, s.dealer);
    }
    const deck = shuffle(Array.from({ length: TAROT_SIZE }, (_, i) => i), rng);
    for (const x of s.seats) s.hands[x] = deck.splice(0, handSize(n));
    s.chien = deck;
    // «пти сек» — единственный козырь I без Эскюза: сдача не в счёт, пересдаёт тот же
    const sec = s.seats.find((x) => s.hands[x].filter(isTrump).length === 1 && s.hands[x].includes(PETIT) && !s.hands[x].includes(EXCUSE));
    if (sec == null) break;
    ev.push({ type: 'petitSec', seat: sec });
  }
  s.phase = 'bid';
  s.turn = fore(s);
  for (const x of s.seats) {
    s.bids[x] = null;
    s.poignee[x] = null;
    s.tricks[x] = 0;
  }
  s.contract = null;
  s.taker = null;
  s.called = null;
  s.partner = null;
  s.partnerShown = false;
  s.ecart = [];
  s.ecartShown = [];
  s.chienOpen = false;
  s.shown = {};
  s.trick = [];
  s.taken = [];
  s.gone = [];
  ev.push({ type: 'deal', deal: s.deal, dealer: s.dealer, hands: s.hands.map((h) => (h ? h.slice() : h)) });
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  const s = newState(cfgFrom(opts), seats);
  dealHand(s, rng, []);
  return s;
}

export const toAct = (s: State): number[] => (s.over ? [] : [s.turn]);
export const deals = (s: State | View) => s.cfg.rounds * s.seats.length;
export const topBid = (s: State | View) => Math.max(0, ...s.seats.map((x) => s.bids[x] ?? 0));

function clone(s0: State): State {
  return {
    ...s0,
    hands: s0.hands.map((h) => (h ? h.slice() : h)),
    chien: s0.chien.slice(),
    ecart: s0.ecart.slice(),
    ecartShown: s0.ecartShown.slice(),
    bids: s0.bids.slice(),
    poignee: s0.poignee.slice(),
    shown: { ...s0.shown },
    trick: s0.trick.slice(),
    taken: s0.taken.slice(),
    gone: s0.gone.slice(),
    tricks: s0.tricks.slice(),
    score: s0.score.slice(),
  };
}

/** Самый старший козырь во взятке (0 — козырей нет). */
const topTrump = (trick: { card: number }[]) => Math.max(0, ...trick.map((t) => (isTrump(t.card) ? t.card : 0)));
/** Масть взятки — по первой карте, кроме Эскюза. */
export const leadKind = (trick: { card: number }[]): Kind | null => {
  const t = trick.find((x) => x.card !== EXCUSE);
  return t ? kindOf(t.card) : null;
};

export function legal(s: State | View, seat: number): number[] {
  const hand = s.hands[seat];
  const lead = leadKind(s.trick);
  if (!lead) return hand;
  const ok = (cs: number[]) => (cs.length ? (hand.includes(EXCUSE) ? [...cs, EXCUSE] : cs) : hand);
  const trumps = hand.filter(isTrump);
  const over = (top: number) => {
    const higher = trumps.filter((c) => c > top);
    return higher.length ? higher : trumps;
  };
  if (lead !== 'T') {
    const follow = hand.filter((c) => kindOf(c) === lead);
    if (follow.length) return ok(follow);
    if (trumps.length) return ok(over(topTrump(s.trick)));
    return hand;
  }
  if (trumps.length) return ok(over(topTrump(s.trick)));
  return hand;
}

export function trickWinner(trick: { seat: number; card: number }[]): number {
  const top = topTrump(trick);
  if (top) return trick.find((t) => t.card === top)!.seat;
  const lead = leadKind(trick);
  let best: { seat: number; card: number } | null = null;
  for (const t of trick) if (kindOf(t.card) === lead && (!best || rankOf(t.card) > rankOf(best.card))) best = t;
  // во взятке один Эскюз (взятка из одной карты не бывает) — на всякий случай первый
  return (best ?? trick[0]).seat;
}

/** Козыри для пуанье (Эскюз считается козырем). */
export const poigneeTrumps = (hand: number[]) => hand.filter((c) => isTrump(c) || c === EXCUSE);
/** Какую пуанье может объявить игрок (0 — никакую). */
export function poigneeMax(s: State | View, seat: number): number {
  if (!s.cfg.bonuses) return 0;
  const t = poigneeTrumps(s.hands[seat]).length;
  const need = POIGNEE[s.seats.length] ?? POIGNEE[4];
  return need.filter((k) => t >= k).length;
}
/** Козыри, которые показывают при пуанье: столько, сколько нужно, Эскюз — только если без него не хватает. */
export function poigneeCards(hand: number[], level: number, n: number): number[] {
  const k = (POIGNEE[n] ?? POIGNEE[4])[level - 1];
  const tr = hand.filter(isTrump).sort((a, b) => a - b);
  if (tr.length >= k) return tr.slice(tr.length - k);
  return [...tr, EXCUSE];
}

/** Можно ли положить карту в снос: не короли, не удлеры; козыри — только если иначе не набрать. */
export function canDiscard(hand: number[], c: number, need: number): boolean {
  if (isKing(c) || OUDLERS.includes(c)) return false;
  if (!isTrump(c)) return true;
  const plain = hand.filter((x) => !isTrump(x) && !isKing(x) && !OUDLERS.includes(x)).length;
  return plain < need;
}

/** Надо ли этому игроку сейчас решать о пуанье (перед первой картой). */
export const asksPoignee = (s: State | View, seat: number) =>
  s.phase === 'play' && s.turn === seat && s.poignee[seat] == null && s.taken.length === 0 && poigneeMax(s, seat) > 0;

function startPlay(s: State) {
  s.phase = 'play';
  s.turn = fore(s);
  for (const x of s.seats) if (poigneeMax(s, x) === 0) s.poignee[x] = 0;
}

/** Торги закончены: взявший — у кого старшая заявка. */
function afterBids(s: State, rng: Rng, ev: Event[]) {
  const top = topBid(s);
  if (!top) {
    ev.push({ type: 'redeal' });
    dealHand(s, rng, ev);
    return;
  }
  const taker = s.seats.find((x) => s.bids[x] === top)!;
  s.taker = taker;
  s.contract = top as Contract;
  ev.push({ type: 'won', seat: taker, c: s.contract });
  if (s.seats.length === 5) {
    s.phase = 'call';
    s.turn = taker;
    return;
  }
  afterCall(s, ev);
}

/** После вызова короля (или сразу): прикуп. */
function afterCall(s: State, ev: Event[]) {
  const t = s.taker!;
  if (s.contract! <= 2) {
    s.chienOpen = true;
    ev.push({ type: 'chien', cards: s.chien.slice(), to: 'taker' });
    s.hands[t] = [...s.hands[t], ...s.chien];
    s.chien = [];
    s.phase = 'discard';
    s.turn = t;
    return;
  }
  // без прикупа — прикуп в очки взявшему, против — защите (не открывают)
  s.ecart = s.chien.slice();
  s.chien = [];
  ev.push({ type: 'chien', to: s.contract === 4 ? 'taker' : 'defence' });
  startPlay(s);
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn || !a) return null;
  const s = clone(s0);
  const ev: Event[] = [];
  const n = s.seats.length;
  if (s.phase === 'bid') {
    if (a.type === 'bid') {
      if (!CONTRACTS.includes(a.c) || a.c <= topBid(s)) return null;
      s.bids[seat] = a.c;
      ev.push({ type: 'bid', seat, c: a.c });
    } else if (a.type === 'pass') {
      s.bids[seat] = 0;
      ev.push({ type: 'pass', seat });
    } else return null;
    // один круг: все сказали
    const next = nextIn(s.seats, seat);
    if (s.bids[next] != null) afterBids(s, rng, ev);
    else s.turn = next;
    return { state: s, events: ev };
  }
  if (s.phase === 'call') {
    if (a.type !== 'call' || !canCall(s, seat).includes(a.card)) return null;
    s.called = a.card;
    const owner = s.seats.find((x) => s.hands[x].includes(a.card));
    // король у самого взявшего или в прикупе — играет один против всех
    s.partner = owner != null && owner !== seat ? owner : null;
    ev.push({ type: 'call', seat, card: a.card });
    afterCall(s, ev);
    return { state: s, events: ev };
  }
  if (s.phase === 'discard') {
    const k = chienSize(n);
    if (a.type !== 'discard' || !Array.isArray(a.cards) || a.cards.length !== k || new Set(a.cards).size !== k) return null;
    const hand = s.hands[seat];
    if (a.cards.some((c) => !hand.includes(c) || !canDiscard(hand, c, k))) return null;
    s.ecart = a.cards.slice();
    s.ecartShown = a.cards.filter(isTrump);
    s.hands[seat] = hand.filter((c) => !a.cards.includes(c));
    ev.push({ type: 'discard', seat, trumps: s.ecartShown.slice() });
    startPlay(s);
    return { state: s, events: ev };
  }
  if (s.phase !== 'play') return null;
  if (a.type === 'poignee') {
    if (!asksPoignee(s, seat) || !Number.isInteger(a.level) || a.level < 0 || a.level > poigneeMax(s, seat)) return null;
    s.poignee[seat] = a.level;
    if (a.level) {
      const cards = poigneeCards(s.hands[seat], a.level, n);
      s.shown[seat] = cards;
      ev.push({ type: 'poignee', seat, level: a.level, cards });
    }
    return { state: s, events: ev };
  }
  if (a.type !== 'play' || asksPoignee(s, seat) || !legal(s, seat).includes(a.card)) return null;
  s.hands[seat] = s.hands[seat].filter((c) => c !== a.card);
  s.trick.push({ seat, card: a.card });
  ev.push({ type: 'play', seat, card: a.card });
  if (s.called != null && a.card === s.called && !s.partnerShown) {
    s.partnerShown = true;
    if (s.partner != null) ev.push({ type: 'partner', seat: s.partner });
  }
  if (s.trick.length < n) {
    s.turn = nextIn(s.seats, seat);
    if (s.poignee[s.turn] == null && poigneeMax(s, s.turn) === 0) s.poignee[s.turn] = 0;
    return { state: s, events: ev };
  }
  const cards = s.trick.map((t) => t.card);
  const lastTrick = s.seats.every((x) => !s.hands[x].length);
  const exT = s.trick.find((t) => t.card === EXCUSE);
  let w = trickWinner(s.trick);
  // последняя взятка с Эскюзом: если его сторона взяла всё до неё — Эскюз берёт взятку (шлем)
  if (exT && lastTrick && s.taken.length && s.taken.every((t) => sameSide(s, t.w, exT.seat))) w = exT.seat;
  s.taken.push({ w, cards, ex: exT && !lastTrick ? exT.seat : undefined });
  s.gone.push(...cards);
  s.tricks[w]++;
  s.trick = [];
  s.turn = w;
  ev.push({ type: 'trick', seat: w, cards });
  if (lastTrick) return finishHand(s, rng, ev);
  for (const x of s.seats) if (s.poignee[x] == null && s.taken.length) s.poignee[x] = 0;
  return { state: s, events: ev };
}

/** Кого можно назвать (впятером): любого короля; у кого все четыре короля — даму, у кого и все дамы — рыцаря, и т. д. */
export function canCall(s: State | View, seat: number): number[] {
  const hand = s.hands[seat];
  for (const r of [14, 13, 12, 11]) {
    const cs = [0, 1, 2, 3].map((i) => 22 + i * 14 + r - 1);
    if (!cs.every((c) => hand.includes(c))) return cs;
  }
  return [0, 1, 2, 3].map((i) => 22 + i * 14 + 9);
}

/** Одна ли сторона у двух игроков (взявший с напарником против защиты). */
export function sameSide(s: State | View, a: number, b: number): boolean {
  const att = (x: number) => x === s.taker || (s.partner != null && x === s.partner);
  return att(a) === att(b);
}

/** Очки стороны взявшего в половинках и число удлеров у неё. */
export function attackPoints(s: State): { halfPts: number; oudlers: number; tricksAtt: number; tricksDef: number } {
  const att = (x: number) => x === s.taker || (s.partner != null && x === s.partner);
  let pts = 0;
  let oud = 0;
  let ta = 0;
  let td = 0;
  const own = (c: number, mine: boolean) => {
    if (!mine) return;
    pts += half(c);
    if (OUDLERS.includes(c)) oud++;
  };
  for (const t of s.taken) {
    const wa = att(t.w);
    if (wa) ta++;
    else td++;
    for (const c of t.cards) {
      if (c === EXCUSE && t.ex != null) {
        // Эскюз остаётся у хозяина, взявшему — полочка взамен
        const ea = att(t.ex);
        own(c, ea);
        if (ea !== wa) pts += wa ? 1 : -1;
        continue;
      }
      own(c, wa);
    }
  }
  // снос и прикуп: малая, гард, без прикупа — взявшему; против — защите
  for (const c of s.ecart) own(c, s.contract !== 6);
  return { halfPts: pts, oudlers: oud, tricksAtt: ta, tricksDef: td };
}

function finishHand(s: State, rng: Rng, ev: Event[]) {
  const t = s.taker!;
  const mult = s.contract!;
  const { halfPts, oudlers, tricksAtt, tricksDef } = attackPoints(s);
  const need = NEED[oudlers];
  const won = halfPts >= need * 2;
  const diff = Math.ceil(Math.abs(halfPts - need * 2) / 2);
  const lines: string[] = [];
  let total = (25 + diff) * mult * (won ? 1 : -1);
  lines.push(`${won ? '' : '−'}(25 + ${diff}) × ${mult}`);
  // «пти о бу»: I в последней взятке
  const last = s.taken[s.taken.length - 1];
  if (s.cfg.bonuses && last.cards.includes(PETIT)) {
    const pab = 10 * mult * (sameSide(s, last.w, t) ? 1 : -1);
    total += pab;
    lines.push(`пти о бу ${pab > 0 ? '+' : '−'}${Math.abs(pab)}`);
  }
  for (const x of s.seats) {
    const lv = s.poignee[x] ?? 0;
    if (!lv) continue;
    const b = POIGNEE_BONUS[lv] * (won ? 1 : -1);
    total += b;
    lines.push(`пуанье ${b > 0 ? '+' : '−'}${Math.abs(b)}`);
  }
  if (tricksDef === 0) {
    total += 200;
    lines.push('шлем +200');
  } else if (tricksAtt === 0) {
    total -= 200;
    lines.push('шлем защиты −200');
  }
  const n = s.seats.length;
  const add = s.seats.reduce((a, x) => ((a[x] = 0), a), [] as number[]);
  const p = s.partner;
  for (const x of s.seats) {
    if (x === t) add[x] = p != null ? 2 * total : (n - 1) * total;
    else if (x === p) add[x] = total;
    else add[x] = -total;
  }
  for (const x of s.seats) s.score[x] += add[x];
  const res: HandResult = { taker: t, partner: p, contract: s.contract!, pts: halfPts / 2, need, oudlers, won, lines, add };
  s.last = res;
  ev.push({ type: 'hand', res, score: s.score.slice() });
  if (s.deal >= deals(s)) {
    s.over = true;
    s.phase = 'over';
    const best = Math.max(...s.seats.map((x) => s.score[x]));
    s.winner = s.seats.find((x) => s.score[x] === best)!;
    ev.push({ type: 'end', winner: s.winner, score: s.score.slice() });
    return { state: s, events: ev };
  }
  dealHand(s, rng, ev);
  return { state: s, events: ev };
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const see = (x: number) => seats === 'all' || seats.includes(x);
  const takerSees = s.taker != null && see(s.taker);
  return {
    ...s,
    hands: s.hands.map((h, i) => (h ? (see(i) ? h.slice() : []) : h)),
    chien: seats === 'all' ? s.chien.slice() : [],
    ecart: seats === 'all' || (takerSees && s.contract! <= 2) ? s.ecart.slice() : [],
    // тайный напарник: знает он сам, остальные — когда сыгран названный король
    partner: seats === 'all' || s.partnerShown || (s.partner != null && see(s.partner)) ? s.partner : null,
    counts: s.hands.map((h) => (h ? h.length : 0)),
  };
}

export const countOf = (s: State | View, seat: number) => ('counts' in s ? (s as View).counts[seat] : s.hands[seat].length);
