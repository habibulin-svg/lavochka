/* Нарды — правила (без DOM): длинные, короткие, гюльбара и греческие тавли (портес, плакото, февга).
 *
 * Доска — 24 пункта, абсолютные номера 0..23: нижний ряд слева направо (0..11), верхний справа налево (12..23).
 * Так ход «вперёд» по абсолютным номерам — против часовой стрелки.
 * У каждого игрока свой путь: индекс 0..23 (0 — голова / самый дальний пункт, 18..23 — дом), 24 — снята с доски.
 *   Белые (0) везде: i → (12 + i) % 24 — голова справа вверху, дом справа внизу.
 *   Чёрные (1) в длинных и гюльбаре: i → i — голова слева внизу, дом слева вверху (ходят в ту же сторону).
 *   Чёрные (1) в коротких: i → (35 - i) % 24 — навстречу белым, дом справа вверху.
 * pts[a] > 0 — столько белых шашек на пункте a, < 0 — чёрных.
 *
 * Тавли (греческие): портес — короткие без куба (марс 2, кокс не считается); февга — длинные без правила головы, но пока первая
 * шашка не дошла до четверти соперника (индекс 12), с головы другую не снимают; плакото — шашки навстречу друг другу,
 * все 15 на старте, не бьют, а «зажимают»: встал на одиночную шашку соперника — она лежит под твоей и не ходит, пока ты не уйдёшь;
 * зажал «мать» (шашку соперника на его стартовом пункте) — победа с 2 очками. Матч тавли — эти три игры по кругу до N очков.
 */
import type { Options, Rng } from '../../core/types';

export type Mode = 'long' | 'short' | 'gulbara' | 'plakoto' | 'fevga' | 'portes' | 'tabula' | 'zeno' | 'duodecim' | 'pompeii';
export type HeadRule = 'classic' | 'strict' | 'free';
export type Block6 = 'rule' | 'home' | 'forbid' | 'allow';

export interface Cfg {
  mode: Mode;
  /** До скольки очков матч (1 — одна партия). */
  target: number;
  /** Длинные и гюльбара: сколько шашек можно снять с головы за ход. */
  head: HeadRule;
  /** Длинные и гюльбара: блок из шести пунктов подряд. */
  block6: Block6;
  /** Марс (соперник не снял ни одной шашки) — 2 очка. */
  mars: boolean;
  /** Кокс — 3 очка. */
  koks: boolean;
  /** Домашний марс — 4 очка: марс, да ещё шашки проигравшего остались в доме победителя (длинные). */
  homeMars?: boolean;
  /** Короткие: куб удвоения. */
  cube: boolean;
  /** Гюльбара: каскад дублей (после дубля — все старшие дубли до 6:6). */
  cascade: boolean;
  /** Гюльбара: несыгранный остаток каскада доигрывает соперник. */
  steal: boolean;
  /** Матч тавли: портес → плакото → февга по кругу. */
  tavli?: boolean;
}

/** Игра тавли по номеру партии. */
export const tavliMode = (game: number): Mode => (['portes', 'plakoto', 'fevga'] as const)[(game - 1) % 3];
/** Встречная геометрия (как в коротких). */
export const isShortGeo = (cfg: Cfg) => cfg.mode === 'short' || cfg.mode === 'portes' || cfg.mode === 'plakoto';
/** Римские игры: табула (24 пункта) и 12 линий (36 полей) — три кости, шашки входят с руки, одиночку бьют. */
export const isRoman = (cfg: Cfg) => cfg.mode === 'tabula' || cfg.mode === 'zeno' || cfg.mode === 'duodecim' || cfg.mode === 'pompeii';
/** 12 линий: три ряда по 12 полей. */
export const isLines = (cfg: Cfg) => cfg.mode === 'duodecim' || cfg.mode === 'pompeii';
/** Оба игрока идут по одному и тому же пути (табула по Остину). */
export const sharedPath = (cfg: Cfg) => cfg.mode === 'tabula';
/** Табула Зенона: шашки не снимают — побеждает тот, кто первым собрал все в последней четверти. */
export const noBearOff = (cfg: Cfg) => cfg.mode === 'zeno';
/** Сколько пунктов на пути. */
export const boardSize = (cfg: Cfg) => (isLines(cfg) ? 36 : 24);
/** Шашек у каждого: в помпейском наборе — по 12. */
export const checkersOf = (cfg: Cfg) => (cfg.mode === 'pompeii' ? 12 : CHECKERS);
/** Сколько костей бросают. */
export const diceCount = (cfg: Cfg) => (isRoman(cfg) ? 3 : 2);
/** С какого индекса пути начинается дом (откуда можно снимать). */
export const homeStart = (cfg: Cfg) => (isLines(cfg) ? 24 : 18);

export const DEFAULT_CFG: Cfg = {
  mode: 'long',
  target: 1,
  head: 'classic',
  block6: 'rule',
  mars: true,
  koks: false,
  cube: false,
  cascade: true,
  steal: true,
};

export function cfgFrom(o: Options): Cfg {
  const pick = <T extends string>(v: unknown, list: readonly T[], def: T): T => (list as readonly unknown[]).includes(v) ? (v as T) : def;
  const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
  const tavli = o.mode === 'tavli';
  const mode = tavli ? 'portes' : pick(o.mode, ['long', 'short', 'gulbara', 'plakoto', 'fevga', 'portes'] as const, 'long');
  const roman = ['tabula', 'zeno', 'duodecim', 'pompeii'].includes(String(o.mode));
  if (roman)
    return { mode: o.mode as Mode, target: Math.max(1, Math.min(25, Number(o.target) || 1)), head: 'free', block6: 'allow', mars: false, koks: false, cube: false, cascade: false, steal: false };
  const greek = mode === 'plakoto' || mode === 'fevga' || mode === 'portes';
  if (greek)
    return { mode, target: Math.max(1, Math.min(25, Number(o.target) || (tavli ? 5 : 1))), head: 'free', block6: 'rule', mars: true, koks: false, cube: false, cascade: false, steal: false, tavli };
  return {
    mode,
    target: Math.max(1, Math.min(25, Number(o.target) || 1)),
    head: pick(o.head, ['classic', 'strict', 'free'] as const, DEFAULT_CFG.head),
    block6: pick(o.block6, ['rule', 'home', 'forbid', 'allow'] as const, DEFAULT_CFG.block6),
    mars: bool(o.mars, true),
    koks: bool(o.koks, mode === 'short'),
    homeMars: mode !== 'short' && bool(o.homeMars, false),
    cube: mode === 'short' && bool(o.cube, false),
    cascade: bool(o.cascade, true),
    steal: bool(o.steal, true),
  };
}

export const CHECKERS = 15;
/** Индекс «снята с доски» (за пределами любого пути). */
export const OFF = 99;
export const BAR = -1;

export interface CubeState {
  value: number;
  /** Кто владеет кубом: -1 — в центре. */
  owner: number;
}

export interface State {
  cfg: Cfg;
  pts: number[];
  /** Плакото: кто зажат на пункте (место) или -1. */
  pin?: number[];
  bar: [number, number];
  /** Римские игры: шашки, ещё не введённые на доску (на руке). */
  hand?: [number, number];
  off: [number, number];
  cur: number;
  phase: 'opening' | 'roll' | 'move' | 'cube' | 'over';
  /** Выпавшие кубики (для показа). */
  dice: number[];
  /** Значения, которые осталось сыграть в этой части хода. */
  left: number[];
  /** Гюльбара: следующие дубли каскада. */
  queue: number[];
  /** Гюльбара: ходы, которые соперник доиграет за игрока перед своим броском. */
  steal: number[];
  /** Сейчас доигрывается чужой остаток каскада. */
  stealing: boolean;
  /** Сколько шашек снято с головы в этом ходу. */
  headMoves: number;
  /** Сыгранных ходов у каждого (для исключения первого хода и каскада). */
  turns: [number, number];
  cube: CubeState;
  score: [number, number];
  /** Номер партии в матче. */
  game: number;
  /** Партия Кроуфорда: удваивать нельзя. */
  crawford: boolean;
  crawfordDone: boolean;
  winner: number | null;
  /** Итог последней партии. */
  lastEnd?: { winner: number; kind: EndKind; points: number };
}

export type Action =
  | { type: 'opening' }
  | { type: 'roll' }
  | { type: 'move'; from: number; die: number }
  | { type: 'double' }
  | { type: 'take' }
  | { type: 'drop' };

export type EndKind = 'oin' | 'mars' | 'koks' | 'homeMars' | 'drop' | 'mother';

export type Event =
  | { type: 'opening'; rolls: [number, number][]; first: number; game: number; mode?: Mode }
  | { type: 'roll'; seat: number; dice: number[]; cascade?: number[]; noMoves?: boolean }
  | { type: 'stage'; seat: number; value: number }
  | {
      type: 'move';
      seat: number;
      from: number;
      to: number;
      die: number;
      /** Абсолютные пункты для анимации: -1 — бар (или рука), OFF — снята. */
      fromAbs: number;
      toAbs: number;
      hit?: boolean;
      /** Плакото: зажал шашку соперника. */
      pin?: boolean;
      stolen?: boolean;
      /** Римские игры: шашка введена с руки (а не с бара). */
      fromHand?: boolean;
      /** Римские игры: поля в журнале считаются от входа (1 — первое поле пути). */
      fwd?: boolean;
    }
  | { type: 'forfeit'; seat: number; count: number; toOpponent: boolean }
  | { type: 'steal'; seat: number; count: number }
  | { type: 'double'; seat: number; value: number }
  | { type: 'take'; seat: number; value: number }
  | { type: 'drop'; seat: number }
  | { type: 'gameEnd'; winner: number; points: number; kind: EndKind; cube: number; score: [number, number]; matchOver: boolean };

export interface Step {
  from: number;
  die: number;
}

// ---------- геометрия ----------

/* Римские игры: путь каждого игрока — список абсолютных полей.
 * Табула — та же доска в 24 пункта: по Остину оба входят в правую верхнюю четверть и идут одной дорогой
 * против часовой стрелки (дом — справа внизу); у Зенона — навстречу, как в коротких нардах.
 * 12 линий — поля 0..35: ряд × 12 + столбец (ряд 0 — нижний, у белых; 2 — верхний; столбцы слева направо).
 * Белые входят в правую половину среднего ряда и идут по нему справа налево, затем верхний ряд слева направо,
 * затем свой нижний ряд справа налево и снимаются за его левым краем. Путь чёрных — тот же, повёрнутый на 180°. */
const LONG_PATH = [...Array(24).keys()].map((i) => (12 + i) % 24);
const LINES_PATH = [...Array(36).keys()].map((i) => (i < 12 ? 23 - i : i < 24 ? i + 12 : 35 - i));
const ROMAN_PATHS: Partial<Record<Mode, number[][]>> = {
  tabula: [LONG_PATH, LONG_PATH],
  zeno: [LONG_PATH, LONG_PATH.map((_, i) => (35 - i) % 24)],
  duodecim: [LINES_PATH, LINES_PATH.map((a) => 35 - a)],
  pompeii: [LINES_PATH, LINES_PATH.map((a) => 35 - a)],
};

export function absOf(cfg: Cfg, p: number, i: number): number {
  const rp = ROMAN_PATHS[cfg.mode];
  if (rp) return rp[p][i];
  if (p === 0) return (12 + i) % 24;
  return isShortGeo(cfg) ? (35 - i) % 24 : i;
}

const PATH_CACHE = new Map<string, number[][]>();
/** idxOf[p][a] — индекс пути игрока p для абсолютного пункта a. */
export function idxTable(cfg: Cfg): number[][] {
  const key = ROMAN_PATHS[cfg.mode] ? cfg.mode : isShortGeo(cfg) ? 's' : 'l';
  let t = PATH_CACHE.get(key);
  if (!t) {
    const n = boardSize(cfg);
    t = [0, 1].map((p) => {
      const r = new Array(n).fill(0);
      for (let i = 0; i < n; i++) r[absOf(cfg, p, i)] = i;
      return r;
    });
    PATH_CACHE.set(key, t);
  }
  return t;
}

export const sign = (p: number) => (p === 0 ? 1 : -1);
/** Длинная геометрия: шашка не бьёт, одиночка закрывает пункт (длинные, гюльбара, февга). */
export const isLong = (cfg: Cfg) => !isShortGeo(cfg) && !isRoman(cfg);

/** Шашек игрока p на индексе пути i. */
export function own(s: State, p: number, i: number): number {
  const v = s.pts[absOf(s.cfg, p, i)] * sign(p);
  return v > 0 ? v : 0;
}
/** Шашек соперника на индексе пути i игрока p. */
export function foe(s: State, p: number, i: number): number {
  const v = s.pts[absOf(s.cfg, p, i)] * sign(p);
  return v < 0 ? -v : 0;
}

/** Шашки, которые ещё надо ввести на доску: побитые и (в римских играх) не вошедшие. */
export const waiting = (s: State, p: number) => s.bar[p] + (s.hand ? s.hand[p] : 0);

export function allHome(s: State, p: number): boolean {
  if (waiting(s, p)) return false;
  const h = homeStart(s.cfg);
  for (let i = 0; i < h; i++) if (own(s, p, i)) return false;
  // плакото: зажатые шашки тоже должны быть дома
  if (s.pin) for (let a = 0; a < 24; a++) if (s.pin[a] === p && idxTable(s.cfg)[p][a] < h) return false;
  return true;
}

export function pipCount(s: State, p: number): number {
  const n = boardSize(s.cfg);
  let v = waiting(s, p) * (n + 1);
  for (let i = 0; i < n; i++) v += own(s, p, i) * (n - i);
  return v;
}

// ---------- расстановка ----------

function emptyBoard(cfg: Cfg): number[] {
  const pts = new Array(boardSize(cfg)).fill(0);
  if (isRoman(cfg)) return pts; // все шашки на руке
  const put = (p: number, i: number, n: number) => (pts[absOf(cfg, p, i)] += n * sign(p));
  for (const p of [0, 1]) {
    if (cfg.mode === 'short' || cfg.mode === 'portes') {
      // 24-й пункт — 2, 13-й — 5, 8-й — 3, 6-й — 5 (индекс пути = 24 - номер пункта)
      put(p, 0, 2);
      put(p, 11, 5);
      put(p, 16, 3);
      put(p, 18, 5);
    } else put(p, 0, CHECKERS);
  }
  return pts;
}

function freshGame(s: State) {
  if (s.cfg.tavli) s.cfg = { ...s.cfg, mode: tavliMode(s.game) };
  s.pts = emptyBoard(s.cfg);
  s.pin = s.cfg.mode === 'plakoto' ? new Array(24).fill(-1) : undefined;
  s.bar = [0, 0];
  s.hand = isRoman(s.cfg) ? [checkersOf(s.cfg), checkersOf(s.cfg)] : undefined;
  s.off = [0, 0];
  s.phase = 'opening';
  s.dice = new Array(diceCount(s.cfg)).fill(0);
  s.left = [];
  s.queue = [];
  s.steal = [];
  s.stealing = false;
  s.headMoves = 0;
  s.turns = [0, 0];
  s.cube = { value: 1, owner: -1 };
}

export function newGame(cfg: Cfg): State {
  const s = {
    cfg: { ...cfg },
    cur: 0,
    score: [0, 0],
    game: 1,
    crawford: false,
    crawfordDone: false,
    winner: null,
  } as unknown as State;
  freshGame(s);
  return s;
}

export const clone = (s: State): State => ({
  ...s,
  cfg: s.cfg,
  pts: s.pts.slice(),
  pin: s.pin ? s.pin.slice() : undefined,
  bar: [s.bar[0], s.bar[1]],
  hand: s.hand ? [s.hand[0], s.hand[1]] : undefined,
  off: [s.off[0], s.off[1]],
  dice: s.dice.slice(),
  left: s.left.slice(),
  queue: s.queue.slice(),
  steal: s.steal.slice(),
  turns: [s.turns[0], s.turns[1]],
  cube: { ...s.cube },
  score: [s.score[0], s.score[1]],
});

// ---------- ходы ----------

function headLimit(s: State, p: number): number {
  const c = s.cfg;
  if (!isLong(c) || c.head === 'free') return CHECKERS;
  // первым ходом на любой дубль можно снять с головы две шашки
  if (c.head === 'classic' && s.turns[p] === 0 && !s.stealing && s.dice[0] === s.dice[1]) return 2;
  return 1;
}

/** Нарушает ли позиция правило блока из шести (для игрока p, только что походившего). */
function badBlock(s: State, p: number): boolean {
  const c = s.cfg;
  if (!isLong(c) || c.block6 === 'allow') return false;
  const o = 1 - p;
  // занятые мной пункты в индексах пути соперника
  let run = 0;
  let furthestFoe = -1;
  for (let i = 0; i < 24; i++) if (own(s, o, i)) furthestFoe = i;
  if (s.off[o]) furthestFoe = 24;
  let foeHome = s.off[o] > 0;
  for (let i = 18; i < 24; i++) if (own(s, o, i)) foeHome = true;
  for (let i = 0; i < 24; i++) {
    run = foe(s, o, i) ? run + 1 : 0;
    if (run >= 6) {
      if (c.block6 === 'forbid') return true;
      if (c.block6 === 'home') {
        // вариант: блок можно, если хоть одна шашка соперника уже у него дома
        if (!foeHome) return true;
        continue;
      }
      // блок допустим, только если впереди него стоит хотя бы одна шашка соперника
      let end = i;
      while (end + 1 < 24 && foe(s, o, end + 1)) end++;
      if (furthestFoe <= end) return true;
      i = end;
      run = 0;
    }
  }
  return false;
}

/** Куда придёт шашка: индекс пути или OFF. null — ход по правилам невозможен (без учёта «максимума кубиков»). */
function stepTarget(s: State, p: number, from: number, die: number): number | null {
  const long = isLong(s.cfg);
  const n = boardSize(s.cfg);
  if (s.bar[p] > 0 && from !== BAR) return null;
  if (from === BAR) {
    if (!waiting(s, p)) return null;
  } else if (from < 0 || from >= n || !own(s, p, from)) return null;
  if (long && from === 0 && s.headMoves >= headLimit(s, p)) return null;
  // февга: пока первая шашка не дошла до четверти соперника, с головы вторую не снимают
  if (s.cfg.mode === 'fevga' && from === 0) {
    let far = -1;
    for (let i = 1; i < 24; i++) if (own(s, p, i)) far = i;
    if (far >= 1 && far < 12 && !s.off[p]) return null;
  }
  const to = (from === BAR ? -1 : from) + die;
  if (to < n) {
    // табула: пока на руке есть шашки, за первую четверть не выходят
    if (s.cfg.mode === 'tabula' && s.hand![p] > 0 && to >= 6) return null;
    const f = foe(s, p, to);
    if (s.cfg.mode === 'plakoto') {
      // встать можно на пустой, свой или одиночную шашку соперника, под которой никто не зажат
      if (f > 1 || (f === 1 && s.pin![absOf(s.cfg, p, to)] !== -1)) return null;
      return to;
    }
    if (long ? f > 0 : f > 1) return null;
    return to;
  }
  if (noBearOff(s.cfg) || !allHome(s, p)) return null;
  if (to > n) {
    // с младшего пункта можно снимать большим кубиком, только если на старших пунктах дома пусто
    for (let j = homeStart(s.cfg); j < from; j++) if (own(s, p, j)) return null;
  }
  return OFF;
}

/** Применить шаг (мутирует s). Возвращает событие хода. */
function doStep(s: State, p: number, from: number, die: number, to: number) {
  const sg = sign(p);
  let hit = false;
  let pinned = false;
  let fromHand = false;
  if (from === BAR) {
    if (s.bar[p]) s.bar[p]--;
    else {
      s.hand![p]--;
      fromHand = true;
    }
  } else {
    const fa = absOf(s.cfg, p, from);
    s.pts[fa] -= sg;
    // плакото: ушла последняя шашка — зажатая освобождается
    if (s.pin && s.pts[fa] === 0 && s.pin[fa] !== -1) {
      s.pts[fa] = sign(s.pin[fa]);
      s.pin[fa] = -1;
    }
  }
  if (to === OFF) s.off[p]++;
  else if (s.pin && s.pts[absOf(s.cfg, p, to)] * sg < 0) {
    // плакото: зажимаем одиночку
    const a = absOf(s.cfg, p, to);
    s.pin[a] = 1 - p;
    s.pts[a] = sg;
    pinned = true;
  } else {
    const a = absOf(s.cfg, p, to);
    if (s.pts[a] * sg < 0) {
      // короткие: бьём одиночную шашку
      s.pts[a] = 0;
      s.bar[1 - p]++;
      hit = true;
    }
    s.pts[a] += sg;
  }
  if (from === 0 && isLong(s.cfg)) s.headMoves++;
  const i = s.left.indexOf(die);
  s.left.splice(i, 1);
  const ev: Extract<Event, { type: 'move' }> = {
    type: 'move',
    seat: p,
    from,
    to,
    die,
    fromAbs: from === BAR ? -1 : absOf(s.cfg, p, from),
    toAbs: to === OFF ? OFF : absOf(s.cfg, p, to),
  };
  if (hit) ev.hit = true;
  if (fromHand) ev.fromHand = true;
  if (isRoman(s.cfg)) ev.fwd = true;
  if (pinned) ev.pin = true;
  return ev;
}

/** Шаги, допустимые сами по себе (без правила «сыграть максимум»). */
function rawSteps(s: State, p: number): Step[] {
  const out: Step[] = [];
  const dice = [...new Set(s.left)];
  const onBoard = [...Array(boardSize(s.cfg)).keys()].filter((i) => own(s, p, i));
  const froms = s.bar[p] ? [BAR] : s.hand?.[p] ? [BAR, ...onBoard] : onBoard;
  for (const d of dice) {
    for (const f of froms) {
      const to = stepTarget(s, p, f, d);
      if (to == null) continue;
      if (isLong(s.cfg) && s.cfg.block6 !== 'allow' && to !== OFF) {
        const t = clone(s);
        doStep(t, p, f, d, to);
        if (badBlock(t, p)) continue;
      }
      out.push({ from: f, die: d });
    }
  }
  return out;
}

export function boardKey(s: State): string {
  return s.pts.join(',') + '|' + (s.pin ? s.pin.join(',') : '') + '|' + s.bar.join(',') + '|' + (s.hand ? s.hand.join(',') : '') + '|' + s.off.join(',') + '|' + s.left.join(',') + '|' + s.headMoves;
}

/** Сколько ещё кубиков можно сыграть из этой позиции (в пределах текущей части хода). */
function maxPlayable(s: State, p: number, memo: Map<string, number>): number {
  if (!s.left.length) return 0;
  const key = boardKey(s);
  const hit = memo.get(key);
  if (hit != null) return hit;
  let best = 0;
  for (const st of rawSteps(s, p)) {
    const t = clone(s);
    doStep(t, p, st.from, st.die, stepTarget(s, p, st.from, st.die)!);
    best = Math.max(best, 1 + maxPlayable(t, p, memo));
    if (best === s.left.length) break;
  }
  memo.set(key, best);
  return best;
}

/** Допустимые шаги текущего игрока с учётом правил «сыграть максимум кубиков» и «если можно один — больший». */
export function legalSteps(s: State): Step[] {
  if (s.phase !== 'move') return [];
  const p = s.cur;
  const raw = rawSteps(s, p);
  if (!raw.length) return [];
  const memo = new Map<string, number>();
  const scored = raw.map((st) => {
    const t = clone(s);
    doStep(t, p, st.from, st.die, stepTarget(s, p, st.from, st.die)!);
    return { st, n: 1 + maxPlayable(t, p, memo) };
  });
  const max = Math.max(...scored.map((x) => x.n));
  let res = scored.filter((x) => x.n === max).map((x) => x.st);
  if (max === 1 && s.left.length === 2 && s.left[0] !== s.left[1]) {
    const hi = Math.max(...res.map((x) => x.die));
    res = res.filter((x) => x.die === hi);
  }
  return res;
}

export function targetOf(s: State, st: Step): number | null {
  return stepTarget(s, s.cur, st.from, st.die);
}

// ---------- ход партии ----------

function canDouble(s: State): boolean {
  const c = s.cfg;
  return c.cube && !s.crawford && s.phase === 'roll' && s.cube.value < 64 && (s.cube.owner === -1 || s.cube.owner === s.cur);
}

export function mayDouble(s: State): boolean {
  if (!canDouble(s)) return false;
  // в матче удваивать, когда куб уже обеспечивает победу, бессмысленно — не запрещаем, но и не нужно
  return true;
}

function endGame(s: State, w: number, kind: EndKind, events: Event[]) {
  const l = 1 - w;
  let base = 1;
  if (kind === 'mother') base = 2;
  else if (kind !== 'drop' && s.off[l] === 0 && s.cfg.mars) {
    kind = 'mars';
    base = 2;
    if (s.cfg.homeMars && inWinnersHome(s, l)) {
      kind = 'homeMars';
      base = 4;
    } else if (s.cfg.koks && isKoks(s, l)) {
      kind = 'koks';
      base = 3;
    }
  }
  const points = base * s.cube.value;
  s.score[w] += points;
  s.lastEnd = { winner: w, kind, points };
  const matchOver = s.score[w] >= s.cfg.target;
  events.push({ type: 'gameEnd', winner: w, points, kind, cube: s.cube.value, score: [s.score[0], s.score[1]], matchOver });
  if (matchOver) {
    s.phase = 'over';
    s.winner = w;
    s.left = [];
    return;
  }
  // следующая партия матча
  const t = s.cfg.target;
  if (s.cfg.cube && !s.crawfordDone && (s.score[0] === t - 1 || s.score[1] === t - 1)) {
    s.crawford = true;
    s.crawfordDone = true;
  } else s.crawford = false;
  s.game++;
  s.cur = w;
  freshGame(s);
}

/** Кокс: проигравший не снял ни одной шашки и не вывел все шашки из первой четверти пути
 *  (в коротких — шашка на баре или в доме победителя). */
/** Шашки проигравшего l стоят в доме победителя (пункты, откуда победитель снимал). */
export function inWinnersHome(s: State, l: number): boolean {
  const w = 1 - l;
  const n = boardSize(s.cfg);
  for (let i = homeStart(s.cfg); i < n; i++) if (foe(s, w, i)) return true;
  return false;
}

export function isKoks(s: State, l: number): boolean {
  if (s.bar[l]) return true;
  for (let i = 0; i < 6; i++) if (own(s, l, i)) return true;
  return false;
}

/** Закончить часть хода: следующий дубль каскада, передача остатка, переход хода. */
function advance(s: State, events: Event[]) {
  const p = s.cur;
  for (;;) {
    if (s.left.length && legalSteps(s).length) return; // ещё есть что играть
    if (s.left.length) {
      // сыграть нельзя — остаток сгорает или уходит сопернику
      const rest = s.left.length + s.queue.length * 4;
      const give = !s.stealing && s.cfg.steal && isCascade(s);
      if (give) {
        s.steal = s.left.slice();
        for (const v of s.queue) s.steal.push(v, v, v, v);
      }
      events.push({ type: 'forfeit', seat: p, count: rest, toOpponent: give });
      s.left = [];
      s.queue = [];
      break;
    }
    if (s.queue.length) {
      const v = s.queue.shift()!;
      s.left = [v, v, v, v];
      s.dice = [v, v];
      events.push({ type: 'stage', seat: p, value: v });
      continue;
    }
    break;
  }
  endTurn(s, events);
}

function isCascade(s: State) {
  return s.cfg.mode === 'gulbara' && s.cfg.cascade && s.dice[0] === s.dice[1] && s.turns[s.cur] >= 3;
}

function endTurn(s: State, events: Event[]) {
  const p = s.cur;
  if (!s.stealing) s.turns[p]++;
  s.stealing = false;
  s.headMoves = 0;
  s.left = [];
  s.queue = [];
  s.cur = 1 - p;
  if (s.steal.length) {
    // соперник доигрывает остаток каскада, потом бросает сам
    s.left = s.steal;
    s.steal = [];
    s.stealing = true;
    s.phase = 'move';
    s.dice = [s.left[0], s.left[0]];
    events.push({ type: 'steal', seat: s.cur, count: s.left.length });
    if (!legalSteps(s).length) {
      events.push({ type: 'forfeit', seat: s.cur, count: s.left.length, toOpponent: false });
      s.left = [];
      s.stealing = false;
      s.headMoves = 0;
      s.phase = 'roll';
    }
    return;
  }
  s.phase = 'roll';
}

function startMoves(s: State, dice: number[], events: Event[], ev: Extract<Event, { type: 'roll' }>) {
  const [a, b] = dice;
  s.dice = dice.slice();
  s.headMoves = 0;
  s.queue = [];
  // римские игры: три кости, дубль не удваивается
  if (dice.length > 2) s.left = dice.slice();
  else if (a === b) {
    s.left = [a, a, a, a];
    if (isCascade(s)) {
      for (let v = a + 1; v <= 6; v++) s.queue.push(v);
      if (s.queue.length) ev.cascade = s.queue.slice();
    }
  } else s.left = [a, b];
  s.phase = 'move';
  if (!legalSteps(s).length) ev.noMoves = true;
  events.push(ev);
  advance(s, events);
}

export function apply(state: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  const s = clone(state);
  const events: Event[] = [];
  const die = () => rng.int(6) + 1;
  if (s.phase === 'over') return null;

  if (a.type === 'opening') {
    if (s.phase !== 'opening') return null;
    const rolls: [number, number][] = [];
    let x: number, y: number;
    do {
      x = die();
      y = die();
      rolls.push([x, y]);
    } while (x === y && rolls.length < 50);
    if (x === y) y = x === 6 ? 5 : x + 1;
    const first = x > y ? 0 : 1;
    s.cur = first;
    events.push({ type: 'opening', rolls, first, game: s.game, mode: s.cfg.mode });
    if (isShortGeo(s.cfg) || s.cfg.mode === 'fevga') {
      // в коротких (и в тавли) первый ход играют сразу этими кубиками
      startMoves(s, [Math.max(x, y), Math.min(x, y)], events, { type: 'roll', seat: first, dice: [Math.max(x, y), Math.min(x, y)] });
    } else s.phase = 'roll';
    return { state: s, events };
  }

  if (seat !== (s.phase === 'cube' ? 1 - s.cur : s.cur)) return null;

  if (a.type === 'roll') {
    if (s.phase !== 'roll') return null;
    const ds = Array.from({ length: diceCount(s.cfg) }, die);
    startMoves(s, ds, events, { type: 'roll', seat, dice: ds.slice() });
    return { state: s, events };
  }

  if (a.type === 'move') {
    if (s.phase !== 'move') return null;
    if (!legalSteps(s).some((st) => st.from === a.from && st.die === a.die)) return null;
    const to = stepTarget(s, seat, a.from, a.die)!;
    const ev = doStep(s, seat, a.from, a.die, to);
    if (s.stealing) ev.stolen = true;
    events.push(ev);
    // плакото: зажата «мать» — шашка соперника на его стартовом пункте
    if (ev.pin && to !== OFF && idxTable(s.cfg)[1 - seat][absOf(s.cfg, seat, to)] === 0) {
      endGame(s, seat, 'mother', events);
      return { state: s, events };
    }
    if (s.off[seat] === checkersOf(s.cfg) || (noBearOff(s.cfg) && allHome(s, seat))) {
      endGame(s, seat, 'oin', events);
      return { state: s, events };
    }
    advance(s, events);
    return { state: s, events };
  }

  if (a.type === 'double') {
    if (!mayDouble(s)) return null;
    s.phase = 'cube';
    events.push({ type: 'double', seat, value: s.cube.value * 2 });
    return { state: s, events };
  }

  if (a.type === 'take' || a.type === 'drop') {
    if (s.phase !== 'cube') return null;
    if (a.type === 'take') {
      s.cube = { value: s.cube.value * 2, owner: seat };
      s.phase = 'roll';
      events.push({ type: 'take', seat, value: s.cube.value });
    } else {
      events.push({ type: 'drop', seat });
      endGame(s, 1 - seat, 'drop', events);
    }
    return { state: s, events };
  }
  return null;
}

export function toAct(s: State): number[] {
  if (s.phase === 'over') return [];
  if (s.phase === 'opening') return [0, 1];
  if (s.phase === 'cube') return [1 - s.cur];
  return [s.cur];
}

/** Применить шаг без проверок (для ботов): мутирует копию. */
export function simStep(s: State, st: Step): State {
  const t = clone(s);
  const to = stepTarget(t, t.cur, st.from, st.die)!;
  doStep(t, t.cur, st.from, st.die, to);
  return t;
}

/** Все различные итоги текущей части хода (позиция + шаги) — только те, что играют максимум кубиков. */
export function finals(s: State, limit = 6000): { state: State; steps: Step[] }[] {
  const p = s.cur;
  const out = new Map<string, { state: State; steps: Step[] }>();
  const seen = new Set<string>();
  const walk = (t: State, steps: Step[]) => {
    const raw = t.left.length ? rawSteps(t, p) : [];
    if (!raw.length) {
      const k = t.pts.join(',') + '|' + t.bar.join(',') + '|' + (t.hand ? t.hand.join(',') : '') + '|' + t.off.join(',');
      if (!out.has(k)) out.set(k, { state: t, steps });
      return;
    }
    for (const st of raw) {
      if (seen.size > limit) return;
      const n = simStep(t, st);
      const k = boardKey(n);
      if (seen.has(k)) continue;
      seen.add(k);
      walk(n, [...steps, st]);
    }
  };
  walk(s, []);
  let res = [...out.values()];
  const max = Math.max(...res.map((r) => r.steps.length));
  res = res.filter((r) => r.steps.length === max);
  if (max === 1 && s.left.length === 2 && s.left[0] !== s.left[1]) {
    const hi = Math.max(...res.map((r) => r.steps[0].die));
    res = res.filter((r) => r.steps[0].die === hi);
  }
  return res;
}
