/* Шахматы — боты: перебор альфа-бета, оценка — материал и таблицы позиций фигур, взятия досчитываются до тишины.
 *   Лёгкий — смотрит на ход вперёд и нередко ошибается;
 *   Средний — два полухода и размен до конца;
 *   Сложный — углубляется до четырёх полуходов (с ограничением по числу позиций), сначала смотрит взятия. */
import type { Rng } from '../../core/types';
import { attacked, inCheck, kingSq, legalMoves, play, pseudoCaptures, pseudoMoves, type Action, type Move, type State } from './engine';

const VAL: Record<string, number> = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };

// Таблицы позиций — с точки зрения белых, напечатаны с 8-й горизонтали (как доска сверху).
const PST: Record<string, number[]> = {
  P: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  N: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  B: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  R: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0,
  ],
  Q: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ],
  K: [
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20,
    -10, -20, -20, -20, -20, -20, -20, -10,
    20, 20, 0, 0, 0, 0, 20, 20,
    20, 30, 10, 0, 0, 10, 30, 20,
  ],
  // король в эндшпиле — в центр
  KE: [
    -50, -40, -30, -20, -20, -30, -40, -50,
    -30, -20, -10, 0, 0, -10, -20, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 20, 30, 30, 20, -10, -30,
    -30, -30, 0, 0, 0, 0, -30, -30,
    -50, -30, -30, -30, -30, -30, -30, -50,
  ],
};

const MATE = 100000;

/** Быстрый прогон проверок (vitest без SIM_GAMES): боты думают мельче, чтобы сотни партий шли секунды.
 *  Тест силы ботов включает полную глубину сам (tuning.fast = false). */
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
export const tuning = { fast: !!env?.VITEST && !env?.SIM_GAMES };

/** Оценка позиции за белых (в сантипешках). */
export function evaluate(board: string[]): number {
  let mat = 0;
  for (const p of board) {
    const k = p.toUpperCase();
    if (p && k !== 'K' && k !== 'P') mat += VAL[k];
  }
  const endgame = mat <= 1600;
  let sc = 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = board[sq];
    if (!p) continue;
    const k = p.toUpperCase();
    const white = p === k;
    const r = sq >> 3;
    const f = sq & 7;
    // в таблице сверху 8-я горизонталь: для белых строка 7 - r, для чёрных — зеркально
    const t = k === 'K' && endgame ? PST.KE : PST[k];
    const v = VAL[k] + t[(white ? 7 - r : r) * 8 + f];
    sc += white ? v : -v;
  }
  return sc;
}

interface Ctx {
  nodes: number;
  limit: number;
}

function ordered(s: State, capturesOnly = false): Move[] {
  const ms = capturesOnly ? pseudoCaptures(s) : pseudoMoves(s);
  const score = (m: Move) => (m.captured ? 10 * VAL[m.captured.toUpperCase()] - VAL[m.piece.toUpperCase()] / 10 : 0) + (m.promo ? 800 : 0);
  return ms.sort((a, b) => score(b) - score(a));
}

function legalAfter(s: State, m: Move): State | null {
  const n = play(s, m);
  if (m.castle) return n;
  return attacked(n.board, kingSq(n.board, s.turn), 1 - s.turn) ? null : n;
}

const persp = (s: State) => (s.turn === 0 ? 1 : -1) * evaluate(s.board);

function quiesce(s: State, alpha: number, beta: number, ctx: Ctx, depth = 0): number {
  ctx.nodes++;
  const stand = persp(s);
  if (stand >= beta) return beta;
  if (alpha < stand) alpha = stand;
  if (depth > 6) return alpha;
  for (const m of ordered(s, true)) {
    const n = legalAfter(s, m);
    if (!n) continue;
    const v = -quiesce(n, -beta, -alpha, ctx, depth + 1);
    if (v >= beta) return beta;
    if (v > alpha) alpha = v;
  }
  return alpha;
}

function search(s: State, depth: number, alpha: number, beta: number, ply: number, ctx: Ctx, qs: boolean): number {
  if (depth <= 0) return qs ? quiesce(s, alpha, beta, ctx) : persp(s);
  ctx.nodes++;
  if (s.half >= 100) return 0;
  let any = false;
  for (const m of ordered(s)) {
    const n = legalAfter(s, m);
    if (!n) continue;
    any = true;
    const v = -search(n, depth - 1, -beta, -alpha, ply + 1, ctx, qs);
    if (v >= beta) return beta;
    if (v > alpha) alpha = v;
    if (ctx.nodes > ctx.limit) break;
  }
  if (!any) return inCheck(s) ? -MATE + ply : 0;
  return alpha;
}

/** Оценки законных ходов на заданную глубину (повтор позиции считаем ничьей). */
function rootScores(s: State, depth: number, qs: boolean, limit: number): { m: Move; v: number }[] {
  const ctx: Ctx = { nodes: 0, limit };
  const out: { m: Move; v: number }[] = [];
  for (const m of ordered(s)) {
    const n = legalAfter(s, m);
    if (!n) continue;
    const repeats = s.keys.length > 3 && s.keys.slice(-8).includes(boardKey(n));
    const v = -search(n, depth - 1, -MATE - 1, MATE + 1, 1, ctx, qs);
    out.push({ m, v: repeats ? Math.min(v, 0) : v });
  }
  return out.sort((a, b) => b.v - a.v);
}

/** Ключ без прав на рокировку и взятия на проходе — достаточно, чтобы заметить повтор. */
function boardKey(s: State): string {
  return s.board.map((p) => p || '.').join('') + s.turn;
}

const toAction = (m: Move): Action => ({ type: 'move', from: m.from, to: m.to, promo: m.promo });

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.phase === 'over') return null;
  if (s.phase === 'draw') {
    // соглашаемся на ничью, если дела плохи
    const v = (seat === 0 ? 1 : -1) * evaluate(s.board);
    return { type: v < (level >= 2 ? -80 : -150) ? 'accept' : 'decline' };
  }
  if (s.turn !== seat) return null;
  const legal = legalMoves(s);
  if (!legal.length) return null;
  if (level === 0) {
    if (rng.next() < 0.18) return toAction(legal[rng.int(legal.length)]);
    const sc = rootScores(s, 1, false, 1e9);
    const good = sc.filter((x) => x.v >= sc[0].v - 90);
    return toAction(good[rng.int(good.length)].m);
  }
  if (level === 1) {
    const sc = rootScores(s, tuning.fast ? 1 : 2, true, 30000);
    const good = sc.filter((x) => x.v >= sc[0].v - 15);
    return toAction(good[rng.int(good.length)].m);
  }
  // сложный: три полухода, в простых позициях — четыре
  const depth = tuning.fast ? 2 : legal.length <= 24 ? 4 : 3;
  const best = rootScores(s, depth, true, tuning.fast ? 8000 : 60000);
  const top = best.filter((x) => x.v >= best[0].v - 5);
  return toAction(top[rng.int(top.length)].m);
}
