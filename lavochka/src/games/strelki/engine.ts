/* «Стрелки» — головоломка «выпусти стрелки» (по механике Arrows Go / Arrow Out): на сетке лежат стрелки-змейки из нескольких клеток,
 * у каждой на конце наконечник. Тап — стрелка ползёт вперёд по своему телу и улетает за край, если впереди до самого края пусто.
 * Если на пути другая стрелка — доползает до неё, отскакивает назад, и пропадает сердце. Выпустили все — уровень пройден.
 * Убирая свободную стрелку, путь другим только расчищаешь, поэтому уровень всегда решается — нужно лишь не ошибаться.
 * Уровень задаётся номером (сид генератора), «Сыграть ещё» ведёт к следующему. Без DOM. */
import { SeededRng } from '../../core/rng';
import { gameNow } from '../../core/clock';
import type { Options, Rng } from '../../core/types';

/** 0 — вверх, 1 — вправо, 2 — вниз, 3 — влево. */
export type Dir = 0 | 1 | 2 | 3;
export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];

export const SIZES = [5, 7, 9, 11, 13, 16];
export type Shape = 'bent' | 'straight';
export type Mode = 'coop' | 'race';

export interface Cfg {
  w: number;
  h: number;
  level: number;
  shape: Shape;
  /** Сердец на уровень; 0 — без счёта (ошибки только считаются). */
  lives: number;
  hints: boolean;
  mode: Mode;
}

export interface Arrow {
  /** Клетки от хвоста к голове. */
  cells: number[];
  dir: Dir;
  /** Цвет мела (номер). */
  tone: number;
}

export interface Board {
  gone: boolean[];
  lives: number;
  mistakes: number;
  hints: number;
  /** Подсказанная стрелка (-1 — нет). */
  hint: number;
  taps: number;
  done: boolean;
  failed: boolean;
  t0: number;
  t1: number;
}

export interface State {
  cfg: Cfg;
  seats: number[];
  arrows: Arrow[];
  boards: Board[];
  /** Выпущенные стрелки на счету каждого места. */
  credit: number[];
  moves: number;
  done: boolean;
}

export type Action = { type: 'tap'; a: number } | { type: 'hint' } | { type: 'think' };

export type Event =
  | { type: 'fly'; seat: number; b: number; a: number }
  /** Упёрлась: голова доползла на steps клеток и встретила стрелку by. */
  | { type: 'bump'; seat: number; b: number; a: number; steps: number; by: number; lives: number }
  | { type: 'hint'; seat: number; b: number; a: number }
  | { type: 'clear'; seat: number; b: number; sec: number; mistakes: number }
  | { type: 'fail'; seat: number; b: number }
  | { type: 'end' };

export function cfgOf(o: Options, players = 1): Cfg {
  const n = SIZES.includes(Number(o.size)) ? Number(o.size) : 9;
  const level = Math.max(1, Math.min(99999, Math.round(Number(o.level)) || 1));
  const lv = Number(o.lives);
  const lives = [0, 1, 3, 5].includes(lv) ? lv : 3;
  return { w: n, h: n, level, shape: o.shape === 'straight' ? 'straight' : 'bent', lives, hints: o.hints !== false, mode: players > 1 && o.mode === 'race' ? 'race' : 'coop' };
}

export const xy = (c: { w: number }, i: number) => [i % c.w, Math.floor(i / c.w)] as const;

/** Клетки луча от головы стрелки до края (без самой головы). */
export function ray(c: { w: number; h: number }, head: number, d: Dir): number[] {
  const out: number[] = [];
  let x = head % c.w;
  let y = Math.floor(head / c.w);
  for (;;) {
    x += DX[d];
    y += DY[d];
    if (x < 0 || y < 0 || x >= c.w || y >= c.h) return out;
    out.push(y * c.w + x);
  }
}

/** Какая стрелка лежит в каждой клетке (-1 — пусто), с учётом выпущенных. */
export function occupancy(s: { cfg: Cfg; arrows: Arrow[] }, gone: boolean[]): Int32Array {
  const occ = new Int32Array(s.cfg.w * s.cfg.h).fill(-1);
  s.arrows.forEach((a, k) => {
    if (!gone[k]) for (const i of a.cells) occ[i] = k;
  });
  return occ;
}

/** Что мешает стрелке k: { steps — на сколько клеток доползёт голова, by — чья стрелка впереди } или null, если путь свободен. */
export function blocker(s: { cfg: Cfg; arrows: Arrow[] }, occ: Int32Array, k: number): { steps: number; by: number } | null {
  const a = s.arrows[k];
  const r = ray(s.cfg, a.cells[a.cells.length - 1], a.dir);
  for (let j = 0; j < r.length; j++) if (occ[r[j]] >= 0) return { steps: j, by: occ[r[j]] };
  return null;
}

/** Свободные сейчас стрелки (их можно выпускать). */
export function freeArrows(s: { cfg: Cfg; arrows: Arrow[] }, gone: boolean[]): number[] {
  const occ = occupancy(s, gone);
  const out: number[] = [];
  for (let k = 0; k < s.arrows.length; k++) if (!gone[k] && !blocker(s, occ, k)) out.push(k);
  return out;
}

const dirOf = (c: { w: number }, from: number, to: number): Dir => {
  const d = to - from;
  return d === 1 ? 1 : d === -1 ? 3 : d > 0 ? 2 : 0;
};

/**
 * Генератор «задом наперёд»: стрелки кладутся в порядке, обратном выпуску. Каждую новую стрелку кладём так,
 * чтобы её луч до края не задевал уже лежащих — значит, её можно выпустить раньше них. Поле заполняется плотно.
 */
export function generate(c: Cfg): Arrow[] {
  const rng = new SeededRng(c.level * 104729 + c.w * 613 + (c.shape === 'straight' ? 31 : 0));
  const N = c.w * c.h;
  const occ = new Int32Array(N).fill(-1);
  const arrows: Arrow[] = [];
  const maxLen = c.shape === 'straight' ? Math.max(2, Math.min(5, Math.ceil(c.w / 2))) : Math.max(3, Math.min(12, Math.round(c.w * 0.9)));
  const minLen = 2;
  const nb = (i: number): number[] => {
    const [x, y] = xy(c, i);
    const out: number[] = [];
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (nx >= 0 && ny >= 0 && nx < c.w && ny < c.h) out.push(ny * c.w + nx);
    }
    return out;
  };
  /** Путь из клетки start: случайная прогулка по пустым клеткам. */
  const walk = (start: number, len: number): number[] => {
    const path = [start];
    const used = new Set(path);
    let dir = -1;
    while (path.length < len) {
      const cur = path[path.length - 1];
      const opts = nb(cur).filter((j) => occ[j] < 0 && !used.has(j));
      if (!opts.length) break;
      let next: number;
      if (c.shape === 'straight') {
        if (dir < 0) next = opts[rng.int(opts.length)];
        else {
          const st = opts.find((j) => dirOf(c, cur, j) === dir);
          if (st == null) break;
          next = st;
        }
      } else {
        const st = dir >= 0 ? opts.find((j) => dirOf(c, cur, j) === dir) : undefined;
        next = st != null && rng.next() < 0.45 ? st : opts[rng.int(opts.length)];
      }
      dir = dirOf(c, cur, next);
      path.push(next);
      used.add(next);
    }
    return path;
  };
  const fits = (cells: number[]): Dir | -1 => {
    const head = cells[cells.length - 1];
    const d = dirOf(c, cells[cells.length - 2], head);
    const own = new Set(cells);
    for (const j of ray(c, head, d)) if (occ[j] >= 0 || own.has(j)) return -1;
    return d;
  };
  const place = (cells: number[], d: Dir) => {
    const k = arrows.length;
    for (const i of cells) occ[i] = k;
    arrows.push({ cells, dir: d, tone: 0 });
  };
  for (let pass = 0; pass < 4; pass++) {
    const order = Array.from({ length: N }, (_, i) => i);
    for (let i = N - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (const start of order) {
      if (occ[start] >= 0) continue;
      // несколько прогулок из клетки; берём ту, чей луч длиннее: длинный луч потом перекроют другие стрелки,
      // и в начале свободных стрелок мало, а цепочки «сначала эту, потом ту» — длинные
      let best: { cells: number[]; d: Dir; score: number } | null = null;
      for (let tries = 0; tries < 6; tries++) {
        const len = minLen + rng.int(maxLen - minLen + 1);
        const p = walk(start, len);
        if (p.length < minLen) break;
        for (let L = p.length; L >= minLen; L--) {
          const fw = p.slice(0, L);
          let hit = false;
          for (const cells of [fw, fw.slice().reverse()]) {
            const d = fits(cells);
            if (d < 0) continue;
            hit = true;
            const reach = ray(c, cells[cells.length - 1], d as Dir).length;
            const score = reach * 2 + L + rng.next() * 3;
            if (!best || score > best.score) best = { cells, d: d as Dir, score };
          }
          if (hit) break;
        }
      }
      if (best) place(best.cells, best.d);
    }
  }
  // мел разных цветов: соседние стрелки — по возможности разными
  const TONES = 5;
  arrows.forEach((a, k) => {
    const near = new Set<number>();
    for (const i of a.cells)
      for (const j of nb(i)) {
        const o = occ[j];
        if (o >= 0 && o < k) near.add(arrows[o].tone);
      }
    const free = Array.from({ length: TONES }, (_, t) => t).filter((t) => !near.has(t));
    a.tone = free.length ? free[rng.int(free.length)] : rng.int(TONES);
  });
  // порядок в списке не должен подсказывать порядок выпуска
  for (let i = arrows.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [arrows[i], arrows[j]] = [arrows[j], arrows[i]];
  }
  return arrows;
}

export function newBoard(cfg: Cfg, count: number, now: number): Board {
  return { gone: new Array(count).fill(false), lives: cfg.lives, mistakes: 0, hints: 0, hint: -1, taps: 0, done: false, failed: false, t0: now, t1: 0 };
}

export function setup(seats: number[], o: Options, _rng: Rng, now = gameNow()): State {
  const cfg = cfgOf(o, seats.length);
  const arrows = generate(cfg);
  const top = Math.max(4, ...seats) + 1;
  const nb = cfg.mode === 'race' ? seats.length : 1;
  const boards: Board[] = [];
  for (let k = 0; k < nb; k++) boards.push(newBoard(cfg, arrows.length, now));
  return { cfg, seats, arrows, boards, credit: new Array(top).fill(0), moves: 0, done: false };
}

export const boardOf = (s: State, seat: number) => (s.cfg.mode === 'race' ? s.seats.indexOf(seat) : 0);
export const left = (b: Board) => b.gone.reduce((n, g) => n + (g ? 0 : 1), 0);

export function toAct(s: State): number[] {
  if (s.done) return [];
  const live = s.seats.filter((x) => {
    const b = s.boards[boardOf(s, x)];
    return !b.done && !b.failed;
  });
  const k = s.moves % Math.max(1, live.length);
  return [...live.slice(k), ...live.slice(0, k)];
}

export function apply(s0: State, seat: number, a: Action, _rng: Rng, now = gameNow()): { state: State; events: Event[] } | null {
  if (s0.done || !toAct(s0).includes(seat) || !a) return null;
  if (a.type === 'think') return { state: { ...s0, moves: s0.moves + 1 }, events: [] };
  const bi = boardOf(s0, seat);
  const b0 = s0.boards[bi];
  if (b0.done || b0.failed) return null;
  const b: Board = { ...b0, gone: b0.gone.slice() };
  const s: State = { ...s0, boards: s0.boards.slice(), credit: s0.credit.slice(), moves: s0.moves + 1 };
  s.boards[bi] = b;
  const ev: Event[] = [];
  if (a.type === 'hint') {
    if (!s.cfg.hints) return null;
    const free = freeArrows(s, b.gone);
    if (!free.length) return null;
    // подсказываем ту же, если она ещё свободна
    b.hint = free.includes(b0.hint) ? b0.hint : free[0];
    b.hints++;
    ev.push({ type: 'hint', seat, b: bi, a: b.hint });
    return { state: s, events: ev };
  }
  if (a.type !== 'tap' || !Number.isInteger(a.a) || a.a < 0 || a.a >= s.arrows.length || b.gone[a.a]) return null;
  b.taps++;
  const occ = occupancy(s, b.gone);
  const bl = blocker(s, occ, a.a);
  if (bl) {
    b.mistakes++;
    if (s.cfg.lives) b.lives = Math.max(0, b.lives - 1);
    ev.push({ type: 'bump', seat, b: bi, a: a.a, steps: bl.steps, by: bl.by, lives: b.lives });
    if (s.cfg.lives && b.lives <= 0) {
      b.failed = true;
      b.t1 = now;
      ev.push({ type: 'fail', seat, b: bi });
    }
  } else {
    b.gone[a.a] = true;
    if (b.hint === a.a) b.hint = -1;
    s.credit[seat]++;
    ev.push({ type: 'fly', seat, b: bi, a: a.a });
    if (b.gone.every(Boolean)) {
      b.done = true;
      b.t1 = now;
      ev.push({ type: 'clear', seat, b: bi, sec: Math.max(0, Math.round((now - b.t0) / 1000)), mistakes: b.mistakes });
    }
  }
  if (b.done || s.boards.every((x) => x.done || x.failed)) s.done = true;
  if (s.done) ev.push({ type: 'end' });
  return { state: s, events: ev };
}

export function result(s: State): { winners: number[]; text: string; scores: Record<number, number> } | null {
  if (!s.done) return null;
  const scores: Record<number, number> = {};
  for (const x of s.seats) scores[x] = s.credit[x];
  const k = s.boards.findIndex((b) => b.done);
  if (k < 0) {
    if (s.cfg.mode === 'race') {
      const best = Math.max(...s.boards.map((b) => b.gone.filter(Boolean).length));
      return { winners: s.seats.filter((_, j) => s.boards[j].gone.filter(Boolean).length === best), text: `Сердца кончились у всех — дальше всех продвинулся тот, кто выпустил ${best}`, scores };
    }
    const b = s.boards[0];
    return { winners: [], text: `Сердца кончились: осталось стрелок ${left(b)} из ${s.arrows.length}`, scores };
  }
  const b = s.boards[k];
  const sec = Math.max(0, Math.round((b.t1 - b.t0) / 1000));
  const err = b.mistakes ? `, ошибок ${b.mistakes}` : ' без единой ошибки';
  if (s.cfg.mode === 'race') return { winners: [s.seats[k]], text: `Первым очистил поле — уровень ${s.cfg.level} за ${sec} с${err}`, scores };
  return { winners: s.seats.slice(), text: `Уровень ${s.cfg.level} пройден за ${sec} с${err}`, scores };
}
