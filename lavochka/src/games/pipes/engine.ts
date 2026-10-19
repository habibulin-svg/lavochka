/* «Водопроводчик» — головоломка-поворотка (как Net / Pipes): в центре — бак с водой, по полю — куски труб.
 * Поворачивая куски, нужно соединить все трубы в одну сеть без открытых концов, чтобы вода дошла до каждого крана.
 * Уровень задаётся номером: он и есть сид генератора, «Сыграть ещё» ведёт на следующий. Без DOM. */
import { SeededRng } from '../../core/rng';
import type { Options, Rng } from '../../core/types';

/** Биты сторон: вверх 1, вправо 2, вниз 4, влево 8. */
export const UP = 1;
export const RIGHT = 2;
export const DOWN = 4;
export const LEFT = 8;
export const DIRS = [UP, RIGHT, DOWN, LEFT];
export const OPP: Record<number, number> = { 1: 4, 2: 8, 4: 1, 8: 2 };

export const rotCW = (m: number) => ((m << 1) | (m >> 3)) & 15;
export const rotCCW = (m: number) => ((m >> 1) | ((m & 1) << 3)) & 15;
export const deg = (m: number) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);

export const SIZES = [5, 7, 9, 11, 13, 15];
export type Mode = 'coop' | 'race';

export interface Cfg {
  w: number;
  h: number;
  wrap: boolean;
  /** Крестовины (четыре выхода) — разрешены ли. */
  cross: boolean;
  level: number;
  mode: Mode;
}

export interface Board {
  /** Трубы клеток сейчас (биты сторон). */
  tile: number[];
  /** Закреплённые клетки (их не поворачивают). */
  lock: boolean[];
  turns: number;
  done: boolean;
  t0: number;
  t1: number;
}

export interface State {
  cfg: Cfg;
  seats: number[];
  /** Где бак с водой. */
  src: number;
  boards: Board[];
  /** Повороты на счету каждого места. */
  credit: number[];
  moves: number;
  done: boolean;
  /** Последний повёрнутый кусок у каждого места. */
  last: number[];
}

export type Action = { type: 'rot'; i: number; d: 1 | -1 } | { type: 'lock'; i: number } | { type: 'think' };

export type Event =
  | { type: 'rot'; seat: number; b: number; i: number; d: 1 | -1 }
  | { type: 'lock'; seat: number; b: number; i: number; on: boolean }
  | { type: 'solved'; seat: number; b: number; sec: number; turns: number }
  | { type: 'end' };

export function cfgOf(o: Options, players = 1): Cfg {
  const n = SIZES.includes(Number(o.size)) ? Number(o.size) : 7;
  const level = Math.max(1, Math.min(99999, Math.round(Number(o.level)) || 1));
  return { w: n, h: n, wrap: !!o.wrap, cross: !!o.cross, level, mode: players > 1 && o.mode === 'race' ? 'race' : 'coop' };
}

/** Сосед клетки i в сторону d (с учётом тора); -1 — за краем. */
export function step(c: { w: number; h: number; wrap: boolean }, i: number, d: number): number {
  let x = i % c.w;
  let y = Math.floor(i / c.w);
  if (d === UP) y--;
  else if (d === DOWN) y++;
  else if (d === LEFT) x--;
  else x++;
  if (c.wrap) {
    x = (x + c.w) % c.w;
    y = (y + c.h) % c.h;
  } else if (x < 0 || y < 0 || x >= c.w || y >= c.h) return -1;
  return y * c.w + x;
}

/** Случайное остовное дерево от центра (Прим): соединяет все клетки, у каждой не больше 3 выходов (4 — если можно крестовины). */
export function generate(c: Cfg): { tiles: number[]; src: number } {
  const rng = new SeededRng(c.level * 7919 + c.w * 131 + (c.wrap ? 17 : 0) + (c.cross ? 5 : 0));
  const n = c.w * c.h;
  const src = Math.floor(c.h / 2) * c.w + Math.floor(c.w / 2);
  for (let attempt = 0; attempt < 50; attempt++) {
    const tiles = new Array(n).fill(0);
    const inTree = new Array(n).fill(false);
    inTree[src] = true;
    let count = 1;
    const maxDeg = c.cross ? 4 : 3;
    const frontier: [number, number][] = [];
    const push = (i: number) => {
      for (const d of DIRS) {
        const j = step(c, i, d);
        if (j >= 0 && !inTree[j]) frontier.push([i, d]);
      }
    };
    push(src);
    while (frontier.length && count < n) {
      const k = rng.int(frontier.length);
      const [i, d] = frontier[k];
      frontier[k] = frontier[frontier.length - 1];
      frontier.pop();
      const j = step(c, i, d);
      if (inTree[j] || deg(tiles[i]) >= maxDeg) continue;
      // прямые длинные трубы скучны: продолжение «по прямой» иногда пропускаем
      if (tiles[i] === OPP[d] && rng.next() < 0.35 && frontier.length > 2) {
        frontier.push([i, d]);
        continue;
      }
      tiles[i] |= d;
      tiles[j] |= OPP[d];
      inTree[j] = true;
      count++;
      push(j);
    }
    if (count === n) return { tiles, src };
  }
  throw new Error('pipes: не удалось построить сеть');
}

/** Какие клетки получают воду: обход от бака по стыкующимся трубам. */
export function watered(c: { w: number; h: number; wrap: boolean }, tile: number[], src: number): boolean[] {
  const wet = new Array(tile.length).fill(false);
  wet[src] = true;
  const stack = [src];
  while (stack.length) {
    const i = stack.pop()!;
    for (const d of DIRS) {
      if (!(tile[i] & d)) continue;
      const j = step(c, i, d);
      if (j < 0 || wet[j] || !(tile[j] & OPP[d])) continue;
      wet[j] = true;
      stack.push(j);
    }
  }
  return wet;
}

/** Решено: вода во всех клетках и ни одного открытого конца (каждый выход упирается в ответный). */
export function solved(c: { w: number; h: number; wrap: boolean }, tile: number[], src: number): boolean {
  for (let i = 0; i < tile.length; i++)
    for (const d of DIRS) {
      if (!(tile[i] & d)) continue;
      const j = step(c, i, d);
      if (j < 0 || !(tile[j] & OPP[d])) return false;
    }
  return watered(c, tile, src).every(Boolean);
}

export function setup(seats: number[], o: Options, rng: Rng, now = Date.now()): State {
  const cfg = cfgOf(o, seats.length);
  const { tiles, src } = generate(cfg);
  // перемешать повороты (кусок-крестовину и прямую на 180° поворачивать без толку — им всё равно)
  const mixed = tiles.map((m) => {
    let t = m;
    for (let k = rng.int(4); k > 0; k--) t = rotCW(t);
    return t;
  });
  if (solved(cfg, mixed, src)) mixed[src === 0 ? 1 : 0] = rotCW(mixed[src === 0 ? 1 : 0]);
  const top = Math.max(4, ...seats) + 1;
  const nb = cfg.mode === 'race' ? seats.length : 1;
  const boards: Board[] = [];
  for (let k = 0; k < nb; k++) boards.push({ tile: mixed.slice(), lock: new Array(mixed.length).fill(false), turns: 0, done: false, t0: now, t1: 0 });
  return { cfg, seats, src, boards, credit: new Array(top).fill(0), moves: 0, done: false, last: new Array(top).fill(-1) };
}

export const boardOf = (s: State, seat: number) => (s.cfg.mode === 'race' ? s.seats.indexOf(seat) : 0);

export function toAct(s: State): number[] {
  if (s.done) return [];
  const k = s.moves % s.seats.length;
  return [...s.seats.slice(k), ...s.seats.slice(0, k)];
}

export function apply(s0: State, seat: number, a: Action, _rng: Rng, now = Date.now()): { state: State; events: Event[] } | null {
  if (s0.done || !s0.seats.includes(seat)) return null;
  if (a?.type === 'think') return { state: { ...s0, moves: s0.moves + 1 }, events: [] };
  const n = s0.cfg.w * s0.cfg.h;
  if (!a || !Number.isInteger(a.i) || a.i < 0 || a.i >= n) return null;
  const bi = boardOf(s0, seat);
  const b0 = s0.boards[bi];
  if (b0.done) return null;
  const b: Board = { ...b0, tile: b0.tile.slice(), lock: b0.lock.slice() };
  const s: State = { ...s0, boards: s0.boards.slice(), credit: s0.credit.slice(), last: s0.last.slice(), moves: s0.moves + 1 };
  s.boards[bi] = b;
  const ev: Event[] = [];
  if (a.type === 'lock') {
    b.lock[a.i] = !b.lock[a.i];
    ev.push({ type: 'lock', seat, b: bi, i: a.i, on: b.lock[a.i] });
    return { state: s, events: ev };
  }
  if (a.type !== 'rot' || (a.d !== 1 && a.d !== -1) || b.lock[a.i]) return null;
  b.tile[a.i] = a.d === 1 ? rotCW(b.tile[a.i]) : rotCCW(b.tile[a.i]);
  b.turns++;
  s.credit[seat]++;
  s.last[seat] = a.i;
  ev.push({ type: 'rot', seat, b: bi, i: a.i, d: a.d });
  if (solved(s.cfg, b.tile, s.src)) {
    b.done = true;
    b.t1 = now;
    s.done = true;
    ev.push({ type: 'solved', seat, b: bi, sec: Math.max(0, Math.round((now - b.t0) / 1000)), turns: b.turns }, { type: 'end' });
  }
  return { state: s, events: ev };
}

export function result(s: State): { winners: number[]; text: string; scores: Record<number, number> } | null {
  if (!s.done) return null;
  const scores: Record<number, number> = {};
  for (const x of s.seats) scores[x] = s.credit[x];
  const k = s.boards.findIndex((b) => b.done);
  const b = s.boards[k];
  const sec = Math.max(0, Math.round((b.t1 - b.t0) / 1000));
  if (s.cfg.mode === 'race') return { winners: [s.seats[k]], text: `Первым пустил воду — уровень ${s.cfg.level} за ${sec} с`, scores };
  return { winners: s.seats.slice(), text: `Уровень ${s.cfg.level}: вода пошла за ${sec} с, поворотов ${b.turns}`, scores };
}
