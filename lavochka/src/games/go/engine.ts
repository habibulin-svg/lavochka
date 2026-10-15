/* Го — правила (без DOM). Доска 9×9, 13×13 или 19×19; чёрные (место 0) против белых (место 1).
 *
 * Ход — камень на свободный пункт. Группа соседних (по линиям) камней одного цвета без свободных пунктов рядом («дыханий»)
 * снимается с доски. Самоубийство (ход, после которого своя группа без дыханий и никого не снято) запрещено.
 * Ко: нельзя ходом повторить позицию, которая была на доске перед прошлым ходом соперника.
 * Пас — пропуск хода; два паса подряд — конец партии: мёртвые камни определяются доигрываниями (камень, чей пункт в
 * доигрываниях почти всегда остаётся за соперником, — мёртвый), они снимаются в плен.
 * Подсчёт: японский — своя территория (пустые пункты, окружённые только своими камнями) + пленные, коми белым 6,5;
 * китайский — свои камни + территория, коми 7,5. Фора: 2–9 чёрных камней на звёздные пункты, белые ходят первыми, коми 0,5.
 * Можно сдаться.
 */
import type { Options, Rng } from '../../core/types';

export interface Cfg {
  size: 9 | 13 | 19;
  rules: 'japanese' | 'chinese';
  handicap: number;
}

export function cfgFrom(o: Options): Cfg {
  const size = Number(o.size) === 13 ? 13 : Number(o.size) === 19 ? 19 : 9;
  const h = Math.max(0, Math.min(9, Math.floor(Number(o.handicap) || 0)));
  return { size, rules: o.rules === 'chinese' ? 'chinese' : 'japanese', handicap: h === 1 ? 0 : h };
}

export const BLACK = 1;
export const WHITE = 2;
export const colorOf = (seat: number) => (seat === 0 ? BLACK : WHITE);
export const other = (c: number) => (c === BLACK ? WHITE : BLACK);

export interface State {
  cfg: Cfg;
  n: number;
  /** 0 — пусто, 1 — чёрный, 2 — белый; индекс y*n+x. */
  board: number[];
  turn: number;
  /** Пленные: сколько камней соперника снял каждый (место). */
  caps: [number, number];
  /** Позиция перед прошлым ходом (для ко). */
  prev: string;
  last: number;
  passes: number;
  moves: number;
  over: boolean;
  /** Итог: мёртвые камни, территория, очки. */
  final: { dead: number[]; owner: number[]; score: [number, number]; winner: number; resign?: number } | null;
  komi: number;
}

export type Action = { type: 'play'; p: number } | { type: 'pass' } | { type: 'resign' };
export type Event =
  | { type: 'play'; seat: number; p: number; captured: number[] }
  | { type: 'pass'; seat: number }
  | { type: 'resign'; seat: number }
  | { type: 'end'; score: [number, number]; winner: number; dead: number[] };

export function neighbors(n: number, p: number): number[] {
  const x = p % n;
  const y = (p - x) / n;
  const out: number[] = [];
  if (x > 0) out.push(p - 1);
  if (x < n - 1) out.push(p + 1);
  if (y > 0) out.push(p - n);
  if (y < n - 1) out.push(p + n);
  return out;
}

/** Группа камня p и её дыхания. */
export function group(board: number[], n: number, p: number): { stones: number[]; libs: number } {
  const c = board[p];
  const seen = new Set<number>([p]);
  const libs = new Set<number>();
  const st = [p];
  const stones: number[] = [];
  while (st.length) {
    const q = st.pop()!;
    stones.push(q);
    for (const r of neighbors(n, q)) {
      if (board[r] === 0) libs.add(r);
      else if (board[r] === c && !seen.has(r)) {
        seen.add(r);
        st.push(r);
      }
    }
  }
  return { stones, libs: libs.size };
}

/** Поставить камень: новая доска и снятые камни; null — нельзя (занято, самоубийство). */
export function place(board: number[], n: number, p: number, c: number): { board: number[]; captured: number[] } | null {
  if (board[p] !== 0) return null;
  const b = board.slice();
  b[p] = c;
  const captured: number[] = [];
  for (const r of neighbors(n, p)) {
    if (b[r] === other(c)) {
      const g = group(b, n, r);
      if (g.libs === 0) for (const s of g.stones) {
        b[s] = 0;
        captured.push(s);
      }
    }
  }
  if (!captured.length && group(b, n, p).libs === 0) return null;
  return { board: b, captured };
}

const key = (b: number[]) => b.join('');

/** Звёздные пункты для форы. */
export function handicapPoints(n: number, k: number): number[] {
  const e = n === 9 ? 2 : 3;
  const m = (n - 1) / 2;
  const f = n - 1 - e;
  const P = (x: number, y: number) => y * n + x;
  const corners = [P(f, e), P(e, f), P(f, f), P(e, e)];
  const sides = [P(e, m), P(f, m), P(m, e), P(m, f)];
  const pts = corners.slice(0, Math.min(4, k));
  if (k >= 5 && k % 2 === 1) pts.push(P(m, m));
  if (k >= 6) pts.push(sides[0], sides[1]);
  if (k >= 8) pts.push(sides[2], sides[3]);
  return pts.slice(0, k);
}

/** Звёзды на доске (для отрисовки). */
export function hoshi(n: number): number[] {
  if (n === 9) return handicapPoints(9, 4).concat([4 * 9 + 4]);
  return handicapPoints(n, 9);
}

export function newState(cfg: Cfg): State {
  const n = cfg.size;
  const board = Array(n * n).fill(0);
  for (const p of handicapPoints(n, cfg.handicap)) board[p] = BLACK;
  return {
    cfg,
    n,
    board,
    turn: cfg.handicap ? 1 : 0,
    caps: [0, 0],
    prev: '',
    last: -1,
    passes: 0,
    moves: 0,
    over: false,
    final: null,
    komi: cfg.handicap ? 0.5 : cfg.rules === 'chinese' ? 7.5 : 6.5,
  };
}

export function setup(_seats: number[], opts: Options): State {
  return newState(cfgFrom(opts));
}

export const toAct = (s: State): number[] => (s.over ? [] : [s.turn]);

/** Допустимые ходы (без паса). */
export function legalMoves(s: State): number[] {
  const c = colorOf(s.turn);
  const out: number[] = [];
  for (let p = 0; p < s.n * s.n; p++) {
    if (s.board[p]) continue;
    const r = place(s.board, s.n, p, c);
    if (r && key(r.board) !== s.prev) out.push(p);
  }
  return out;
}

export function isLegal(s: State, p: number): boolean {
  if (!Number.isInteger(p) || p < 0 || p >= s.n * s.n || s.board[p]) return false;
  const r = place(s.board, s.n, p, colorOf(s.turn));
  return !!r && key(r.board) !== s.prev;
}

// ---------------------------------------------------------------- подсчёт

/** Пустые области: кому принадлежит пункт (0 — ничей). Камни — своему цвету. */
export function territory(board: number[], n: number): number[] {
  const owner = board.slice();
  const seen = new Uint8Array(n * n);
  for (let p = 0; p < n * n; p++) {
    if (board[p] || seen[p]) continue;
    const area: number[] = [];
    const border = new Set<number>();
    const st = [p];
    seen[p] = 1;
    while (st.length) {
      const q = st.pop()!;
      area.push(q);
      for (const r of neighbors(n, q)) {
        if (board[r]) border.add(board[r]);
        else if (!seen[r]) {
          seen[r] = 1;
          st.push(r);
        }
      }
    }
    const o = border.size === 1 ? [...border][0] : 0;
    for (const q of area) owner[q] = o;
  }
  return owner;
}

/** Своё ли это око: все соседи — свои камни. */
export const isEyeLike = (board: number[], n: number, p: number, c: number) => neighbors(n, p).every((r) => board[r] === c);

/** Случайный доигрыш до конца (для мёртвых камней и ботов): ход не в своё око, пас — когда некуда. */
export function playout(board0: number[], n: number, toMove: number, rng: Rng, maxMoves = Math.round(n * n * 1.5)): number[] {
  let b = board0.slice();
  let c = toMove;
  let passes = 0;
  const empties = () => {
    const e: number[] = [];
    for (let p = 0; p < n * n; p++) if (!b[p]) e.push(p);
    return e;
  };
  for (let m = 0; m < maxMoves && passes < 2; m++) {
    const e = empties();
    let moved = false;
    for (let k = e.length; k > 0; k--) {
      const i = rng.int(k);
      const p = e[i];
      e[i] = e[k - 1];
      if (isEyeLike(b, n, p, c)) continue;
      const r = place(b, n, p, c);
      if (!r) continue;
      b = r.board;
      moved = true;
      break;
    }
    passes = moved ? 0 : passes + 1;
    c = other(c);
  }
  return b;
}

/** Мёртвые камни: в доигрываниях их пункт чаще всего достаётся сопернику. */
export function deadStones(s: State, rng: Rng, runs = s.n >= 19 ? 30 : 60): number[] {
  const n = s.n;
  const own = new Float32Array(n * n);
  for (let k = 0; k < runs; k++) {
    const b = playout(s.board, n, colorOf(s.turn), rng);
    const t = territory(b, n);
    for (let p = 0; p < n * n; p++) if (t[p]) own[p] += t[p] === BLACK ? 1 : -1;
  }
  const dead: number[] = [];
  for (let p = 0; p < n * n; p++) {
    const c = s.board[p];
    if (!c) continue;
    const v = own[p] / runs;
    if ((c === BLACK && v < -0.4) || (c === WHITE && v > 0.4)) dead.push(p);
  }
  return dead;
}

export function score(s: State, dead: number[]): { owner: number[]; score: [number, number] } {
  const n = s.n;
  const b = s.board.slice();
  const caps: [number, number] = [...s.caps] as [number, number];
  for (const p of dead) {
    if (b[p] === BLACK) caps[1]++;
    else caps[0]++;
    b[p] = 0;
  }
  const owner = territory(b, n);
  const terr = [0, 0];
  const stones = [0, 0];
  for (let p = 0; p < n * n; p++) {
    if (b[p]) stones[b[p] - 1]++;
    else if (owner[p]) terr[owner[p] - 1]++;
  }
  const sc: [number, number] = s.cfg.rules === 'chinese' ? [stones[0] + terr[0], stones[1] + terr[1] + s.komi] : [terr[0] + caps[0], terr[1] + caps[1] + s.komi];
  return { owner, score: sc };
}

function finish(s: State, rng: Rng, ev: Event[]) {
  const dead = deadStones(s, rng);
  const r = score(s, dead);
  const winner = r.score[0] > r.score[1] ? 0 : 1;
  s.over = true;
  s.final = { dead, owner: r.owner, score: r.score, winner };
  ev.push({ type: 'end', score: r.score, winner, dead });
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn || !a || typeof a !== 'object') return null;
  const s: State = { ...s0, caps: [...s0.caps] as [number, number] };
  const ev: Event[] = [];
  if (a.type === 'resign') {
    s.over = true;
    const r = score(s, []);
    s.final = { dead: [], owner: r.owner, score: r.score, winner: 1 - seat, resign: seat };
    ev.push({ type: 'resign', seat }, { type: 'end', score: r.score, winner: 1 - seat, dead: [] });
    return { state: s, events: ev };
  }
  if (a.type === 'pass') {
    s.passes++;
    s.prev = key(s.board);
    s.turn = 1 - seat;
    s.moves++;
    s.last = -1;
    ev.push({ type: 'pass', seat });
    // страховка от бесконечной партии ботов
    if (s.passes >= 2 || s.moves >= s.n * s.n * 3) finish(s, rng, ev);
    return { state: s, events: ev };
  }
  if (a.type !== 'play' || !isLegal(s, a.p)) return null;
  const r = place(s.board, s.n, a.p, colorOf(seat))!;
  s.prev = key(s.board);
  s.board = r.board;
  s.caps[seat] += r.captured.length;
  s.passes = 0;
  s.last = a.p;
  s.turn = 1 - seat;
  s.moves++;
  ev.push({ type: 'play', seat, p: a.p, captured: r.captured });
  if (s.moves >= s.n * s.n * 3) finish(s, rng, ev);
  return { state: s, events: ev };
}

export const makeView = (s: State): State => s;
