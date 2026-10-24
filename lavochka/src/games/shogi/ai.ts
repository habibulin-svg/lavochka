/* Сёги — боты: альфа-бета (core/minimax) на псевдоходах со «взятием короля», законность — только у корня.
 * Оценка — цена фигур на доске и в руке (в руке чуть дороже: её можно поставить куда угодно), продвижение, защита короля золотом и серебром.
 *   Лёгкий — на полхода с разбросом; Средний — два полухода; Сложный — три (в мини- и доубуцу — глубже). */
import type { Rng } from '../../core/types';
import { bestMove, type SearchGame } from '../../core/minimax';
import { GEO, kingSq, legalPos, playPos, pseudo, type Action, type Move, type Pos, type View } from './engine';

const VAL: Record<string, number> = { K: 0, R: 1000, B: 850, G: 600, S: 520, N: 420, L: 400, P: 100, W: 300, F: 250 };
const PROMO: Record<string, number> = { R: 1300, B: 1100, S: 600, N: 600, L: 600, P: 550 };

function score(p: Pos, me: number): number {
  const g = GEO[p.mode];
  let sc = 0;
  for (let q = 0; q < p.board.length; q++) {
    const x = p.board[q];
    if (!x) continue;
    let v = x.pr ? PROMO[x.k] ?? 600 : VAL[x.k] ?? 0;
    const rr = x.o === 0 ? Math.floor(q / g.w) : g.h - 1 - Math.floor(q / g.w);
    if (x.k !== 'K') v += rr * (x.k === 'P' ? 6 : 3);
    if (x.k === 'K' && p.mode === 'dobutsu') v += rr * 40;
    sc += x.o === me ? v : -v;
  }
  for (const o of [0, 1])
    for (const [k, n] of Object.entries(p.hands[o])) {
      const v = n * (VAL[k] ?? 0) * 1.1;
      sc += o === me ? v : -v;
    }
  return sc;
}

function makeGame(root: Pos): SearchGame<Pos, Move> {
  return {
    moves: (p) => (p === root ? legalPos(p) : pseudo(p)),
    play: playPos,
    side: (p) => p.turn,
    over: (p) => kingSq(p, 0) < 0 || kingSq(p, 1) < 0,
    score: (p, me) => (kingSq(p, me) < 0 ? -100000 : kingSq(p, 1 - me) < 0 ? 100000 : score(p, me)),
    order: (p, m) => (m.drop ? 0 : (p.board[m.to] ? (VAL[p.board[m.to]!.k] ?? 5000) * 10 : 0) + (m.promo ? 500 : 0)),
  };
}

/** Прогоны тестов (vitest без SIM_GAMES): боты думают мельче, чтобы партии шли быстро. */
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
const fast = !!env?.VITEST && !env?.SIM_GAMES;

const toAction = (m: Move): Action => (m.drop ? { type: 'drop', kind: m.drop, to: m.to } : { type: 'move', from: m.from, to: m.to, promo: m.promo });

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (v.over || v.turn !== seat) return null;
  const root: Pos = { board: v.board, hands: v.hands, turn: v.turn, mode: v.cfg.mode };
  const legal = legalPos(root);
  if (!legal.length) return null;
  const small = v.cfg.mode !== 'shogi';
  let depth = level === 0 ? 1 : level === 1 ? (small ? 3 : 2) : small ? 5 : 3;
  if (fast) depth = Math.min(depth, small ? 2 : 1);
  const m = bestMove(makeGame(root), root, depth, rng, level === 0 ? 300 : level === 1 ? 20 : 0);
  const ok = m && legal.some((x) => x.from === m.from && x.to === m.to && x.drop === m.drop && !!x.promo === !!m.promo);
  return toAction(ok ? m! : legal[rng.int(legal.length)]);
}
