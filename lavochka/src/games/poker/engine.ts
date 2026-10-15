/* Покер (2D) — Омаха, стад, дро, лоуболл, бадуги, HORSE (без DOM). Холдем отдельно — на 3D-столе; здесь он только в ротации HORSE.
 *
 * Семейства:
 *   flop  — холдем, Омаха (4 или 5 своих, ровно две свои + три общие): блайнды, префлоп, флоп, тёрн, ривер.
 *   stud  — 7-карточный (2 закрытые + 1 открытая, ещё три открытых, последняя закрытая) и 5-карточный (1 + 1, ещё три открытых):
 *           анте, «принос» — самая младшая открытая (в раззе — самая старшая), дальше первым ходит лучшая открытая рука.
 *   draw  — 5-карточное дро (один обмен), тройной обмен 2–7 и A–5, бадуги (4 карты), бадьюси (2–7 + бадуги), бадэйси (A–5 + бадуги).
 * Хай-лоу «8 или лучше» (Омаха, стад): половина банка — старшей, половина — лучшей лоу из пяти разных до восьмёрки; лоу нет — всё старшей.
 * Ставки: лимит (малая ставка на ранних улицах, большая на поздних, не больше четырёх ставок за круг), пот-лимит, безлимит.
 * Партия до того, как у одного все фишки, или до N раздач — тогда побеждает самый богатый.
 */
import type { Options, Rng } from '../../core/types';
import { sameCard, type Card, type Suit } from '../../cards/deck';
import { allCards, badugi, high, low27, low8, lowA5, omahaHigh } from './hands';

export type Game = 'holdem' | 'omaha4' | 'omaha5' | 'stud7' | 'stud5' | 'razz' | 'draw5' | 'td27' | 'tda5' | 'badugi' | 'badeucy' | 'badacey';
export type Mode = Game | 'horse';
export type Struct = 'limit' | 'pot' | 'nl';
export type Family = 'flop' | 'stud' | 'draw';

export interface GameInfo {
  name: string;
  family: Family;
  /** Сколько своих карт (у стада — всего за раздачу). */
  cards: number;
  draws: number;
  /** Как делится банк: 'hi', 'lo' (весь банк младшей), 'split' (хай-лоу 8), 'bad27', 'badA5'. */
  pot: 'hi' | 'loA5' | 'lo27' | 'badugi' | 'hilo' | 'bad27' | 'badA5';
  struct: Struct;
}

export const GAMES: Record<Game, GameInfo> = {
  holdem: { name: 'Холдем', family: 'flop', cards: 2, draws: 0, pot: 'hi', struct: 'limit' },
  omaha4: { name: 'Омаха', family: 'flop', cards: 4, draws: 0, pot: 'hi', struct: 'pot' },
  omaha5: { name: 'Омаха-5', family: 'flop', cards: 5, draws: 0, pot: 'hi', struct: 'pot' },
  stud7: { name: 'Стад-7', family: 'stud', cards: 7, draws: 0, pot: 'hi', struct: 'limit' },
  stud5: { name: 'Стад-5', family: 'stud', cards: 5, draws: 0, pot: 'hi', struct: 'limit' },
  razz: { name: 'Разз', family: 'stud', cards: 7, draws: 0, pot: 'loA5', struct: 'limit' },
  draw5: { name: 'Дро', family: 'draw', cards: 5, draws: 1, pot: 'hi', struct: 'nl' },
  td27: { name: '2–7 тройной обмен', family: 'draw', cards: 5, draws: 3, pot: 'lo27', struct: 'limit' },
  tda5: { name: 'A–5 тройной обмен', family: 'draw', cards: 5, draws: 3, pot: 'loA5', struct: 'limit' },
  badugi: { name: 'Бадуги', family: 'draw', cards: 4, draws: 3, pot: 'badugi', struct: 'limit' },
  badeucy: { name: 'Бадьюси', family: 'draw', cards: 5, draws: 3, pot: 'bad27', struct: 'limit' },
  badacey: { name: 'Бадэйси', family: 'draw', cards: 5, draws: 3, pot: 'badA5', struct: 'limit' },
};

/** HORSE: холдем, Омаха хай-лоу, разз, стад, стад хай-лоу — по кругу раздач на игру. */
export const HORSE: { game: Game; hilo: boolean; letter: string }[] = [
  { game: 'holdem', hilo: false, letter: 'H' },
  { game: 'omaha4', hilo: true, letter: 'O' },
  { game: 'razz', hilo: false, letter: 'R' },
  { game: 'stud7', hilo: false, letter: 'S' },
  { game: 'stud7', hilo: true, letter: 'E' },
];

export interface Cfg {
  mode: Mode;
  hilo: boolean;
  /** 'auto' — как принято для вида. */
  struct: Struct | 'auto';
  stack: number;
  /** Раздач в партии (0 — до последнего). */
  hands: number;
}

export function cfgFrom(o: Options): Cfg {
  const modes: Mode[] = ['omaha4', 'omaha5', 'stud7', 'stud5', 'razz', 'draw5', 'td27', 'tda5', 'badugi', 'badeucy', 'badacey', 'horse'];
  const mode = modes.includes(o.mode as Mode) ? (o.mode as Mode) : 'omaha4';
  const st = o.struct === 'limit' || o.struct === 'pot' || o.struct === 'nl' ? o.struct : 'auto';
  return { mode, hilo: !!o.hilo, struct: st, stack: [500, 1000, 2000].includes(Number(o.stack)) ? Number(o.stack) : 1000, hands: [0, 20, 40].includes(Number(o.hands)) ? Number(o.hands) : 30 };
}

export const SB = 10;
export const BB = 20;
export const ANTE = 5;
export const BRING = 5;
const CAP = 4;
const N = 6;

export type Phase = 'bet' | 'draw' | 'over';

export interface State {
  cfg: Cfg;
  seats: number[];
  /** Вид текущей раздачи (в HORSE меняется). */
  game: Game;
  hilo: boolean;
  hand: number;
  button: number;
  chips: number[];
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
  /** Кто уже менял в этом обмене. */
  drew: boolean[];
  /** Сколько карт сменил каждый в последнем обмене (видно всем). */
  drawn: number[];
  shown: Record<number, Card[]>;
  last: { winners: { seat: number; amount: number; hand: string }[] } | null;
  over: boolean;
}

export interface View extends State {
  counts: number[];
}

export type Action = { type: 'fold' } | { type: 'check' } | { type: 'call' } | { type: 'raise'; to: number } | { type: 'allin' } | { type: 'draw'; cards: Card[] };

export type Event =
  | { type: 'deal'; hand: number; game: Game; hilo: boolean; button: number; hole?: Card[][]; up?: boolean[][] }
  | { type: 'post'; seat: number; amount: number; what: string }
  | { type: 'act'; seat: number; action: Action; amount: number }
  | { type: 'street'; street: number; board?: Card[]; cards?: { seat: number; card: Card | null; up: boolean }[] }
  | { type: 'draw'; seat: number; count: number; cards?: Card[] }
  | { type: 'show'; seat: number; cards: Card[]; hand: string }
  | { type: 'win'; seat: number; amount: number; hand: string }
  | { type: 'bust'; seat: number }
  | { type: 'end'; winner: number };

export const info = (s: Pick<State, 'game'>) => GAMES[s.game];
/** HORSE — весь лимитный; иначе как выбрано (или как принято для вида). */
export const structOf = (s: Pick<State, 'cfg' | 'game'>): Struct => (s.cfg.mode === 'horse' ? 'limit' : s.cfg.struct === 'auto' ? GAMES[s.game].struct : s.cfg.struct);
const live = (s: State) => s.seats.filter((p) => s.chips[p] > 0);
const nextIn = (list: number[], p: number) => {
  const all = [...list].sort((a, b) => a - b);
  return all.find((x) => x > p) ?? all[0];
};
export const contenders = (s: State) => s.inHand.filter((p) => !s.folded[p]);
const canAct = (s: State, p: number) => s.inHand.includes(p) && !s.folded[p] && !s.allin[p];
export const potSize = (s: State) => s.inHand.reduce((a, p) => a + s.total[p], 0);

/** Размер ставки в лимите на этой улице. */
export function betUnit(s: State): number {
  const g = info(s);
  if (g.family === 'flop') return s.street >= 2 ? BB * 2 : BB;
  // стад: с пятой улицы (у пятикарточного — с четвёртой карты) — большая
  if (g.family === 'stud') return s.street >= 2 ? BB * 2 : BB;
  // дро: после обмена (в тройном — после второго) — большая
  return s.street >= (g.draws === 1 ? 1 : 2) ? BB * 2 : BB;
}

export function newState(cfg: Cfg, seats: number[]): State {
  const z = () => Array(N).fill(0);
  const first = cfg.mode === 'horse' ? HORSE[0] : { game: cfg.mode as Game, hilo: cfg.hilo };
  return {
    cfg,
    seats: seats.slice(),
    game: first.game,
    hilo: first.hilo,
    hand: 0,
    button: seats[seats.length - 1],
    chips: Array.from({ length: N }, (_, p) => (seats.includes(p) ? cfg.stack : 0)),
    hole: [[], [], [], [], [], []],
    up: [[], [], [], [], [], []],
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
    minRaise: BB,
    raises: 0,
    acted: [],
    turn: seats[0],
    drew: Array(N).fill(false),
    drawn: z(),
    shown: {},
    last: null,
    over: false,
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

function put(s: State, p: number, amount: number) {
  const a = Math.min(amount, s.chips[p]);
  s.chips[p] -= a;
  s.bet[p] += a;
  s.total[p] += a;
  if (s.chips[p] === 0) s.allin[p] = true;
  return a;
}

/** Ранг открытых карт стада для порядка хода (старше — лучше; в раззе — младше лучше). */
function upValue(s: State, p: number): number {
  const ups = s.hole[p].filter((_, i) => s.up[p][i]);
  if (s.game === 'razz') return lowA5(ups.length >= 5 ? ups : ups) + 0;
  return high(ups);
}

const SUIT_ORDER: Suit[] = ['C', 'D', 'H', 'S'];

export function deal(s0: State, rng: Rng): { state: State; events: Event[] } {
  const s: State = { ...s0, chips: s0.chips.slice() };
  const ev: Event[] = [];
  s.hand++;
  if (s.cfg.mode === 'horse') {
    const k = Math.floor((s.hand - 1) / Math.max(2, s.seats.length)) % HORSE.length;
    s.game = HORSE[k].game;
    s.hilo = HORSE[k].hilo;
  }
  const players = live(s);
  s.button = nextIn(players, s.button);
  s.deck = shuffle(allCards(), rng);
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
  s.minRaise = BB;
  s.raises = 0;
  s.acted = [];
  s.drew = Array(N).fill(false);
  s.drawn = Array(N).fill(0);
  s.shown = {};
  s.hole = [[], [], [], [], [], []];
  s.up = [[], [], [], [], [], []];
  const g = info(s);
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
    for (const p of order) for (let i = 0; i < g.cards; i++) {
      s.hole[p].push(draw1(s, rng));
      s.up[p].push(false);
    }
  }
  ev.push({ type: 'deal', hand: s.hand, game: s.game, hilo: s.hilo, button: s.button, hole: s.hole.map((h) => h.slice()), up: s.up.map((u) => u.slice()) });
  if (g.family === 'stud') {
    for (const p of players) {
      const a = put(s, p, ANTE);
      if (a) ev.push({ type: 'post', seat: p, amount: a, what: 'анте' });
    }
    s.bet = Array(N).fill(0);
    // принос: младшая открытая (в раззе — старшая), при равных — по масти
    const card = (p: number) => s.hole[p][s.up[p].indexOf(true)];
    const key = (p: number) => {
      const c = card(p);
      const r = s.game === 'razz' ? (c.r === 14 ? 1 : c.r) : c.r;
      return (s.game === 'razz' ? -r : r) * 4 + (s.game === 'razz' ? -SUIT_ORDER.indexOf(c.s) : SUIT_ORDER.indexOf(c.s));
    };
    const bring = players.slice().sort((a, b) => key(a) - key(b))[0];
    const a = put(s, bring, BRING);
    ev.push({ type: 'post', seat: bring, amount: a, what: 'принос' });
    s.current = BRING;
    s.minRaise = BB - BRING;
    s.turn = nextIn(players, bring);
    while (!canAct(s, s.turn) && s.turn !== bring) s.turn = nextIn(players, s.turn);
    return finishDealSetup(s, ev, rng);
  }
  // блайнды (вдвоём: баттон — малый)
  const sb = players.length === 2 ? s.button : nextIn(players, s.button);
  const bb = nextIn(players, sb);
  ev.push({ type: 'post', seat: sb, amount: put(s, sb, SB), what: 'малый блайнд' });
  ev.push({ type: 'post', seat: bb, amount: put(s, bb, BB), what: 'большой блайнд' });
  s.current = BB;
  s.minRaise = BB;
  s.turn = nextIn(players, bb);
  return finishDealSetup(s, ev, rng);
}

function finishDealSetup(s: State, ev: Event[], rng: Rng) {
  // если ходить некому (все ва-банк на блайндах) — сразу дальше
  if (!canAct(s, s.turn) || contenders(s).filter((p) => !s.allin[p]).length < 2) {
    const r = advance(s, ev, rng, true);
    return r;
  }
  return { state: s, events: ev };
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  return deal(newState(cfgFrom(opts), seats), rng).state;
}

export const toAct = (s: State): number[] => (s.over ? [] : [s.turn]);
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
  const min = Math.min(stack, s.current + Math.max(s.minRaise, BB));
  if (st === 'nl') return [min, stack];
  // пот-лимит: колл и сверху весь банк с коллом
  const call = s.current - s.bet[p];
  const max = Math.min(stack, s.current + potSize(s) + call);
  return [Math.min(min, max), max];
}

function nextToAct(s: State, from: number): number | null {
  const order = [...s.inHand].sort((a, b) => a - b);
  let x = from;
  for (let i = 0; i < order.length; i++) {
    x = nextIn(order, x);
    if (canAct(s, x) && (!s.acted.includes(x) || s.bet[x] < s.current)) return x;
  }
  return null;
}

/** Первый ход на улице: у стада — лучшая открытая рука, иначе — первый слева от баттона. */
function firstOnStreet(s: State): number | null {
  const can = contenders(s).filter((p) => !s.allin[p]);
  if (!can.length) return null;
  if (info(s).family === 'stud') return can.slice().sort((a, b) => upValue(s, b) - upValue(s, a) || a - b)[0];
  let x = s.button;
  for (let i = 0; i < 6; i++) {
    x = nextIn(s.inHand, x);
    if (can.includes(x)) return x;
  }
  return can[0];
}

function newRound(s: State) {
  s.bet = Array(N).fill(0);
  s.current = 0;
  s.minRaise = BB;
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
    s.street++;
    newRound(s);
    if (g.family === 'flop') {
      draw1(s, rng); // в сброс
      const n = s.street === 1 ? 3 : 1;
      const cards: Card[] = [];
      for (let i = 0; i < n; i++) cards.push(draw1(s, rng));
      s.board = [...s.board, ...cards];
      ev.push({ type: 'street', street: s.street, board: cards });
    } else if (g.family === 'stud') {
      const lastDown = g.cards === 7 && s.street === 4;
      const cards: { seat: number; card: Card | null; up: boolean }[] = [];
      for (const p of contenders(s)) {
        const c = draw1(s, rng);
        s.hole[p].push(c);
        s.up[p].push(!lastDown);
        cards.push({ seat: p, card: c, up: !lastDown });
      }
      ev.push({ type: 'street', street: s.street, cards });
    } else {
      // дро: обмен перед торговлей
      s.phase = 'draw';
      s.drew = Array(N).fill(false);
      s.drawn = Array(N).fill(0);
      ev.push({ type: 'street', street: s.street });
      const first = firstOnStreet(s) ?? contenders(s)[0];
      s.turn = firstDrawer(s, first);
      return { state: s, events: ev };
    }
    const can = contenders(s).filter((p) => !s.allin[p]);
    if (can.length >= 2) {
      s.turn = firstOnStreet(s)!;
      return { state: s, events: ev };
    }
  }
}

/** Меняют все оставшиеся в раздаче (и ва-банк тоже — им тоже нужно добрать карты). */
function firstDrawer(s: State, from: number): number {
  const c = contenders(s);
  if (c.includes(from)) return from;
  return c[0];
}

function afterDraw(s: State, ev: Event[], rng: Rng): { state: State; events: Event[] } {
  const c = contenders(s);
  const left = c.filter((p) => !s.drew[p]);
  if (left.length) {
    let x = s.turn;
    for (let i = 0; i < 6; i++) {
      x = nextIn(s.inHand, x);
      if (left.includes(x)) break;
    }
    s.turn = x;
    return { state: s, events: ev };
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

export function hiValue(s: State, p: number): number {
  const cards = s.hole[p];
  switch (s.game) {
    case 'omaha4':
    case 'omaha5':
      return omahaHigh(cards, s.board);
    case 'holdem':
      return high([...cards, ...s.board]);
    default:
      return high(cards);
  }
}

/** Значения для делёжа: hi (всегда есть), lo (null — не претендует). Смысл «hi» в лоуболле — лучшая низкая. */
export function values(s: State, p: number): { hi: number; lo: number | null } {
  const cards = s.hole[p];
  const omaha = s.game === 'omaha4' || s.game === 'omaha5';
  switch (info(s).pot) {
    case 'hi':
      return { hi: hiValue(s, p), lo: s.hilo ? low8(omaha ? [] : cards, omaha ? { hole: cards, board: s.board } : undefined) : null };
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
  return { hi: hiValue(s, p), lo: null };
}

/** Делится ли банк пополам (хай-лоу и бадьюси/бадэйси). */
const split = (s: State) => s.hilo || info(s).pot === 'bad27' || info(s).pot === 'badA5';

export function finishHand(s: State, ev: Event[], rng: Rng, uncontested: boolean): { state: State; events: Event[] } {
  const alive = contenders(s);
  const winners: { seat: number; amount: number; hand: string }[] = [];
  const give = (p: number, amt: number, hand: string) => {
    if (!amt) return;
    s.chips[p] += amt;
    const w = winners.find((x) => x.seat === p);
    if (w) w.amount += amt;
    else winners.push({ seat: p, amount: amt, hand });
  };
  if (uncontested) give(alive[0], potSize(s), '');
  else {
    const val = new Map(alive.map((p) => [p, values(s, p)]));
    for (const p of alive) {
      s.shown[p] = s.hole[p].slice();
      ev.push({ type: 'show', seat: p, cards: s.hole[p].slice(), hand: '' });
    }
    const levels = [...new Set(s.inHand.map((p) => s.total[p]).filter((v) => v > 0))].sort((a, b) => a - b);
    let prev = 0;
    for (const lv of levels) {
      let layer = s.inHand.reduce((a, p) => a + Math.max(0, Math.min(s.total[p], lv) - prev), 0);
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
      const parts: [number[], number][] = loW.length ? [[hiW, Math.ceil(layer / 2)], [loW, Math.floor(layer / 2)]] : [[hiW, layer]];
      for (const [ws, amt] of parts) {
        const share = Math.floor(amt / ws.length);
        let rest = amt - share * ws.length;
        for (const w of ws) give(w, share + (rest-- > 0 ? 1 : 0), loW.includes(w) && !hiW.includes(w) ? 'лоу' : '');
        layer -= amt;
      }
    }
  }
  for (const w of winners) ev.push({ type: 'win', seat: w.seat, amount: w.amount, hand: w.hand });
  s.last = { winners };
  for (const p of s.inHand) if (s.chips[p] === 0) ev.push({ type: 'bust', seat: p });
  // мусор раздачи — в сброс
  const left = live(s);
  if (left.length <= 1 || (s.cfg.hands > 0 && s.hand >= s.cfg.hands)) {
    s.over = true;
    s.phase = 'over';
    const rich = s.seats.slice().sort((a, b) => s.chips[b] - s.chips[a])[0];
    ev.push({ type: 'end', winner: rich });
    return { state: s, events: ev };
  }
  const d = deal(s, rng);
  return { state: d.state, events: [...ev, ...d.events] };
}

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
  };
}

/** Сколько карт можно сменить. */
export const maxDraw = (s: State) => info(s).cards;

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn || !a || typeof a !== 'object') return null;
  const s = clone(s0);
  const ev: Event[] = [];
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
    return afterDraw(s, ev, rng);
  }
  if (!canAct(s, seat)) return null;
  const call = toCall(s, seat);
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
  ev.push({ type: 'act', seat, action: a, amount });
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
  };
}

export const countOf = (s: State, p: number) => ((s as Partial<View>).counts ? (s as View).counts[p] : s.hole[p].length);
