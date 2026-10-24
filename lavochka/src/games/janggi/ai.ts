/* Чанги — боты: альфа-бета (core/minimax) на псевдоходах со «взятием генерала», законность — у корня.
 * Оценка — очки фигур (колесница 13 … солдат 2) и продвижение солдат и коней.
 *   Лёгкий — на полхода с разбросом; Средний — три полухода; Сложный — четыре. Ходов нет (и нет шаха) — пропуск;
 *   бикджан, выгодный по очкам, бот не разрывает. */
import type { Rng } from '../../core/types';
import { bestMove, type SearchGame } from '../../core/minimax';
import { colorOf, facing, fileOf, generalSq, legalMoves, N, playBoard, points, pseudo, rankOf, VALUE, type Action, type Move, type View } from './engine';

interface P {
  board: string[];
  turn: 0 | 1;
}

function score(b: string[], me: number): number {
  let sc = 0;
  for (let q = 0; q < N; q++) {
    const x = b[q];
    if (!x) continue;
    const c = colorOf(x);
    const k = x.toUpperCase();
    let v = VALUE[k] * 100;
    const adv = c === 0 ? rankOf(q) : 9 - rankOf(q);
    if (k === 'P') v += adv * 6;
    if (k === 'H' || k === 'C') v += 10 - Math.abs(fileOf(q) - 4) * 2;
    sc += c === me ? v : -v;
  }
  return sc;
}

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
const fast = !!env?.VITEST && !env?.SIM_GAMES;

function makeGame(root: P): SearchGame<P, Move> {
  return {
    moves: (p) => (p === root ? legalMoves(p.board, p.turn) : pseudo(p.board, p.turn)),
    play: (p, m) => ({ board: playBoard(p.board, m), turn: (1 - p.turn) as 0 | 1 }),
    side: (p) => p.turn,
    over: (p) => generalSq(p.board, 0) < 0 || generalSq(p.board, 1) < 0,
    score: (p, me) => (generalSq(p.board, me) < 0 ? -100000 : generalSq(p.board, 1 - me) < 0 ? 100000 : score(p.board, me)),
    order: (p, m) => (p.board[m.to] ? VALUE[p.board[m.to].toUpperCase()] * 100 - VALUE[p.board[m.from].toUpperCase()] : 0),
  };
}

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (v.over || v.turn !== seat) return null;
  const legal = legalMoves(v.board, seat);
  // бикджан: если по очкам впереди — пропускаем ход (партия решится в нашу пользу)
  if (v.bik === 1 - seat && level > 0) {
    const pts = points(v.board);
    if (pts[seat] > pts[1 - seat]) return { type: 'pass' };
  }
  if (!legal.length) return { type: 'pass' };
  let depth = level === 0 ? 1 : level === 1 ? 3 : 4;
  if (fast) depth = Math.min(depth, 2);
  const root: P = { board: v.board, turn: v.turn };
  const m = bestMove(makeGame(root), root, depth, rng, level === 0 ? 300 : level === 1 ? 20 : 0);
  const ok = m && legal.some((x) => x.from === m.from && x.to === m.to);
  const pick = ok ? m! : legal[rng.int(legal.length)];
  // не начинаем бикджан, если по очкам позади
  if (facing(playBoard(v.board, pick))) {
    const pts = points(playBoard(v.board, pick));
    if (pts[seat] < pts[1 - seat]) {
      const alt = legal.find((x) => !facing(playBoard(v.board, x)));
      if (alt) return { type: 'move', from: alt.from, to: alt.to };
    }
  }
  return { type: 'move', from: pick.from, to: pick.to };
}
