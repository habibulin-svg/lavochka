/* Царская игра Ура — движок. Доска 3×8 с перемычкой: у каждого игрока свой ряд (4 клетки большого блока и 2 малого),
 * средний ряд из 8 клеток — общий. Путь (по Финкелю): 1–4 — свой ряд большого блока к краю, 5–12 — средний ряд,
 * 13–14 — свой ряд малого блока обратно; 15 — фишка вышла. Розетки — 4, 8 (средняя, на общем пути) и 14.
 * Бросок — четыре пирамидки (или три), у каждой две вершины из четырёх отмечены: очки — сколько отмеченных смотрит вверх. */
import type { Options, Rng } from '../../core/types';

export const HOME = 15;
export const ROSETTES = [4, 8, 14];
export const SHARED = (p: number) => p >= 5 && p <= 12;

export interface Cfg {
  pieces: number;
  dice: number;
  /** Средняя розетка безопасна: на ней фишку не бьют. */
  safe: boolean;
  /** Выход только точным броском. */
  exact: boolean;
  /** Ставки по табличке Итти-Мардука: проскочил розетку — жетон в кон, встал на розетку — жетон из кона. */
  stakes: boolean;
}

export interface State {
  cfg: Cfg;
  /** Места за столом по сторонам: side 0 — нижний ряд, side 1 — верхний. */
  seats: number[];
  cur: number;
  phase: 'roll' | 'move' | 'over';
  /** Последний бросок: пирамидки (1 — отмеченная вершина вверх) и очки. */
  dice: number[];
  value: number;
  /** Клетки фишек по сторонам: 0 — ещё не вошла, 1–14 — на доске, 15 — вышла. */
  pos: number[][];
  tokens: number[];
  pool: number;
  winner: number | null;
  /** Последний ход — для подсветки. */
  last: { side: number; from: number; to: number } | null;
  moves: number;
}

export type Action = { type: 'roll' } | { type: 'move'; from: number };

export type Event =
  | { type: 'roll'; seat: number; dice: number[]; value: number; none: boolean }
  | { type: 'move'; seat: number; side: number; from: number; to: number; hit: boolean; again: boolean; paid: number; took: number }
  | { type: 'end'; winner: number };

export const STAKE = 10;

export function cfgFrom(o: Options): Cfg {
  return {
    pieces: Number(o.pieces ?? 7),
    dice: Number(o.dice ?? 4),
    safe: o.safe !== false,
    exact: o.exact !== false,
    stakes: o.stakes === true,
  };
}

export function newState(cfg: Cfg, seats = [0, 1]): State {
  return {
    cfg,
    seats,
    cur: 0,
    phase: 'roll',
    dice: [],
    value: 0,
    pos: [Array(cfg.pieces).fill(0), Array(cfg.pieces).fill(0)],
    tokens: cfg.stakes ? [STAKE, STAKE] : [0, 0],
    pool: 0,
    winner: null,
    last: null,
    moves: 0,
  };
}

export function setup(seats: number[], o: Options): State {
  return newState(cfgFrom(o), seats.length === 2 ? seats : [0, 1]);
}

/** Клетка пути стороны → столбец и ряд на доске (столбцы 0–7 слева направо, ряды 0 — верх, 1 — середина, 2 — низ). */
export function cell(side: number, p: number): [number, number] {
  const own = side === 0 ? 2 : 0;
  if (p <= 4) return [4 - p, own];
  if (p <= 12) return [p - 5, 1];
  return [p === 13 ? 7 : 6, own];
}

export function toAct(s: State): number[] {
  return s.phase === 'over' ? [] : [s.seats[s.cur]];
}

/** Куда пойдёт фишка с клетки from при броске v; null — хода нет. */
export function target(s: State, side: number, from: number, v: number): number | null {
  if (v <= 0 || from >= HOME) return null;
  let to = from + v;
  if (to > HOME) {
    if (s.cfg.exact) return null;
    to = HOME;
  }
  if (to === HOME) return to;
  if (s.pos[side].includes(to)) return null;
  if (SHARED(to) && s.pos[1 - side].includes(to) && to === 8 && s.cfg.safe) return null;
  return to;
}

/** Клетки, с которых можно пойти (без повторов: все невошедшие — одна клетка 0). */
export function legal(s: State): { from: number; to: number }[] {
  if (s.phase !== 'move') return [];
  const out: { from: number; to: number }[] = [];
  const seen = new Set<number>();
  for (const from of s.pos[s.cur]) {
    if (seen.has(from)) continue;
    seen.add(from);
    const to = target(s, s.cur, from, s.value);
    if (to != null) out.push({ from, to });
  }
  return out.sort((a, b) => a.from - b.from);
}

/** Очки броска: каждая пирамидка — 0 или 1. */
export function throwDice(n: number, rng: Rng): number[] {
  return Array.from({ length: n }, () => rng.int(2));
}

function pass(s: State) {
  s.cur = 1 - s.cur;
  s.phase = 'roll';
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.phase === 'over' || seat !== s0.seats[s0.cur]) return null;
  const s: State = structuredClone(s0);
  const events: Event[] = [];
  if (a.type === 'roll') {
    if (s.phase !== 'roll') return null;
    s.dice = throwDice(s.cfg.dice, rng);
    s.value = s.dice.reduce((x, y) => x + y, 0);
    s.phase = 'move';
    const none = legal(s).length === 0;
    events.push({ type: 'roll', seat, dice: s.dice, value: s.value, none });
    if (none) pass(s);
    return { state: s, events };
  }
  if (a.type !== 'move' || s.phase !== 'move') return null;
  const side = s.cur;
  const to = target(s, side, a.from, s.value);
  if (to == null || !s.pos[side].includes(a.from)) return null;
  const i = s.pos[side].indexOf(a.from);
  s.pos[side][i] = to;
  let hit = false;
  if (to < HOME && SHARED(to)) {
    const j = s.pos[1 - side].indexOf(to);
    if (j >= 0) {
      s.pos[1 - side][j] = 0;
      hit = true;
    }
  }
  const again = ROSETTES.includes(to);
  let paid = 0;
  let took = 0;
  if (s.cfg.stakes) {
    // проскочил розетку, не встав на неё, — жетон в кон; встал на розетку — жетон из кона
    for (const r of ROSETTES) if (a.from < r && to > r && s.tokens[side] > 0) paid++;
    paid = Math.min(paid, s.tokens[side]);
    s.tokens[side] -= paid;
    s.pool += paid;
    if (again && s.pool > 0) {
      took = 1;
      s.pool--;
      s.tokens[side]++;
    }
  }
  s.last = { side, from: a.from, to };
  s.moves++;
  events.push({ type: 'move', seat, side, from: a.from, to, hit, again, paid, took });
  if (s.pos[side].every((p) => p === HOME)) {
    s.phase = 'over';
    s.winner = side;
    if (s.cfg.stakes) {
      s.tokens[side] += s.pool;
      s.pool = 0;
    }
    events.push({ type: 'end', winner: s.seats[side] });
    return { state: s, events };
  }
  if (again) s.phase = 'roll';
  else pass(s);
  return { state: s, events };
}

/** Вероятности очков броска n пирамидок: биномиальные. */
export function odds(n: number): number[] {
  const out = Array(n + 1).fill(0);
  for (let m = 0; m < 1 << n; m++) {
    let k = 0;
    for (let b = m; b; b >>= 1) k += b & 1;
    out[k] += 1 / (1 << n);
  }
  return out;
}
