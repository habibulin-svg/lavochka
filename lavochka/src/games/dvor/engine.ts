/* «А у нас во дворе» — движок. Все решают одну и ту же цепочку задач, каждый в своём темпе; очки за решение,
 * минус за подсказки и ошибки, плюс за норматив и за то, что решил первым. Решения задач живут только в состоянии
 * (на сервере / у хоста); игрок получает решение задачи, только когда сам её закрыл. Без DOM. */
import type { Options, Rng } from '../../core/types';
import { shuffle } from '../../core/rng';
import { kindOf, KINDS, type Hint } from './kinds';
import { KIDS, STAGES, stageOf } from './stages';

export interface Cfg {
  mode: 'olymp' | 'train';
  /** Олимпиада: этапов; тренировка: задач. */
  len: number;
  /** 0–2 или -1 — «растёт»: от лёгких к трудным. */
  lvl: number;
  /** Тренировка: тип задачи. */
  kind: string;
}

export interface Puzzle {
  kind: string;
  level: number;
  stage: string;
  data: unknown;
  sol: unknown;
}

export interface Mark {
  ok: boolean;
  pts: number;
  sec: number;
  hints: number;
  wrong: number;
  par: boolean;
  first: boolean;
}

export interface Board {
  /** Номер текущей задачи; = list.length — всё решено. */
  i: number;
  /** Когда открыта текущая задача (мс). */
  t0: number;
  phase: 'solve' | 'done';
  hints: Hint[];
  wrong: number;
  score: number;
  marks: Mark[];
  /** Ходов «думаю» над текущей задачей (бот по ним понимает, что время не идёт — тесты, «пропустить»). */
  thinks?: number;
}

export interface State {
  cfg: Cfg;
  seats: number[];
  list: Puzzle[];
  boards: Record<number, Board>;
  /** Кто первым решил задачу i. */
  first: Record<number, number>;
  turn: number;
}

export type Action = { t: 'ans'; a: unknown } | { t: 'hint' } | { t: 'skip' } | { t: 'next' } | { t: 'think' };

export type Event =
  | { type: 'open'; seat: number; i: number }
  | { type: 'hint'; seat: number; i: number; k: number; text: string }
  | { type: 'wrong'; seat: number; i: number }
  | { type: 'solved'; seat: number; i: number; mark: Mark }
  | { type: 'skip'; seat: number; i: number }
  | { type: 'finish'; seat: number; score: number };

/** Что игрок видит о задаче: условие; решение — только когда закрыл её. */
export interface PuzzleView {
  kind: string;
  level: number;
  stage: string;
  data: unknown;
  sol?: unknown;
}

export interface BoardView {
  i: number;
  t0: number;
  phase: Board['phase'];
  score: number;
  marks: Mark[];
  /** Только своё: текущая задача, подсказки. */
  cur?: PuzzleView;
  hints?: Hint[];
  wrong?: number;
  thinks?: number;
}

export interface View {
  cfg: Cfg;
  seats: number[];
  total: number;
  /** Сколько очков можно набрать максимум (для грамоты). */
  max: number;
  boards: Record<number, BoardView>;
  first: Record<number, number>;
}

export function cfgOf(o: Options): Cfg {
  const mode = o.mode === 'train' ? 'train' : 'olymp';
  const len = Number(mode === 'train' ? (o.count ?? 5) : (o.stages ?? 4));
  const lvl = Number(o.lvl ?? -1);
  const kind = String(o.kind ?? 'zebra');
  return {
    mode,
    len: Math.max(1, Math.min(mode === 'train' ? 20 : STAGES.length, Number.isFinite(len) ? len : 4)),
    lvl: [0, 1, 2].includes(lvl) ? lvl : -1,
    kind: KINDS[kind] ? kind : 'zebra',
  };
}

/** Сколько задач в партии. */
export const countOf = (c: Cfg) => (c.mode === 'train' ? c.len : c.len * 2);

function levelAt(c: Cfg, k: number, n: number): number {
  if (c.lvl >= 0) return c.lvl;
  return Math.min(2, Math.floor((k * 3) / n));
}

/** Цепочка задач: олимпиада — по две задачи разных типов на этап; тренировка — один тип. */
export function makeList(c: Cfg, rng: Rng): Puzzle[] {
  const n = countOf(c);
  const plan: { kind: string; stage: string }[] = [];
  if (c.mode === 'train') {
    const st = STAGES.filter((s) => s.kinds.includes(c.kind));
    for (let k = 0; k < n; k++) plan.push({ kind: c.kind, stage: (st.length ? st[rng.int(st.length)] : STAGES[0]).id });
  } else {
    const stages = shuffle(STAGES, rng).slice(0, c.len);
    for (const st of stages) for (const kind of st.kinds.slice(0, 2)) plan.push({ kind, stage: st.id });
  }
  return plan.map((p, k) => {
    const level = levelAt(c, k, n);
    const { data, sol } = kindOf(p.kind).gen(level, rng, { names: KIDS, stage: p.stage });
    return { kind: p.kind, level, stage: p.stage, data, sol };
  });
}

export function newState(c: Cfg, seats: number[], rng: Rng, now = Date.now()): State {
  const list = makeList(c, rng);
  const boards: Record<number, Board> = {};
  for (const s of seats) boards[s] = { i: 0, t0: now, phase: 'solve', hints: [], wrong: 0, score: 0, marks: [] };
  return { cfg: c, seats, list, boards, first: {}, turn: 0 };
}

export function toAct(s: State): number[] {
  const live = s.seats.filter((x) => s.boards[x].i < s.list.length);
  if (!live.length) return [];
  const k = s.turn % live.length;
  return [...live.slice(k), ...live.slice(0, k)];
}

/** Очки за задачу: база минус подсказки и ошибки (не меньше 1), плюс норматив и «первым». */
export function scoreOf(base: number, hints: number, wrong: number, par: boolean, first: boolean): number {
  return Math.max(1, base - hints - wrong) + (par ? 1 : 0) + (first ? 1 : 0);
}

/** Сколько можно набрать максимум (для грамоты): база + норматив за каждую. */
export function maxScore(s: { list: { kind: string; level: number }[] }, multi: boolean): number {
  return s.list.reduce((t, p) => t + kindOf(p.kind).pts[p.level] + 1 + (multi ? 1 : 0), 0);
}

export function apply(s0: State, seat: number, a: Action, rng: Rng, now = Date.now()): { state: State; events: Event[] } | null {
  const b0 = s0.boards[seat];
  if (!b0 || b0.i >= s0.list.length || !a || typeof a !== 'object') return null;
  const p = s0.list[b0.i];
  const K = kindOf(p.kind);
  const ev: Event[] = [];
  let b: Board = b0;
  const first = { ...s0.first };
  switch (a.t) {
    case 'think':
      b = { ...b0, thinks: (b0.thinks ?? 0) + 1 };
      break;
    case 'hint': {
      if (b0.phase !== 'solve') return null;
      const h = K.hint(p.data, p.sol, b0.hints.length, rng);
      if (!h) return null;
      b = { ...b0, hints: [...b0.hints, h] };
      ev.push({ type: 'hint', seat, i: b0.i, k: b0.hints.length, text: h.text });
      break;
    }
    case 'ans': {
      if (b0.phase !== 'solve') return null;
      let ok = false;
      try {
        ok = K.check(p.data, p.sol, a.a);
      } catch {
        ok = false;
      }
      if (!ok) {
        b = { ...b0, wrong: b0.wrong + 1 };
        ev.push({ type: 'wrong', seat, i: b0.i });
        break;
      }
      const sec = Math.max(0, Math.round((now - b0.t0) / 1000));
      const par = sec <= K.par[p.level];
      const isFirst = s0.seats.length > 1 && first[b0.i] == null;
      if (isFirst) first[b0.i] = seat;
      const pts = scoreOf(K.pts[p.level], b0.hints.length, b0.wrong, par, isFirst);
      const mark: Mark = { ok: true, pts, sec, hints: b0.hints.length, wrong: b0.wrong, par, first: isFirst };
      b = { ...b0, phase: 'done', score: b0.score + pts, marks: [...b0.marks, mark] };
      ev.push({ type: 'solved', seat, i: b0.i, mark });
      break;
    }
    case 'skip': {
      if (b0.phase !== 'solve') return null;
      const sec = Math.max(0, Math.round((now - b0.t0) / 1000));
      b = { ...b0, phase: 'done', marks: [...b0.marks, { ok: false, pts: 0, sec, hints: b0.hints.length, wrong: b0.wrong, par: false, first: false }] };
      ev.push({ type: 'skip', seat, i: b0.i });
      break;
    }
    case 'next': {
      if (b0.phase !== 'done') return null;
      const i = b0.i + 1;
      b = { ...b0, i, t0: now, phase: 'solve', hints: [], wrong: 0, thinks: 0 };
      if (i < s0.list.length) ev.push({ type: 'open', seat, i });
      else ev.push({ type: 'finish', seat, score: b0.score });
      break;
    }
    default:
      return null;
  }
  return { state: { ...s0, boards: { ...s0.boards, [seat]: b }, first, turn: s0.turn + 1 }, events: ev };
}

function puzzleView(p: Puzzle, withSol: boolean): PuzzleView {
  return { kind: p.kind, level: p.level, stage: p.stage, data: p.data, ...(withSol ? { sol: p.sol } : {}) };
}

export function view(s: State, seats: number[] | 'all'): View {
  const boards: Record<number, BoardView> = {};
  for (const x of s.seats) {
    const b = s.boards[x];
    const own = seats === 'all' || seats.includes(x);
    const bv: BoardView = { i: b.i, t0: b.t0, phase: b.phase, score: b.score, marks: b.marks };
    if (own && b.i < s.list.length) {
      bv.cur = puzzleView(s.list[b.i], b.phase === 'done');
      bv.hints = b.hints;
      bv.wrong = b.wrong;
      bv.thinks = b.thinks ?? 0;
    }
    boards[x] = bv;
  }
  return { cfg: s.cfg, seats: s.seats, total: s.list.length, max: maxScore(s, s.seats.length > 1), boards, first: s.first };
}

export function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (ev.type === 'hint' && seats !== 'all' && !seats.includes(ev.seat)) return { ...ev, text: '' };
  return ev;
}

export function award(score: number, max: number): { title: string; medal: string } {
  const f = max ? score / max : 0;
  if (f >= 0.8) return { title: 'Золотая грамота', medal: '🥇' };
  if (f >= 0.55) return { title: 'Серебряная грамота', medal: '🥈' };
  if (f >= 0.3) return { title: 'Бронзовая грамота', medal: '🥉' };
  return { title: 'Грамота за участие', medal: '📜' };
}

export function result(s: State) {
  if (toAct(s).length) return null;
  const scores: Record<number, number> = {};
  for (const x of s.seats) scores[x] = s.boards[x].score;
  const max = maxScore(s, s.seats.length > 1);
  const best = Math.max(...s.seats.map((x) => scores[x]));
  const winners = s.seats.filter((x) => scores[x] === best);
  const aw = award(best, max);
  const solved = s.boards[winners[0]].marks.filter((m) => m.ok).length;
  const text = s.seats.length === 1 ? `${aw.medal} ${aw.title}: ${best} из ${max} очков, решено ${solved} из ${s.list.length}` : `${aw.medal} ${aw.title} — ${best} очков из ${max}`;
  return { winners, text, scores };
}

export { stageOf };
