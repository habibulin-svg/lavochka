/* Сальто — боты. Оценка — сколько шагов осталось своим фишкам до мест (как в подсчёте по лимиту) минус то же у соперника,
 * со штрафом за фишку, которая заняла чужое (своё же) место и мешает ещё не дошедшей.
 *   Лёгкий — продвигается, но с большим разбросом; Средний — лучший ход по оценке;
 *   Сложный — смотрит ещё и лучший ответ соперника (с учётом обязательных прыжков). */
import type { Rng } from '../../core/types';
import { apply, dist, home, left, moves, rawMoves, type Action, type Move, type State, type View } from './engine';

/** Фишки, сидящие на месте другой своей фишки, которая ещё не дома. */
function blockers(s: State, seat: number, board: number[]): number {
  if (s.cfg.mode !== 'salta') return 0;
  let k = 0;
  for (let id = 0; id < s.pieces.length; id++) {
    const pc = s.pieces[id];
    if (pc.seat !== seat) continue;
    const on = board[pc.tgt];
    if (on >= 0 && on !== id && s.pieces[on].seat === seat) k++;
  }
  return k;
}

/** Ходов, приближающих к цели (свобода продвижения). */
function progress(s: State, seat: number, board: number[]): number {
  if (s.cfg.mode !== 'salta') return 0;
  let k = 0;
  for (const m of rawMoves(s, seat, board)) {
    const pc = s.pieces[board[m.from]];
    if (dist(s.n, m.to, pc.tgt) < dist(s.n, m.from, pc.tgt)) k++;
  }
  return k;
}

/** Шагов до мест по пустой доске, но в обход своих фишек, уже вставших на места (их сдвигать дорого).
 * Если дорога закрыта ими целиком — расстояние напрямик с большим штрафом: стоит расступиться. */
function pathLeft(s: State, seat: number, board: number[]): number {
  if (s.cfg.mode !== 'salta') return left(s, seat, board);
  const n = s.n;
  const settled = new Uint8Array(board.length);
  for (let p = 0; p < board.length; p++) {
    const id = board[p];
    if (id >= 0 && s.pieces[id].seat === seat && s.pieces[id].tgt === p) settled[p] = 1;
  }
  let sum = 0;
  const d = new Int16Array(board.length);
  const queue = new Int16Array(board.length);
  for (let p = 0; p < board.length; p++) {
    const id = board[p];
    if (id < 0 || s.pieces[id].seat !== seat || settled[p]) continue;
    const t = s.pieces[id].tgt;
    // волна от фишки до её места
    d.fill(-1);
    d[p] = 0;
    let qh = 0;
    let qt = 0;
    queue[qt++] = p;
    let got = -1;
    while (qh < qt && got < 0) {
      const c = queue[qh++];
      const cf = c % n;
      const cr = (c - cf) / n;
      for (let k = 0; k < 4; k++) {
        const f = cf + (k & 1 ? 1 : -1);
        const r = cr + (k & 2 ? 1 : -1);
        if (f < 0 || r < 0 || f >= n || r >= n) continue;
        const q = r * n + f;
        if (d[q] >= 0 || (settled[q] && q !== t)) continue;
        d[q] = d[c] + 1;
        if (q === t) {
          got = d[q];
          break;
        }
        queue[qt++] = q;
      }
    }
    sum += got >= 0 ? got : dist(n, p, t) + 6;
  }
  return sum;
}

function score(s: State, seat: number, board: number[], mob = false): number {
  if (home(s, seat, board)) return 1e6;
  if (home(s, 1 - seat, board)) return -1e6;
  let v = pathLeft(s, 1 - seat, board) - pathLeft(s, seat, board) - 1.5 * blockers(s, seat, board) + 1.5 * blockers(s, 1 - seat, board);
  if (mob) v += 0.08 * (progress(s, seat, board) - progress(s, 1 - seat, board));
  return v;
}

function after(board: number[], m: Move): number[] {
  const b = board.slice();
  b[m.to] = b[m.from];
  b[m.from] = -1;
  return b;
}

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (v.over || v.turn !== seat) return null;
  const ms = moves(v, seat);
  if (!ms.length) return { type: 'pass' };
  let best = -Infinity;
  let pick = ms[0];
  const back = v.lastBy?.[seat];
  for (const m of ms) {
    const b = after(v.board, m);
    let val = score(v, seat, b, level > 0);
    if (level === 0) val += rng.next() * 4;
    // туда-обратно той же фишкой — только если иначе никак
    const undo = back && m.from === back[back.length - 1] && m.to === back[0] ? 0.7 : 0;
    if (level === 2 && val < 1e5) {
      // худший для нас ответ соперника (без правила о запирании — для скорости)
      let worst = Infinity;
      for (const r of rawMoves(v, 1 - seat, b)) worst = Math.min(worst, score(v, seat, after(b, r), true));
      if (worst < Infinity) val = worst * 0.7 + val * 0.3;
    }
    val += rng.next() * 0.2 - undo;
    if (val > best) [best, pick] = [val, m];
  }
  return { type: 'move', from: pick.from, to: pick.to };
}

/** Для показа и превью: сыграть ход бота. */
export function botStep(s: State, level: number, rng: Rng): State {
  const a = choose(s, s.turn, level, rng);
  return a ? (apply(s, s.turn, a)?.state ?? s) : s;
}
