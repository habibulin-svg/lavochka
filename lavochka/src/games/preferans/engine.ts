/* Преферанс — правила (без DOM). Записи: «Сочи», «Ленинград», «Ростов», «Классика» (бомбы, пас втёмную), «Скачки»;
 * соглашения — настройками (по «Кодексу преферанса» 1996 г. и описаниям разновидностей). Колода 32 карты (7…Т), трое (вчетвером сдающий не играет).
 *
 * По 10 карт, 2 — прикуп. Торговля: 6♠ < 6♣ < 6♦ < 6♥ < 6БК < 7♠ … < 8БК < мизер < 9♠ … < 10БК; кто спасовал — больше не торгуется.
 * Мизер можно заявить только первым своим словом. Все спасовали — распасы. После распасов подряд торговля начинается не ниже «выхода»
 * (последовательность 6-7-7, 6-7-8-8 …: после N распасов подряд — N-й член, последний повторяется, у 6-7-8-6-7-8 — по кругу).
 * Взявший игру берёт прикуп (его видят все), сносит две карты и заказывает игру не ниже своей ставки (или сдаёт её «без трёх/двух», если можно).
 * Вист: первый вистующий — «вист»/«пас», второй — ещё и «полвиста» (на 6 и 7, если первый спасовал); спасовавший может «вернуть вист».
 * Оба спасовали — игра сыграна; полвиста устояло — тоже, а ушедший за полвиста пишет половину обязательных взяток.
 * Один вистует — сам решает: в светлую (карты обоих вистующих открыты, ходит за обоих он) или втёмную.
 * «Сталинград»: на 6♠ вистуют оба обязательно. Десятерная «проверяется»: вистующие играют в открытую без ответственности.
 * Мизер: ловящие открывают карты (до первого хода или после первой взятки — «первый ход втёмную»).
 * Распасы: каждый старается взять меньше; первые две взятки заходят картами прикупа (в «Ростове» прикуп не участвует).
 *
 * Запись: пуля (6 — 2, 7 — 4, 8 — 6, 9 — 8, 10 — 10, мизер — 10), гора (штраф), висты (на других игроков).
 * Обязательные взятки вистующих: на 6 — 4, на 7 — 2, на 8–10 — 1. Вистующий пишет цену игры за взятку (в «Ленинграде» вдвое).
 * Недобор заказчика — в гору цену за каждую недобранную; остальные пишут консоляцию (в «Ростове» — 10 за взятку, в «Скачках» и «Ленинграде» — вдвое).
 * Недовист — ответственный (полная цена) или полуответственный (половина); двое вистующих на 6–7 отвечают каждый за половину, на 8–10 — второй.
 * Жлобский вист: при одном вистующем все висты — ему; джентльменский: при подсаде заказчика висты пополам с пасовавшим.
 * Распасы: взятка — в гору (цена 1 или 2, с прогрессией), ни одной — цена взятки в пулю; «Ростов»: взявший меньше всех пишет по 5 вистов
 * за каждую взятку остальных. Пуля переполнена — помощь (висты 10 за очко); в «Ленинграде» помощи нет: перебор и недобор пули — гора вдвойне.
 * «Классика»: перед игрой — обязательные распасы (каждому бомба), первая рука может спасовать втёмную (распасы вдвое, ему бомба, перебить —
 * только семерной, повторно — восьмерной); бомба удваивает (учетверяет …) всю запись его следующей игры, сгорает, когда игра сыграна.
 * «Скачки»: 4 скака до 22 в пуле; в начале скака — распасы по 2; первый набравший 22 пишет по 300 с каждого, меньшая гора скака — по 200;
 * в конце за самую большую пулю — ещё по 300, за самую маленькую гору — по 200.
 * Итог: висты на других минус висты на тебя плюс разница горы (гора — по 10 вистов за очко, делится между всеми).
 */
import type { Options, Rng } from '../../core/types';
import { sameCard, type Card, type Suit } from '../../cards/deck';

export type Variant = 'sochi' | 'leningrad' | 'rostov' | 'classic' | 'skachki';
export type Trump = Suit | 'NT';
export type ExitSeq = '666' | '677' | '6788' | '678678';

export interface Cfg {
  variant: Variant;
  /** Пуля — до скольких (в «Скачках» — до скольких скак). */
  pulya: number;
  /** Жлобский вист (иначе джентльменский). */
  greedy: boolean;
  /** Ответственный вист (иначе полуответственный). */
  resp: boolean;
  /** «Полвиста» на шестерной и семерной. */
  halfWhist: boolean;
  /** Десятерная проверяется (иначе вистуется). */
  tenCheck: boolean;
  /** «Сталинград»: 6♠ вистуется обоими обязательно. */
  stalingrad: boolean;
  /** Первый ход втёмную: карты открывают после первой взятки (иначе — до первого хода). */
  darkLead: boolean;
  /** Сдать игру без розыгрыша: 0 — нельзя, 2 / 3 — «без двух» / «без трёх». */
  concede: 0 | 2 | 3;
  /** Выход из распасов. */
  exit: ExitSeq;
  /** Выход подсадом: несыгранная игра тоже выводит из распасов. */
  exitByFail: boolean;
  /** Переход сдачи после распасов (иначе сдаёт тот же). */
  slide: boolean;
  /** Цена взятки на распасах. */
  raspPrice: 1 | 2;
  /** Прогрессия распасов. */
  prog: 'none' | 'arith' | 'geom';
  /** Прикуп на распасах задаёт масть первых двух взяток. */
  raspPrikup: boolean;
  /** Платный прикуп: за тузы и марьяж в прикупе сдающий пишет висты на заказчика. */
  paidPrikup: boolean;
  /** «Классика»: пас втёмную первой руки. */
  darkPass: boolean;
  /** «Классика»: кругов обязательных распасов перед игрой. */
  opening: number;
}

export const SKAKS = 4;

const pick = <T>(v: unknown, list: readonly T[], def: T): T => (list.includes(v as T) ? (v as T) : def);
const flag = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);

/** Настройки из выбранных опций; чего нет — по умолчанию для записи (так подхватываются и старые сохранения). */
export function cfgFrom(o: Options): Cfg {
  const variant = pick(o.variant, ['sochi', 'leningrad', 'rostov', 'classic', 'skachki'] as const, 'sochi');
  const d = VARIANT_DEFAULTS[variant];
  return {
    variant,
    pulya: variant === 'skachki' ? 22 : pick(Number(o.pulya), [10, 20, 30, 50], 10),
    greedy: o.whistStyle == null ? d.greedy : o.whistStyle !== 'gentle',
    resp: o.resp == null ? d.resp : o.resp !== 'half',
    halfWhist: flag(o.halfWhist, d.halfWhist),
    tenCheck: o.ten == null ? d.tenCheck : o.ten === 'check',
    stalingrad: flag(o.stalingrad, d.stalingrad),
    darkLead: o.lead == null ? d.darkLead : o.lead === 'dark',
    concede: pick(Number(o.concede), [0, 2, 3] as const, d.concede),
    exit: pick(String(o.exit), ['666', '677', '6788', '678678'] as const, d.exit),
    exitByFail: flag(o.exitByFail, d.exitByFail),
    slide: flag(o.slide, d.slide),
    raspPrice: pick(Number(o.raspPrice), [1, 2] as const, d.raspPrice),
    prog: pick(o.prog, ['none', 'arith', 'geom'] as const, d.prog),
    raspPrikup: variant === 'rostov' ? false : flag(o.raspPrikup, d.raspPrikup),
    paidPrikup: flag(o.paidPrikup, d.paidPrikup),
    darkPass: variant === 'classic' && flag(o.darkPass, d.darkPass),
    opening: variant === 'classic' ? pick(Number(o.opening), [0, 1, 2], d.opening) : 0,
  };
}

/** Соглашения, обычные для каждой записи (они же — умолчания пресетов). */
export const VARIANT_DEFAULTS: Record<Variant, Omit<Cfg, 'variant' | 'pulya'>> = {
  sochi: { greedy: true, resp: true, halfWhist: true, tenCheck: false, stalingrad: false, darkLead: false, concede: 0, exit: '666', exitByFail: true, slide: true, raspPrice: 1, prog: 'none', raspPrikup: true, paidPrikup: false, darkPass: false, opening: 0 },
  leningrad: { greedy: false, resp: false, halfWhist: true, tenCheck: false, stalingrad: false, darkLead: false, concede: 0, exit: '6788', exitByFail: true, slide: true, raspPrice: 2, prog: 'arith', raspPrikup: true, paidPrikup: false, darkPass: false, opening: 0 },
  rostov: { greedy: true, resp: false, halfWhist: true, tenCheck: false, stalingrad: false, darkLead: false, concede: 0, exit: '666', exitByFail: true, slide: true, raspPrice: 1, prog: 'none', raspPrikup: false, paidPrikup: true, darkPass: false, opening: 0 },
  classic: { greedy: true, resp: false, halfWhist: false, tenCheck: false, stalingrad: true, darkLead: true, concede: 0, exit: '677', exitByFail: false, slide: false, raspPrice: 1, prog: 'arith', raspPrikup: true, paidPrikup: false, darkPass: true, opening: 1 },
  skachki: { greedy: true, resp: true, halfWhist: true, tenCheck: false, stalingrad: false, darkLead: false, concede: 0, exit: '666', exitByFail: true, slide: true, raspPrice: 1, prog: 'none', raspPrikup: true, paidPrikup: false, darkPass: false, opening: 0 },
};

/** Ставка: уровень 6–10 и масть, или мизер. */
export type Bid = { level: number; trump: Trump } | { misere: true };

export const BID_SUITS: Trump[] = ['S', 'C', 'D', 'H', 'NT'];
export const VALUE: Record<number, number> = { 6: 2, 7: 4, 8: 6, 9: 8, 10: 10 };
export const MISERE_VALUE = 10;
/** Сколько взяток должны взять вистующие вместе. */
export const DUTY: Record<number, number> = { 6: 4, 7: 2, 8: 1, 9: 1, 10: 1 };
export const RANKS = [7, 8, 9, 10, 11, 12, 13, 14];

const isMis = (b: Bid): b is { misere: true } => 'misere' in b;
export const isMisere = isMis;

/** Номер ставки для сравнения: 6♠ = 0 … 8БК = 14, мизер = 14.5, 9♠ = 15 … 10БК = 24. */
export function bidRank(b: Bid): number {
  if (isMis(b)) return 14.5;
  return (b.level - 6) * 5 + BID_SUITS.indexOf(b.trump);
}

export function allBids(): Bid[] {
  const out: Bid[] = [];
  for (let l = 6; l <= 10; l++) {
    for (const t of BID_SUITS) out.push({ level: l, trump: t });
    if (l === 8) out.push({ misere: true });
  }
  return out;
}

export const sameBid = (a: Bid, b: Bid) => bidRank(a) === bidRank(b);

export interface Trick {
  leader: number;
  cards: { seat: number; card: Card }[];
  /** Распасы: карта прикупа, задающая масть. */
  prikup?: Card;
}

export type Phase = 'dark' | 'bid' | 'discard' | 'contract' | 'whist' | 'play' | 'over';
/** Шаг виста: первый, второй, возврат виста после «полвиста», выбор одиночного вистующего (в светлую / втёмную). */
export type WhistStep = 'd1' | 'd2' | 'return' | 'choose';
export type WhistMark = 'whist' | 'pass' | 'half';

export interface State {
  cfg: Cfg;
  seats: number[];
  players: number[];
  dealer: number;
  hands: Card[][];
  prikup: Card[];
  /** Снос (видит только заказчик). */
  discard: Card[];
  phase: Phase;
  turn: number;
  /** Торговля. */
  bid: Bid | null;
  bidder: number;
  /** Кто уже говорил что-то кроме паса (для мизера). */
  spoke: number[];
  passed: number[];
  /** Игра: заказ или распасы. */
  kind: 'game' | 'misere' | 'raspasy' | null;
  contract: Bid | null;
  declarer: number;
  /** Решения вистующих. */
  whist: Record<number, WhistMark>;
  wstep: WhistStep | null;
  /** Кто сказал вист первым, вторым (на 8–10 за недовист отвечает второй). */
  whistOrder: number[];
  /** Вист уже возвращали (второй раз уйти за полвиста нельзя). */
  wback: boolean;
  /** Игра в светлую: карты этого пасующего открыты, за него ходит вистующий. */
  open: number | null;
  /** Десятерная «проверяется»: вистующие играют в открытую без ответственности. */
  check: boolean;
  trump: Trump | null;
  trick: Trick | null;
  lastTrick: Trick | null;
  tricks: number[];
  tricksPlayed: number;
  /** Распасов подряд (без выхода): прогрессия и выход. */
  raspasyRun: number;
  /** Обязательные распасы (без торговли): в начале «Классики» и скака. */
  forced: boolean;
  /** Сколько ещё обязательных распасов «Классики». */
  openingLeft: number;
  /** Пас втёмную в этой сдаче (место) и сколько распасов втёмную было подряд до неё. */
  darkSeat: number | null;
  darkRun: number;
  /** Бомбы «Классики»: множители по порядку. */
  bombs: number[][];
  pulya: number[];
  gora: number[];
  /** whists[a][b] — висты игрока a на игрока b. */
  whists: number[][];
  /** «Скачки»: номер скака, кто первым набрал пулю скака, итоги прошлых скаков. */
  skak: number;
  skFirst: number[] | null;
  totPulya: number[];
  totGora: number[];
  round: number;
  /** Итоговые очки в вистах (после закрытия пули). */
  final: number[] | null;
}

export interface View extends State {
  counts: number[];
  me: number[];
}

export type Action =
  | { type: 'dark-pass' }
  | { type: 'look' }
  | { type: 'bid'; bid: Bid }
  | { type: 'pass' }
  | { type: 'discard'; cards: Card[] }
  | { type: 'contract'; bid: Bid }
  | { type: 'concede' }
  | { type: 'whist' }
  | { type: 'pass-whist' }
  | { type: 'half-whist' }
  | { type: 'show'; open: boolean }
  | { type: 'play'; card: Card };

export type ScoreKind = 'game' | 'misere' | 'raspasy' | 'free' | 'half' | 'concede';

export type Event =
  | { type: 'deal'; round: number; dealer: number; counts: number[]; hands?: Card[][] }
  | { type: 'dark'; seat: number; dark: boolean }
  | { type: 'bid'; seat: number; bid: Bid }
  | { type: 'pass'; seat: number }
  | { type: 'prikup'; seat: number; cards: Card[] }
  | { type: 'raspasy'; forced?: boolean }
  | { type: 'discard'; seat: number; cards?: Card[] }
  | { type: 'contract'; seat: number; bid: Bid }
  | { type: 'whist'; seat: number; whist: boolean; half?: boolean; back?: boolean; forced?: boolean }
  | { type: 'show'; seat: number; open: boolean }
  | { type: 'open'; seat: number; cards: Card[] }
  | { type: 'play'; seat: number; card: Card }
  | { type: 'trick'; winner: number; prikup?: Card }
  | {
      type: 'score';
      kind: ScoreKind;
      players: number[];
      declarer: number;
      contract: Bid | null;
      tricks: number[];
      made: boolean;
      pulya: number[];
      gora: number[];
      whists: number[][];
      notes: string[];
      /** Множитель бомбы / распасов. */
      mult?: number;
    }
  | { type: 'skak'; skak: number; first: number[]; lowGora: number[] }
  | { type: 'end'; final: number[] };

// ---------------------------------------------------------------- карты

export function makeDeck32(): Card[] {
  const out: Card[] = [];
  for (const s of ['S', 'C', 'D', 'H'] as Suit[]) for (const r of RANKS) out.push({ s, r });
  return out;
}

export const has = (h: Card[], c: Card) => h.some((x) => sameCard(x, c));
const nextIn = (list: number[], seat: number) => list[(list.indexOf(seat) + 1) % list.length];

export function legalCards(s: Pick<State, 'trick' | 'trump' | 'hands'>, seat: number): Card[] {
  const hand = s.hands[seat];
  const t = s.trick;
  const lead = t ? (t.cards.length ? t.cards[0].card.s : t.prikup?.s) : undefined;
  if (!lead) return hand.slice();
  const follow = hand.filter((c) => c.s === lead);
  if (follow.length) return follow;
  if (s.trump && s.trump !== 'NT') {
    const tr = hand.filter((c) => c.s === s.trump);
    if (tr.length) return tr;
  }
  return hand.slice();
}

export function trickWinner(t: Trick, trump: Trump | null): number {
  const lead = t.cards.length ? (t.prikup ? t.prikup.s : t.cards[0].card.s) : t.prikup!.s;
  let best: { seat: number; card: Card } | null = null;
  for (const x of t.cards) {
    const c = x.card;
    if (!best) {
      if (c.s === lead || (trump && trump !== 'NT' && c.s === trump)) best = x;
      continue;
    }
    const b = best.card;
    const tr = trump && trump !== 'NT' ? trump : null;
    const better = c.s === b.s ? c.r > b.r : tr != null && c.s === tr && b.s !== tr;
    if (better) best = x;
  }
  // распасы: в масть прикупа не пошёл никто — взятка заходившему
  return best ? best.seat : t.leader;
}

// ---------------------------------------------------------------- выход, прогрессия, бомбы

const EXIT: Record<ExitSeq, number[]> = { '666': [6], '677': [6, 7, 7], '6788': [6, 7, 8, 8], '678678': [6, 7, 8] };

/** С какого уровня можно торговаться в этой сдаче (выход из распасов, пас втёмную). */
export function minLevel(s: Pick<State, 'cfg' | 'raspasyRun' | 'darkSeat' | 'darkRun'>): number {
  const seq = EXIT[s.cfg.exit];
  const k = s.raspasyRun;
  let lv = s.cfg.exit === '678678' ? seq[k % 3] : seq[Math.min(k, seq.length - 1)];
  if (s.darkSeat != null) lv = Math.max(lv, Math.min(8, 7 + s.darkRun));
  return lv;
}

/** Ставка допустима по уровню (мизер — между 8 и 9). */
export const levelOk = (b: Bid, min: number) => (isMis(b) ? min <= 8 : b.level >= min);

/** Множитель прогрессии для n-х распасов подряд (n = 1, 2, …), предел — три шага. */
export function progMult(cfg: Cfg, n: number): number {
  const k = Math.min(Math.max(1, n), 3);
  return cfg.prog === 'arith' ? k : cfg.prog === 'geom' ? 2 ** (k - 1) : 1;
}

/** Платный прикуп: туз — 1, туз и король одной масти — 2, два туза — 3, марьяж — 1. */
export function prikupUnits(p: Card[]): number {
  const aces = p.filter((c) => c.r === 14).length;
  if (aces >= 2) return 3;
  const same = p.length === 2 && p[0].s === p[1].s;
  if (aces === 1) return same && p.some((c) => c.r === 13) ? 2 : 1;
  if (same && p.some((c) => c.r === 13) && p.some((c) => c.r === 12)) return 1;
  return 0;
}

// ---------------------------------------------------------------- партия

export function newState(cfg: Cfg, seats: number[]): State {
  return {
    cfg,
    seats: seats.slice(),
    players: [],
    dealer: seats[seats.length - 1],
    hands: [[], [], [], []],
    prikup: [],
    discard: [],
    phase: 'bid',
    turn: seats[0],
    bid: null,
    bidder: -1,
    spoke: [],
    passed: [],
    kind: null,
    contract: null,
    declarer: -1,
    whist: {},
    wstep: null,
    whistOrder: [],
    wback: false,
    open: null,
    check: false,
    trump: null,
    trick: null,
    lastTrick: null,
    tricks: [0, 0, 0, 0],
    tricksPlayed: 0,
    raspasyRun: 0,
    forced: false,
    openingLeft: cfg.opening * seats.length,
    darkSeat: null,
    darkRun: 0,
    bombs: [[], [], [], []],
    pulya: [0, 0, 0, 0],
    gora: [0, 0, 0, 0],
    whists: [0, 1, 2, 3].map(() => [0, 0, 0, 0]),
    skak: 1,
    skFirst: null,
    totPulya: [0, 0, 0, 0],
    totGora: [0, 0, 0, 0],
    round: 0,
    final: null,
  };
}

/** Сохранённая партия старой версии: настройки и новые поля — по умолчанию. */
function migrate(s: State): State {
  if (s.cfg.exit && s.bombs && s.totPulya) return s;
  const cfg = cfgFrom(s.cfg as unknown as Options);
  return {
    ...newState(cfg, s.seats),
    ...s,
    cfg,
    whist: Object.fromEntries(Object.entries(s.whist ?? {})) as Record<number, WhistMark>,
    wstep: s.wstep ?? (s.phase === 'whist' ? 'd1' : null),
    whistOrder: s.whistOrder ?? [],
    wback: !!s.wback,
    check: !!s.check,
    forced: !!s.forced,
    openingLeft: s.openingLeft ?? 0,
    darkSeat: s.darkSeat ?? null,
    darkRun: s.darkRun ?? 0,
    bombs: s.bombs ?? [[], [], [], []],
    skak: s.skak ?? 1,
    skFirst: s.skFirst ?? null,
    totPulya: s.totPulya ?? [0, 0, 0, 0],
    totGora: s.totGora ?? [0, 0, 0, 0],
  };
}

function shuffle<T>(a: T[], rng: Rng): T[] {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

export function deal(s0: State, rng: Rng): { state: State; events: Event[] } {
  // после распасов без «перехода сдачи» сдаёт тот же
  const keep = s0.round > 0 && s0.kind === 'raspasy' && !s0.cfg.slide;
  const dealer = s0.round === 0 ? s0.seats[s0.seats.length - 1] : keep ? s0.dealer : nextIn(s0.seats, s0.dealer);
  const players = s0.seats.length === 4 ? s0.seats.filter((x) => x !== dealer) : s0.seats.slice();
  const deck = shuffle(makeDeck32(), rng);
  const hands: Card[][] = [[], [], [], []];
  for (const p of players) hands[p] = deck.splice(0, 10);
  const first = s0.seats.length === 4 ? nextIn(s0.seats, dealer) : nextIn(players, dealer);
  // обязательные распасы: в начале «Классики» и каждого скака
  const forced = s0.openingLeft > 0 || (s0.cfg.variant === 'skachki' && s0.pulya.every((x) => x === 0) && s0.gora.every((x) => x === 0) && s0.skFirst == null);
  const s: State = {
    ...s0,
    dealer,
    players,
    hands,
    prikup: deck.splice(0, 2),
    discard: [],
    phase: s0.cfg.darkPass && !forced ? 'dark' : 'bid',
    turn: first,
    bid: null,
    bidder: -1,
    spoke: [],
    passed: [],
    kind: null,
    contract: null,
    declarer: -1,
    whist: {},
    wstep: null,
    whistOrder: [],
    wback: false,
    open: null,
    check: false,
    trump: null,
    trick: null,
    lastTrick: null,
    tricks: [0, 0, 0, 0],
    tricksPlayed: 0,
    forced,
    darkSeat: null,
    round: s0.round + 1,
  };
  const ev: Event[] = [{ type: 'deal', round: s.round, dealer, counts: hands.map((h) => h.length), hands: hands.map((h) => h.slice()) }];
  if (forced) startRaspasy(s, ev);
  return { state: s, events: ev };
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  return deal(newState(cfgFrom(opts), seats), rng).state;
}

/** Кто действует: при игре в светлую за открытого пасующего ходит вистующий. */
export function toAct(raw: State): number[] {
  const s = migrate(raw);
  if (s.phase === 'over') return [];
  if (s.phase === 'play' && s.open != null && s.turn === s.open && opened(s)) {
    const w = s.players.find((x) => s.whist[x] === 'whist');
    return w != null ? [w] : [s.turn];
  }
  return [s.turn];
}

/** Первая рука — следующий за сдающим среди играющих. */
const firstHand = (s: State) => (s.seats.length === 4 ? nextIn(s.seats, s.dealer) : nextIn(s.players, s.dealer));

/** Вистующие по порядку хода: первый — следующий за заказчиком. */
const defenders = (s: State) => {
  const d1 = nextIn(s.players, s.declarer);
  return [d1, nextIn(s.players, d1)];
};

/** Открыты ли уже карты (в светлую, на мизере, при проверке десятерной). */
function opened(s: State): boolean {
  if (s.phase !== 'play') return false;
  if (s.check) return true;
  if (s.open != null) return !s.cfg.darkLead || s.tricksPlayed >= 1;
  if (s.kind === 'misere') {
    if (s.cfg.darkLead) return s.tricksPlayed >= 1;
    // по Кодексу: при ходе ловящих — до первого хода, при ходе мизериста — после его первой карты
    return s.tricksPlayed >= 1 || firstHand(s) !== s.declarer || (s.trick?.cards.length ?? 0) > 0;
  }
  return false;
}

/** Чьи карты видят все. */
function publicSeats(s: State): number[] {
  if (!opened(s)) return [];
  if (s.kind === 'misere' || s.check || s.open != null) return s.players.filter((x) => x !== s.declarer);
  return [];
}

function nextBidder(s: State, seat: number): number {
  let x = seat;
  for (let i = 0; i < 4; i++) {
    x = nextIn(s.players, x);
    if (!s.passed.includes(x)) return x;
  }
  return seat;
}

function startRaspasy(s: State, ev: Event[]) {
  s.kind = 'raspasy';
  s.contract = null;
  s.declarer = -1;
  s.trump = null;
  s.phase = 'play';
  const lead = firstHand(s);
  s.trick = s.cfg.raspPrikup ? { leader: lead, cards: [], prikup: s.prikup[0] } : null;
  s.turn = lead;
  ev.push({ type: 'raspasy', forced: s.forced || undefined });
}

const halfOk = (s: State) => s.cfg.halfWhist && s.contract != null && !isMis(s.contract) && s.contract.level <= 7;
const stalin = (s: State) => s.cfg.stalingrad && s.contract != null && !isMis(s.contract) && s.contract.level === 6 && s.contract.trump === 'S';

export function apply(raw: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  const s0 = migrate(raw);
  if (s0.phase === 'over' || !a || typeof a !== 'object') return null;
  // за открытого пасующего ходит вистующий
  const actor = toAct(s0)[0];
  if (seat !== actor) return null;
  const who = s0.turn;
  const ev: Event[] = [];
  const s: State = { ...s0, hands: s0.hands.slice(), passed: s0.passed.slice(), spoke: s0.spoke.slice(), tricks: s0.tricks.slice(), whist: { ...s0.whist }, whistOrder: s0.whistOrder.slice() };
  switch (s0.phase) {
    case 'dark': {
      if (a.type !== 'dark-pass' && a.type !== 'look') return null;
      s.phase = 'bid';
      ev.push({ type: 'dark', seat: who, dark: a.type === 'dark-pass' });
      if (a.type === 'dark-pass') {
        s.darkSeat = who;
        s.passed.push(who);
        s.turn = nextBidder(s, who);
      }
      return { state: s, events: ev };
    }
    case 'bid': {
      if (a.type === 'bid') {
        const b = a.bid;
        if (!b || (isMis(b) ? false : !(b.level >= 6 && b.level <= 10 && BID_SUITS.includes(b.trump)))) return null;
        if (s.bid && bidRank(b) <= bidRank(s.bid)) return null;
        if (!levelOk(b, minLevel(s))) return null;
        if (isMis(b) && s.spoke.includes(who)) return null;
        s.bid = b;
        s.bidder = who;
        if (!s.spoke.includes(who)) s.spoke.push(who);
        ev.push({ type: 'bid', seat: who, bid: b });
      } else if (a.type === 'pass') {
        s.passed.push(who);
        ev.push({ type: 'pass', seat: who });
      } else return null;
      const left = s.players.filter((x) => !s.passed.includes(x));
      if (!left.length || (left.length === 1 && s.bid && left[0] === s.bidder)) {
        if (!s.bid) startRaspasy(s, ev);
        else {
          // игра — заказчику: прикуп ему в руку
          s.declarer = s.bidder;
          s.kind = isMis(s.bid) ? 'misere' : 'game';
          ev.push({ type: 'prikup', seat: s.declarer, cards: s.prikup.slice() });
          s.hands[s.declarer] = [...s.hands[s.declarer], ...s.prikup];
          s.phase = 'discard';
          s.turn = s.declarer;
        }
      } else if (left.length === 1 && !s.bid) {
        // остался один, а ставок не было — он ещё может сказать или спасовать (тогда распасы)
        s.turn = left[0];
      } else s.turn = nextBidder(s, who);
      return { state: s, events: ev };
    }
    case 'discard': {
      if (a.type !== 'discard' || !Array.isArray(a.cards) || a.cards.length !== 2 || sameCard(a.cards[0], a.cards[1])) return null;
      const hand = s.hands[who];
      if (!a.cards.every((c) => has(hand, c))) return null;
      s.hands[who] = hand.filter((c) => !a.cards.some((x) => sameCard(x, c)));
      s.discard = a.cards.slice();
      ev.push({ type: 'discard', seat: who, cards: a.cards.slice() });
      if (s.kind === 'misere') {
        s.contract = { misere: true };
        s.trump = null;
        beginPlay(s, ev);
      } else s.phase = 'contract';
      return { state: s, events: ev };
    }
    case 'contract': {
      if (a.type === 'concede') {
        if (!s.cfg.concede) return null;
        return scoreRound(s, ev, rng, 'concede');
      }
      if (a.type !== 'contract' || !a.bid || isMis(a.bid) || bidRank(a.bid) < bidRank(s.bid!) || !BID_SUITS.includes(a.bid.trump)) return null;
      s.contract = a.bid;
      s.trump = a.bid.trump;
      ev.push({ type: 'contract', seat: who, bid: a.bid });
      const [d1, d2] = defenders(s);
      if (a.bid.level === 10 && s.cfg.tenCheck) {
        // десятерная проверяется: оба «вистуют» в открытую без ответственности
        s.check = true;
        s.whist = { [d1]: 'whist', [d2]: 'whist' };
        s.whistOrder = [d1, d2];
        beginPlay(s, ev);
        return { state: s, events: ev };
      }
      if (stalin(s)) {
        // Сталинград: вистуют оба
        s.whist = { [d1]: 'whist', [d2]: 'whist' };
        s.whistOrder = [d1, d2];
        ev.push({ type: 'whist', seat: d1, whist: true, forced: true }, { type: 'whist', seat: d2, whist: true, forced: true });
        beginPlay(s, ev);
        return { state: s, events: ev };
      }
      s.phase = 'whist';
      s.wstep = 'd1';
      s.turn = d1;
      return { state: s, events: ev };
    }
    case 'whist':
      return whistStep(s, who, a, ev, rng);
    case 'play': {
      if (a.type !== 'play' || !has(s.hands[who], a.card) || !legalCards(s, who).some((c) => sameCard(c, a.card))) return null;
      const before = publicSeats(s0);
      s.hands[who] = s.hands[who].filter((c) => !sameCard(c, a.card));
      const t: Trick = s.trick ? { ...s.trick, cards: s.trick.cards.slice() } : { leader: who, cards: [] };
      t.cards.push({ seat: who, card: a.card });
      ev.push({ type: 'play', seat: who, card: a.card });
      if (t.cards.length < s.players.length) {
        s.trick = t;
        s.turn = nextIn(s.players, who);
        openEvents(s, before, ev);
        return { state: s, events: ev };
      }
      const w = trickWinner(t, s.trump);
      s.tricks[w]++;
      s.tricksPlayed++;
      s.lastTrick = t;
      ev.push({ type: 'trick', winner: w, prikup: t.prikup });
      if (!s.hands[w].length) return scoreRound(s, ev, rng, 'play');
      // распасы: вторая взятка тоже заходит прикупом
      if (s.kind === 'raspasy' && s.tricksPlayed === 1 && s.cfg.raspPrikup) {
        s.trick = { leader: firstHand(s), cards: [], prikup: s.prikup[1] };
        s.turn = firstHand(s);
      } else {
        s.trick = null;
        s.turn = w;
      }
      openEvents(s, before, ev);
      return { state: s, events: ev };
    }
  }
  return null;
}

/** Карты, которые только что открылись, — событием (их видят все). */
function openEvents(s: State, before: number[], ev: Event[]) {
  for (const x of publicSeats(s)) if (!before.includes(x)) ev.push({ type: 'open', seat: x, cards: s.hands[x].slice() });
}

function whistStep(s: State, who: number, a: Action, ev: Event[], rng: Rng): { state: State; events: Event[] } | null {
  const [d1, d2] = defenders(s);
  const other = who === d1 ? d2 : d1;
  const mark = (x: number, m: WhistMark) => {
    s.whist[x] = m;
    if (m === 'whist' && !s.whistOrder.includes(x)) s.whistOrder.push(x);
    if (m !== 'whist') s.whistOrder = s.whistOrder.filter((y) => y !== x);
  };
  switch (s.wstep) {
    case 'd1':
    case 'd2': {
      if (a.type === 'whist' || a.type === 'pass-whist') mark(who, a.type === 'whist' ? 'whist' : 'pass');
      else if (a.type === 'half-whist' && s.wstep === 'd2' && halfOk(s) && s.whist[d1] === 'pass') mark(who, 'half');
      else return null;
      ev.push({ type: 'whist', seat: who, whist: a.type === 'whist', half: a.type === 'half-whist' || undefined });
      if (s.wstep === 'd1') {
        s.wstep = 'd2';
        s.turn = d2;
        return { state: s, events: ev };
      }
      if (s.whist[d2] === 'half') {
        // спасовавший может вернуть вист
        s.wstep = 'return';
        s.turn = d1;
        return { state: s, events: ev };
      }
      return resolveWhist(s, ev, rng);
    }
    case 'return': {
      const halfer = other;
      if (a.type === 'whist') {
        mark(who, 'whist');
        mark(halfer, 'pass');
        s.wback = true;
        ev.push({ type: 'whist', seat: who, whist: true, back: true });
        s.wstep = 'choose';
        return { state: s, events: ev };
      }
      if (a.type !== 'pass-whist') return null;
      ev.push({ type: 'whist', seat: who, whist: false });
      return scoreRound(s, ev, rng, 'half');
    }
    case 'choose': {
      if (a.type === 'show') {
        if (a.open) {
          s.open = other;
          ev.push({ type: 'show', seat: who, open: true });
        } else ev.push({ type: 'show', seat: who, open: false });
        beginPlay(s, ev);
        return { state: s, events: ev };
      }
      // джентльменский вист: первый вистующий может уйти за полвиста, если второй спасовал
      if (a.type === 'half-whist' && !s.cfg.greedy && halfOk(s) && who === d1 && s.whist[d2] === 'pass' && !s.wback) {
        mark(who, 'half');
        ev.push({ type: 'whist', seat: who, whist: false, half: true });
        s.wstep = 'return';
        s.turn = d2;
        return { state: s, events: ev };
      }
      return null;
    }
  }
  return null;
}

function resolveWhist(s: State, ev: Event[], rng: Rng): { state: State; events: Event[] } {
  const ws = s.players.filter((x) => s.whist[x] === 'whist');
  if (!ws.length) return scoreRound(s, ev, rng, 'free');
  if (ws.length === 1) {
    // одиночный вистующий решает: в светлую или втёмную
    s.wstep = 'choose';
    s.turn = ws[0];
    return { state: s, events: ev };
  }
  beginPlay(s, ev);
  return { state: s, events: ev };
}

function beginPlay(s: State, ev: Event[]) {
  s.phase = 'play';
  s.wstep = null;
  s.trick = null;
  // заходит первая рука
  s.turn = firstHand(s);
  openEvents(s, [], ev);
}

/** Пуля переполнена — лишнее закрывает пулю другим, а за помощь пишутся висты. В «Ленинграде» и «Скачках» помощи нет. */
function addPulya(s: State, p: number, v: number, notes: string[]) {
  const limit = s.cfg.pulya;
  if (s.cfg.variant === 'leningrad' || s.cfg.variant === 'skachki') {
    s.pulya[p] += v;
    return;
  }
  const room = limit - s.pulya[p];
  if (v <= room) {
    s.pulya[p] += v;
    return;
  }
  s.pulya[p] = limit;
  let extra = v - Math.max(0, room);
  const others = s.seats.filter((x) => x !== p).sort((a, b) => s.pulya[b] - s.pulya[a]);
  for (const o of others) {
    if (extra <= 0) break;
    const r = limit - s.pulya[o];
    if (r <= 0) continue;
    const give = Math.min(r, extra);
    s.pulya[o] += give;
    s.whists[p][o] += give * 10;
    extra -= give;
    notes.push(`help:${p}:${o}:${give}`);
  }
  // закрывать некому — остаток списывает гору
  if (extra > 0) s.gora[p] -= extra;
}

/** Цена взятки вистующего: в «Ленинграде» вдвое. */
const whistK = (cfg: Cfg) => (cfg.variant === 'leningrad' ? 2 : 1);
/** Консоляция за недобранную взятку. */
const consolation = (cfg: Cfg, val: number) => (cfg.variant === 'rostov' ? 10 : cfg.variant === 'leningrad' || cfg.variant === 'skachki' ? 2 * val : val);

function scoreRound(s0: State, ev: Event[], rng: Rng, how: 'play' | 'free' | 'half' | 'concede'): { state: State; events: Event[] } {
  const s: State = { ...s0, pulya: s0.pulya.slice(), gora: s0.gora.slice(), whists: s0.whists.map((r) => r.slice()), bombs: s0.bombs.map((b) => b.slice()) };
  const notes: string[] = [];
  const cfg = s.cfg;
  let made = true;
  let mult = 1;
  let kind: ScoreKind;
  /** Выход из распасов состоялся. */
  let exit = true;
  if (s.kind === 'raspasy') {
    kind = 'raspasy';
    exit = false;
    const n = s.raspasyRun + 1;
    if (cfg.variant === 'rostov') {
      // распасы на висты: взявший меньше всех пишет по 5 за каждую взятку остальных
      const min = Math.min(...s.players.map((p) => s.tricks[p]));
      const low = s.players.filter((p) => s.tricks[p] === min);
      for (const q of s.players) if (!low.includes(q)) for (const x of low) s.whists[x][q] += (5 * s.tricks[q]) / low.length;
      for (const p of s.players) if (s.tricks[p] === 0) addPulya(s, p, 1, notes);
      if (s.seats.length === 4) addPulya(s, s.dealer, 1, notes);
    } else {
      const dark = s.darkSeat != null ? 2 ** (s.darkRun + 1) : 1;
      mult = cfg.raspPrice * progMult(cfg, n) * dark * (s.forced && cfg.variant === 'skachki' ? 2 : 1);
      for (const p of s.players) {
        if (s.tricks[p] === 0) addPulya(s, p, mult, notes);
        else s.gora[p] += s.tricks[p] * mult;
      }
    }
    // бомбы «Классики»: обязательные распасы — каждому, пас втёмную — пасовавшему
    if (cfg.variant === 'classic') {
      if (s.openingLeft > 0) for (const p of s.players) s.bombs[p].push(2);
      else if (s.darkSeat != null) s.bombs[s.darkSeat].push(Math.min(8, 2 ** (s.darkRun + 1)));
    }
    s.darkRun = s.darkSeat != null ? s0.darkRun + 1 : 0;
    if (s.openingLeft > 0) s.openingLeft--;
    s.raspasyRun = n;
  } else {
    const d = s.declarer;
    mult = s.bombs[d][0] ?? 1;
    const others = s.seats.filter((x) => x !== d);
    if (s.kind === 'misere') {
      kind = 'misere';
      made = s.tricks[d] === 0;
      if (made) addPulya(s, d, MISERE_VALUE * mult, notes);
      else s.gora[d] += MISERE_VALUE * s.tricks[d] * mult;
    } else if (how === 'concede') {
      // сдал без розыгрыша: «без трёх» («без двух») на игре, до которой доторговался; висты никто не пишет
      kind = 'concede';
      made = false;
      s.contract = s.bid;
      const lv = (s.bid as { level: number }).level;
      s.gora[d] += VALUE[lv] * cfg.concede * mult;
      notes.push(`concede:${cfg.concede}`);
    } else {
      const c = s.contract as { level: number; trump: Trump };
      const val = VALUE[c.level];
      const k = whistK(cfg) * mult;
      const [d1, d2] = defenders(s);
      const ws = [d1, d2].filter((x) => s.whist[x] === 'whist');
      if (how === 'free') {
        kind = 'free';
        addPulya(s, d, val * mult, notes);
      } else if (how === 'half') {
        // полвиста: игра сыграна, ушедший за полвиста пишет половину обязательных взяток
        kind = 'half';
        addPulya(s, d, val * mult, notes);
        const halfer = [d1, d2].find((x) => s.whist[x] === 'half')!;
        s.whists[halfer][d] += val * k * (DUTY[c.level] / 2);
      } else {
        kind = 'game';
        const got = s.tricks[d];
        made = got >= c.level;
        if (made) addPulya(s, d, val * mult, notes);
        else {
          const under = c.level - got;
          s.gora[d] += val * under * mult;
          // консоляция — все, кроме заказчика (и сдающий вчетвером)
          for (const x of others) s.whists[x][d] += consolation(cfg, val) * under * mult;
        }
        const total = s.tricks[d1] + s.tricks[d2];
        if (ws.length === 2) {
          for (const x of ws) s.whists[x][d] += val * k * s.tricks[x];
        } else if (ws.length === 1) {
          const w = ws[0];
          const pass = w === d1 ? d2 : d1;
          if (!made && !cfg.greedy) {
            // джентльменский: при подсаде висты пополам с пасовавшим
            s.whists[w][d] += (val * k * total) / 2;
            s.whists[pass][d] += (val * k * total) / 2;
          } else s.whists[w][d] += val * k * total;
        }
        // недовист (при проверке десятерной ответственности нет)
        const duty = DUTY[c.level];
        if (made && total < duty && ws.length && !s.check) {
          const rf = (cfg.resp ? 1 : 0.5) * val * mult;
          if (ws.length === 1) {
            s.gora[ws[0]] += rf * (duty - total);
            notes.push(`short:${ws[0]}`);
          } else if (c.level <= 7) {
            for (const x of ws) {
              const sh = duty / 2 - s.tricks[x];
              if (sh > 0) {
                s.gora[x] += rf * sh;
                notes.push(`short:${x}`);
              }
            }
          } else {
            const second = s.whistOrder[1] ?? ws[1];
            s.gora[second] += rf * (duty - total);
            notes.push(`short:${second}`);
          }
        }
      }
      // платный прикуп: сдающий пишет на заказчика за тузы и марьяж из прикупа
      if (cfg.paidPrikup && s.dealer !== d) {
        const u = prikupUnits(s.prikup);
        if (u) {
          s.whists[s.dealer][d] += u * (cfg.variant === 'rostov' ? 10 : val);
          notes.push(`prikup:${u}`);
        }
      }
    }
    if (made) s.bombs[d].shift();
    // выход из распасов (несыгранная игра выводит, только если «выход подсадом»; в «Скачках» пасы и невистованная — не выводят)
    exit = made || cfg.exitByFail;
    if (cfg.variant === 'skachki' && (how === 'free' || how === 'half')) exit = false;
    if (exit) s.raspasyRun = 0;
    s.darkRun = 0;
  }
  ev.push({ type: 'score', kind, players: s.players.slice(), declarer: s.declarer, contract: s.contract, tricks: s.tricks.slice(), made, pulya: s.pulya.slice(), gora: s.gora.slice(), whists: s.whists.map((r) => r.slice()), notes, mult: mult !== 1 ? mult : undefined });
  if (cfg.variant === 'skachki') return skachkiAfter(s, ev, rng, kind === 'raspasy');
  const done = cfg.variant === 'leningrad' ? s.seats.reduce((a, p) => a + s.pulya[p], 0) >= cfg.pulya * s.seats.length : s.seats.every((p) => s.pulya[p] >= cfg.pulya);
  if (done) return finish(s, ev);
  const d = deal(s, rng);
  return { state: d.state, events: [...ev, ...d.events] };
}

function finish(s: State, ev: Event[]): { state: State; events: Event[] } {
  s.final = finalScores(s);
  s.phase = 'over';
  ev.push({ type: 'end', final: s.final.slice() });
  return { state: s, events: ev };
}

/** «Скачки»: первый набравший пулю скака, конец скака (не на распасах), призы, конец партии после четырёх скаков. */
function skachkiAfter(s: State, ev: Event[], rng: Rng, rasp: boolean): { state: State; events: Event[] } {
  const target = s.cfg.pulya;
  const reached = s.seats.filter((p) => s.pulya[p] >= target);
  if (!s.skFirst && reached.length) s.skFirst = reached;
  if (reached.length && !rasp) {
    const first = s.skFirst ?? reached;
    const prize = (who: number[], v: number) => {
      for (const w of who) for (const q of s.seats) if (q !== w) s.whists[w][q] += v / who.length;
    };
    prize(first, 300);
    const lowG = Math.min(...s.seats.map((p) => s.gora[p]));
    const low = s.seats.filter((p) => s.gora[p] === lowG);
    prize(low, 200);
    ev.push({ type: 'skak', skak: s.skak, first: first.slice(), lowGora: low });
    s.totPulya = s.totPulya.map((x, i) => x + s.pulya[i]);
    s.totGora = s.totGora.map((x, i) => x + s.gora[i]);
    s.pulya = [0, 0, 0, 0];
    s.gora = [0, 0, 0, 0];
    s.skFirst = null;
    s.raspasyRun = 0;
    if (s.skak >= SKAKS) {
      const maxP = Math.max(...s.seats.map((p) => s.totPulya[p]));
      prize(s.seats.filter((p) => s.totPulya[p] === maxP), 300);
      const minG = Math.min(...s.seats.map((p) => s.totGora[p]));
      prize(s.seats.filter((p) => s.totGora[p] === minG), 200);
      return finish(s, ev);
    }
    s.skak++;
  }
  const d = deal(s, rng);
  return { state: d.state, events: [...ev, ...d.events] };
}

/** Гора для итога: в «Скачках» — за все скаки, в «Ленинграде» — с перебором и недобором пули (вдвойне). */
export function goraForFinal(s: Pick<State, 'seats' | 'gora'> & Partial<Pick<State, 'cfg' | 'pulya' | 'totGora' | 'phase'>>): number[] {
  const g = s.gora.slice();
  if (s.cfg?.variant === 'skachki' && s.totGora) for (const p of s.seats) g[p] = s.totGora[p] + (s.phase === 'over' ? 0 : s.gora[p]);
  if (s.cfg?.variant === 'leningrad' && s.pulya) for (const p of s.seats) g[p] += 2 * (s.cfg.pulya - s.pulya[p]);
  return g;
}

/** Итог в вистах: висты на других минус висты на тебя, плюс гора (10 вистов за очко) поровну на всех. */
export function finalScores(s: Pick<State, 'seats' | 'gora' | 'whists'> & Partial<Pick<State, 'cfg' | 'pulya' | 'totGora' | 'phase'>>): number[] {
  const n = s.seats.length;
  const out = [0, 0, 0, 0];
  const gora = goraForFinal(s);
  const goraSum = s.seats.reduce((a, p) => a + gora[p], 0);
  for (const p of s.seats) {
    let v = 0;
    for (const q of s.seats) if (q !== p) v += s.whists[p][q] - s.whists[q][p];
    v += ((goraSum - n * gora[p]) * 10) / n;
    out[p] = Math.round(v);
  }
  // из-за округления подгоняем последнего, чтобы сумма была ноль
  const last = s.seats[s.seats.length - 1];
  out[last] = -s.seats.slice(0, -1).reduce((a, p) => a + out[p], 0);
  return out;
}

export function makeView(raw: State, seats: number[] | 'all'): View {
  const s = migrate(raw);
  const pub = publicSeats(s);
  // пас втёмную: первая рука решает, не видя своих карт
  const blind = (x: number) => s.phase === 'dark' && x === s.turn;
  const see = (x: number) => seats === 'all' || pub.includes(x) || (seats.includes(x) && !blind(x));
  const v = s as Partial<View>;
  const prikupShown = (s.phase !== 'bid' && s.phase !== 'dark') || (s.kind === 'raspasy' && s.cfg.raspPrikup);
  return {
    ...s,
    hands: s.hands.map((h, i) => (see(i) ? h.slice() : [])),
    prikup: prikupShown && (s.kind !== 'raspasy' || s.cfg.raspPrikup) ? s.prikup.slice() : [],
    discard: seats === 'all' || seats.includes(s.declarer) ? s.discard.slice() : [],
    counts: s.hands.map((h, i) => v.counts?.[i] ?? h.length),
    me: seats === 'all' ? s.seats.slice() : seats.slice(),
  };
}

export const handCount = (s: State, seat: number) => ((s as Partial<View>).counts ? (s as View).counts[seat] : s.hands[seat].length);

export function bidName(b: Bid | null): string {
  if (!b) return '—';
  if (isMis(b)) return 'мизер';
  return `${b.level}${b.trump === 'NT' ? ' БК' : { S: '♠', C: '♣', D: '♦', H: '♥' }[b.trump]}`;
}
