/* Домино — правила (без DOM). Одна карточка, разновидности (по «Разновидностям и правилам» пользователя):
 *
 * Общее: 28 костей 0-0…6-6. Кость кладут к концу ряда с тем же числом, дубли — поперёк. Нечем ходить — берут из базара
 * по одной, пока не найдётся; базар пуст — пропускают ход («еду»). Кон кончается, когда кто-то выложил все кости,
 * или «рыбой» — ходить не может никто. Места: 0…3 по кругу; вдвоём — 0 и 2; вчетвером пары — 0 и 2 против 1 и 3.
 *
 * Козёл: по 7, последнюю кость из базара не берут. Первый кон — с 1-1 (вчетвером) или с меньшего дубля; дальше заходит
 * выигравший кон или «рыбак». Проигравшие пишут на себя очки с рук (одинокое 0-0 — 25), меньше 13 «висит». 101 — козёл.
 * Морской козёл: пишет выигравший — очки проигравших, от 25; очки бывают только у одной стороны: другая, выиграв 25+,
 * «списывает» их (у всех 0). 125 — победа. Два дубля разом на оба конца. Зашёл 6-6, имея очки, — «на сто»:
 * выиграл кон — выиграл партию, проиграл с 25+ на руках — проиграл («свояк»). Вышел на 0-0 — «лысый», партия выиграна;
 * вышел на 6-6 — выиграл, если у соперника 25+, иначе следующий кон он играет «на сто». На руках одно 0-0 — 25,
 * одно 6-6 — 50, оба — 75. Рыба: рыбак (последний, кто положил не дубль) с <25 против 25+ — выиграл и идёт «на сто»;
 * у рыбака больше и 25+ — он «списывает рыбу»: три кона подряд заходит сам, выиграв с 25+ у соперника — списал,
 * не смог — ход «на сто» у соперника. Поровну — «яйца»: следующий кон с 1-1, очки идут выигравшему, три раза не
 * разыграли — протухли.
 * Осёл: как козёл, но первый выставленный дубль открывает четыре стороны; за ход можно доложить ещё дубли на другие
 * концы; положив дубль, можно сказать «Закрыто!» — дальше этого дубля не ставят. Пока дублей не было, закрыть двумя
 * дублями оба конца — кон окончен, обычный подсчёт. Висящее (<13) сгорает, если в следующем кону на сторону ничего не пришлось.
 * Телефон (домики): первый дубль — «дом», когда его перекроют с обеих сторон, ставят и вверх-вниз. Сумма концов кратна 5 —
 * пишешь её себе. Кто остался с костями — списывает со своего счёта очки руки, округлённые вниз до 5 (долгов нет).
 * Первый кон — с 3-2, дальше заходит вышедший. До 225; набрали оба — ничья.
 * Маггинс (все пятёрки): вдвоём по 7, втроём-вчетвером по 5; первый дубль — четыре стороны; кратно 5 — пишешь сумму;
 * вышел — ещё 10; рыба — меньший получает разницу с остальными, округлённую до 5. До 200.
 * Генерал: парами, каждый кон — с 1-1, рыба не в счёт. Кто вышел на 0-0 или 6-6, «навешивает генерала» тому, кто ходит
 * следом (оба разом — два). Счёта очков нет; набрал генералов сколько условились — проиграл.
 * Спортивное: парами, заходят по очереди любой костью, играют 4/8/12 сдач; выигравшая сдачу пара пишет себе очки
 * соперников; больше набравшая — победила.
 * Колбаса: вдвоём, у каждого по 14 закрытых костей в линию — никто, и сам хозяин, их не видит. Берёшь крайнюю справа
 * и кладёшь к концу ряда; ряд растёт двумя параллельными линиями от первой кости. Кость, у которой числа совпадают со
 * стыком обеих линий на одном месте, «режет колбасу»: всё до стыка (с первой костью) уходит сопернику в хвост линии,
 * а нож становится новым началом. Дубль можно вставить в любой стык с его числом. Некуда — кость в хвост своей линии. Кто остался с костями —
 * пишет на себя их очки; до 101.
 */
import type { Options, Rng } from '../../core/types';

export type Variant = 'kozel' | 'morskoy' | 'osel' | 'telefon' | 'muggins' | 'general' | 'sport' | 'kolbasa';
export type Bone = [number, number];

export interface Cfg {
  variant: Variant;
  /** Вчетвером — парами (напарник напротив). В морском, телефоне, генерале и спортивном — всегда парами. */
  pairs: boolean;
  /** Спортивное: сколько сдач. */
  deals: number;
  /** Генерал: до скольких генералов. */
  generals: number;
}

const VARIANTS: Variant[] = ['kozel', 'morskoy', 'osel', 'telefon', 'muggins', 'general', 'sport', 'kolbasa'];

export function cfgFrom(o: Options): Cfg {
  const v = String(o.variant) as Variant;
  const deals = Number(o.deals);
  const gens = Number(o.generals);
  return {
    variant: VARIANTS.includes(v) ? v : 'kozel',
    pairs: o.pairs !== false,
    deals: [4, 8, 12].includes(deals) ? deals : 4,
    generals: [1, 3, 5].includes(gens) ? gens : 3,
  };
}

export const limits = (cfg: Cfg) =>
  cfg.variant === 'morskoy'
    ? { min: 25, to: 125 }
    : cfg.variant === 'telefon'
      ? { min: 0, to: 225 }
      : cfg.variant === 'muggins'
        ? { min: 0, to: 200 }
        : cfg.variant === 'kolbasa'
          ? { min: 0, to: 101 }
          : { min: 13, to: 101 };

/** Очки — «плохие» (кто больше, тот проиграл): козёл, осёл, генерал. */
export const badScore = (cfg: Cfg) => cfg.variant === 'kozel' || cfg.variant === 'osel' || cfg.variant === 'general' || cfg.variant === 'kolbasa';
export const isKolbasa = (cfg: Cfg) => cfg.variant === 'kolbasa';
/** Первый дубль открывает четыре стороны. */
export const spinVariant = (cfg: Cfg) => cfg.variant === 'osel' || cfg.variant === 'muggins' || cfg.variant === 'telefon';
/** Очки за концы, кратные пяти. */
export const fivesVariant = (cfg: Cfg) => cfg.variant === 'telefon' || cfg.variant === 'muggins';
/** Последнюю кость из базара не берут. */
const keepLast = (cfg: Cfg) => cfg.variant === 'kozel' || cfg.variant === 'morskoy' || cfg.variant === 'osel';
/** Два дубля разом на разные концы (после дубля). */
const twinDoubles = (cfg: Cfg) => cfg.variant === 'morskoy' || cfg.variant === 'general';

/** Кость в ряду: a — число со стороны центра, b — открытое наружу. */
export interface Tile {
  a: number;
  b: number;
  seat: number;
  /** Порядковый номер выкладки — раскладка ставит кости по нему, чтобы старые не сдвигались. */
  n?: number;
}

export interface Arm {
  tiles: Tile[];
  /** «Закрыто» (осёл) — сюда больше не ставят. */
  closed: boolean;
}

export interface Chain {
  center: Tile | null;
  /** 0 — влево, 1 — вправо, 2 — вверх, 3 — вниз (верх и низ — только от дубля-«дома»). */
  arms: Arm[];
  /** Центр — дубль на четыре стороны (осёл, телефон, маггинс). */
  spin?: boolean;
}

export interface State {
  cfg: Cfg;
  seats: number[];
  hands: Bone[][];
  bazaar: Bone[];
  chain: Chain;
  turn: number;
  /** play — обычный ход; more — можно доложить дубли или сказать «хватит». */
  phase: 'play' | 'more' | 'over';
  /** Сколько ещё дублей можно доложить в этом ходу. */
  moreLeft: number;
  /** Кон (с 1). */
  round: number;
  /** Обязательная кость первого хода кона (или null — любая). */
  opener: Bone | null;
  /** Очки сторон (сторона — пара или игрок); в генерале — генералы. */
  scores: number[];
  /** Невписанные очки (меньше 13 / 25) — висят. */
  hang: number[];
  /** «Яйца»: очки ничейной рыбы. */
  eggs: number;
  /** Морской: сколько раз яйца не разыграли. */
  eggTries: number;
  /** Морской: сторона, играющая кон «на сто». */
  sto: number | null;
  /** Морской: рыбак «списывает рыбу». */
  debt: { side: number; seat: number; tries: number } | null;
  /** Числа, на которые игрок уже не мог ходить (публично: все видели, как он брал из базара или пропускал). */
  lacks: number[][];
  /** Сколько ходов подряд пропустили — для справки в отрисовке. */
  passes: number;
  /** Последний, кто положил не дубль, — «рыбак». */
  lastSeat: number | null;
  /** Кости, выложенные в текущем (последнем) ходу. */
  turnBones: Bone[];
  /** Последний выигравший кон (он начинает следующий). */
  lastWinner: number | null;
  /** Итог: проигравшая сторона («козёл») и выигравшие места. */
  goat: number | null;
  winners: number[];
}

export interface View extends State {
  counts: number[];
  bazaarCount: number;
  me: number[];
  /** Колбаса: открытая крайняя кость ходящего (её видят все). */
  front: Bone | null;
}

export type Action =
  | { type: 'play'; bone: Bone; arm: number; close?: boolean }
  | { type: 'draw' }
  | { type: 'pass' }
  | { type: 'enough' }
  /** Колбаса: разрезать на стыке k обеих линий. */
  | { type: 'cut'; k: number }
  /** Колбаса: вставить дубль в стык k линии arm. */
  | { type: 'insert'; arm: number; k: number }
  /** Колбаса: кость некуда — в хвост своей линии. */
  | { type: 'skip' };

export interface RoundRes {
  /** Кто выиграл кон (место) — вышел первым или выиграл рыбу; null — яйца / не в счёт. */
  winner: number | null;
  fish: boolean;
  /** Очки на руках у каждой стороны. */
  pips: number[];
  /** Сколько записали каждой стороне в этот кон (со знаком: в телефоне списывают). */
  wrote: number[];
  /** Пояснение по-дворовому: «на сто», «лысый», «списал»… */
  note?: string;
}

export type Event =
  | { type: 'deal'; round: number; counts: number[]; bazaar: number; first: number; opener: Bone | null; hands?: Bone[][]; sto?: number | null; eggs?: number; hidden?: boolean }
  | { type: 'play'; seat: number; bone: Bone; arm: number; tile: Tile; close: boolean; center: boolean; root?: boolean; pts?: number; sto?: boolean }
  | { type: 'draw'; seat: number; bone?: Bone; left: number }
  | { type: 'pass'; seat: number }
  | { type: 'enough'; seat: number }
  | { type: 'cut'; seat: number; bone: Bone; k: number; moved: Bone[]; to: number }
  | { type: 'insert'; seat: number; bone: Bone; arm: number; k: number }
  | { type: 'skip'; seat: number; bone: Bone }
  | { type: 'round'; res: RoundRes; scores: number[]; hands: Bone[][]; sides: number[][] }
  | { type: 'end'; goat: number | null; goatSeats: number[]; winners: number[]; scores: number[]; text: string };

// ---------------------------------------------------------------- кости

export const pips = (b: Bone) => b[0] + b[1];
export const isDouble = (b: Bone) => b[0] === b[1];
export const sameBone = (x: Bone, y: Bone) => (x[0] === y[0] && x[1] === y[1]) || (x[0] === y[1] && x[1] === y[0]);
const norm = (b: Bone): Bone => (b[0] <= b[1] ? [b[0], b[1]] : [b[1], b[0]]);
const isBone = (b: Bone, x: number, y: number) => sameBone(b, [x, y]);

export function allBones(): Bone[] {
  const out: Bone[] = [];
  for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) out.push([a, b]);
  return out;
}

/** Очки руки: одинокое «пусто-пусто» — 25; в морском одинокое 6-6 — 50, только 0-0 и 6-6 — 75. */
export function handPips(h: Bone[], cfg?: Cfg): number {
  if (cfg && fivesVariant(cfg)) return h.reduce((a, b) => a + pips(b), 0);
  if (h.length === 1 && isBone(h[0], 0, 0)) return 25;
  if (cfg?.variant === 'morskoy') {
    if (h.length === 1 && isBone(h[0], 6, 6)) return 50;
    if (h.length === 2 && h.some((b) => isBone(b, 0, 0)) && h.some((b) => isBone(b, 6, 6))) return 75;
  }
  return h.reduce((a, b) => a + pips(b), 0);
}

export const seatsFor = (n: number) => (n === 2 ? [0, 2] : n === 3 ? [0, 1, 2] : [0, 1, 2, 3]);
const forcedPairs = (cfg: Cfg) => cfg.variant === 'morskoy' || cfg.variant === 'telefon' || cfg.variant === 'general' || cfg.variant === 'sport';
export const teams = (s: Pick<State, 'cfg' | 'seats'>) => s.seats.length === 4 && (s.cfg.pairs || forcedPairs(s.cfg));
/** Сторона места: пара (0 — места 0 и 2, 1 — места 1 и 3) или сам игрок (индекс в seats). */
export const sideOf = (s: Pick<State, 'cfg' | 'seats'>, seat: number) => (teams(s) ? seat % 2 : s.seats.indexOf(seat));
export const sideCount = (s: Pick<State, 'cfg' | 'seats'>) => (teams(s) ? 2 : s.seats.length);
export const sideSeats = (s: Pick<State, 'cfg' | 'seats'>, side: number) => s.seats.filter((x) => sideOf(s, x) === side);
export const nextSeat = (s: Pick<State, 'seats'>, seat: number) => s.seats[(s.seats.indexOf(seat) + 1) % s.seats.length];
/** Сколько костей на руку. */
export const handSize = (cfg: Cfg, n: number) => (cfg.variant === 'kolbasa' ? Math.floor(28 / n) : cfg.variant === 'muggins' && n > 2 ? 5 : 7);

// ---------------------------------------------------------------- ряд

/** Сколько сторон открыто от центра. */
function armCount(c: Chain, cfg: Cfg): number {
  if (!c.spin) return 2;
  // телефон: «дом» открывается вверх-вниз, когда его перекрыли с обеих сторон
  if (cfg.variant === 'telefon' && (!c.arms[0].tiles.length || !c.arms[1].tiles.length)) return 2;
  return 4;
}

/** Открытые концы: номер руки → число на конце. */
export function ends(c: Chain, cfg: Cfg): { arm: number; v: number }[] {
  if (!c.center) return [];
  const out: { arm: number; v: number }[] = [];
  const n = armCount(c, cfg);
  for (let i = 0; i < n; i++) {
    const arm = c.arms[i];
    if (arm.closed) continue;
    const last = arm.tiles[arm.tiles.length - 1];
    const v = last ? last.b : i === 0 ? c.center.a : c.center.b;
    out.push({ arm: i, v });
  }
  return out;
}

/** Сумма открытых концов (телефон, маггинс): дубль на конце — обе половинки; пустые верх и низ не считаются. */
export function endSum(c: Chain, cfg: Cfg): number {
  const ct = c.center;
  if (!ct) return 0;
  const dbl = ct.a === ct.b;
  if (!c.arms[0].tiles.length && !c.arms[1].tiles.length && !c.arms[2].tiles.length && !c.arms[3].tiles.length) return ct.a + ct.b;
  let sum = 0;
  for (let i = 0; i < armCount(c, cfg); i++) {
    const t = c.arms[i].tiles;
    if (t.length) {
      const last = t[t.length - 1];
      sum += last.a === last.b ? last.b * 2 : last.b;
    } else if (i < 2) sum += dbl ? ct.a * 2 : i === 0 ? ct.a : ct.b;
  }
  return sum;
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
    for (const e of es) if (bone[0] === e.v || bone[1] === e.v) out.push({ bone, arm: e.arm });
  }
  return out;
}

const cloneChain = (c: Chain): Chain => ({ center: c.center, arms: c.arms.map((a) => ({ tiles: a.tiles.slice(), closed: a.closed })), spin: !!c.spin });
const flip = (t: Tile): Tile => ({ ...t, a: t.b, b: t.a });
const onTable = (c: Chain) => (c.center ? 1 : 0) + c.arms.reduce((a, x) => a + x.tiles.length, 0);

/** Положить кость. Первый дубль в «разворотных» играх становится центром на четыре стороны — ряд перестраивается от него. */
function placeTile(c: Chain, bone: Bone, arm: number, seat: number, close: boolean, cfg: Cfg): { chain: Chain; tile: Tile; root: boolean } {
  const chain = cloneChain(c);
  const n = onTable(c);
  if (arm < 0) {
    const tile = { a: bone[0], b: bone[1], seat, n };
    chain.center = tile;
    chain.spin = spinVariant(cfg) && isDouble(bone);
    return { chain, tile, root: false };
  }
  const e = ends(c, cfg).find((x) => x.arm === arm)!;
  const tile = { a: e.v, b: bone[0] === e.v ? bone[1] : bone[0], seat, n };
  if (isDouble(bone) && spinVariant(cfg) && !c.spin && arm < 2) {
    // ряд пока прямой: перестраиваем от нового дубля, весь прежний ряд — одна его сторона
    const ct = c.center!;
    const back =
      arm === 1
        ? [...c.arms[1].tiles.slice().reverse().map(flip), flip(ct), ...c.arms[0].tiles]
        : [...c.arms[0].tiles.slice().reverse().map(flip), { ...ct }, ...c.arms[1].tiles];
    const backArm = arm === 1 ? 0 : 1;
    chain.center = tile;
    chain.spin = true;
    chain.arms = [0, 1, 2, 3].map((i) => ({ tiles: i === backArm ? back : [], closed: false }));
    // «Закрыто!» — дальше этого дубля не ставят ни в одну сторону
    if (close) for (const i of [arm, 2, 3]) chain.arms[i].closed = true;
    return { chain, tile, root: true };
  }
  chain.arms[arm].tiles.push(tile);
  if (close) chain.arms[arm].closed = true;
  return { chain, tile, root: false };
}

// ---------------------------------------------------------------- партия

const emptyChain = (): Chain => ({ center: null, arms: [0, 1, 2, 3].map(() => ({ tiles: [], closed: false })), spin: false });

export function newState(cfg: Cfg, seats: number[]): State {
  const sides = seats.length === 4 && (cfg.pairs || forcedPairs(cfg)) ? 2 : seats.length;
  return {
    cfg,
    seats: seats.slice(),
    hands: [[], [], [], []],
    bazaar: [],
    chain: emptyChain(),
    turn: seats[0],
    phase: 'play',
    moreLeft: 0,
    round: 0,
    opener: null,
    scores: Array(sides).fill(0),
    hang: Array(sides).fill(0),
    eggs: 0,
    eggTries: 0,
    sto: null,
    debt: null,
    lacks: [[], [], [], []],
    passes: 0,
    lastSeat: null,
    turnBones: [],
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

/** Кто держит кость (по списку предпочтений); нет ни одной — самая тяжёлая (или самый тяжёлый дубль). */
function findOpener(s: State, wanted: Bone[], heavyDouble = false): { seat: number; bone: Bone } {
  for (const w of wanted) {
    const seat = s.seats.find((x) => s.hands[x].some((b) => sameBone(b, w)));
    if (seat != null) return { seat, bone: w };
  }
  let best: { seat: number; bone: Bone } | null = null;
  let bv = -1;
  for (const seat of s.seats)
    for (const b of s.hands[seat]) {
      const v = pips(b) + (heavyDouble && isDouble(b) ? 100 : 0);
      if (v > bv) {
        bv = v;
        best = { seat, bone: b };
      }
    }
  return best!;
}

const D = (d: number): Bone => [d, d];
const LOW_DOUBLES = [0, 1, 2, 3, 4, 5, 6].map(D);

/** Раздача нового кона и кто заходит. */
export function deal(s0: State, rng: Rng): { state: State; events: Event[] } {
  const s: State = {
    ...s0,
    hands: [[], [], [], []],
    chain: emptyChain(),
    lacks: [[], [], [], []],
    passes: 0,
    phase: 'play',
    moreLeft: 0,
    round: s0.round + 1,
    lastSeat: null,
    turnBones: [],
  };
  const deck = shuffle(allBones(), rng);
  const n = handSize(s.cfg, s.seats.length);
  for (const seat of s.seats) s.hands[seat] = deck.splice(0, n).map(norm);
  s.bazaar = deck;
  const v = s.cfg.variant;
  const firstKon = s.round === 1 || s0.lastWinner == null;
  let first: number;
  let opener: Bone | null = null;
  const pick = (wanted: Bone[], heavy = false) => {
    const f = findOpener(s, wanted, heavy);
    first = f.seat;
    opener = f.bone;
  };
  first = s.seats[0];
  if (v === 'general') pick([D(1), ...LOW_DOUBLES]);
  else if (v === 'sport') first = s.seats[(s.round - 1) % s.seats.length];
  else if (v === 'kolbasa') first = firstKon ? s.seats[rng.int(s.seats.length)] : s0.lastWinner!;
  else if (v === 'morskoy' && s.eggs > 0) pick([D(1), ...LOW_DOUBLES]);
  else if (v === 'morskoy' && s.sto != null) first = s0.lastWinner != null && sideOf(s, s0.lastWinner) === s.sto ? s0.lastWinner : sideSeats(s, s.sto)[0];
  else if (v === 'morskoy' && s.debt) first = s.debt.seat;
  else if (!firstKon) first = s0.lastWinner!;
  else if (v === 'telefon') pick([[2, 3], ...LOW_DOUBLES]);
  else if (v === 'muggins') pick([6, 5, 4, 3, 2, 1, 0].map(D), true);
  else if (s.seats.length === 4) pick([D(1), ...LOW_DOUBLES]);
  else pick(LOW_DOUBLES);
  s.turn = first;
  s.opener = opener;
  const counts = [0, 1, 2, 3].map((x) => s.hands[x].length);
  return {
    state: s,
    events: [{ type: 'deal', round: s.round, counts, bazaar: s.bazaar.length, first, opener, hands: s.hands.map((h) => h.slice()), sto: s.sto, eggs: s.eggs, hidden: v === 'kolbasa' }],
  };
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  return deal(newState(cfgFrom(opts), seats), rng).state;
}

export const toAct = (s: State): number[] => (s.phase === 'over' ? [] : [s.turn]);

export const canDraw = (s: Pick<State, 'cfg'>, left: number) => left > (keepLast(s.cfg) ? 1 : 0);

/** Может ли кто-нибудь положить кость (или взять из базара). */
function anyMove(s: State): boolean {
  if (!ends(s.chain, s.cfg).length && s.chain.center) return false;
  if (canDraw(s, s.bazaar.length)) return true;
  return s.seats.some((x) => placements(s, s.hands[x]).length > 0);
}

function addLack(s: State, seat: number) {
  const vs = ends(s.chain, s.cfg).map((e) => e.v);
  const cur = new Set(s.lacks[seat]);
  for (const v of vs) cur.add(v);
  s.lacks = s.lacks.map((l, i) => (i === seat ? [...cur].sort() : l));
}

const round5 = (x: number) => Math.round(x / 5) * 5;
const floor5 = (x: number) => Math.floor(x / 5) * 5;

interface Tally {
  scores: number[];
  hang: number[];
  wrote: number[];
  winSide: number | null;
  winnerSeat: number | null;
  note?: string;
  /** Партия решена прямо сейчас: сторона-победитель (или 'draw'). */
  champ?: number | 'draw';
  /** Перейти к следующему кону с этими полями. */
  next: Partial<State>;
}

/** Козёл, осёл: проигравшие пишут на себя. */
function tallyGoat(s: State, outSeat: number | null, pipsBy: number[]): Tally {
  const ns = pipsBy.length;
  const fish = outSeat == null;
  let winSide: number | null;
  let winnerSeat: number | null = outSeat;
  if (!fish) winSide = sideOf(s, outSeat!);
  else {
    const min = Math.min(...pipsBy);
    const best = pipsBy.map((p, i) => (p === min ? i : -1)).filter((i) => i >= 0);
    winSide = best.length === 1 ? best[0] : null;
    // следующий кон начинает «рыбак»
    winnerSeat = s.lastSeat ?? s.turn;
  }
  const { min } = limits(s.cfg);
  const wrote = Array(ns).fill(0);
  const scores = s.scores.slice();
  const hang = s.hang.slice();
  let eggs = s.eggs;
  if (winSide == null) eggs += pipsBy.reduce((a, b) => a + b, 0);
  else {
    for (let side = 0; side < ns; side++) {
      if (side === winSide) {
        // осёл: «запомненное» сгорает, если в этот кон на сторону ничего не пришлось
        if (s.cfg.variant === 'osel') hang[side] = 0;
        continue;
      }
      const total = pipsBy[side] + hang[side] + eggs;
      if (total >= min) {
        scores[side] += total;
        wrote[side] = total;
        hang[side] = 0;
      } else hang[side] = total;
    }
    eggs = 0;
  }
  return { scores, hang, wrote, winSide, winnerSeat, next: { eggs, lastWinner: winnerSeat ?? s.lastWinner } };
}

/** Морской козёл. */
function tallySea(s: State, outSeat: number | null, pipsBy: number[]): Tally {
  const ns = pipsBy.length;
  const scores = s.scores.slice();
  const wrote = Array(ns).fill(0);
  const holder = scores.findIndex((x) => x > 0);
  const sum = pipsBy.reduce((a, b) => a + b, 0);
  const next: Partial<State> = { sto: null, debt: s.debt, eggs: s.eggs, eggTries: s.eggTries };
  let note: string | undefined;
  let champ: number | undefined;
  /** Обычная запись: выигравший пишет себе очки проигравших (от 25), чужие очки — списывает. */
  const write = (w: number, gain: number) => {
    if (gain < 25) return;
    if (holder >= 0 && holder !== w) {
      note = (note ? note + ' ' : '') + 'Списал чужие очки — у всех по нулям.';
      for (let i = 0; i < ns; i++) scores[i] = 0;
      return;
    }
    scores[w] += gain;
    wrote[w] = gain;
    if (scores[w] >= limits(s.cfg).to) champ = w;
  };
  if (outSeat != null) {
    const w = sideOf(s, outSeat);
    const lose = sum - pipsBy[w];
    const last = s.turnBones[s.turnBones.length - 1];
    let gain = lose;
    if (s.eggs) {
      gain += s.eggs;
      note = `Яйца разыграны (+${s.eggs}).`;
      next.eggs = 0;
      next.eggTries = 0;
    }
    if (s.debt) {
      if (s.debt.side === w && lose >= 25) {
        note = 'Рыба списана.';
        next.debt = null;
      } else if (s.debt.tries + 1 >= 3) {
        next.debt = null;
        next.sto = s.debt.side === w ? (w + 1) % ns : w;
        note = 'Рыбу не списал с трёх раз — соперник идёт «на сто».';
      } else next.debt = { ...s.debt, tries: s.debt.tries + 1 };
    }
    if (last && isBone(last, 0, 0)) {
      champ = w;
      note = 'Вышел на «пусто-пусто» — лысый козёл!';
    } else if (s.sto === w) {
      champ = w;
      note = 'Выиграл кон «на сто» — партия!';
    } else if (s.sto != null && pipsBy[s.sto] >= 25) {
      champ = w;
      note = `Шёл «на сто», а на руках ${pipsBy[s.sto]} — свояк!`;
    } else if (last && isBone(last, 6, 6)) {
      if (lose >= 25) {
        champ = w;
        note = 'Вышел на 6-6 при 25+ у соперника — партия!';
      } else {
        next.sto = w;
        note = 'Вышел на 6-6 — следующий кон «на сто».';
      }
    } else write(w, gain);
    return { scores, hang: s.hang, wrote, winSide: w, winnerSeat: outSeat, note, champ, next: { ...next, lastWinner: outSeat } };
  }
  // рыба
  const fisher = s.lastSeat ?? s.turn;
  const F = sideOf(s, fisher);
  const f = pipsBy[F];
  const o = sum - f;
  if (f === o) {
    const tries = s.eggTries + 1;
    if (tries > 3) {
      next.eggs = 0;
      next.eggTries = 0;
      note = 'Яйца протухли.';
    } else {
      next.eggs = s.eggs + sum;
      next.eggTries = tries;
      note = 'Поровну — яйца, следующий кон с 1-1.';
    }
    return { scores, hang: s.hang, wrote, winSide: null, winnerSeat: null, note, next: { ...next, lastWinner: s.lastWinner } };
  }
  if (f < 25 && o >= 25) {
    next.sto = F;
    note = 'Рыбак выиграл — идёт «на сто».';
    return { scores, hang: s.hang, wrote, winSide: F, winnerSeat: fisher, note, next: { ...next, lastWinner: fisher } };
  }
  if (f > o && f >= 25) {
    next.debt = { side: F, seat: fisher, tries: 0 };
    note = 'У рыбака больше — он «списывает рыбу», заходит сам.';
    return { scores, hang: s.hang, wrote, winSide: null, winnerSeat: null, note, next: { ...next, lastWinner: fisher } };
  }
  const w = f < o ? F : pipsBy.map((p, i) => (i === F ? Infinity : p)).reduce((bi, p, i, arr) => (p < arr[bi] ? i : bi), F === 0 ? 1 : 0);
  write(w, sum - pipsBy[w]);
  const ws = w === F ? fisher : sideSeats(s, w).sort((x, y) => handPips(s.hands[x], s.cfg) - handPips(s.hands[y], s.cfg))[0];
  return { scores, hang: s.hang, wrote, winSide: w, winnerSeat: ws, note, champ, next: { ...next, lastWinner: ws } };
}

/** Телефон и маггинс: очки уже набраны по ходу, в конце — списание / премия. */
function tallyFives(s: State, outSeat: number | null, pipsBy: number[]): Tally {
  const ns = pipsBy.length;
  const scores = s.scores.slice();
  const wrote = Array(ns).fill(0);
  const sum = pipsBy.reduce((a, b) => a + b, 0);
  let winSide: number | null = outSeat != null ? sideOf(s, outSeat) : null;
  let winnerSeat = outSeat;
  if (s.cfg.variant === 'telefon') {
    // кто остался с костями — списывает свои, округлив вниз до пяти; долгов нет
    for (let i = 0; i < ns; i++) {
      if (i === winSide) continue;
      const d = Math.min(scores[i], floor5(pipsBy[i]));
      scores[i] -= d;
      wrote[i] = -d;
    }
  } else if (outSeat != null) {
    scores[winSide!] += 10;
    wrote[winSide!] = 10;
  } else {
    const min = Math.min(...pipsBy);
    const best = pipsBy.map((p, i) => (p === min ? i : -1)).filter((i) => i >= 0);
    if (best.length === 1) {
      winSide = best[0];
      const g = round5(sum - 2 * min);
      scores[winSide] += g;
      wrote[winSide] = g;
      winnerSeat = sideSeats(s, winSide)[0];
    }
  }
  const to = limits(s.cfg).to;
  const top = scores.filter((x) => x >= to);
  let champ: number | 'draw' | undefined;
  if (top.length) {
    const max = Math.max(...scores);
    const leaders = scores.map((x, i) => (x === max ? i : -1)).filter((i) => i >= 0);
    champ = s.cfg.variant === 'telefon' && top.length > 1 ? 'draw' : leaders.length === 1 ? leaders[0] : 'draw';
  }
  return { scores, hang: s.hang, wrote, winSide, winnerSeat, champ, next: { lastWinner: winnerSeat ?? s.lastWinner } };
}

/** Генерал: вышел на 0-0 / 6-6 — следующему по кругу генерал. */
function tallyGeneral(s: State, outSeat: number | null, pipsBy: number[]): Tally {
  const ns = pipsBy.length;
  const scores = s.scores.slice();
  const wrote = Array(ns).fill(0);
  if (outSeat == null) return { scores, hang: s.hang, wrote, winSide: null, winnerSeat: null, note: 'Рыба не в счёт — пересдача.', next: {} };
  const gens = s.turnBones.filter((b) => isBone(b, 0, 0) || isBone(b, 6, 6)).length;
  const loser = sideOf(s, nextSeat(s, outSeat));
  let note: string | undefined;
  if (gens) {
    scores[loser] += gens;
    wrote[loser] = gens;
    note = gens > 1 ? 'Вышел на 0-0 и 6-6 разом — два генерала!' : `Вышел на ${s.turnBones.some((b) => isBone(b, 0, 0)) ? '«пусто-пусто»' : '6-6'} — генерал!`;
  }
  return { scores, hang: s.hang, wrote, winSide: sideOf(s, outSeat), winnerSeat: outSeat, note, next: { lastWinner: outSeat } };
}

/** Спортивное: выигравшая пара пишет себе очки соперников. */
function tallySport(s: State, outSeat: number | null, pipsBy: number[]): Tally {
  const ns = pipsBy.length;
  const scores = s.scores.slice();
  const wrote = Array(ns).fill(0);
  const sum = pipsBy.reduce((a, b) => a + b, 0);
  let winSide: number | null = outSeat != null ? sideOf(s, outSeat) : null;
  if (outSeat == null) {
    const min = Math.min(...pipsBy);
    const best = pipsBy.map((p, i) => (p === min ? i : -1)).filter((i) => i >= 0);
    winSide = best.length === 1 ? best[0] : null;
  }
  if (winSide != null) {
    scores[winSide] += sum - pipsBy[winSide];
    wrote[winSide] = sum - pipsBy[winSide];
  }
  return { scores, hang: s.hang, wrote, winSide, winnerSeat: outSeat, next: {} };
}

/** Конец кона: подсчёт и запись очков. outSeat — кто вышел (или null — рыба). */
function endRound(s: State, outSeat: number | null, ev: Event[], rng: Rng): { state: State; events: Event[] } {
  const ns = sideCount(s);
  const pipsBy = Array(ns).fill(0);
  for (const seat of s.seats) pipsBy[sideOf(s, seat)] += handPips(s.hands[seat], s.cfg);
  const v = s.cfg.variant;
  const t =
    v === 'morskoy'
      ? tallySea(s, outSeat, pipsBy)
      : fivesVariant(s.cfg)
        ? tallyFives(s, outSeat, pipsBy)
        : v === 'general'
          ? tallyGeneral(s, outSeat, pipsBy)
          : v === 'sport'
            ? tallySport(s, outSeat, pipsBy)
            : tallyGoat(s, outSeat, pipsBy);
  const res: RoundRes = { winner: t.winnerSeat, fish: outSeat == null, pips: pipsBy, wrote: t.wrote, note: t.note };
  const sides = Array.from({ length: ns }, (_, i) => sideSeats(s, i));
  ev.push({ type: 'round', res, scores: t.scores.slice(), hands: s.hands.map((h) => h.slice()), sides });
  const st: State = { ...s, ...t.next, scores: t.scores, hang: t.hang };
  // конец партии
  let champ = t.champ;
  let goat: number | null = null;
  if (champ == null) {
    if (badScore(s.cfg)) {
      const to = v === 'general' ? s.cfg.generals : limits(s.cfg).to;
      if (t.scores.some((x) => x >= to) || (v === 'general' && s.round >= 40)) {
        const top = Math.max(...t.scores);
        const tops = t.scores.map((x, i) => (x === top ? i : -1)).filter((i) => i >= 0);
        goat = tops.length === 1 ? tops[0] : null;
        if (goat == null) champ = 'draw';
      }
    } else if (v === 'sport' && s.round >= s.cfg.deals) {
      const max = Math.max(...t.scores);
      const tops = t.scores.map((x, i) => (x === max ? i : -1)).filter((i) => i >= 0);
      champ = tops.length === 1 ? tops[0] : 'draw';
    }
  }
  if (champ != null || goat != null) {
    let winners: number[];
    let text: string;
    if (goat != null) {
      const low = Math.min(...t.scores);
      winners = s.seats.filter((x) => t.scores[sideOf(s, x)] === low && sideOf(s, x) !== goat);
      if (!winners.length) winners = s.seats.filter((x) => sideOf(s, x) !== goat);
      text = v === 'general' ? `генералы: ${t.scores.join(' : ')}` : `козёл — ${sideSeats(s, goat).length > 1 ? 'пара' : 'игрок'} с ${t.scores[goat]} очками`;
    } else if (champ === 'draw') {
      winners = [];
      text = 'ничья';
    } else {
      winners = sideSeats(s, champ as number);
      // проигравшая сторона — с самым большим остатком на руках (для «козла» в итоге)
      const others = pipsBy.map((p, i) => (i === champ ? -1 : p));
      goat = others.indexOf(Math.max(...others));
      text = t.note ?? `победа со счётом ${t.scores.join(' : ')}`;
    }
    st.phase = 'over';
    st.goat = goat;
    st.winners = winners;
    ev.push({ type: 'end', goat, goatSeats: goat != null ? sideSeats(s, goat) : [], winners, scores: t.scores.slice(), text });
    return { state: st, events: ev };
  }
  const d = deal(st, rng);
  return { state: d.state, events: [...ev, ...d.events] };
}

// ---------------------------------------------------------------- колбаса

/** Число на стыке k линии arm: 0…len-1 — внутренний стык (перед костью k), len — конец линии. */
export function jointValue(c: Chain, arm: number, k: number): number | null {
  const t = c.arms[arm].tiles;
  if (!c.center || k < 0 || k > t.length) return null;
  if (k < t.length) return t[k].a;
  return t.length ? t[t.length - 1].b : arm === 0 ? c.center.a : c.center.b;
}

/** Ходы колбасы для открытой кости. */
export function kolMoves(s: Pick<State, 'chain' | 'cfg'>, bone: Bone): Action[] {
  const c = s.chain;
  if (!c.center) return [{ type: 'play', bone, arm: -1 }];
  const out: Action[] = [];
  for (const e of ends(c, s.cfg)) if (bone[0] === e.v || bone[1] === e.v) out.push({ type: 'play', bone, arm: e.arm });
  // нож: на стыке обеих линий (когда в каждой есть хоть одна кость)
  const l0 = c.arms[0].tiles.length;
  const l1 = c.arms[1].tiles.length;
  if (l0 && l1)
    for (let k = 1; k <= Math.min(l0, l1); k++) {
      const v0 = jointValue(c, 0, k)!;
      const v1 = jointValue(c, 1, k)!;
      if (sameBone(bone, [v0, v1])) out.push({ type: 'cut', k });
    }
  // дубль — в любой внутренний стык со своим числом
  if (isDouble(bone))
    for (const arm of [0, 1])
      for (let k = 0; k < c.arms[arm].tiles.length; k++) if (jointValue(c, arm, k) === bone[0]) out.push({ type: 'insert', arm, k });
  return out;
}

function applyKolbasa(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  const line = s0.hands[seat];
  const bone = line[0];
  if (!bone) return null;
  const moves = kolMoves(s0, bone);
  const ev: Event[] = [];
  const rest = line.slice(1);
  const hands = s0.hands.slice();
  if (a.type === 'skip') {
    if (moves.length) return null;
    hands[seat] = [...rest, bone];
    ev.push({ type: 'skip', seat, bone });
    const s: State = { ...s0, hands, passes: s0.passes + 1 };
    // полный круг по всем линиям без хода — рыба
    const total = s.seats.reduce((n, x) => n + s.hands[x].length, 0);
    if (s.passes >= total) return endRound(s, null, ev, rng);
    return { state: { ...s, turn: nextSeat(s, seat) }, events: ev };
  }
  const ok = moves.some((m) => JSON.stringify(m) === JSON.stringify(a.type === 'play' ? { type: 'play', bone, arm: a.arm } : a));
  if (!ok || (a.type === 'play' && !sameBone(a.bone, bone))) return null;
  hands[seat] = rest;
  let s: State = { ...s0, hands, passes: 0, lastSeat: seat, turnBones: [bone], opener: null };
  if (a.type === 'play') {
    const { chain, tile } = placeTile(s0.chain, bone, a.arm, seat, false, s0.cfg);
    s.chain = chain;
    ev.push({ type: 'play', seat, bone, arm: a.arm, tile, close: false, center: a.arm < 0 });
  } else if (a.type === 'cut') {
    // нож ложится поперёк обеих линий; всё, что до него (с первой костью), уходит сопернику, нож — новое начало
    const c = s0.chain;
    const v0 = jointValue(c, 0, a.k)!;
    const v1 = jointValue(c, 1, a.k)!;
    const moved: Bone[] = [norm([c.center!.a, c.center!.b])];
    for (const arm of [0, 1]) moved.push(...c.arms[arm].tiles.slice(0, a.k).map((t) => norm([t.a, t.b])));
    const chain: Chain = { center: { a: v0, b: v1, seat }, arms: c.arms.map((x) => ({ tiles: x.tiles.slice(a.k), closed: false })), spin: false };
    const to = nextSeat(s0, seat);
    hands[to] = [...hands[to], ...moved];
    s = { ...s, chain };
    ev.push({ type: 'cut', seat, bone, k: a.k, moved, to });
  } else if (a.type === 'insert') {
    const chain = cloneChain(s0.chain);
    chain.arms[a.arm].tiles.splice(a.k, 0, { a: bone[0], b: bone[0], seat });
    s = { ...s, chain };
    ev.push({ type: 'insert', seat, bone, arm: a.arm, k: a.k });
  } else return null;
  if (!hands[seat].length) return endRound(s, seat, ev, rng);
  return { state: { ...s, turn: nextSeat(s, seat) }, events: ev };
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.phase === 'over' || seat !== s0.turn || !a || typeof a !== 'object') return null;
  if (isKolbasa(s0.cfg)) return applyKolbasa(s0, seat, a, rng);
  const hand = s0.hands[seat];
  const ev: Event[] = [];
  if (a.type === 'enough') {
    if (s0.phase !== 'more') return null;
    ev.push({ type: 'enough', seat });
    return afterTurn({ ...s0, phase: 'play', moreLeft: 0 }, seat, ev, rng);
  }
  if (a.type === 'draw') {
    if (s0.phase !== 'play' || placements(s0, hand).length || !canDraw(s0, s0.bazaar.length)) return null;
    const s: State = { ...s0, bazaar: s0.bazaar.slice(), hands: s0.hands.slice() };
    const bone = s.bazaar.shift()!;
    s.hands[seat] = [...hand, bone];
    addLack(s, seat);
    ev.push({ type: 'draw', seat, bone, left: s.bazaar.length });
    return { state: s, events: ev };
  }
  if (a.type === 'pass') {
    if (s0.phase !== 'play' || placements(s0, hand).length || canDraw(s0, s0.bazaar.length)) return null;
    const s: State = { ...s0, passes: s0.passes + 1 };
    addLack(s, seat);
    ev.push({ type: 'pass', seat });
    return afterTurn(s, seat, ev, rng);
  }
  if (a.type !== 'play' || !Array.isArray(a.bone)) return null;
  const more = s0.phase === 'more';
  const opts = placements(s0, hand, more);
  const p = opts.find((x) => sameBone(x.bone, a.bone) && x.arm === a.arm);
  if (!p) return null;
  const close = !!a.close && s0.cfg.variant === 'osel' && isDouble(p.bone) && p.arm >= 0;
  const { chain, tile, root } = placeTile(s0.chain, p.bone, p.arm, seat, close, s0.cfg);
  const hands = s0.hands.slice();
  hands[seat] = hand.filter((b) => !sameBone(b, p.bone));
  const s: State = {
    ...s0,
    chain,
    hands,
    opener: null,
    passes: 0,
    lastSeat: isDouble(p.bone) && s0.lastSeat != null ? s0.lastSeat : seat,
    turnBones: more ? [...s0.turnBones, p.bone] : [p.bone],
  };
  const e: Extract<Event, { type: 'play' }> = { type: 'play', seat, bone: p.bone, arm: p.arm, tile, close, center: p.arm < 0, root };
  // морской: зашёл 6-6, имея очки, — кон «на сто»
  if (p.arm < 0 && s.cfg.variant === 'morskoy' && isBone(p.bone, 6, 6) && s.scores[sideOf(s, seat)] > 0 && s.sto == null) {
    s.sto = sideOf(s, seat);
    e.sto = true;
  }
  // кратно пяти — пишешь себе
  if (fivesVariant(s.cfg)) {
    const sum = endSum(chain, s.cfg);
    if (sum > 0 && sum % 5 === 0) {
      e.pts = sum;
      s.scores = s.scores.map((x, i) => (i === sideOf(s, seat) ? x + sum : x));
    }
  }
  ev.push(e);
  if (!hands[seat].length) return endRound(s, seat, ev, rng);
  // доложить дубли: осёл — сколько есть; морской и генерал — второй дубль на другой конец
  const left = more ? s0.moreLeft - 1 : s.cfg.variant === 'osel' ? 9 : twinDoubles(s.cfg) && isDouble(p.bone) && p.arm >= 0 ? 1 : 0;
  if (left > 0 && placements(s, hands[seat], true).length) return { state: { ...s, phase: 'more', moreLeft: left }, events: ev };
  return afterTurn({ ...s, phase: 'play', moreLeft: 0 }, seat, ev, rng);
}

function afterTurn(s: State, seat: number, ev: Event[], rng: Rng): { state: State; events: Event[] } {
  if (!anyMove(s)) return endRound(s, null, ev, rng);
  return { state: { ...s, turn: nextSeat(s, seat) }, events: ev };
}

export function makeView(s: State, seats: number[] | 'all'): View {
  // в колбасе свою линию не видит и хозяин — открыта только крайняя кость ходящего
  const kol = isKolbasa(s.cfg);
  const see = (x: number) => !kol && (seats === 'all' || seats.includes(x));
  const front = (s as Partial<View>).front !== undefined ? (s as View).front : kol && s.phase !== 'over' ? (s.hands[s.turn][0] ?? null) : null;
  return {
    ...s,
    front,
    hands: s.hands.map((h, x) => (see(x) ? h.slice() : [])),
    bazaar: [],
    // повторный вызов на готовом виде (превью) не теряет счётчиков
    counts: s.hands.map((h, i) => (s as Partial<View>).counts?.[i] ?? h.length),
    bazaarCount: (s as Partial<View>).bazaarCount ?? s.bazaar.length,
    me: seats === 'all' ? s.seats.slice() : seats.slice(),
  };
}

export const handCount = (s: State, seat: number) => ((s as Partial<View>).counts ? (s as View).counts[seat] : s.hands[seat].length);
export const bazaarLeft = (s: State) => ((s as Partial<View>).bazaarCount ?? s.bazaar.length);

/** Ряд после хода — для ботов и подсказки (tile — где встала кость). */
export function previewPlace(s: Pick<State, 'chain' | 'cfg'>, p: Placement, seat: number): { chain: Chain; tile: Tile } {
  return placeTile(s.chain, p.bone, p.arm, seat, false, s.cfg);
}
export const placeTilePreview = (s: Pick<State, 'chain' | 'cfg'>, p: Placement, seat: number): Chain => previewPlace(s, p, seat).chain;

/** Ряд после события хода (для пошагового показа без ожидания нового состояния). */
export function chainAfter(c: Chain, ev: Extract<Event, { type: 'play' }>, cfg: Cfg): Chain {
  if (ev.center) return { ...cloneChain(c), center: ev.tile, spin: spinVariant(cfg) && ev.tile.a === ev.tile.b };
  return placeTile(c, ev.bone, ev.arm, ev.seat, ev.close, cfg).chain;
}
