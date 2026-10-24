/* Китайские шашки — боты. Оценка — сколько шагов осталось своим фишкам до вершины целевого дома (меньше — лучше),
 * с штрафом за отставшие фишки и бонусом за занятые лунки дома.
 *   Лёгкий — лучший ход по продвижению, но с разбросом; Средний — лучший по оценке позиции;
 *   Сложный — вдвоём смотрит ещё и ответ соперника, в компании — сравнивает свой прогресс с лучшим чужим. */
import type { Rng } from '../../core/types';
import { geoOf, moves, type Action, type Geo, type State, type View } from './engine';

function evalSeat(s: State, g: Geo, seat: number): number {
  const target = g.homes[g.opp[s.corner[seat]]];
  const tset = new Set(target);
  const tip = g.tip[g.opp[s.corner[seat]]];
  // свободные (не своими) лунки дома — к ним и тянемся
  const free = target.filter((p) => s.board[p] !== seat);
  let sum = 0;
  let worst = 0;
  for (let p = 0; p < s.board.length; p++) {
    if (s.board[p] !== seat) continue;
    if (tset.has(p)) {
      // внутри — чуть глубже лучше
      sum += g.dist(p, tip) * 0.1;
      continue;
    }
    let d = Infinity;
    for (const q of free) d = Math.min(d, g.dist(p, q));
    if (!free.length) d = g.dist(p, tip);
    d += 2;
    sum += d;
    if (d > worst) worst = d;
  }
  return -sum - worst * 1.5;
}

function after(s: State, from: number, to: number): State {
  const board = s.board.slice();
  board[to] = board[from];
  board[from] = -1;
  return { ...s, board };
}

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (v.over || v.turn !== seat) return null;
  const g = geoOf(v.cfg);
  const ms = moves(v, seat);
  if (!ms.length) return null;
  const tip = g.tip[g.opp[v.corner[seat]]];
  const gain = (m: { from: number; to: number }) => g.dist(m.from, tip) - g.dist(m.to, tip);
  if (level === 0) {
    const sc = ms.map((m) => evalSeat(after(v, m.from, m.to), g, seat) + rng.next() * 3);
    let bi = 0;
    sc.forEach((x, i) => x > sc[bi] && (bi = i));
    return { type: 'move', from: ms[bi].from, to: ms[bi].to };
  }
  const others = v.seats.filter((x) => x !== seat);
  let best = -Infinity;
  let pick = ms[0];
  for (const m of ms) {
    const n = after(v, m.from, m.to);
    let val = evalSeat(n, g, seat) + gain(m) * 0.3;
    if (level === 2) {
      if (others.length === 1) {
        // лучший ответ соперника (по его оценке) — и наш итог после него
        const o = others[0];
        let ob = -Infinity;
        let oVal = 0;
        for (const r of moves({ ...n, turn: o }, o)) {
          const nn = after(n, r.from, r.to);
          const e = evalSeat(nn, g, o);
          if (e > ob) [ob, oVal] = [e, evalSeat(nn, g, seat) - e * 0.5];
        }
        val = oVal + gain(m) * 0.3;
      } else val -= Math.max(...others.map((o) => evalSeat(n, g, o))) * 0.1;
    }
    val += rng.next() * 0.01;
    if (val > best) [best, pick] = [val, m];
  }
  return { type: 'move', from: pick.from, to: pick.to };
}
