/* Нарды — правила (без DOM): длинные, короткие и гюльбара.
 *
 * Доска — 24 пункта, абсолютные номера 0..23: нижний ряд слева направо (0..11), верхний справа налево (12..23).
 * Так ход «вперёд» по абсолютным номерам — против часовой стрелки.
 * У каждого игрока свой путь: индекс 0..23 (0 — голова / самый дальний пункт, 18..23 — дом), 24 — снята с доски.
 *   Белые (0) везде: i → (12 + i) % 24 — голова справа вверху, дом справа внизу.
 *   Чёрные (1) в длинных и гюльбаре: i → i — голова слева внизу, дом слева вверху (ходят в ту же сторону).
 *   Чёрные (1) в коротких: i → (35 - i) % 24 — навстречу белым, дом справа вверху.
 * pts[a] > 0 — столько белых шашек на пункте a, < 0 — чёрных.
 */
import type { Options, Rng } from '../../core/types';

export type Mode = 'long' | 'short' | 'gulbara';
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
  /** Кокс / домашний марс — 3 очка. */
  koks: boolean;
  /** Короткие: куб удвоения. */
  cube: boolean;
  /** Гюльбара: каскад дублей (после дубля — все старшие дубли до 6:6). */
  cascade: boolean;
  /** Гюльбара: несыгранный остаток каскада доигрывает соперник. */
  steal: boolean;
}

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
  const mode = pick(o.mode, ['long', 'short', 'gulbara'] as const, 'long');
  return {
    mode,
    target: Math.max(1, Math.min(25, Number(o.target) || 1)),
    head: pick(o.head, ['classic', 'strict', 'free'] as const, DEFAULT_CFG.head),
    block6: pick(o.block6, ['rule', 'home', 'forbid', 'allow'] as const, DEFAULT_CFG.block6),
    mars: bool(o.mars, true),
    koks: bool(o.koks, mode === 'short'),
    cube: mode === 'short' && bool(o.cube, false),
    cascade: bool(o.cascade, true),
    steal: bool(o.steal, true),
  };
}

export const CHECKERS = 15;
export const OFF = 24;
export const BAR = -1;

export interface CubeState {
  value: number;
  /** Кто владеет кубом: -1 — в центре. */
  owner: number;
}

export interface State {
  cfg: Cfg;
  pts: number[];
  bar: [number, number];
  off: [number, number];
  cur: number;
  phase: 'opening' | 'roll' | 'move' | 'cube' | 'over';
  /** Выпавшие кубики (для показа). */
  dice: [number, number];
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

export type EndKind = 'oin' | 'mars' | 'koks' | 'drop';

export type Event =
  | { type: 'opening'; rolls: [number, number][]; first: number; game: number }
  | { type: 'roll'; seat: number; dice: [number, number]; cascade?: number[]; noMoves?: boolean }
  | { type: 'stage'; seat: number; value: number }
  | {
      type: 'move';
      seat: number;
      from: number;
      to: number;
      die: number;
      /** Абсолютные пункты для анимации: -1 — бар, 24 — снята. */
      fromAbs: number;
      toAbs: number;
      hit?: boolean;
      stolen?: boolean;
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

export function absOf(cfg: Cfg, p: number, i: number): number {
  if (p === 0) return (12 + i) % 24;
  return cfg.mode === 'short' ? (35 - i) % 24 : i;
}

const PATH_CACHE = new Map<string, number[][]>();
/** idxOf[p][a] — индекс пути игрока p для абсолютного пункта a. */
export function idxTable(cfg: Cfg): number[][] {
  const key = cfg.mode === 'short' ? 's' : 'l';
  let t = PATH_CACHE.get(key);
  if (!t) {
    t = [0, 1].map((p) => {
      const r = new Array(24).fill(0);
      for (let i = 0; i < 24; i++) r[absOf(cfg, p, i)] = i;
      return r;
    });
    PATH_CACHE.set(key, t);
  }
  return t;
}

export const sign = (p: number) => (p === 0 ? 1 : -1);
export const isLong = (cfg: Cfg) => cfg.mode !== 'short';

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

export function allHome(s: State, p: number): boolean {
  if (s.bar[p]) return false;
  for (let i = 0; i < 18; i++) if (own(s, p, i)) return false;
  return true;
}

export function pipCount(s: State, p: number): number {
  let n = s.bar[p] * 25;
  for (let i = 0; i < 24; i++) n += own(s, p, i) * (24 - i);
  return n;
}

// ---------- расстановка ----------

function emptyBoard(cfg: Cfg): number[] {
  const pts = new Array(24).fill(0);
  const put = (p: number, i: number, n: number) => (pts[absOf(cfg, p, i)] += n * sign(p));
  for (const p of [0, 1]) {
    if (cfg.mode === 'short') {
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
  s.pts = emptyBoard(s.cfg);
  s.bar = [0, 0];
  s.off = [0, 0];
  s.phase = 'opening';
  s.dice = [0, 0];
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
  bar: [s.bar[0], s.bar[1]],
  off: [s.off[0], s.off[1]],
  dice: [s.dice[0], s.dice[1]],
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
  if (s.bar[p] > 0 && from !== BAR) return null;
  if (from === BAR) {
    if (!s.bar[p]) return null;
  } else if (from < 0 || from > 23 || !own(s, p, from)) return null;
  if (long && from === 0 && s.headMoves >= headLimit(s, p)) return null;
  const to = (from === BAR ? -1 : from) + die;
  if (to < 24) {
    const f = foe(s, p, to);
    if (long ? f > 0 : f > 1) return null;
    return to;
  }
  if (!allHome(s, p)) return null;
  if (to > 24) {
    // с младшего пункта можно снимать большим кубиком, только если на старших пунктах дома пусто
    for (let j = 18; j < from; j++) if (own(s, p, j)) return null;
  }
  return OFF;
}

/** Применить шаг (мутирует s). Возвращает событие хода. */
function doStep(s: State, p: number, from: number, die: number, to: number) {
  const sg = sign(p);
  let hit = false;
  if (from === BAR) s.bar[p]--;
  else s.pts[absOf(s.cfg, p, from)] -= sg;
  if (to === OFF) s.off[p]++;
  else {
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
    toAbs: to === OFF ? 24 : absOf(s.cfg, p, to),
  };
  if (hit) ev.hit = true;
  return ev;
}

/** Шаги, допустимые сами по себе (без правила «сыграть максимум»). */
function rawSteps(s: State, p: number): Step[] {
  const out: Step[] = [];
  const dice = [...new Set(s.left)];
  const froms = s.bar[p] ? [BAR] : [...Array(24).keys()].filter((i) => own(s, p, i));
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
  return s.pts.join(',') + '|' + s.bar.join(',') + '|' + s.off.join(',') + '|' + s.left.join(',') + '|' + s.headMoves;
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
  if (kind !== 'drop' && s.off[l] === 0 && s.cfg.mars) {
    kind = 'mars';
    base = 2;
    if (s.cfg.koks && isKoks(s, l)) {
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

function startMoves(s: State, a: number, b: number, events: Event[], ev: Extract<Event, { type: 'roll' }>) {
  s.dice = [a, b];
  s.headMoves = 0;
  s.queue = [];
  if (a === b) {
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
    events.push({ type: 'opening', rolls, first, game: s.game });
    if (s.cfg.mode === 'short') {
      // в коротких первый ход играют сразу этими кубиками
      startMoves(s, Math.max(x, y), Math.min(x, y), events, { type: 'roll', seat: first, dice: [Math.max(x, y), Math.min(x, y)] });
    } else s.phase = 'roll';
    return { state: s, events };
  }

  if (seat !== (s.phase === 'cube' ? 1 - s.cur : s.cur)) return null;

  if (a.type === 'roll') {
    if (s.phase !== 'roll') return null;
    const d1 = die();
    const d2 = die();
    startMoves(s, d1, d2, events, { type: 'roll', seat, dice: [d1, d2] });
    return { state: s, events };
  }

  if (a.type === 'move') {
    if (s.phase !== 'move') return null;
    if (!legalSteps(s).some((st) => st.from === a.from && st.die === a.die)) return null;
    const to = stepTarget(s, seat, a.from, a.die)!;
    const ev = doStep(s, seat, a.from, a.die, to);
    if (s.stealing) ev.stolen = true;
    events.push(ev);
    if (s.off[seat] === CHECKERS) {
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
      const k = t.pts.join(',') + '|' + t.bar.join(',') + '|' + t.off.join(',');
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
