/* Покер — общий движок для всех видов (без DOM): холдем (он же в 3D-комнате), Short Deck, пайнэппл, Омаха, Куршевель, стад,
 * дро, лоуболл, бадуги и смешанные HORSE и 8-Game.
 *
 * Семейства:
 *   flop  — холдем, Short Deck, пайнэппл, Омаха 4/5, Куршевель: блайнды, префлоп, флоп, тёрн, ривер.
 *           Short Deck — колода с шестёрки: флеш старше фулл-хауса, A-6-7-8-9 — младший стрит.
 *           Пайнэппл — три своих, одну сбросить до флопа; крейзи-пайнэппл — после торговли на флопе.
 *           Омаха и Куршевель — ровно две свои + три общие; в Куршевеле пять своих, и первая карта флопа открыта до торговли.
 *   stud  — 7-карточный (2 закрытые + 1 открытая, ещё три открытых, последняя закрытая) и 5-карточный (1 + 1, ещё три открытых):
 *           анте, «принос» — самая младшая открытая (в раззе — самая старшая), дальше первым ходит лучшая открытая рука.
 *   draw  — 5-карточное дро (один обмен), тройной обмен 2–7 и A–5, бадуги (4 карты), бадьюси (2–7 + бадуги), бадэйси (A–5 + бадуги).
 * Хай-лоу «8 или лучше» (Омаха, Куршевель, стад): половина банка — старшей, половина — лучшей лоу из пяти разных до восьмёрки; лоу нет — всё старшей.
 * Ставки: лимит (малая ставка на ранних улицах, большая на поздних, не больше четырёх ставок за круг), пот-лимит, безлимит.
 * Блайнды: малый и большой слева от баттона; вдвоём (хедз-ап) баттон — малый блайнд и ходит первым до флопа, после — вторым.
 * Анте (по желанию): с каждого, за всех — баттон (баттон-анте) или большой блайнд; в стаде анте всегда.
 * Блайнды могут удваиваться каждые N раздач. Партия до того, как у одного все фишки, или до N раздач — тогда побеждает самый богатый.
 * Каждая раздача пишется в историю (HandRecord) — один формат для всех видов: на нём HUD, реплеер, разбор и школа. */
import type { Options, Rng } from '../../core/types';
import { sameCard, type Card, type Suit } from '../../cards/deck';
import { allCards, badugi, badugiSize, high, highCat, highName, highSD, low27, low8, lowA5, omahaHigh } from './hands';
import type { TourEvKind, TourState } from './tour';

export type Game = 'holdem' | 'shortdeck' | 'pineapple' | 'crazy' | 'omaha4' | 'omaha5' | 'courchevel' | 'stud7' | 'stud5' | 'razz' | 'draw5' | 'td27' | 'tda5' | 'badugi' | 'badeucy' | 'badacey';
export type Mix = 'horse' | 'eight';
export type Mode = Game | Mix;
export type Struct = 'limit' | 'pot' | 'nl';
export type Family = 'flop' | 'stud' | 'draw';
/** Анте: нет, с каждого, баттон за всех, большой блайнд за всех. */
export type AnteKind = 'none' | 'all' | 'button' | 'bb';

export interface GameInfo {
  name: string;
  family: Family;
  /** Сколько своих карт (у стада — всего за раздачу). */
  cards: number;
  draws: number;
  /** Как делится банк: 'hi', 'loA5'/'lo27' (весь банк младшей), 'badugi', 'bad27'/'badA5' (пополам с бадуги). */
  pot: 'hi' | 'loA5' | 'lo27' | 'badugi' | 'bad27' | 'badA5';
  struct: Struct;
  /** Больше игроков колоды не хватит. */
  max: number;
  /** Колода с шестёрки (Short Deck). */
  short?: boolean;
  /** Пайнэппл: одну свою карту сбросить перед этой улицей (1 — до флопа, 2 — до тёрна). */
  discard?: number;
  /** Куршевель: столько общих карт открыто до торговли на префлопе. */
  pre?: number;
  /** Ровно две свои + три общие. */
  omaha?: boolean;
  /** Бывает хай-лоу. */
  hilo?: boolean;
}

export const GAMES: Record<Game, GameInfo> = {
  holdem: { name: 'Холдем', family: 'flop', cards: 2, draws: 0, pot: 'hi', struct: 'nl', max: 9 },
  shortdeck: { name: 'Short Deck', family: 'flop', cards: 2, draws: 0, pot: 'hi', struct: 'nl', max: 9, short: true },
  pineapple: { name: 'Пайнэппл', family: 'flop', cards: 3, draws: 0, pot: 'hi', struct: 'nl', max: 9, discard: 1 },
  crazy: { name: 'Крейзи-пайнэппл', family: 'flop', cards: 3, draws: 0, pot: 'hi', struct: 'nl', max: 9, discard: 2 },
  omaha4: { name: 'Омаха', family: 'flop', cards: 4, draws: 0, pot: 'hi', struct: 'pot', max: 9, omaha: true, hilo: true },
  omaha5: { name: 'Омаха-5', family: 'flop', cards: 5, draws: 0, pot: 'hi', struct: 'pot', max: 8, omaha: true, hilo: true },
  courchevel: { name: 'Куршевель', family: 'flop', cards: 5, draws: 0, pot: 'hi', struct: 'pot', max: 8, pre: 1, omaha: true, hilo: true },
  stud7: { name: 'Стад-7', family: 'stud', cards: 7, draws: 0, pot: 'hi', struct: 'limit', max: 7, hilo: true },
  stud5: { name: 'Стад-5', family: 'stud', cards: 5, draws: 0, pot: 'hi', struct: 'limit', max: 8, hilo: true },
  razz: { name: 'Разз', family: 'stud', cards: 7, draws: 0, pot: 'loA5', struct: 'limit', max: 7 },
  draw5: { name: 'Дро', family: 'draw', cards: 5, draws: 1, pot: 'hi', struct: 'nl', max: 6 },
  td27: { name: '2–7 тройной обмен', family: 'draw', cards: 5, draws: 3, pot: 'lo27', struct: 'limit', max: 6 },
  tda5: { name: 'A–5 тройной обмен', family: 'draw', cards: 5, draws: 3, pot: 'loA5', struct: 'limit', max: 6 },
  badugi: { name: 'Бадуги', family: 'draw', cards: 4, draws: 3, pot: 'badugi', struct: 'limit', max: 6 },
  badeucy: { name: 'Бадьюси', family: 'draw', cards: 5, draws: 3, pot: 'bad27', struct: 'limit', max: 6 },
  badacey: { name: 'Бадэйси', family: 'draw', cards: 5, draws: 3, pot: 'badA5', struct: 'limit', max: 6 },
};

/** Вид в ротации смешанной игры: каждый — на круг раздач. */
export interface Slot {
  game: Game;
  hilo: boolean;
  struct: Struct;
  letter: string;
}

export const MIXES: Record<Mix, { name: string; slots: Slot[] }> = {
  // HORSE: холдем, Омаха хай-лоу, разз, стад, стад хай-лоу — всё лимит
  horse: {
    name: 'HORSE',
    slots: [
      { game: 'holdem', hilo: false, struct: 'limit', letter: 'H' },
      { game: 'omaha4', hilo: true, struct: 'limit', letter: 'O' },
      { game: 'razz', hilo: false, struct: 'limit', letter: 'R' },
      { game: 'stud7', hilo: false, struct: 'limit', letter: 'S' },
      { game: 'stud7', hilo: true, struct: 'limit', letter: 'E' },
    ],
  },
  // 8-Game: 2–7 тройной обмен, лимитный холдем, Омаха хай-лоу, разз, стад, стад хай-лоу, безлимитный холдем, пот-лимит Омаха
  eight: {
    name: '8-Game',
    slots: [
      { game: 'td27', hilo: false, struct: 'limit', letter: '2-7' },
      { game: 'holdem', hilo: false, struct: 'limit', letter: 'LHE' },
      { game: 'omaha4', hilo: true, struct: 'limit', letter: 'O8' },
      { game: 'razz', hilo: false, struct: 'limit', letter: 'R' },
      { game: 'stud7', hilo: false, struct: 'limit', letter: 'S' },
      { game: 'stud7', hilo: true, struct: 'limit', letter: 'S8' },
      { game: 'holdem', hilo: false, struct: 'nl', letter: 'NLHE' },
      { game: 'omaha4', hilo: false, struct: 'pot', letter: 'PLO' },
    ],
  },
};

export const isMix = (m: Mode): m is Mix => m === 'horse' || m === 'eight';
/** Сколько игроков можно посадить при этом виде (смешанные — по самому тесному виду ротации). */
export const maxPlayers = (m: Mode) => (isMix(m) ? Math.min(...MIXES[m].slots.map((x) => GAMES[x.game].max)) : GAMES[m].max);

export interface Cfg {
  mode: Mode;
  hilo: boolean;
  /** 'auto' — как принято для вида. */
  struct: Struct | 'auto';
  stack: number;
  /** Раздач в партии (0 — до последнего). */
  hands: number;
  /** Большой блайнд в начале (малый — половина); от него же лимитные ставки, анте и принос. */
  blind: number;
  /** Удваивать блайнды каждые столько раздач (0 — не расти). */
  every: number;
  ante: AnteKind;
  /** Турнир (этап 3): выплаты по местам — боты на пузыре учитывают ICM. */
  prizes?: number[];
  /** Кэш-игра: блайнды не растут, проигравший докупается до стартового стека; итог — выигрыш с учётом докупок. */
  cash?: boolean;
}

const MODES: Mode[] = [...(Object.keys(GAMES) as Game[]), 'horse', 'eight'];

export function cfgFrom(o: Options): Cfg {
  const mode = MODES.includes(o.mode as Mode) ? (o.mode as Mode) : 'holdem';
  const st = o.struct === 'limit' || o.struct === 'pot' || o.struct === 'nl' ? o.struct : 'auto';
  const pick = (v: unknown, list: number[], d: number) => (list.includes(Number(v)) ? Number(v) : d);
  return {
    mode,
    hilo: !!o.hilo,
    struct: st,
    stack: pick(o.stack, [500, 1000, 1500, 2000], 1000),
    // кэш-игра без конца не кончится — по умолчанию 30 раздач
    hands: pick(o.hands, [0, 20, 30, 40], 0) || (o.cash === true ? 30 : 0),
    blind: pick(o.blind, [10, 20, 50], 20),
    every: pick(o.every, [0, 5, 10, 20], 10),
    ante: o.ante === 'all' || o.ante === 'button' || o.ante === 'bb' ? o.ante : 'none',
    cash: o.cash === true,
  };
}

const CAP = 4;
export const N = 9;

export type Phase = 'bet' | 'draw' | 'discard' | 'over';

// ---------------------------------------------------------------- история раздач

/** Шаг раздачи в истории. street — улица (у дро — номер круга торговли). Карты, которых место не видело, — null. */
export type HandAct =
  | { k: 'post'; seat: number; amount: number; what: 'sb' | 'bb' | 'ante' | 'bring' }
  | { k: 'act'; street: number; seat: number; a: 'fold' | 'check' | 'call' | 'bet' | 'raise'; amount: number; to: number; allin?: boolean }
  /** Общие карты улицы (у Куршевеля открытая до префлопа — в board с самого начала). */
  | { k: 'board'; street: number; cards: Card[] }
  /** Стад: карта улицы месту (открытая или последняя закрытая). */
  | { k: 'card'; street: number; seat: number; card: Card | null; up: boolean }
  | { k: 'draw'; street: number; seat: number; out: (Card | null)[]; got: (Card | null)[] }
  | { k: 'discard'; street: number; seat: number; card: Card | null };

/** Раздача целиком — один формат для всех видов покера (версия формата v). */
export interface HandRecord {
  v: 1;
  /** Номер раздачи в партии. */
  no: number;
  game: Game;
  hilo: boolean;
  struct: Struct;
  small: number;
  big: number;
  /** Анте с места (у баттон-анте и анте большого блайнда — сколько тот платит за всех). */
  ante: number;
  anteKind: AnteKind | 'stud';
  button: number;
  /** Кто в раздаче и с каким стеком сел (до анте и блайндов). */
  seats: { seat: number; stack: number }[];
  /** Стартовые карты (у стада — первые три, up — какие открыты). */
  hole: Record<number, (Card | null)[]>;
  up?: Record<number, boolean[]>;
  board: Card[];
  acts: HandAct[];
  /** Вскрытые руки (последние карты). */
  shown: Record<number, Card[]>;
  winners: { seat: number; amount: number; hand: string; lo?: boolean }[];
  /** Итог раздачи по фишкам: + выиграл, − проиграл. */
  net: Record<number, number>;
  /** Дошло до вскрытия. */
  showdown: boolean;
}

/** История глазами мест seats: чужие закрытые карты — null (вскрытые остаются). */
export function recFor(r: HandRecord, seats: number[] | 'all'): HandRecord {
  if (seats === 'all') return r;
  const see = (p: number) => seats.includes(p);
  const hole: HandRecord['hole'] = {};
  for (const [k, cs] of Object.entries(r.hole)) {
    const p = Number(k);
    hole[p] = see(p) ? cs.slice() : cs.map((c, i) => (r.up?.[p]?.[i] ? c : null));
  }
  const acts = r.acts.map((a): HandAct => {
    if (!('seat' in a) || see(a.seat)) return a;
    if (a.k === 'card' && !a.up) return { ...a, card: null };
    if (a.k === 'draw') return { ...a, out: a.out.map(() => null), got: a.got.map(() => null) };
    if (a.k === 'discard') return { ...a, card: null };
    return a;
  });
  return { ...r, hole, acts };
}

// ---------------------------------------------------------------- состояние

export interface State {
  cfg: Cfg;
  seats: number[];
  /** Вид текущей раздачи (в смешанных меняется), его хай-лоу и ставки. */
  game: Game;
  hilo: boolean;
  struct: Struct;
  hand: number;
  button: number;
  /** Блайнды сейчас. */
  small: number;
  big: number;
  chips: number[];
  /** Кэш-игра: сколько раз докупался каждый (по стартовому стеку). */
  rebuys?: number[];
  /** Свои карты; у стада — с отметкой «открыта». */
  hole: Card[][];
  up: boolean[][];
  board: Card[];
  deck: Card[];
  muck: Card[];
  /** Улица: 0 — первая торговля; у дро — номер круга (между обменами). */
  street: number;
  phase: Phase;
  inHand: number[];
  folded: boolean[];
  allin: boolean[];
  bet: number[];
  total: number[];
  current: number;
  minRaise: number;
  raises: number;
  acted: number[];
  turn: number;
  /** Кто уже менял (сбросил) в этом обмене. */
  drew: boolean[];
  /** Сколько карт сменил каждый в последнем обмене (видно всем). */
  drawn: number[];
  shown: Record<number, Card[]>;
  last: { winners: { seat: number; amount: number; hand: string }[] } | null;
  over: boolean;
  /** История текущей (или только что сыгранной) раздачи. */
  rec: HandRecord | null;
  /** Турнир (poker/tour.ts): раздачу между раздачами ведёт он — уровни, вылеты, ребаи, пересадки. */
  tour?: TourState;
  /** Турнир: раздача сыграна, следующую сдаст турнир. */
  between?: boolean;
  /** Турнир: место решает «ребай / ре-энтри / аддон» — торговли нет. */
  decide?: { seat: number; what: 'rebuy' | 'reentry' | 'addon' } | null;
}

export interface View extends State {
  counts: number[];
}

export type Action = { type: 'fold' } | { type: 'check' } | { type: 'call' } | { type: 'raise'; to: number } | { type: 'allin' } | { type: 'draw'; cards: Card[] } | { type: 'discard'; card: Card };

export type Event =
  | { type: 'blinds'; small: number; big: number }
  | { type: 'deal'; hand: number; game: Game; hilo: boolean; struct: Struct; button: number; seats: number[]; small: number; big: number; hole?: Card[][]; up?: boolean[][]; board?: Card[] }
  | { type: 'post'; seat: number; amount: number; what: string }
  /** to — ставка места в круге после хода; open — первая ставка на улице (а не рейз). */
  | { type: 'act'; seat: number; action: Action; amount: number; to: number; allin: boolean; open?: boolean }
  | { type: 'street'; street: number; board?: Card[]; cards?: { seat: number; card: Card | null; up: boolean }[] }
  | { type: 'draw'; seat: number; count: number; cards?: Card[] }
  | { type: 'discard'; seat: number; card?: Card }
  | { type: 'show'; seat: number; cards: Card[]; hand: string }
  | { type: 'win'; seat: number; amount: number; hand: string; uncontested: boolean }
  | { type: 'bust'; seat: number }
  /** Кэш-игра: докупка до стартового стека. */
  | { type: 'rebuy'; seat: number; amount: number }
  /** Раздача сыграна: её история. */
  | { type: 'hand'; rec: HandRecord }
  | { type: 'end'; winner: number }
  /** Турнир: уровень, вылет и место, пересадка, пузырь, итог (poker/tour.ts). */
  | { type: 'tour'; kind: TourEvKind; text: string };

export const info = (s: Pick<State, 'game'>) => GAMES[s.game];
export const structOf = (s: Pick<State, 'struct'>): Struct => s.struct;
const live = (s: State) => s.seats.filter((p) => s.chips[p] > 0);
const nextIn = (list: number[], p: number) => {
  const all = [...list].sort((a, b) => a - b);
  return all.find((x) => x > p) ?? all[0];
};
export const contenders = (s: Pick<State, 'inHand' | 'folded'>) => s.inHand.filter((p) => !s.folded[p]);
const canAct = (s: State, p: number) => s.inHand.includes(p) && !s.folded[p] && !s.allin[p];
export const potSize = (s: Pick<State, 'inHand' | 'total'>) => s.inHand.reduce((a, p) => a + s.total[p], 0);
/** Анте и принос в стаде — четверть большого блайнда. */
const studAnte = (s: State) => Math.max(1, Math.round(s.big / 4));

/** Размер ставки в лимите на этой улице. */
export function betUnit(s: State): number {
  const g = info(s);
  if (g.family === 'flop' || g.family === 'stud') return s.street >= 2 ? s.big * 2 : s.big;
  // дро: после обмена (в тройном — после второго) — большая
  return s.street >= (g.draws === 1 ? 1 : 2) ? s.big * 2 : s.big;
}

const empty = () => Array.from({ length: N }, () => [] as never[]);

export function newState(cfg: Cfg, seats: number[]): State {
  const z = () => Array(N).fill(0);
  const first = isMix(cfg.mode) ? MIXES[cfg.mode].slots[0] : { game: cfg.mode, hilo: cfg.hilo, struct: cfg.struct === 'auto' ? GAMES[cfg.mode].struct : cfg.struct };
  return {
    cfg,
    seats: seats.slice(),
    game: first.game,
    hilo: first.hilo && !!GAMES[first.game].hilo,
    struct: first.struct,
    hand: 0,
    button: seats[seats.length - 1],
    small: cfg.blind / 2,
    big: cfg.blind,
    chips: Array.from({ length: N }, (_, p) => (seats.includes(p) ? cfg.stack : 0)),
    hole: empty(),
    up: empty(),
    board: [],
    deck: [],
    muck: [],
    street: 0,
    phase: 'bet',
    inHand: [],
    folded: Array(N).fill(false),
    allin: Array(N).fill(false),
    bet: z(),
    total: z(),
    current: 0,
    minRaise: cfg.blind,
    raises: 0,
    acted: [],
    turn: seats[0],
    drew: Array(N).fill(false),
    drawn: z(),
    shown: {},
    last: null,
    over: false,
    rec: null,
  };
}

function shuffle(a: Card[], rng: Rng): Card[] {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

function draw1(s: State, rng: Rng): Card {
  if (!s.deck.length) {
    s.deck = shuffle(s.muck, rng);
    s.muck = [];
  }
  return s.deck.shift()!;
}

/** Ставка в круг (идёт в bet и в банк). */
function put(s: State, p: number, amount: number) {
  const a = Math.min(amount, s.chips[p]);
  s.chips[p] -= a;
  s.bet[p] += a;
  s.total[p] += a;
  if (s.chips[p] === 0) s.allin[p] = true;
  return a;
}

/** Анте — мёртвые фишки: в банк, но не в ставку круга. */
function putDead(s: State, p: number, amount: number) {
  const a = Math.min(amount, s.chips[p]);
  s.chips[p] -= a;
  s.total[p] += a;
  if (s.chips[p] === 0) s.allin[p] = true;
  return a;
}

function post(s: State, ev: Event[], p: number, amount: number, what: 'sb' | 'bb' | 'ante' | 'bring', dead = false) {
  const a = dead ? putDead(s, p, amount) : put(s, p, amount);
  const word = { sb: 'малый блайнд', bb: 'большой блайнд', ante: 'анте', bring: 'принос' }[what];
  ev.push({ type: 'post', seat: p, amount: a, what: word });
  s.rec?.acts.push({ k: 'post', seat: p, amount: a, what });
  return a;
}

/** Ранг открытых карт стада для порядка хода (старше — лучше; в раззе — младше лучше). */
function upValue(s: State, p: number): number {
  const ups = s.hole[p].filter((_, i) => s.up[p][i]);
  if (s.game === 'razz') return lowA5(ups);
  return high(ups);
}

const SUIT_ORDER: Suit[] = ['C', 'D', 'H', 'S'];

export function deal(s0: State, rng: Rng): { state: State; events: Event[] } {
  const s: State = { ...s0, chips: s0.chips.slice() };
  if (s.between) s.between = false;
  const ev: Event[] = [];
  s.hand++;
  if (s.cfg.every && !s.cfg.cash && s.hand > 1 && (s.hand - 1) % s.cfg.every === 0) {
    s.big *= 2;
    s.small = s.big / 2;
    ev.push({ type: 'blinds', small: s.small, big: s.big });
  }
  if (isMix(s.cfg.mode)) {
    const slots = MIXES[s.cfg.mode].slots;
    const k = Math.floor((s.hand - 1) / Math.max(2, s.seats.length)) % slots.length;
    s.game = slots[k].game;
    s.hilo = slots[k].hilo;
    s.struct = slots[k].struct;
  } else {
    s.game = s.cfg.mode;
    s.hilo = s.cfg.hilo && !!GAMES[s.game].hilo;
    s.struct = s.cfg.struct === 'auto' ? GAMES[s.game].struct : s.cfg.struct;
  }
  const g = info(s);
  const players = live(s);
  s.button = nextIn(players, s.button);
  s.deck = shuffle(allCards(g.short), rng);
  s.muck = [];
  s.board = [];
  s.street = 0;
  s.phase = 'bet';
  s.inHand = players.slice();
  s.folded = Array(N).fill(false);
  s.allin = Array(N).fill(false);
  s.bet = Array(N).fill(0);
  s.total = Array(N).fill(0);
  s.current = 0;
  s.minRaise = s.big;
  s.raises = 0;
  s.acted = [];
  s.drew = Array(N).fill(false);
  s.drawn = Array(N).fill(0);
  s.shown = {};
  s.hole = empty();
  s.up = empty();
  const order: number[] = [];
  let x = s.button;
  for (let i = 0; i < players.length; i++) {
    x = nextIn(players, x);
    order.push(x);
  }
  if (g.family === 'stud') {
    const down = g.cards === 7 ? 2 : 1;
    for (const p of order) {
      for (let i = 0; i < down; i++) {
        s.hole[p].push(draw1(s, rng));
        s.up[p].push(false);
      }
      s.hole[p].push(draw1(s, rng));
      s.up[p].push(true);
    }
  } else {
    for (const p of order)
      for (let i = 0; i < g.cards; i++) {
        s.hole[p].push(draw1(s, rng));
        s.up[p].push(false);
      }
  }
  // Куршевель: первая карта флопа открыта сразу
  for (let i = 0; i < (g.pre ?? 0); i++) s.board.push(draw1(s, rng));
  const anteKind: HandRecord['anteKind'] = g.family === 'stud' ? 'stud' : s.cfg.ante;
  const anteAmt = g.family === 'stud' ? studAnte(s) : anteKind === 'none' ? 0 : anteKind === 'bb' ? s.big : Math.max(1, Math.round(s.big / 10));
  s.rec = {
    v: 1,
    no: s.hand,
    game: s.game,
    hilo: s.hilo,
    struct: s.struct,
    small: s.small,
    big: s.big,
    ante: anteKind === 'button' ? anteAmt * players.length : anteAmt,
    anteKind,
    button: s.button,
    seats: players.map((p) => ({ seat: p, stack: s.chips[p] })),
    hole: Object.fromEntries(players.map((p) => [p, s.hole[p].slice()])),
    ...(g.family === 'stud' ? { up: Object.fromEntries(players.map((p) => [p, s.up[p].slice()])) } : {}),
    board: s.board.slice(),
    acts: [],
    shown: {},
    winners: [],
    net: {},
    showdown: false,
  };
  ev.push({ type: 'deal', hand: s.hand, game: s.game, hilo: s.hilo, struct: s.struct, button: s.button, seats: players.slice(), small: s.small, big: s.big, hole: s.hole.map((h) => h.slice()), up: s.up.map((u) => u.slice()), ...(s.board.length ? { board: s.board.slice() } : {}) });
  if (g.family === 'stud') {
    for (const p of players) post(s, ev, p, anteAmt, 'ante', true);
    // принос: младшая открытая (в раззе — старшая), при равных — по масти
    const card = (p: number) => s.hole[p][s.up[p].indexOf(true)];
    const key = (p: number) => {
      const c = card(p);
      const r = s.game === 'razz' ? (c.r === 14 ? 1 : c.r) : c.r;
      return (s.game === 'razz' ? -r : r) * 4 + (s.game === 'razz' ? -SUIT_ORDER.indexOf(c.s) : SUIT_ORDER.indexOf(c.s));
    };
    const bring = players.slice().sort((a, b) => key(a) - key(b))[0];
    const bringAmt = studAnte(s);
    post(s, ev, bring, bringAmt, 'bring');
    s.current = s.bet[bring];
    s.minRaise = s.big - bringAmt;
    s.turn = nextIn(players, bring);
    while (!canAct(s, s.turn) && s.turn !== bring) s.turn = nextIn(players, s.turn);
    return finishDealSetup(s, ev, rng);
  }
  // блайнды (вдвоём: баттон — малый), потом анте
  const sb = players.length === 2 ? s.button : nextIn(players, s.button);
  const bb = nextIn(players, sb);
  post(s, ev, sb, s.small, 'sb');
  post(s, ev, bb, s.big, 'bb');
  if (anteKind === 'all') for (const p of players) post(s, ev, p, anteAmt, 'ante', true);
  else if (anteKind === 'button') post(s, ev, s.button, anteAmt * players.length, 'ante', true);
  else if (anteKind === 'bb') post(s, ev, bb, anteAmt, 'ante', true);
  s.current = s.big;
  s.minRaise = s.big;
  s.turn = nextIn(players, bb);
  return finishDealSetup(s, ev, rng);
}

function finishDealSetup(s: State, ev: Event[], rng: Rng) {
  // если ходить некому (все ва-банк на блайндах) — сразу дальше
  if (!canAct(s, s.turn) || contenders(s).filter((p) => !s.allin[p]).length < 2) return advance(s, ev, rng, true);
  return { state: s, events: ev };
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  return deal(newState(cfgFrom(opts), seats), rng).state;
}

export const toAct = (s: State): number[] => (s.over ? [] : s.decide ? [s.decide.seat] : s.between ? [] : [s.turn]);
export const toCall = (s: Pick<State, 'current' | 'bet' | 'chips'>, p: number) => Math.min(s.chips[p], Math.max(0, s.current - s.bet[p]));

/** Допустимый рейз «до»: [мин, макс] или null. */
export function raiseRange(s: State, p: number): [number, number] | null {
  const stack = s.chips[p] + s.bet[p];
  if (stack <= s.current) return null;
  const st = structOf(s);
  if (st === 'limit') {
    if (s.raises >= CAP) return null;
    const unit = betUnit(s);
    // принос в стаде «доводится» до малой ставки
    const to = s.current < unit && info(s).family === 'stud' && s.street === 0 ? unit : s.current + unit;
    const t = Math.min(to, stack);
    return [t, t];
  }
  const min = Math.min(stack, s.current + Math.max(s.minRaise, s.big));
  if (st === 'nl') return [min, stack];
  // пот-лимит: колл и сверху весь банк с коллом
  const call = s.current - s.bet[p];
  const max = Math.min(stack, s.current + potSize(s) + call);
  return [Math.min(min, max), max];
}

/** Наименьший рейз «до» (для кнопок). */
export const minRaiseTo = (s: State, p: number) => raiseRange(s, p)?.[0] ?? s.current;

function nextToAct(s: State, from: number): number | null {
  const order = [...s.inHand].sort((a, b) => a - b);
  let x = from;
  for (let i = 0; i < order.length; i++) {
    x = nextIn(order, x);
    if (canAct(s, x) && (!s.acted.includes(x) || s.bet[x] < s.current)) return x;
  }
  return null;
}

/** Первый за баттоном из списка. */
function leftOfButton(s: State, list: number[]): number | null {
  if (!list.length) return null;
  let x = s.button;
  for (let i = 0; i < N; i++) {
    x = nextIn(s.inHand, x);
    if (list.includes(x)) return x;
  }
  return list[0];
}

/** Первый ход на улице: у стада — лучшая открытая рука, иначе — первый слева от баттона. */
function firstOnStreet(s: State): number | null {
  const can = contenders(s).filter((p) => !s.allin[p]);
  if (!can.length) return null;
  if (info(s).family === 'stud') return can.slice().sort((a, b) => upValue(s, b) - upValue(s, a) || a - b)[0];
  return leftOfButton(s, can);
}

function newRound(s: State) {
  s.bet = Array(N).fill(0);
  s.current = 0;
  s.minRaise = s.big;
  s.raises = 0;
  s.acted = [];
}

/** Сколько улиц торговли у вида. */
function lastStreet(s: State): number {
  const g = info(s);
  if (g.family === 'flop') return 3;
  if (g.family === 'stud') return g.cards === 7 ? 4 : 3;
  return g.draws;
}

/** Пайнэппл: перед этой улицей ещё не сбросили лишнюю карту. */
const needDiscard = (s: State) => info(s).discard === s.street + 1 && contenders(s).some((p) => s.hole[p].length > 2);

function advance(s: State, ev: Event[], rng: Rng, fromDeal = false): { state: State; events: Event[] } {
  if (contenders(s).length === 1) return finishHand(s, ev, rng, true);
  const nx = fromDeal ? (canAct(s, s.turn) ? s.turn : nextToAct(s, s.turn)) : nextToAct(s, s.turn);
  const active = contenders(s).filter((p) => !s.allin[p]);
  if (nx != null && !(active.length === 1 && s.bet[active[0]] >= s.current)) {
    s.turn = nx;
    return { state: s, events: ev };
  }
  // круг торговли окончен
  while (true) {
    if (s.street >= lastStreet(s)) return finishHand(s, ev, rng, false);
    const g = info(s);
    // все (кроме, может, одного) ва-банк — торговли больше не будет: руки открываются сразу, доска докручивается в открытую
    // (не в дро и не перед сбросом крейзи-пайнэппла — там игроки ещё меняют карты)
    if (g.family !== 'draw' && !g.discard && contenders(s).filter((p) => !s.allin[p]).length < 2)
      for (const p of contenders(s))
        if (!s.shown[p]) {
          s.shown[p] = s.hole[p].slice();
          ev.push({ type: 'show', seat: p, cards: s.hole[p].slice(), hand: (g.family === 'flop' ? s.board.length >= 3 : s.hole[p].length >= 5) ? handName(s, p) : '' });
        }
    if (needDiscard(s)) {
      s.phase = 'discard';
      s.drew = Array(N).fill(false);
      s.turn = leftOfButton(s, contenders(s))!;
      return { state: s, events: ev };
    }
    s.street++;
    newRound(s);
    if (g.family === 'flop') {
      draw1(s, rng); // в сброс
      const n = s.street === 1 ? 3 - (g.pre ?? 0) : 1;
      const cards: Card[] = [];
      for (let i = 0; i < n; i++) cards.push(draw1(s, rng));
      s.board = [...s.board, ...cards];
      ev.push({ type: 'street', street: s.street, board: cards });
      s.rec?.acts.push({ k: 'board', street: s.street, cards: cards.slice() });
    } else if (g.family === 'stud') {
      const lastDown = g.cards === 7 && s.street === 4;
      const cards: { seat: number; card: Card | null; up: boolean }[] = [];
      for (const p of contenders(s)) {
        const c = draw1(s, rng);
        s.hole[p].push(c);
        s.up[p].push(!lastDown);
        cards.push({ seat: p, card: c, up: !lastDown });
        s.rec?.acts.push({ k: 'card', street: s.street, seat: p, card: c, up: !lastDown });
      }
      ev.push({ type: 'street', street: s.street, cards });
    } else {
      // дро: обмен перед торговлей
      s.phase = 'draw';
      s.drew = Array(N).fill(false);
      s.drawn = Array(N).fill(0);
      ev.push({ type: 'street', street: s.street });
      const first = firstOnStreet(s) ?? contenders(s)[0];
      s.turn = contenders(s).includes(first) ? first : contenders(s)[0];
      return { state: s, events: ev };
    }
    const can = contenders(s).filter((p) => !s.allin[p]);
    if (can.length >= 2) {
      s.turn = firstOnStreet(s)!;
      return { state: s, events: ev };
    }
  }
}

/** Обмен или сброс: следующий, кто ещё не менял, или дальше по раздаче. */
function afterDraw(s: State, ev: Event[], rng: Rng): { state: State; events: Event[] } {
  const c = contenders(s);
  const left = c.filter((p) => (s.phase === 'discard' ? s.hole[p].length > 2 : !s.drew[p]));
  if (left.length) {
    let x = s.turn;
    for (let i = 0; i < N; i++) {
      x = nextIn(s.inHand, x);
      if (left.includes(x)) break;
    }
    s.turn = x;
    return { state: s, events: ev };
  }
  if (s.phase === 'discard') {
    // все сбросили — открываем улицу (круг торговли до сброса уже окончен)
    s.phase = 'bet';
    return advance(s, ev, rng, false);
  }
  s.phase = 'bet';
  const can = c.filter((p) => !s.allin[p]);
  if (can.length >= 2) {
    s.turn = firstOnStreet(s)!;
    return { state: s, events: ev };
  }
  // торговаться некому — следующий обмен или вскрытие
  s.acted = [];
  return advance(s, ev, rng, false);
}

// ---------------------------------------------------------------- вскрытие

export function hiValue(s: Pick<State, 'game' | 'hole' | 'board'>, p: number): number {
  const cards = s.hole[p];
  const g = GAMES[s.game];
  if (g.omaha) return omahaHigh(cards, s.board);
  if (g.short) return highSD([...cards, ...s.board]);
  if (g.family === 'flop') return high([...cards, ...s.board]);
  return high(cards);
}

/** Значения для делёжа: hi (всегда есть), lo (null — не претендует). Смысл «hi» в лоуболле — лучшая низкая. */
export function values(s: Pick<State, 'game' | 'hole' | 'board' | 'hilo'>, p: number): { hi: number; lo: number | null } {
  const cards = s.hole[p];
  const g = GAMES[s.game];
  switch (g.pot) {
    case 'hi':
      return { hi: hiValue(s, p), lo: s.hilo ? low8(g.omaha ? [] : cards, g.omaha ? { hole: cards, board: s.board } : undefined) : null };
    case 'loA5':
      return { hi: lowA5(cards), lo: null };
    case 'lo27':
      return { hi: low27(cards), lo: null };
    case 'badugi':
      return { hi: badugi(cards), lo: null };
    case 'bad27':
      return { hi: badugi(cards), lo: low27(cards) };
    case 'badA5':
      return { hi: badugi(cards), lo: lowA5(cards) };
  }
}

/** Младшая пятёрка строкой: «7-5-4-3-2». */
function lowWord(cards: Card[], aceLow: boolean): string {
  const r = (c: Card) => (c.r === 14 && aceLow ? 1 : c.r);
  const nm = (n: number) => (n === 1 || n === 14 ? 'Т' : n === 13 ? 'К' : n === 12 ? 'Д' : n === 11 ? 'В' : String(n));
  const u = [...new Set(cards.map(r))].sort((a, b) => a - b).slice(0, 5);
  return u.reverse().map(nm).join('-');
}

/** Название руки на вскрытии. */
export function handName(s: Pick<State, 'game' | 'hole' | 'board' | 'hilo'>, p: number): string {
  const g = GAMES[s.game];
  const cards = s.hole[p];
  switch (g.pot) {
    case 'hi':
      return highName(hiValue(s, p), g.short);
    case 'loA5':
      return `лоу ${lowWord(cards, true)}`;
    case 'lo27': {
      const v = -low27(cards);
      return highCat(v) ? highName(v) : `лоу ${lowWord(cards, false)}`;
    }
    default:
      return `бадуги из ${badugiSize(cards)}`;
  }
}

/** Делится ли банк пополам (хай-лоу и бадьюси/бадэйси). */
const split = (s: State) => s.hilo || info(s).pot === 'bad27' || info(s).pot === 'badA5';

export function finishHand(s: State, ev: Event[], rng: Rng, uncontested: boolean): { state: State; events: Event[] } {
  const alive = contenders(s);
  const winners: { seat: number; amount: number; hand: string; lo?: boolean }[] = [];
  const names = new Map<number, string>();
  const give = (p: number, amt: number, lo: boolean) => {
    if (!amt) return;
    s.chips[p] += amt;
    const w = winners.find((x) => x.seat === p);
    if (w) {
      w.amount += amt;
      if (!lo) w.lo = undefined;
    } else winners.push({ seat: p, amount: amt, hand: names.get(p) ?? '', ...(lo ? { lo: true } : {}) });
  };
  if (uncontested) give(alive[0], potSize(s), false);
  else {
    const val = new Map(alive.map((p) => [p, values(s, p)]));
    for (const p of alive) {
      names.set(p, handName(s, p));
      // открытые при ва-банке уже показаны — второй раз в журнал не пишем
      if (!s.shown[p]) ev.push({ type: 'show', seat: p, cards: s.hole[p].slice(), hand: names.get(p)! });
      s.shown[p] = s.hole[p].slice();
    }
    const levels = [...new Set(s.inHand.map((p) => s.total[p]).filter((v) => v > 0))].sort((a, b) => a - b);
    let prev = 0;
    for (const lv of levels) {
      const layer = s.inHand.reduce((a, p) => a + Math.max(0, Math.min(s.total[p], lv) - prev), 0);
      const elig0 = alive.filter((p) => s.total[p] >= lv);
      prev = lv;
      if (!layer) continue;
      const elig = elig0.length ? elig0 : alive;
      const best = (key: 'hi' | 'lo') => {
        const vs = elig.map((p) => val.get(p)![key]).filter((x): x is number => x != null);
        if (!vs.length) return [];
        const top = Math.max(...vs);
        return elig.filter((p) => val.get(p)![key] === top).sort((a, b) => a - b);
      };
      const hiW = best('hi');
      const loW = split(s) ? best('lo') : [];
      const parts: [number[], number, boolean][] = loW.length
        ? [
            [hiW, Math.ceil(layer / 2), false],
            [loW, Math.floor(layer / 2), true],
          ]
        : [[hiW, layer, false]];
      for (const [ws, amt, lo] of parts) {
        const share = Math.floor(amt / ws.length);
        let rest = amt - share * ws.length;
        for (const w of ws) give(w, share + (rest-- > 0 ? 1 : 0), lo);
      }
    }
  }
  for (const w of winners) ev.push({ type: 'win', seat: w.seat, amount: w.amount, hand: w.lo ? 'лоу' : w.hand, uncontested });
  s.last = { winners: winners.map((w) => ({ seat: w.seat, amount: w.amount, hand: w.lo ? 'лоу' : w.hand })) };
  if (s.rec) {
    const r = s.rec;
    r.board = s.board.slice();
    r.shown = { ...s.shown };
    r.winners = winners.map((w) => ({ ...w }));
    r.showdown = !uncontested;
    r.net = Object.fromEntries(r.seats.map((x) => [x.seat, s.chips[x.seat] - x.stack]));
    ev.push({ type: 'hand', rec: r });
  }
  for (const p of s.inHand) if (s.chips[p] === 0) ev.push({ type: 'bust', seat: p });
  // турнир сам решает, что дальше (poker/tour.ts)
  if (s.tour) {
    s.between = true;
    return { state: s, events: ev };
  }
  // кэш-игра: проигравшиеся докупаются, никто не выбывает
  if (s.cfg.cash)
    for (const p of s.seats)
      if (s.chips[p] === 0) {
        s.chips[p] = s.cfg.stack;
        s.rebuys = s.rebuys ?? Array(N).fill(0);
        s.rebuys[p]++;
        ev.push({ type: 'rebuy', seat: p, amount: s.cfg.stack });
      }
  const left = live(s);
  if (left.length <= 1 || (s.cfg.hands > 0 && s.hand >= s.cfg.hands)) {
    s.over = true;
    s.phase = 'over';
    ev.push({ type: 'end', winner: richest(s) });
    return { state: s, events: ev };
  }
  const d = deal(s, rng);
  return { state: d.state, events: [...ev, ...d.events] };
}

/** У кого больше всех фишек (при равных — первый по месту). */
export const richest = (s: Pick<State, 'seats' | 'chips'> & Partial<Pick<State, 'rebuys' | 'cfg'>>) => s.seats.slice().sort((a, b) => netOf(s, b) - netOf(s, a) || a - b)[0];

/** Итог места: фишки минус докупки (в кэш-игре); иначе — фишки. */
export const netOf = (s: Pick<State, 'chips'> & Partial<Pick<State, 'rebuys' | 'cfg'>>, p: number) => s.chips[p] - (s.rebuys?.[p] ?? 0) * (s.cfg?.stack ?? 0);

// ---------------------------------------------------------------- ход

function clone(s0: State): State {
  return {
    ...s0,
    chips: s0.chips.slice(),
    hole: s0.hole.map((h) => h.slice()),
    up: s0.up.map((u) => u.slice()),
    board: s0.board.slice(),
    deck: s0.deck.slice(),
    muck: s0.muck.slice(),
    folded: s0.folded.slice(),
    allin: s0.allin.slice(),
    bet: s0.bet.slice(),
    total: s0.total.slice(),
    acted: s0.acted.slice(),
    drew: s0.drew.slice(),
    drawn: s0.drawn.slice(),
    shown: { ...s0.shown },
    rec: s0.rec && { ...s0.rec, acts: s0.rec.acts.slice() },
  };
}

/** Сколько карт можно сменить. */
export const maxDraw = (s: State) => info(s).cards;

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over || s0.decide || s0.between || seat !== s0.turn || !a || typeof a !== 'object') return null;
  const s = clone(s0);
  const ev: Event[] = [];
  if (s.phase === 'discard') {
    const c = a.type === 'discard' ? a.card : null;
    const i = c ? s.hole[seat].findIndex((x) => sameCard(x, c)) : -1;
    if (i < 0 || s.hole[seat].length <= 2) return null;
    const out = s.hole[seat][i];
    s.hole[seat] = s.hole[seat].filter((_, k) => k !== i);
    s.up[seat] = s.hole[seat].map(() => false);
    s.muck.push(out);
    s.drew[seat] = true;
    ev.push({ type: 'discard', seat, card: out });
    s.rec?.acts.push({ k: 'discard', street: s.street, seat, card: out });
    return afterDraw(s, ev, rng);
  }
  if (s.phase === 'draw') {
    if (a.type !== 'draw' || !Array.isArray(a.cards) || a.cards.length > maxDraw(s) || s.drew[seat]) return null;
    const hand = s.hole[seat];
    if (!a.cards.every((c) => hand.some((x) => sameCard(x, c))) || new Set(a.cards.map((c) => c.s + c.r)).size !== a.cards.length) return null;
    const keep = hand.filter((c) => !a.cards.some((x) => sameCard(x, c)));
    s.muck.push(...a.cards);
    const got: Card[] = [];
    for (let i = 0; i < a.cards.length; i++) got.push(draw1(s, rng));
    s.hole[seat] = [...keep, ...got];
    s.up[seat] = s.hole[seat].map(() => false);
    s.drew[seat] = true;
    s.drawn[seat] = a.cards.length;
    ev.push({ type: 'draw', seat, count: a.cards.length, cards: got });
    s.rec?.acts.push({ k: 'draw', street: s.street, seat, out: a.cards.map((c) => ({ s: c.s, r: c.r })), got: got.slice() });
    return afterDraw(s, ev, rng);
  }
  if (!canAct(s, seat)) return null;
  const call = toCall(s, seat);
  const before = s.current;
  let amount = 0;
  switch (a.type) {
    case 'fold':
      s.folded[seat] = true;
      break;
    case 'check':
      if (call > 0) return null;
      break;
    case 'call':
      if (call <= 0) return null;
      amount = put(s, seat, call);
      break;
    case 'raise': {
      const rr = raiseRange(s, seat);
      const to = Math.round(Number(a.to));
      if (!rr || !Number.isFinite(to) || to < rr[0] || to > rr[1]) return null;
      const inc = to - s.current;
      amount = put(s, seat, to - s.bet[seat]);
      if (inc >= s.minRaise) s.minRaise = inc;
      s.current = Math.max(s.current, s.bet[seat]);
      s.raises++;
      s.acted = [];
      break;
    }
    case 'allin': {
      const st = structOf(s);
      const rr = raiseRange(s, seat);
      // в лимите и пот-лимите ва-банк — только если он не больше разрешённого рейза или это колл на все
      if (st !== 'nl' && s.chips[seat] + s.bet[seat] > (rr ? rr[1] : s.current)) return null;
      amount = put(s, seat, s.chips[seat]);
      if (s.bet[seat] > s.current) {
        const inc = s.bet[seat] - s.current;
        if (inc >= s.minRaise) {
          s.minRaise = inc;
          s.acted = [];
          s.raises++;
        }
        s.current = s.bet[seat];
      }
      break;
    }
    default:
      return null;
  }
  s.acted.push(seat);
  // в историю — смысл хода: ставка (первая на улице), рейз, колл (в том числе ва-банк меньше ставки)
  const kind = a.type === 'fold' || a.type === 'check' || a.type === 'call' ? a.type : s.bet[seat] > before ? (before === 0 || (info(s).family === 'stud' && s.street === 0 && s.raises <= 1 && before < s.big) ? 'bet' : 'raise') : 'call';
  ev.push({ type: 'act', seat, action: a, amount, to: s.bet[seat], allin: s.allin[seat], ...(kind === 'bet' ? { open: true } : {}) });
  s.rec?.acts.push({ k: 'act', street: s.street, seat, a: kind, amount, to: s.bet[seat], ...(s.allin[seat] ? { allin: true } : {}) });
  return advance(s, ev, rng);
}

/** Видно: свои карты, открытые карты стада, вскрытые руки. */
export function makeView(s: State, seats: number[] | 'all'): View {
  const see = (p: number) => seats === 'all' || seats.includes(p);
  const v = s as Partial<View>;
  return {
    ...s,
    hole: s.hole.map((h, p) => (see(p) || s.shown[p] ? h.slice() : h.map((c, i) => (s.up[p][i] ? c : (null as unknown as Card))))),
    deck: [],
    muck: [],
    counts: s.hole.map((h, p) => v.counts?.[p] ?? h.length),
    rec: s.rec && recFor(s.rec, seats),
  };
}

export const countOf = (s: State, p: number) => ((s as Partial<View>).counts ? (s as View).counts[p] : s.hole[p].length);
