/* Реверси — боты. Оценка позиции: вес клеток (углы — золото, клетки рядом с пустым углом — яд, края — хорошо),
 * подвижность (сколько ходов у меня против соперника) и, к концу, число фишек. В «анти-реверси» всё наоборот.
 *   Лёгкий — смотрит на один ход: вес клетки и сколько переворачивает, с заметным шумом;
 *   Средний — перебор на 2 полухода (альфа-бета);
 *   Сложный — на 4 полухода (на доске 10×10 — на 3), а последние 10 клеток досчитывает до конца точно. */
import type { Rng } from '../../core/types';
import { BLACK, colorOf, count, flipsAt, movesFor, WHITE, type Action, type State } from './engine';

/** Вес клетки на доске n×n. */
const weights = new Map<number, number[]>();
function weightsFor(n: number): number[] {
  let w = weights.get(n);
  if (w) return w;
  w = [];
  const edge = (i: number) => i === 0 || i === n - 1;
  const near = (i: number) => i === 1 || i === n - 2;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      let v = 1;
      if (edge(x) && edge(y)) v = 100;
      else if (near(x) && near(y)) v = -40;
      else if ((edge(x) && near(y)) || (near(x) && edge(y))) v = -15;
      else if (edge(x) || edge(y)) v = 8;
      else if (near(x) || near(y)) v = -2;
      w.push(v);
    }
  weights.set(n, w);
  return w;
}

/** Ядовитые клетки рядом с углом перестают быть ядом, когда угол уже занят. */
function cellWeight(b: number[], n: number, p: number, w: number[]): number {
  const v = w[p];
  if (v >= 0) return v;
  const x = p % n;
  const y = (p - x) / n;
  const cx = x < n / 2 ? 0 : n - 1;
  const cy = y < n / 2 ? 0 : n - 1;
  if (Math.abs(cx - x) <= 1 && Math.abs(cy - y) <= 1 && b[cy * n + cx]) return 2;
  return v;
}

interface Pos {
  b: number[];
  n: number;
}

function legal(pos: Pos, c: number): number[] {
  const out: number[] = [];
  for (let p = 0; p < pos.n * pos.n; p++) if (!pos.b[p] && flipsAt(pos.b, pos.n, p, c).length) out.push(p);
  return out;
}

/** Оценка для цвета c (больше — лучше). */
function evaluate(pos: Pos, c: number, anti: boolean): number {
  const { b, n } = pos;
  const o = c === BLACK ? WHITE : BLACK;
  const w = weightsFor(n);
  let place = 0;
  let empties = 0;
  for (let p = 0; p < n * n; p++) {
    if (!b[p]) empties++;
    else if (b[p] === c) place += cellWeight(b, n, p, w);
    else place -= cellWeight(b, n, p, w);
  }
  const mob = legal(pos, c).length - legal(pos, o).length;
  const [bl, wh] = count(b);
  const discs = c === BLACK ? bl - wh : wh - bl;
  const late = empties < n * n * 0.25;
  if (anti) return -place * 0.6 + mob * 6 - discs * (late ? 12 : 2);
  return place + mob * 8 + (late ? discs * 6 : 0);
}

function finalScore(pos: Pos, c: number, anti: boolean): number {
  const [bl, wh] = count(pos.b);
  const d = c === BLACK ? bl - wh : wh - bl;
  return (anti ? -d : d) * 10000;
}

function play(pos: Pos, p: number, c: number): number[] {
  const flips = flipsAt(pos.b, pos.n, p, c);
  pos.b[p] = c;
  for (const q of flips) pos.b[q] = c;
  return flips;
}

function undo(pos: Pos, p: number, flips: number[], c: number) {
  const o = c === BLACK ? WHITE : BLACK;
  pos.b[p] = 0;
  for (const q of flips) pos.b[q] = o;
}

function order(pos: Pos, moves: number[], anti: boolean): number[] {
  const w = weightsFor(pos.n);
  return moves.sort((a, b) => (anti ? w[a] - w[b] : w[b] - w[a]));
}

/** Негамакс с альфа-бета отсечением; exact — досчитывать до конца. */
function search(pos: Pos, c: number, depth: number, alpha: number, beta: number, anti: boolean, exact: boolean, passed: boolean): number {
  const o = c === BLACK ? WHITE : BLACK;
  if (!exact && depth <= 0) return evaluate(pos, c, anti);
  const moves = legal(pos, c);
  if (!moves.length) {
    if (passed) return finalScore(pos, c, anti);
    return -search(pos, o, depth - 1, -beta, -alpha, anti, exact, true);
  }
  let best = -Infinity;
  for (const p of order(pos, moves, anti)) {
    const flips = play(pos, p, c);
    const v = -search(pos, o, depth - 1, -beta, -alpha, anti, exact, false);
    undo(pos, p, flips, c);
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over || s.turn !== seat) return null;
  const c = colorOf(seat);
  const moves = movesFor(s, c);
  if (!moves.length) return null;
  // свободное начало: просто случайная центральная клетка
  if (s.cfg.start === 'free' && s.moves < 4) return { type: 'play', p: moves[rng.int(moves.length)] };
  if (moves.length === 1) return { type: 'play', p: moves[0] };
  const anti = s.cfg.anti;
  const n = s.n;
  const pos: Pos = { b: s.board.slice(), n };
  if (level === 0) {
    const w = weightsFor(n);
    const score = (p: number) => {
      const f = flipsAt(pos.b, n, p, c).length;
      const v = anti ? -w[p] * 0.5 - f : w[p] * 0.5 + f;
      return v + rng.next() * 30;
    };
    let best = moves[0];
    let bv = -Infinity;
    for (const p of moves) {
      const v = score(p);
      if (v > bv) {
        bv = v;
        best = p;
      }
    }
    return { type: 'play', p: best };
  }
  const empties = pos.b.filter((v) => !v).length;
  const exact = level >= 2 && empties <= (n > 8 ? 8 : 10);
  const depth = level === 1 ? 2 : n > 8 ? 3 : 4;
  const o = c === BLACK ? WHITE : BLACK;
  let best: number[] = [];
  let bv = -Infinity;
  for (const p of order(pos, moves.slice(), anti)) {
    const flips = play(pos, p, c);
    const v = -search(pos, o, depth - 1, -Infinity, Infinity, anti, exact, false);
    undo(pos, p, flips, c);
    if (v > bv + 0.5) {
      bv = v;
      best = [p];
    } else if (Math.abs(v - bv) <= 0.5) best.push(p);
  }
  return { type: 'play', p: best[rng.int(best.length)] };
}
