/* «Сапёр» — движок без DOM. Три режима:
 *  - «Одному или вместе» — одно поле, как в Windows: все открывают клетки в одном поле, мина — проигрыш для всех;
 *  - «Наперегонки» — у каждого своё поле с одинаковыми минами и общей стартовой поляной; кто первым разминирует;
 *  - «Охота на мины» — одно поле, ходят по очереди, найденная мина — очко и ещё ход (как Minesweeper Flags).
 * Мины лежат только в состоянии комнаты: view их не отдаёт, пока поле не кончилось. */
import type { Options, Rng } from '../../core/types';
import { countNums, flood, neighbours, solvable } from './solver';

export type Mode = 'solo' | 'race' | 'flags';
/** Первая клетка: как в Windows (просто не мина), поляна (ноль), без угадывания (поле решается логикой). */
export type Start = 'win' | 'zero' | 'noguess';

export const SIZES: Record<string, { label: string; w: number; h: number; m: number }> = {
  beginner: { label: 'Новичок', w: 9, h: 9, m: 10 },
  amateur: { label: 'Любитель', w: 16, h: 16, m: 40 },
  pro: { label: 'Профессионал', w: 30, h: 16, m: 99 },
};
export const MODE_LABEL: Record<Mode, string> = { solo: 'Одному или вместе', race: 'Наперегонки', flags: 'Охота на мины' };

export interface Cfg {
  mode: Mode;
  w: number;
  h: number;
  m: number;
  torus: boolean;
  knight: boolean;
  start: Start;
  /** Отметки «?» правой кнопкой (как в Windows). */
  marks: boolean;
}

export interface Board {
  /** Мины. В view — пусто, пока поле не кончилось. */
  mine: boolean[];
  open: boolean[];
  /** Число у открытой клетки; в view у закрытых — -1. */
  num: number[];
  /** 0 — ничего, 1 — флажок, 2 — «?». */
  mark: number[];
  /** Охота: кто нашёл мину (-1 — никто). */
  owner: number[];
  /** Клетка, где подорвались. */
  boom: number;
  st: 'new' | 'play' | 'won' | 'lost';
  /** Сколько пустых клеток ещё закрыто. */
  left: number;
  t0: number;
  t1: number;
  /** Чужое поле в «Наперегонки»: клетки не видны, только счёт. */
  hidden?: boolean;
}

export interface State {
  cfg: Cfg;
  seats: number[];
  boards: Board[];
  /** Охота: чей ход (место). */
  turn: number;
  /** Охота — найденные мины; иначе — открытые клетки. По местам. */
  score: number[];
  moves: number;
  done: boolean;
  /** Наперегонки: общая стартовая клетка (-1 — нет). */
  start: number;
  /** Последняя клетка, которую открыл каждый (для подсветки). */
  last: number[];
}

export type Action =
  | { type: 'open'; i: number }
  | { type: 'chord'; i: number }
  | { type: 'mark'; i: number; m: number }
  | { type: 'think' };

export type Event =
  | { type: 'open'; seat: number; b: number; cells: number[] }
  | { type: 'mark'; seat: number; b: number; i: number; m: number }
  | { type: 'claim'; seat: number; i: number; score: number }
  | { type: 'boom'; seat: number; b: number; i: number }
  | { type: 'won'; seat: number; b: number; sec: number }
  | { type: 'end' };

const clampInt = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};

/** Охота: мин погуще (16 × 16 — 51, как в оригинале), всегда нечётно — ничьей не бывает. */
export const flagsMines = (w: number, h: number) => {
  const m = Math.round(w * h * 0.2);
  return m % 2 ? m : m + 1;
};

export function cfgOf(o: Options): Cfg {
  const mode: Mode = o.mode === 'race' || o.mode === 'flags' ? o.mode : 'solo';
  let w: number, h: number, m: number;
  const sz = SIZES[String(o.size)];
  if (sz) ({ w, h, m } = sz);
  else {
    w = clampInt(o.cw, 6, 40, 20);
    h = clampInt(o.ch, 6, 30, 12);
    m = clampInt(o.cm, 1, 999, 40);
  }
  if (mode === 'flags') m = flagsMines(w, h);
  m = Math.max(1, Math.min(m, w * h - 10));
  const start: Start = o.start === 'zero' || o.start === 'noguess' ? o.start : 'win';
  return { mode, w, h, m, torus: !!o.torus, knight: !!o.knight, start: mode === 'flags' ? 'win' : start, marks: o.marks !== false };
}

export const nbrOf = (c: Cfg) => neighbours(c.w, c.h, c.torus, c.knight);

function emptyBoard(n: number, m: number, now: number): Board {
  return {
    mine: new Array(n).fill(false),
    open: new Array(n).fill(false),
    num: new Array(n).fill(0),
    mark: new Array(n).fill(0),
    owner: new Array(n).fill(-1),
    boom: -1,
    st: 'new',
    left: n - m,
    t0: now,
    t1: 0,
  };
}

/** Разложить мины, не трогая exclude. Без угадывания — перебор раскладок, пока поле не решится логикой от start. */
export function placeMines(c: Cfg, rng: Rng, exclude: Set<number>, start: number, noguess: boolean): boolean[] {
  const n = c.w * c.h;
  const nbr = nbrOf(c);
  const free: number[] = [];
  for (let i = 0; i < n; i++) if (!exclude.has(i)) free.push(i);
  const m = Math.min(c.m, free.length);
  let mine: boolean[] = [];
  const tries = noguess ? 600 : 1;
  for (let t = 0; t < tries; t++) {
    const pool = free.slice();
    mine = new Array(n).fill(false);
    for (let k = 0; k < m; k++) {
      const j = k + rng.int(pool.length - k);
      [pool[k], pool[j]] = [pool[j], pool[k]];
      mine[pool[k]] = true;
    }
    if (!noguess || solvable(nbr, mine, start, m)) break;
  }
  return mine;
}

function excludeFor(c: Cfg, i: number, start: Start): Set<number> {
  const ex = new Set<number>([i]);
  if (start !== 'win') for (const j of nbrOf(c)[i]) ex.add(j);
  return ex;
}

function arm(b: Board, c: Cfg, mine: boolean[], now: number) {
  b.mine = mine;
  b.num = countNums(nbrOf(c), mine);
  b.st = 'play';
  b.t0 = now;
  b.left = c.w * c.h - mine.filter(Boolean).length;
}

export function setup(seats: number[], o: Options, rng: Rng, now = Date.now()): State {
  const c = cfgOf(o);
  const n = c.w * c.h;
  const top = Math.max(4, ...seats) + 1;
  const s: State = {
    cfg: c,
    seats,
    boards: [],
    turn: seats[0],
    score: new Array(top).fill(0),
    moves: 0,
    done: false,
    start: -1,
    last: new Array(top).fill(-1),
  };
  if (c.mode === 'race') {
    // общая раскладка и общая стартовая поляна — честно для всех
    const st = rng.int(n);
    const mine = placeMines(c, rng, excludeFor(c, st, c.start === 'win' ? 'zero' : c.start), st, c.start === 'noguess');
    s.start = st;
    for (let k = 0; k < seats.length; k++) {
      const b = emptyBoard(n, c.m, now);
      arm(b, c, mine.slice(), now);
      b.left -= flood(nbrOf(c), b.num, b.open, st).length;
      s.boards.push(b);
    }
  } else {
    const b = emptyBoard(n, c.m, now);
    if (c.mode === 'flags') arm(b, c, placeMines(c, rng, new Set(), -1, false), now);
    s.boards.push(b);
  }
  return s;
}

/** Разложить мины заранее, как будто первый щелчок будет в клетку i (показ правил: шаги считаются по известной раскладке). */
export function preArm(s: State, i: number, rng: Rng, now = Date.now()): State {
  const c = s.cfg;
  const b = cloneBoard(s.boards[0]);
  arm(b, c, placeMines(c, rng, excludeFor(c, i, c.start), i, c.start === 'noguess'), now);
  return { ...s, boards: [b, ...s.boards.slice(1)] };
}

export const boardOf = (s: State, seat: number) => (s.cfg.mode === 'race' ? s.seats.indexOf(seat) : 0);

/** Кто может действовать: все сразу (кроме подорвавшихся в «Наперегонки»), в охоте — по очереди. Порядок сдвигается, чтобы боты ходили по очереди. */
export function toAct(s: State): number[] {
  if (s.done) return [];
  if (s.cfg.mode === 'flags') return [s.turn];
  const live = s.seats.filter((x) => {
    const b = s.boards[boardOf(s, x)];
    return b.st === 'new' || b.st === 'play';
  });
  const k = s.moves % Math.max(1, live.length);
  return [...live.slice(k), ...live.slice(0, k)];
}

function cloneBoard(b: Board): Board {
  return { ...b, mine: b.mine.slice(), open: b.open.slice(), num: b.num.slice(), mark: b.mark.slice(), owner: b.owner.slice() };
}

const secOf = (b: Board) => Math.max(0, Math.round(((b.t1 || b.t0) - b.t0) / 1000));

/** Найденных мин в охоте. */
export const claimed = (b: Board) => b.owner.filter((x) => x >= 0).length;

function checkEnd(s: State, ev: Event[], now: number) {
  const c = s.cfg;
  if (c.mode === 'solo') s.done = s.boards[0].st === 'won' || s.boards[0].st === 'lost';
  else if (c.mode === 'race') s.done = s.boards.some((b) => b.st === 'won') || s.boards.every((b) => b.st === 'lost');
  else {
    const rest = c.m - claimed(s.boards[0]);
    const sc = s.seats.map((x) => s.score[x]).sort((a, b) => b - a);
    s.done = rest === 0 || sc[0] - (sc[1] ?? 0) > rest;
    if (s.done) s.boards[0].st = 'won';
  }
  if (s.done) {
    for (const b of s.boards) if (!b.t1) b.t1 = now;
    ev.push({ type: 'end' });
  }
}

/** Открыть клетку i доски b местом seat (флажок не открывается). */
function openCell(s: State, b: Board, bi: number, seat: number, i: number, ev: Event[], now: number) {
  const c = s.cfg;
  if (b.open[i]) return;
  if (b.mine[i]) {
    b.open[i] = true;
    if (c.mode === 'flags') {
      b.owner[i] = seat;
      b.mark[i] = 0;
      s.score[seat]++;
      ev.push({ type: 'claim', seat, i, score: s.score[seat] });
      return;
    }
    b.boom = i;
    b.st = 'lost';
    b.t1 = now;
    ev.push({ type: 'boom', seat, b: bi, i });
    return;
  }
  const got = flood(nbrOf(c), b.num, b.open, i, (j) => b.mark[j] === 1);
  for (const j of got) b.mark[j] = 0;
  b.left -= got.length;
  if (c.mode !== 'flags') s.score[seat] += got.length;
  ev.push({ type: 'open', seat, b: bi, cells: got });
  if (b.left <= 0 && c.mode !== 'flags') {
    b.st = 'won';
    b.t1 = now;
    // как в Windows: на выигранном поле все мины помечаются флажками
    b.mine.forEach((m, j) => m && (b.mark[j] = 1));
    ev.push({ type: 'won', seat, b: bi, sec: secOf(b) });
  }
}

export function apply(s0: State, seat: number, a: Action, rng: Rng, now = Date.now()): { state: State; events: Event[] } | null {
  if (s0.done || !s0.seats.includes(seat) || !toAct(s0).includes(seat)) return null;
  const c = s0.cfg;
  const n = c.w * c.h;
  const bi = boardOf(s0, seat);
  const b0 = s0.boards[bi];
  if (a?.type === 'think') return { state: { ...s0, moves: s0.moves + 1 }, events: [] };
  if (!a || !Number.isInteger((a as { i: number }).i) || (a as { i: number }).i < 0 || (a as { i: number }).i >= n) return null;
  if (b0.st === 'won' || b0.st === 'lost') return null;
  const b = cloneBoard(b0);
  const s: State = { ...s0, boards: s0.boards.slice(), score: s0.score.slice(), last: s0.last.slice(), moves: s0.moves + 1 };
  s.boards[bi] = b;
  const ev: Event[] = [];
  const nbr = nbrOf(c);
  switch (a.type) {
    case 'mark': {
      if (c.mode === 'flags' || b.open[a.i] || ![0, 1, 2].includes(a.m) || (a.m === 2 && !c.marks)) return null;
      if (b.mark[a.i] === a.m) return null;
      b.mark[a.i] = a.m;
      ev.push({ type: 'mark', seat, b: bi, i: a.i, m: a.m });
      return { state: s, events: ev };
    }
    case 'open': {
      if (b.open[a.i] || (b.mark[a.i] === 1 && c.mode !== 'flags')) return null;
      if (b.st === 'new') {
        arm(b, c, placeMines(c, rng, excludeFor(c, a.i, c.start), a.i, c.start === 'noguess'), now);
      }
      s.last[seat] = a.i;
      openCell(s, b, bi, seat, a.i, ev, now);
      if (c.mode === 'flags' && !b.mine[a.i]) {
        const k = s.seats.indexOf(seat);
        s.turn = s.seats[(k + 1) % s.seats.length];
      }
      break;
    }
    case 'chord': {
      // как в Windows: на открытом числе, если флажков рядом столько же, — открыть остальных соседей
      if (c.mode === 'flags' || !b.open[a.i] || b.num[a.i] <= 0) return null;
      const ns = nbr[a.i];
      if (ns.filter((j) => b.mark[j] === 1).length !== b.num[a.i]) return null;
      const todo = ns.filter((j) => !b.open[j] && b.mark[j] !== 1);
      if (!todo.length) return null;
      s.last[seat] = a.i;
      for (const j of todo) {
        if (b.st !== 'play') break;
        openCell(s, b, bi, seat, j, ev, now);
      }
      break;
    }
    default:
      return null;
  }
  checkEnd(s, ev, now);
  return { state: s, events: ev };
}

/** Что видят места seats: мины и закрытые числа — только на кончившемся поле; в «Наперегонки» чужие поля — одним счётом. */
export function view(s: State, seats: number[] | 'all'): State {
  const boards = s.boards.map((b, k) => {
    const over = s.done || b.st === 'won' || b.st === 'lost';
    const mineSeat = s.cfg.mode === 'race' ? s.seats[k] : -1;
    if (s.cfg.mode === 'race' && !over && seats !== 'all' && !seats.includes(mineSeat))
      return { ...b, mine: [], open: [], num: [], mark: [], owner: [], hidden: true };
    if (over) return b;
    return { ...b, mine: [], num: b.num.map((x, i) => (b.open[i] ? x : -1)) };
  });
  return { ...s, boards };
}

export function result(s: State): { winners: number[]; text: string; scores: Record<number, number> } | null {
  if (!s.done) return null;
  const c = s.cfg;
  const scores: Record<number, number> = {};
  for (const x of s.seats) scores[x] = s.score[x];
  if (c.mode === 'solo') {
    const b = s.boards[0];
    return b.st === 'won' ? { winners: s.seats.slice(), text: `Поле разминировано за ${secOf(b)} с`, scores } : { winners: [], text: 'Подрыв на мине', scores };
  }
  if (c.mode === 'race') {
    const k = s.boards.findIndex((b) => b.st === 'won');
    if (k >= 0) return { winners: [s.seats[k]], text: `Первым разминировал поле за ${secOf(s.boards[k])} с`, scores };
    const best = Math.min(...s.boards.map((b) => b.left));
    return { winners: s.seats.filter((x, k2) => s.boards[k2].left === best), text: 'Подорвались все — победил тот, кто открыл больше', scores };
  }
  const top = Math.max(...s.seats.map((x) => s.score[x]));
  return { winners: s.seats.filter((x) => s.score[x] === top), text: `Найдено мин: ${top} из ${c.m}`, scores };
}
