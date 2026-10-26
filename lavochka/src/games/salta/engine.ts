/* Сальто — правила, без DOM. Конрад Бюттгенбах, Германия, 1899.
 *
 * Доска 10×10, играют только тёмные поля (a1 — тёмное). Поле p = r·n + f, r = 0 — нижний ряд (зелёные).
 * У каждого 15 фишек в трёх ближних рядах: ближний — звёзды, второй — луны, третий — солнца, в каждом ряду номера 1–5
 * слева направо (со своей стороны). Цель — довести каждую фишку ровно на семь рядов вперёд, сохранив порядок в ряду:
 * звёзды встают на место солнц соперника, луны — лун, солнца — звёзд.
 * Ход — шаг по диагонали на соседнее пустое поле, вперёд или назад; или прыжок вперёд через одну фишку соперника
 * на пустое поле за ней (без взятия, без цепочек). Прыгать обязательно («Сальто!»), из нескольких прыжков — любой.
 * Запирать нельзя: ход, после которого сопернику некуда ходить, запрещён (кроме победного).
 * Через 120 ходов каждого считают, сколько шагов осталось фишкам до мест (не глядя на преграды): у кого меньше — победил.
 *
 * Пресет «Пирамида» (по Беллу): 8×8, по 10 фишек треугольником 4-3-2-1, ходы и прыжки только вперёд, прыгать можно через любую
 * фишку и цепочкой, цель — занять стартовые поля соперника (любой фишкой). */
import type { Options } from '../../core/types';

export type Mode = 'salta' | 'pyramid';
export interface Cfg {
  mode: Mode;
  /** Ходов каждого до подсчёта (0 — без счёта, только в пирамиде, где ходы конечны). */
  limit: number;
}
export function cfgFrom(o: Options): Cfg {
  const mode: Mode = o.mode === 'pyramid' ? 'pyramid' : 'salta';
  const lim = Number(o.limit);
  return { mode, limit: mode === 'pyramid' ? 0 : lim === 80 || lim === 200 ? lim : 120 };
}

/** Знак фишки: звезда, луна, солнце; в пирамиде — без знака. */
export type Sym = 'star' | 'moon' | 'sun' | 'plain';
export interface Piece {
  seat: number;
  sym: Sym;
  /** Номер 1–5 (в пирамиде — по порядку). */
  num: number;
  /** Поле, куда фишка должна прийти (в пирамиде — −1: подойдёт любое поле лагеря соперника). */
  tgt: number;
}

export interface State {
  cfg: Cfg;
  n: number;
  /** Номер фишки на поле или −1. */
  board: number[];
  pieces: Piece[];
  turn: number;
  /** Сколько ходов сделал каждый. */
  made: [number, number];
  /** Пропуски подряд (оба застряли — подсчёт). */
  passes: number;
  /** Путь последнего хода. */
  last: number[] | null;
  /** Последний ход каждого (боты не ходят туда-обратно). */
  lastBy: [number[] | null, number[] | null];
  over: boolean;
  winner: number | null;
  /** Почему кончилась: дошли, подсчёт по лимиту, оба застряли. */
  why: 'home' | 'limit' | 'stuck' | null;
  /** Итог подсчёта: сколько шагов осталось каждому. */
  left: [number, number] | null;
}
export type View = State;

export type Action = { type: 'move'; from: number; to: number } | { type: 'pass' };
export type Event =
  | { type: 'move'; seat: number; path: number[]; jump: boolean }
  | { type: 'pass'; seat: number }
  | { type: 'end'; winner: number | null; why: 'home' | 'limit' | 'stuck'; left: [number, number] | null };

export const fileOf = (s: { n: number }, p: number) => p % s.n;
export const rowOf = (s: { n: number }, p: number) => Math.floor(p / s.n);
export const isDark = (n: number, p: number) => ((p % n) + Math.floor(p / n)) % 2 === 0;
/** Ряд «со своей стороны»: 0 — ближний. */
export const ownRow = (s: { n: number }, seat: number, p: number) => (seat === 0 ? rowOf(s, p) : s.n - 1 - rowOf(s, p));

/** Тёмные поля ряда r слева направо со стороны игрока seat. */
function rowSquares(n: number, seat: number, own: number): number[] {
  const r = seat === 0 ? own : n - 1 - own;
  const out: number[] = [];
  for (let f = 0; f < n; f++) if (isDark(n, r * n + f)) out.push(r * n + f);
  return seat === 0 ? out : out.reverse();
}

const SYMS: Sym[] = ['star', 'moon', 'sun'];

/** Стартовые поля лагеря (для пирамиды — треугольник 4-3-2-1). */
export function camp(n: number, mode: Mode, seat: number): number[] {
  if (mode === 'salta') return [0, 1, 2].flatMap((r) => rowSquares(n, seat, r));
  const out: number[] = [];
  for (let r = 0; r < 4; r++) {
    const row = rowSquares(n, seat, r);
    // ряд 0: 4 поля из 4; дальше — средние
    const w = 4 - r;
    const st = Math.floor((row.length - w) / 2);
    out.push(...row.slice(st, st + w));
  }
  return out;
}

export function newState(cfg: Cfg): State {
  const n = cfg.mode === 'salta' ? 10 : 8;
  const board = new Array(n * n).fill(-1);
  const pieces: Piece[] = [];
  for (const seat of [0, 1]) {
    if (cfg.mode === 'salta') {
      for (let r = 0; r < 3; r++) {
        const from = rowSquares(n, seat, r);
        const to = rowSquares(n, seat, r + 7);
        from.forEach((p, k) => {
          board[p] = pieces.length;
          pieces.push({ seat, sym: SYMS[r], num: k + 1, tgt: to[k] });
        });
      }
    } else {
      camp(n, 'pyramid', seat).forEach((p, k) => {
        board[p] = pieces.length;
        pieces.push({ seat, sym: 'plain', num: k + 1, tgt: -1 });
      });
    }
  }
  return { cfg, n, board, pieces, turn: 0, made: [0, 0], passes: 0, last: null, lastBy: [null, null], over: false, winner: null, why: null, left: null };
}

export function toAct(s: State): number[] {
  return s.over ? [] : [s.turn];
}

export interface Move {
  from: number;
  to: number;
  path: number[];
  jump: boolean;
}

const DIAG = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

function at(s: State, f: number, r: number): number {
  return f < 0 || r < 0 || f >= s.n || r >= s.n ? -1 : r * s.n + f;
}

/** Все ходы без правила о запирании: в Сальто прыжки, если есть, иначе шаги; в пирамиде — всё вместе. */
export function rawMoves(s: State, seat: number, board = s.board): Move[] {
  const fwd = seat === 0 ? 1 : -1;
  const steps: Move[] = [];
  const jumps: Move[] = [];
  const salta = s.cfg.mode === 'salta';
  for (let p = 0; p < board.length; p++) {
    const id = board[p];
    if (id < 0 || s.pieces[id].seat !== seat) continue;
    const f = p % s.n;
    const r = Math.floor(p / s.n);
    for (const [df, dr] of DIAG) {
      if (!salta && dr !== fwd) continue;
      const q = at(s, f + df, r + dr);
      if (q >= 0 && board[q] < 0) steps.push({ from: p, to: q, path: [p, q], jump: false });
    }
    if (salta) {
      for (const df of [1, -1]) {
        const mid = at(s, f + df, r + fwd);
        const q = at(s, f + 2 * df, r + 2 * fwd);
        if (q >= 0 && board[q] < 0 && board[mid] >= 0 && s.pieces[board[mid]].seat !== seat) jumps.push({ from: p, to: q, path: [p, q], jump: true });
      }
    } else {
      // пирамида: цепочка прыжков вперёд через любые фишки
      const seen = new Set<number>([p]);
      const walk = (c: number, path: number[]) => {
        const cf = c % s.n;
        const cr = Math.floor(c / s.n);
        for (const df of [1, -1]) {
          const mid = at(s, cf + df, cr + fwd);
          const q = at(s, cf + 2 * df, cr + 2 * fwd);
          if (q < 0 || seen.has(q) || board[q] >= 0 || mid < 0 || board[mid] < 0 || mid === p) continue;
          seen.add(q);
          const np = [...path, q];
          jumps.push({ from: p, to: q, path: np, jump: true });
          walk(q, np);
        }
      };
      walk(p, [p]);
    }
  }
  if (salta) return jumps.length ? jumps : steps;
  return [...steps, ...jumps];
}

function hasMove(s: State, seat: number, board: number[]): boolean {
  return rawMoves(s, seat, board).length > 0;
}

/** Все фишки на местах. */
export function home(s: State, seat: number, board = s.board): boolean {
  if (s.cfg.mode === 'salta') return s.pieces.every((pc, id) => pc.seat !== seat || board[pc.tgt] === id);
  return camp(s.n, 'pyramid', 1 - seat).every((p) => board[p] >= 0 && s.pieces[board[p]].seat === seat);
}

function moved(board: number[], m: Move): number[] {
  const b = board.slice();
  b[m.to] = b[m.from];
  b[m.from] = -1;
  return b;
}

/** Допустимые ходы с правилом «не запирать» (в Сальто). */
export function moves(s: State, seat: number): Move[] {
  if (s.over || s.turn !== seat) return [];
  const raw = rawMoves(s, seat);
  if (s.cfg.mode !== 'salta') return raw;
  const ok = raw.filter((m) => {
    const b = moved(s.board, m);
    return home(s, seat, b) || hasMove(s, 1 - seat, b);
  });
  // если запирают все ходы (почти не бывает) — правило снимается
  return ok.length ? ok : raw;
}

/** Шагов до поля по диагоналям, не глядя на преграды. */
export function dist(n: number, a: number, b: number): number {
  return Math.max(Math.abs((a % n) - (b % n)), Math.abs(Math.floor(a / n) - Math.floor(b / n)));
}

/** Сколько шагов осталось фишкам игрока (подсчёт по лимиту). В пирамиде — рядов до лагеря соперника. */
export function left(s: State, seat: number, board = s.board): number {
  let sum = 0;
  if (s.cfg.mode === 'salta') {
    for (let p = 0; p < board.length; p++) {
      const id = board[p];
      if (id >= 0 && s.pieces[id].seat === seat) sum += dist(s.n, p, s.pieces[id].tgt);
    }
    return sum;
  }
  const tgts = camp(s.n, 'pyramid', 1 - seat);
  const near = Math.min(...tgts.map((q) => ownRow(s, seat, q)));
  for (let p = 0; p < board.length; p++) {
    const id = board[p];
    if (id < 0 || s.pieces[id].seat !== seat) continue;
    if (tgts.includes(p)) continue;
    const r = ownRow(s, seat, p);
    // не дошла до лагеря — ряды до него и ещё шаг; в лагерных рядах, но мимо поля — шаг
    sum += r < near ? near - r + 1 : 1;
  }
  return sum;
}

function finish(s: State, ev: Event[], why: 'home' | 'limit' | 'stuck', winner?: number | null) {
  s.over = true;
  s.why = why;
  if (why === 'home') s.winner = winner!;
  else {
    const l: [number, number] = [left(s, 0), left(s, 1)];
    s.left = l;
    s.winner = l[0] < l[1] ? 0 : l[1] < l[0] ? 1 : null;
  }
  ev.push({ type: 'end', winner: s.winner, why, left: s.left });
}

export function apply(s0: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn || !a) return null;
  const ms = moves(s0, seat);
  const ev: Event[] = [];
  let s: State;
  if (a.type === 'pass') {
    if (ms.length) return null;
    s = { ...s0, turn: 1 - seat, passes: s0.passes + 1, last: null };
    ev.push({ type: 'pass', seat });
    if (s.passes >= 2) finish(s, ev, 'stuck');
    return { state: s, events: ev };
  }
  if (a.type !== 'move') return null;
  const m = ms.find((x) => x.from === a.from && x.to === a.to);
  if (!m) return null;
  const made: [number, number] = [s0.made[0], s0.made[1]];
  made[seat]++;
  const lastBy: [number[] | null, number[] | null] = [s0.lastBy[0], s0.lastBy[1]];
  lastBy[seat] = m.path;
  s = { ...s0, board: moved(s0.board, m), made, turn: 1 - seat, passes: 0, last: m.path, lastBy };
  ev.push({ type: 'move', seat, path: m.path, jump: m.jump });
  if (home(s, seat)) finish(s, ev, 'home', seat);
  else if (s.cfg.limit && made[0] >= s.cfg.limit && made[1] >= s.cfg.limit) finish(s, ev, 'limit');
  else if (!s.cfg.limit && made[0] + made[1] >= 400) finish(s, ev, 'limit');
  return { state: s, events: ev };
}
