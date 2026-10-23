/* Игры на кресте — правила без DOM. Доска-крест на 33 точки (7×7 без углов), у солитёра есть и французская на 37.
 *
 * «Лиса и гуси»: гуси (место 0) ходят первыми, на соседнюю точку по прямой линии (не по диагонали) и не назад.
 *   Лиса ходит на соседнюю точку по любой линии или прыгает через гуся на пустую точку за ним — гусь съеден;
 *   прыжки можно продолжать той же лисой, но не обязательно. Гуси выигрывают, заперев лису (всех лис);
 *   лиса — когда гусей осталось меньше девяти (запереть уже нечем) или гусям некуда ходить.
 *   Гандикап — уравнять силы: две лисы против 17 гусей.
 * «Асальто»: 24 повстанца (место 0, ходят первыми) штурмуют крепость — верхнюю ветвь креста (9 точек), где стоят два офицера.
 *   Повстанцы ходят на соседнюю точку только вперёд, вбок или вперёд по диагонали; офицеры — в любую сторону,
 *   и бить (прыгать) обязаны, прыжки продолжаются, пока можно. Повстанцы выигрывают, заняв все 9 точек крепости
 *   или заперев офицеров; офицеры — когда повстанцев осталось меньше девяти.
 * «Йога» (солитёр): один игрок. Все лунки заняты, кроме центральной; фишка прыгает по прямой через соседнюю
 *   на пустую лунку, перепрыгнутая снимается. Цель — оставить одну фишку, лучше всего в центре.
 * Линии: «через точку» — диагонали только у точек с чётной суммой координат (классическая доска),
 *   «все» — диагонали в каждом квадрате (советская коробка). 300 ходов без исхода — ничья. */
import type { Options } from '../../core/types';

export type Mode = 'fox' | 'asalto' | 'yoga';
export type Look = 'soviet' | 'wood';

export interface Cfg {
  mode: Mode;
  geese: number;
  foxes: number;
  /** Гусям можно назад. */
  back: boolean;
  lines: 'alt' | 'all';
  /** Доска солитёра: 33 (английская) или 37 (французская). */
  holes: 33 | 37;
  look: Look;
}

export function cfgFrom(o: Options): Cfg {
  const mode: Mode = o.mode === 'asalto' ? 'asalto' : o.mode === 'yoga' ? 'yoga' : 'fox';
  const g = Number(o.geese);
  return {
    mode,
    geese: g === 15 || g === 17 ? g : 13,
    foxes: Number(o.foxes) === 2 ? 2 : 1,
    back: o.back === true,
    lines: o.lines === 'all' ? 'all' : 'alt',
    holes: mode === 'yoga' && Number(o.holes) === 37 ? 37 : 33,
    look: o.look === 'wood' ? 'wood' : 'soviet',
  };
}

export interface Geo {
  xy: [number, number][];
  /** Номер точки по клетке сетки 7×7 (-1 — нет точки). */
  at: number[];
  /** Направления из точки: [dx, dy, сосед, точка за ним или -1]. */
  dirs: [number, number, number, number][][];
}

const cache = new Map<string, Geo>();
export function geo(cfg: Cfg): Geo {
  const k = `${cfg.holes}:${cfg.mode === 'yoga' ? 'o' : cfg.lines}`;
  const c = cache.get(k);
  if (c) return c;
  const on = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < 7 && y < 7 && ((x >= 2 && x <= 4) || (y >= 2 && y <= 4) || (cfg.holes === 37 && x >= 1 && x <= 5 && y >= 1 && y <= 5));
  const xy: [number, number][] = [];
  const at = Array(49).fill(-1);
  for (let y = 0; y < 7; y++)
    for (let x = 0; x < 7; x++)
      if (on(x, y)) {
        at[y * 7 + x] = xy.length;
        xy.push([x, y]);
      }
  const diag = (x: number, y: number) => cfg.mode !== 'yoga' && (cfg.lines === 'all' || (x + y) % 2 === 0);
  const id = (x: number, y: number) => (on(x, y) ? at[y * 7 + x] : -1);
  const dirs = xy.map(([x, y]) => {
    const ds: [number, number][] = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    if (diag(x, y)) ds.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
    const out: [number, number, number, number][] = [];
    for (const [dx, dy] of ds) {
      const a = id(x + dx, y + dy);
      if (a < 0) continue;
      // диагональ продолжается, только если она есть и у соседа (на советской доске — всегда)
      const b = dx && dy && !diag(x + dx, y + dy) ? -1 : id(x + 2 * dx, y + 2 * dy);
      out.push([dx, dy, a, b]);
    }
    return out;
  });
  const g = { xy, at, dirs };
  cache.set(k, g);
  return g;
}

export const EMPTY = 0;
/** Гусь / повстанец / колышек. */
export const MAN = 1;
/** Лиса / офицер. */
export const FOX = 2;

export interface State {
  cfg: Cfg;
  board: number[];
  turn: number;
  /** Лиса посреди серии прыжков (точка) или -1. */
  chain: number;
  ply: number;
  /** Сколько съедено (снято). */
  eaten: number;
  over: boolean;
  winner: number | null;
  last: number[];
}

export type Action = { type: 'move'; from: number; to: number } | { type: 'stop' };
export type Event =
  | { type: 'move'; seat: number; from: number; to: number; kind: number; eat: number }
  | { type: 'stop'; seat: number }
  | { type: 'end'; winner: number | null; why: EndWhy; left?: number };
export type EndWhy = 'trapped' | 'eaten' | 'stuck' | 'fort' | 'long' | 'solved' | 'left';

const LIMIT = 300;
/** Меньше стольких гусей (повстанцев) — запереть лису (взять крепость) уже нечем. */
export const MIN_MEN = 9;

export const isFort = (x: number, y: number) => y <= 2 && x >= 2 && x <= 4;

export function newState(cfg: Cfg): State {
  const G = geo(cfg);
  const board = Array(G.xy.length).fill(EMPTY);
  const put = (x: number, y: number, v: number) => {
    const p = G.at[y * 7 + x];
    if (p >= 0) board[p] = v;
  };
  if (cfg.mode === 'yoga') {
    board.fill(MAN);
    put(3, cfg.holes === 37 ? 2 : 3, EMPTY);
  } else if (cfg.mode === 'asalto') {
    G.xy.forEach(([x, y], p) => {
      if (!isFort(x, y)) board[p] = MAN;
    });
    put(2, 2, FOX);
    put(4, 2, FOX);
  } else {
    // гуси снизу: нижняя ветвь, затем ряд 4, затем края ряда 3
    const order: [number, number][] = [];
    for (const y of [6, 5]) for (const x of [2, 3, 4]) order.push([x, y]);
    for (const x of [0, 1, 2, 3, 4, 5, 6]) order.push([x, 4]);
    for (const x of [0, 6, 1, 5]) order.push([x, 3]);
    for (const [x, y] of order.slice(0, cfg.geese)) put(x, y, MAN);
    if (cfg.foxes === 2) {
      put(2, 1, FOX);
      put(4, 1, FOX);
    } else put(3, 1, FOX);
  }
  return { cfg, board, turn: 0, chain: -1, ply: 0, eaten: 0, over: false, winner: null, last: [] };
}

export const setup = (_seats: number[], o: Options) => newState(cfgFrom(o));
export const toAct = (s: State) => (s.over ? [] : [s.turn]);

/** Прыжки фишки p (лиса/офицер/колышек). */
function jumps(s: State, G: Geo, p: number): Action[] {
  const out: Action[] = [];
  for (const [, , a, b] of G.dirs[p]) if (b >= 0 && s.board[a] === MAN && s.board[b] === EMPTY) out.push({ type: 'move', from: p, to: b });
  return out;
}

/** Шаги гуся / повстанца. */
function manSteps(s: State, G: Geo, p: number): Action[] {
  const out: Action[] = [];
  const asalto = s.cfg.mode === 'asalto';
  for (const [dx, dy, a] of G.dirs[p]) {
    if (s.board[a] !== EMPTY) continue;
    if (asalto) {
      if (dy > 0) continue; // только к крепости: вперёд, вбок, вперёд по диагонали
    } else {
      if (dx && dy) continue; // гуси — только по прямым
      if (dy > 0 && !s.cfg.back) continue;
    }
    out.push({ type: 'move', from: p, to: a });
  }
  return out;
}

function foxSteps(s: State, G: Geo, p: number): Action[] {
  const out: Action[] = [];
  for (const [, , a] of G.dirs[p]) if (s.board[a] === EMPTY) out.push({ type: 'move', from: p, to: a });
  return out;
}

export function legal(s: State): Action[] {
  if (s.over) return [];
  const G = geo(s.cfg);
  const mode = s.cfg.mode;
  if (mode === 'yoga') {
    const out: Action[] = [];
    s.board.forEach((v, p) => {
      if (v === MAN) out.push(...jumps(s, G, p));
    });
    return out;
  }
  if (s.chain >= 0) {
    const more = jumps(s, G, s.chain);
    return mode === 'asalto' ? more : [...more, { type: 'stop' }];
  }
  const out: Action[] = [];
  if (s.turn === 0) {
    s.board.forEach((v, p) => {
      if (v === MAN) out.push(...manSteps(s, G, p));
    });
    return out;
  }
  const caps: Action[] = [];
  s.board.forEach((v, p) => {
    if (v !== FOX) return;
    caps.push(...jumps(s, G, p));
    out.push(...foxSteps(s, G, p));
  });
  if (mode === 'asalto' && caps.length) return caps;
  return [...caps, ...out];
}

const men = (s: State) => s.board.reduce((n, v) => n + (v === MAN ? 1 : 0), 0);

function fortTaken(s: State, G: Geo): boolean {
  let n = 0;
  G.xy.forEach(([x, y], p) => {
    if (isFort(x, y) && s.board[p] === MAN) n++;
  });
  return n === 9;
}

/** Применить ход без проверки. */
export function step(s0: State, a: Action): { state: State; events: Event[] } {
  const G = geo(s0.cfg);
  const s: State = { ...s0, board: s0.board.slice(), last: [] };
  const seat = s0.turn;
  const events: Event[] = [];
  let pass = true;
  if (a.type === 'stop') {
    s.chain = -1;
    events.push({ type: 'stop', seat });
  } else {
    const kind = s.board[a.from];
    s.board[a.from] = EMPTY;
    s.board[a.to] = kind;
    let eat = -1;
    const d = G.dirs[a.from].find(([, , , b]) => b === a.to);
    const isJump = !!d && !G.dirs[a.from].some(([, , x]) => x === a.to);
    if (isJump) {
      eat = d![2];
      s.board[eat] = EMPTY;
      s.eaten++;
    }
    s.last = [a.from, a.to];
    events.push({ type: 'move', seat, from: a.from, to: a.to, kind, eat });
    if (s.cfg.mode !== 'yoga' && eat >= 0) {
      s.chain = a.to;
      if (jumps(s, G, a.to).length && men(s) >= MIN_MEN) pass = false;
      else s.chain = -1;
    }
  }
  s.ply++;
  const end = (winner: number | null, why: EndWhy, left?: number) => {
    s.over = true;
    s.winner = winner;
    s.chain = -1;
    events.push({ type: 'end', winner, why, left });
    return { state: s, events };
  };
  if (s.cfg.mode === 'yoga') {
    if (legal(s).length) return { state: s, events };
    const left = men(s);
    const center = G.at[3 * 7 + 3];
    return end(left === 1 ? 0 : null, left === 1 && s.board[center] === MAN ? 'solved' : 'left', left);
  }
  if (men(s) < MIN_MEN) return end(1, 'eaten');
  if (s.cfg.mode === 'asalto' && fortTaken(s, G)) return end(0, 'fort');
  if (!pass) return { state: s, events };
  s.turn = 1 - seat;
  if (!legal(s).length) return end(seat, s.turn === 1 ? 'trapped' : 'stuck');
  if (s.ply >= LIMIT) return end(null, 'long');
  return { state: s, events };
}

export function apply(s: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  if (s.over || seat !== s.turn || !a) return null;
  const ok = legal(s).some((m) => m.type === a.type && (m.type === 'stop' || (a.type === 'move' && m.from === a.from && m.to === a.to)));
  return ok ? step(s, a) : null;
}

export { men };
