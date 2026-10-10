/* Домино «Козёл» — правила (без DOM): козёл, морской козёл, осёл; 2–4 игрока, вчетвером — парами.
 *
 * 28 костей 0-0…6-6, на руку по 7, остаток (при двух и трёх игроках) — базар. Кость кладут к концу ряда с тем же числом.
 * Нечем ходить — берут из базара по одной, пока не найдётся; базар пуст — пропускают ход («еду»).
 * Кон кончается, когда кто-то выложил все кости (его сторона выиграла кон) или ряд «заперт» — «рыба»:
 * ходить не может никто, тогда выигрывает сторона, у которой на руках меньше очков; поровну — «яйца».
 * Проигравшие записывают на себя очки со своих рук (одинокое «пусто-пусто» — 25). Меньше 13 (в морском — 25) не пишут — висит до следующего раза.
 * Кто первым набрал 101 (в морском — 125) — «козёл», проиграл.
 * Осёл: от первого дубля ряд идёт в четыре стороны; за ход можно выложить ещё и свои дубли; положив дубль, можно сказать «Закрыто» —
 * в эту сторону больше не ставят.
 * Места: 0…3 по кругу; вдвоём играют места 0 и 2 (друг напротив друга), вчетвером пары — 0 и 2 против 1 и 3.
 */
import type { Options, Rng } from '../../core/types';

export type Variant = 'kozel' | 'morskoy' | 'osel';
export type Bone = [number, number];

export interface Cfg {
  variant: Variant;
  /** Вчетвером — парами (напарник напротив). */
  pairs: boolean;
}

export function cfgFrom(o: Options): Cfg {
  const v = String(o.variant);
  return { variant: v === 'morskoy' || v === 'osel' ? v : 'kozel', pairs: o.pairs !== false };
}

export const limits = (cfg: Cfg) => (cfg.variant === 'morskoy' ? { min: 25, to: 125 } : { min: 13, to: 101 });

/** Кость в ряду: a — число со стороны центра, b — открытое наружу. */
export interface Tile {
  a: number;
  b: number;
  seat: number;
}

export interface Arm {
  tiles: Tile[];
  /** «Закрыто» (осёл) — сюда больше не ставят. */
  closed: boolean;
}

export interface Chain {
  center: Tile | null;
  /** 0 — влево, 1 — вправо, 2 — вверх, 3 — вниз (верх и низ — только в осле от дубля). */
  arms: Arm[];
}

export interface State {
  cfg: Cfg;
  seats: number[];
  hands: Bone[][];
  bazaar: Bone[];
  chain: Chain;
  turn: number;
  /** play — обычный ход; more — осёл: можно доложить дубли или сказать «хватит». */
  phase: 'play' | 'more' | 'over';
  /** Кон (с 1). */
  round: number;
  /** Кто начинает кон и какой костью обязан (только в первом кону). */
  opener: Bone | null;
  /** Очки сторон (сторона — пара или игрок). */
  scores: number[];
  /** Невписанные очки (меньше 13 / 25) — висят. */
  hang: number[];
  /** «Яйца»: очки ничейной рыбы, достанутся проигравшим в следующем кону. */
  eggs: number;
  /** Числа, на которые игрок уже не мог ходить (публично: все видели, как он брал из базара или пропускал). */
  lacks: number[][];
  /** Сколько ходов подряд пропустили — для справки в отрисовке. */
  passes: number;
  /** Последний выигравший кон (он начинает следующий). */
  lastWinner: number | null;
  /** Итог: кто «козёл» (сторона). */
  goat: number | null;
  winners: number[];
}

export interface View extends State {
  counts: number[];
  bazaarCount: number;
  me: number[];
}

export type Action =
  | { type: 'play'; bone: Bone; arm: number; close?: boolean }
  | { type: 'draw' }
  | { type: 'pass' }
  | { type: 'enough' };

export interface RoundRes {
  /** Кто выиграл кон (место) — вышел первым или выиграл рыбу; null — яйца. */
  winner: number | null;
  fish: boolean;
  /** Очки на руках у каждой стороны. */
  pips: number[];
  /** Сколько записали каждой стороне в этот кон. */
  wrote: number[];
}

export type Event =
  | { type: 'deal'; round: number; counts: number[]; bazaar: number; first: number; opener: Bone | null; hands?: Bone[][] }
  | { type: 'play'; seat: number; bone: Bone; arm: number; tile: Tile; close: boolean; center: boolean }
  | { type: 'draw'; seat: number; bone?: Bone; left: number }
  | { type: 'pass'; seat: number }
  | { type: 'enough'; seat: number }
  | { type: 'round'; res: RoundRes; scores: number[]; hands: Bone[][]; sides: number[][] }
  | { type: 'end'; goat: number; goatSeats: number[]; winners: number[]; scores: number[] };

// ---------------------------------------------------------------- кости

export const pips = (b: Bone) => b[0] + b[1];
export const isDouble = (b: Bone) => b[0] === b[1];
export const sameBone = (x: Bone, y: Bone) => (x[0] === y[0] && x[1] === y[1]) || (x[0] === y[1] && x[1] === y[0]);
const norm = (b: Bone): Bone => (b[0] <= b[1] ? [b[0], b[1]] : [b[1], b[0]]);

export function allBones(): Bone[] {
  const out: Bone[] = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) out.push([a, b]);
  return out;
}

/** Очки руки: одинокое «пусто-пусто» — 25. */
export function handPips(h: Bone[]): number {
  if (h.length === 1 && h[0][0] === 0 && h[0][1] === 0) return 25;
  return h.reduce((a, b) => a + pips(b), 0);
}

export const seatsFor = (n: number) => (n === 2 ? [0, 2] : n === 3 ? [0, 1, 2] : [0, 1, 2, 3]);
/** Сторона места: пара (0 — места 0 и 2, 1 — места 1 и 3) или сам игрок (индекс в seats). */
export const sideOf = (s: Pick<State, 'cfg' | 'seats'>, seat: number) => (teams(s) ? seat % 2 : s.seats.indexOf(seat));
export const teams = (s: Pick<State, 'cfg' | 'seats'>) => s.seats.length === 4 && s.cfg.pairs;
export const sideCount = (s: Pick<State, 'cfg' | 'seats'>) => (teams(s) ? 2 : s.seats.length);
export const sideSeats = (s: Pick<State, 'cfg' | 'seats'>, side: number) => s.seats.filter((x) => sideOf(s, x) === side);
export const nextSeat = (s: Pick<State, 'seats'>, seat: number) => s.seats[(s.seats.indexOf(seat) + 1) % s.seats.length];

// ---------------------------------------------------------------- ряд

/** Открытые концы: номер руки → число на конце. */
export function ends(c: Chain, cfg: Cfg): { arm: number; v: number }[] {
  if (!c.center) return [];
  const out: { arm: number; v: number }[] = [];
  const dbl = c.center.a === c.center.b;
  const n = cfg.variant === 'osel' && dbl ? 4 : 2;
  for (let i = 0; i < n; i++) {
    const arm = c.arms[i];
    if (arm.closed) continue;
    const last = arm.tiles[arm.tiles.length - 1];
    const v = last ? last.b : i === 0 ? c.center.a : c.center.b;
    out.push({ arm: i, v });
  }
  return out;
}

export interface Placement {
  bone: Bone;
  /** -1 — первая кость в центр. */
  arm: number;
}

/** Куда можно положить кости руки. */
export function placements(s: Pick<State, 'chain' | 'cfg' | 'opener'>, hand: Bone[], onlyDoubles = false): Placement[] {
  if (!s.chain.center) {
    const list = s.opener ? hand.filter((b) => sameBone(b, s.opener!)) : hand;
    return list.map((bone) => ({ bone, arm: -1 }));
  }
  const out: Placement[] = [];
  const es = ends(s.chain, s.cfg);
  for (const bone of hand) {
    if (onlyDoubles && !isDouble(bone)) continue;
    const seen = new Set<string>();
    for (const e of es) {
      if (bone[0] !== e.v && bone[1] !== e.v) continue;
      // одинаковые концы — одно и то же место для игрока; но в осле руки разные, оставляем все
      const key = `${e.arm}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ bone, arm: e.arm });
    }
  }
  return out;
}

function placeTile(c: Chain, bone: Bone, arm: number, seat: number, close: boolean, cfg: Cfg): { chain: Chain; tile: Tile } {
  const chain: Chain = { center: c.center, arms: c.arms.map((a) => ({ tiles: a.tiles.slice(), closed: a.closed })) };
  if (arm < 0) {
    const tile = { a: bone[0], b: bone[1], seat };
    chain.center = tile;
    return { chain, tile };
  }
  const e = ends(c, cfg).find((x) => x.arm === arm)!;
  const tile = { a: e.v, b: bone[0] === e.v ? bone[1] : bone[0], seat };
  chain.arms[arm].tiles.push(tile);
  if (close) chain.arms[arm].closed = true;
  return { chain, tile };
}

// ---------------------------------------------------------------- партия

const emptyChain = (): Chain => ({ center: null, arms: [0, 1, 2, 3].map(() => ({ tiles: [], closed: false })) });

export function newState(cfg: Cfg, seats: number[]): State {
  const sides = seats.length === 4 && cfg.pairs ? 2 : seats.length;
  return {
    cfg,
    seats: seats.slice(),
    hands: [[], [], [], []],
    bazaar: [],
    chain: emptyChain(),
    turn: seats[0],
    phase: 'play',
    round: 0,
    opener: null,
    scores: Array(sides).fill(0),
    hang: Array(sides).fill(0),
    eggs: 0,
    lacks: [[], [], [], []],
    passes: 0,
    lastWinner: null,
    goat: null,
    winners: [],
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

/** Раздача нового кона. Первый кон начинает тот, у кого 1-1 (нет на руках — меньший дубль, без дублей — самая тяжёлая кость). */
export function deal(s0: State, rng: Rng): { state: State; events: Event[] } {
  const s: State = { ...s0, hands: [[], [], [], []], chain: emptyChain(), lacks: [[], [], [], []], passes: 0, phase: 'play', round: s0.round + 1 };
  const deck = shuffle(allBones(), rng);
  for (const seat of s.seats) s.hands[seat] = deck.splice(0, 7).map(norm);
  s.bazaar = deck;
  let first: number;
  if (s.round === 1 || s0.lastWinner == null) {
    const order = [1, 2, 3, 4, 5, 6, 0];
    let found: { seat: number; bone: Bone } | null = null;
    for (const d of order) {
      const seat = s.seats.find((x) => s.hands[x].some((b) => b[0] === d && b[1] === d));
      if (seat != null) {
        found = { seat, bone: [d, d] };
        break;
      }
    }
    if (!found) {
      let best = -1;
      for (const seat of s.seats)
        for (const b of s.hands[seat])
          if (pips(b) > best) {
            best = pips(b);
            found = { seat, bone: b };
          }
    }
    first = found!.seat;
    s.opener = found!.bone;
  } else {
    first = s0.lastWinner;
    s.opener = null;
  }
  s.turn = first;
  const counts = [0, 1, 2, 3].map((x) => s.hands[x].length);
  return { state: s, events: [{ type: 'deal', round: s.round, counts, bazaar: s.bazaar.length, first, opener: s.opener, hands: s.hands.map((h) => h.slice()) }] };
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  return deal(newState(cfgFrom(opts), seats), rng).state;
}

export const toAct = (s: State): number[] => (s.phase === 'over' ? [] : [s.turn]);

/** Может ли кто-нибудь положить кость (или взять из базара). */
function anyMove(s: State): boolean {
  if (s.bazaar.length) return true;
  return s.seats.some((x) => placements(s, s.hands[x]).length > 0);
}

function addLack(s: State, seat: number) {
  const vs = ends(s.chain, s.cfg).map((e) => e.v);
  const cur = new Set(s.lacks[seat]);
  for (const v of vs) cur.add(v);
  s.lacks = s.lacks.map((l, i) => (i === seat ? [...cur].sort() : l));
}

/** Конец кона: подсчёт и запись очков. winnerSeat — кто вышел (или null — рыба). */
function endRound(s: State, outSeat: number | null, ev: Event[], rng: Rng): { state: State; events: Event[] } {
  const ns = sideCount(s);
  const pipsBy = Array(ns).fill(0);
  for (const seat of s.seats) pipsBy[sideOf(s, seat)] += handPips(s.hands[seat]);
  let winSide: number | null;
  let winnerSeat: number | null = outSeat;
  const fish = outSeat == null;
  if (!fish) winSide = sideOf(s, outSeat!);
  else {
    const min = Math.min(...pipsBy);
    const best = pipsBy.map((p, i) => (p === min ? i : -1)).filter((i) => i >= 0);
    winSide = best.length === 1 ? best[0] : null;
    // рыбу выиграл — из этой стороны начинает следующий кон тот, у кого меньше на руках
    if (winSide != null) winnerSeat = sideSeats(s, winSide).sort((x, y) => handPips(s.hands[x]) - handPips(s.hands[y]))[0];
  }
  const { min, to } = limits(s.cfg);
  const wrote = Array(ns).fill(0);
  const scores = s.scores.slice();
  const hang = s.hang.slice();
  let eggs = s.eggs;
  if (winSide == null) {
    // яйца: никто не пишет, очки уходят в следующий кон
    eggs += pipsBy.reduce((a, b) => a + b, 0);
  } else {
    for (let side = 0; side < ns; side++) {
      if (side === winSide) continue;
      const total = pipsBy[side] + hang[side] + eggs;
      if (total >= min) {
        scores[side] += total;
        wrote[side] = total;
        hang[side] = 0;
      } else hang[side] = total;
    }
    eggs = 0;
  }
  const res: RoundRes = { winner: winnerSeat, fish, pips: pipsBy, wrote };
  const sides = Array.from({ length: ns }, (_, i) => sideSeats(s, i));
  ev.push({ type: 'round', res, scores: scores.slice(), hands: s.hands.map((h) => h.slice()), sides });
  const st: State = { ...s, scores, hang, eggs, lastWinner: winnerSeat ?? s.lastWinner };
  const over = scores.some((x) => x >= to);
  if (over) {
    const top = Math.max(...scores);
    const goat = scores.indexOf(top);
    const low = Math.min(...scores);
    const winners = s.seats.filter((x) => scores[sideOf(s, x)] === low && scores[sideOf(s, x)] < top);
    st.phase = 'over';
    st.goat = goat;
    st.winners = winners.length ? winners : s.seats.filter((x) => sideOf(s, x) !== goat);
    ev.push({ type: 'end', goat, goatSeats: sideSeats(s, goat), winners: st.winners, scores: scores.slice() });
    return { state: st, events: ev };
  }
  const d = deal(st, rng);
  return { state: d.state, events: [...ev, ...d.events] };
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.phase === 'over' || seat !== s0.turn || !a || typeof a !== 'object') return null;
  const hand = s0.hands[seat];
  const ev: Event[] = [];
  if (a.type === 'enough') {
    if (s0.phase !== 'more') return null;
    ev.push({ type: 'enough', seat });
    return afterTurn({ ...s0, phase: 'play' }, seat, ev, rng);
  }
  if (a.type === 'draw') {
    if (s0.phase !== 'play' || placements(s0, hand).length || !s0.bazaar.length) return null;
    const s: State = { ...s0, bazaar: s0.bazaar.slice(), hands: s0.hands.slice() };
    const bone = s.bazaar.shift()!;
    s.hands[seat] = [...hand, bone];
    addLack(s, seat);
    ev.push({ type: 'draw', seat, bone, left: s.bazaar.length });
    return { state: s, events: ev };
  }
  if (a.type === 'pass') {
    if (s0.phase !== 'play' || placements(s0, hand).length || s0.bazaar.length) return null;
    const s: State = { ...s0, passes: s0.passes + 1 };
    addLack(s, seat);
    ev.push({ type: 'pass', seat });
    return afterTurn(s, seat, ev, rng);
  }
  if (a.type !== 'play' || !Array.isArray(a.bone)) return null;
  const opts = placements(s0, hand, s0.phase === 'more');
  const p = opts.find((x) => sameBone(x.bone, a.bone) && x.arm === a.arm);
  if (!p) return null;
  const close = !!a.close && s0.cfg.variant === 'osel' && isDouble(p.bone) && p.arm >= 0;
  const { chain, tile } = placeTile(s0.chain, p.bone, p.arm, seat, close, s0.cfg);
  const hands = s0.hands.slice();
  hands[seat] = hand.filter((b) => !sameBone(b, p.bone));
  const s: State = { ...s0, chain, hands, opener: null, passes: 0 };
  ev.push({ type: 'play', seat, bone: p.bone, arm: p.arm, tile, close, center: p.arm < 0 });
  if (!hands[seat].length) return endRound(s, seat, ev, rng);
  // осёл: после хода можно доложить свои дубли
  if (s.cfg.variant === 'osel' && placements(s, hands[seat], true).length) return { state: { ...s, phase: 'more' }, events: ev };
  return afterTurn({ ...s, phase: 'play' }, seat, ev, rng);
}

function afterTurn(s: State, seat: number, ev: Event[], rng: Rng): { state: State; events: Event[] } {
  if (!anyMove(s)) return endRound(s, null, ev, rng);
  return { state: { ...s, turn: nextSeat(s, seat) }, events: ev };
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const see = (x: number) => seats === 'all' || seats.includes(x);
  return {
    ...s,
    hands: s.hands.map((h, x) => (see(x) ? h.slice() : [])),
    bazaar: [],
    counts: s.hands.map((h) => h.length),
    bazaarCount: s.bazaar.length,
    me: seats === 'all' ? s.seats.slice() : seats.slice(),
  };
}

export const handCount = (s: State, seat: number) => ((s as Partial<View>).counts ? (s as View).counts[seat] : s.hands[seat].length);
export const bazaarLeft = (s: State) => ((s as Partial<View>).bazaarCount ?? s.bazaar.length);

/** Ряд после хода — для ботов. */
export function placeTilePreview(s: State, p: Placement, seat: number): Chain {
  return placeTile(s.chain, p.bone, p.arm, seat, false, s.cfg).chain;
}
