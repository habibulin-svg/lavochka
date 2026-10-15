/* Рэндзю и гомоку — боты. Кандидаты — пустые пункты рядом с камнями. Оценка пункта — сумма по четырём линиям:
 * сколько своих камней соберётся в окне из пяти и открыто ли оно, то же для соперника (защита).
 *   Лёгкий — лучший по оценке с заметным шумом, видит только пятёрку;
 *   Средний — выиграть, иначе закрыть чужую пятёрку, иначе лучший по оценке;
 *   Сложный — то же, а ещё смотрит ответ соперника на лучшие 8 ходов (не оставить ему открытую четвёрку/вилку). */
import type { Rng } from '../../core/types';
import { BLACK, colorOf, DIRS, fiveThrough, isLegal, lineCells, WHITE, type Action, type State } from './engine';

const W = [0, 1, 12, 120, 1500, 100000];

/** Оценка пункта p для цвета c: окна из пяти, где нет чужих камней. */
function value(b: number[], n: number, p: number, c: number): number {
  let sum = 0;
  for (const d of DIRS) {
    const cells = lineCells(n, p, d, 4);
    for (let i = 0; i + 5 <= cells.length; i++) {
      const win = cells.slice(i, i + 5);
      if (!win.includes(p) || win.some((q) => q < 0)) continue;
      let mine = 0;
      let bad = false;
      for (const q of win) {
        if (q === p) continue;
        if (b[q] === c) mine++;
        else if (b[q] !== 0) bad = true;
      }
      if (!bad) sum += W[mine + 1];
    }
  }
  return sum;
}

function candidates(s: State): number[] {
  const n = s.n;
  if (!s.moves) return [(n * n) >> 1];
  const out = new Set<number>();
  for (let p = 0; p < n * n; p++) {
    if (!s.board[p]) continue;
    const x = p % n;
    const y = (p - x) / n;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < n && yy < n && !s.board[yy * n + xx]) out.add(yy * n + xx);
      }
  }
  return [...out].filter((p) => isLegal(s, p));
}

const exact = (s: State, c: number) => s.cfg.variant === 'exact' || (s.cfg.variant === 'renju' && c === BLACK);

function winsAt(s: State, p: number, c: number): boolean {
  const b = s.board;
  b[p] = c;
  const ok = !!fiveThrough(b, s.n, p, c, exact(s, c));
  b[p] = 0;
  return ok;
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over || s.turn !== seat) return null;
  const c = colorOf(seat);
  const o = c === BLACK ? WHITE : BLACK;
  const cands = candidates(s);
  if (!cands.length) {
    for (let p = 0; p < s.n * s.n; p++) if (isLegal(s, p)) return { type: 'play', p };
    return null;
  }
  const win = cands.find((p) => winsAt(s, p, c));
  if (win != null) return { type: 'play', p: win };
  if (level > 0) {
    const block = cands.find((p) => winsAt(s, p, o));
    if (block != null) return { type: 'play', p: block };
  }
  const score = (p: number) => value(s.board, s.n, p, c) * 1.1 + value(s.board, s.n, p, o) + (level === 0 ? rng.next() * 300 : rng.next());
  const ranked = cands.map((p) => ({ p, v: score(p) })).sort((a, b) => b.v - a.v);
  if (level < 2) return { type: 'play', p: ranked[0].p };
  // сложный: после моего хода — лучший ответ соперника; берём ход, где ответ слабее
  let best = ranked[0];
  let bestNet = -Infinity;
  for (const cand of ranked.slice(0, 8)) {
    const b = s.board;
    b[cand.p] = c;
    const t: State = { ...s, board: b, turn: 1 - seat, moves: s.moves + 1 };
    const replies = candidates(t);
    let worst = 0;
    for (const r of replies) {
      if (winsAt(t, r, o)) {
        worst = 1e9;
        break;
      }
      worst = Math.max(worst, value(b, s.n, r, o));
    }
    b[cand.p] = 0;
    const net = cand.v - worst * 0.8;
    if (net > bestNet) {
      bestNet = net;
      best = cand;
    }
  }
  return { type: 'play', p: best.p };
}
