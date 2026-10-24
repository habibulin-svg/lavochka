/* Сянци — боты: альфа-бета по общему перебору (core/minimax), оценка — цена фигур и продвижение солдат.
 *   Лёгкий — на полхода вперёд с большим разбросом; Средний — три полухода; Сложный — четыре полухода, взятия первыми.
 * В ко-уп закрытые фигуры неизвестны и боту: он раскладывает оставшийся состав наугад (несколько раскладов у сложного). */
import type { Rng } from '../../core/types';
import { bestMove, type SearchGame } from '../../core/minimax';
import { colorOf, fileOf, generalSq, HIDDEN, hiddenPool, legalPos, N, playPos, pseudo, rankOf, type Action, type Move, type Pos, type View } from './engine';

const VAL: Record<string, number> = { K: 0, A: 200, E: 200, H: 400, R: 900, C: 450, P: 100 };
const HID = 330; // закрытая фигура — в среднем

function score(p: Pos, me: number): number {
  let sc = 0;
  for (let q = 0; q < N; q++) {
    const x = p.board[q];
    if (!x) continue;
    const c = colorOf(x);
    const k = x.toUpperCase();
    let v = p.hidden[q] ? HID : VAL[k] ?? 0;
    if (k === 'P' && !p.hidden[q]) {
      const adv = c === 0 ? rankOf(q) : 9 - rankOf(q);
      if (adv >= 5) v += 60 + (adv < 9 ? 30 : 0) - Math.abs(fileOf(q) - 4) * 8;
    }
    if ((k === 'H' || k === 'C') && !p.hidden[q]) v += 12 - Math.abs(fileOf(q) - 4) * 3;
    if (p.mode === 'up' && !p.hidden[q] && (k === 'A' || k === 'E')) v += 60;
    sc += c === me ? v : -v;
  }
  return sc;
}

/** Генералы на одной вертикали без фигур между ними — ходящий «берёт» чужого генерала. */
function facing(p: Pos): boolean {
  const g = generalSq(p.board, 0);
  const o = generalSq(p.board, 1);
  if (g < 0 || o < 0 || fileOf(g) !== fileOf(o)) return false;
  for (let q = g + 9; q < o; q += 9) if (p.board[q]) return false;
  return true;
}

/** Перебор на псевдоходах со «взятием генерала» (быстро); у корня — только законные ходы. */
function makeGame(root: Pos): SearchGame<Pos, Move> {
  return {
    moves: (p) => (p === root ? legalPos(p) : pseudo(p, p.turn)),
    play: playPos,
    side: (p) => p.turn,
    over: (p) => generalSq(p.board, 0) < 0 || generalSq(p.board, 1) < 0 || facing(p),
    score: (p, me) => {
      if (generalSq(p.board, me) < 0) return -10000;
      if (generalSq(p.board, 1 - me) < 0) return 10000;
      if (facing(p)) return p.turn === me ? 10000 : -10000;
      return score(p, me);
    },
    order: (p, m) => (p.board[m.to] ? (VAL[p.board[m.to].toUpperCase()] ?? HID) * 10 - (VAL[p.board[m.from].toUpperCase()] ?? HID) : 0),
  };
}

function pick(root: Pos, depth: number, rng: Rng, noise: number): Move | null {
  const legal = legalPos(root);
  if (!legal.length) return null;
  const m = bestMove(makeGame(root), root, depth, rng, noise);
  return m && legal.some((x) => x.from === m.from && x.to === m.to) ? m : legal[rng.int(legal.length)];
}

/** Разложить закрытые фигуры наугад из оставшегося состава. */
function world(v: View, rng: Rng): Pos {
  const board = v.board.slice();
  for (const c of [0, 1]) {
    const pool = hiddenPool(v, c);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (let q = 0; q < N; q++) if (board[q] === HIDDEN[c]) board[q] = pool.pop() ?? (c === 0 ? 'P' : 'p');
  }
  return { board, hidden: v.hidden, mode: v.cfg.mode, turn: v.turn };
}

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (v.over || v.turn !== seat) return null;
  const depth = level === 0 ? 1 : level === 1 ? 3 : 4;
  const noise = level === 0 ? 220 : level === 1 ? 20 : 0;
  const hiddenAny = v.hidden.some(Boolean);
  if (!hiddenAny) {
    const m = pick({ board: v.board, hidden: v.hidden, mode: v.cfg.mode, turn: v.turn }, depth, rng, noise);
    return m ? { type: 'move', from: m.from, to: m.to } : null;
  }
  // ко-уп: голосование по нескольким раскладам (ходы закрытыми фигурами от расклада не зависят)
  const tally = new Map<string, number>();
  const tries = level === 2 ? 3 : 1;
  for (let i = 0; i < tries; i++) {
    const m = pick(world(v, rng), Math.min(depth, 3), rng, noise);
    if (m) tally.set(`${m.from}-${m.to}`, (tally.get(`${m.from}-${m.to}`) ?? 0) + 1);
  }
  let best = '';
  let n = 0;
  for (const [k, c] of tally) if (c > n) [best, n] = [k, c];
  if (!best) return null;
  const [from, to] = best.split('-').map(Number);
  return { type: 'move', from, to };
}
