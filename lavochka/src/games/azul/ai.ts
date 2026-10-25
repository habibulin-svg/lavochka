/* Плиточник — боты: оценка каждой закупки.
 *   Лёгкий — что-нибудь без лишнего в «бой» (наугад из неплохих);
 *   Средний — очки за плитку, если строка заполнится, штрафы «боя», недостроенные строки, ряды и столбцы стены;
 *   Сложный — то же минус лучший ответ следующего игрока (что ему остаётся на рынке).
 * Серая стена: столбец — где плитка даст больше очков (и ближе к центру). */
import type { Rng } from '../../core/types';
import { apply, colOf, FLOOR, legal, tilePoints, wallCols, type Action, type Board, type State } from './engine';

function floorCost(b: Board, extra: number): number {
  let v = 0;
  for (let i = 0; i < extra; i++) {
    const at = b.floor.length + i;
    if (at < 7) v += FLOOR[at];
  }
  return v;
}

function bestCol(b: Board, row: number, kind: number, grey: boolean): number {
  if (!grey) return colOf(kind, row);
  let best = -1;
  let bv = -Infinity;
  for (const c of wallCols(b, row, kind)) {
    const w = b.wall.map((r) => [...r]);
    w[row][c] = kind;
    const v = tilePoints(w, row, c) - Math.abs(c - 2) * 0.2;
    if (v > bv) (bv = v), (best = c);
  }
  return best;
}

/** Ценность закупки для ходящего (без учёта соперников). */
export function value(s: State, a: Extract<Action, { type: 'take' }>): number {
  const b = s.boards[s.turn];
  const tiles = a.src === -1 ? s.center : s.factories[a.src];
  const n = tiles.filter((t) => t === a.kind).length;
  const trowel = a.src === -1 && s.trowel ? 1 : 0;
  let v = -0.6 * trowel; // мастерок — минус очко, зато первый ход
  if (a.row === 5) return v + floorCost(b, n + trowel) - 1.5;
  const L = b.lines[a.row];
  const room = a.row + 1 - L.n;
  const put = Math.min(room, n);
  const over = n - put;
  v += floorCost(b, over + trowel); // лишнее и мастерок — в «бой»
  const filled = L.n + put === a.row + 1;
  if (filled) {
    const c = bestCol(b, a.row, a.kind, s.cfg.grey);
    if (c < 0) return v - 10;
    const w = b.wall.map((r) => [...r]);
    w[a.row][c] = a.kind;
    v += tilePoints(w, a.row, c);
    // к бонусам: ряд и столбец
    v += w[a.row].filter((x) => x >= 0).length * 0.25 + w.filter((r) => r[c] >= 0).length * 0.45;
  } else {
    // недостроенная строка: тем хуже, чем больше не хватает
    v += put * 0.55 - (a.row + 1 - L.n - put) * 0.35;
  }
  return v;
}

const fixed: Rng = { next: () => 0.5, int: (n) => Math.floor(n / 2), getState: () => 0 };

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over) return null;
  const ms = legal(s);
  if (!ms.length) return null;
  if (s.phase === 'wall') {
    const t = s.tiling!;
    const b = s.boards[t.seat];
    const c = bestCol(b, t.row, b.lines[t.row].k, true);
    return ms.find((m) => m.type === 'wall' && m.col === c) ?? ms[0];
  }
  if (s.turn !== seat) return null;
  const takes = ms as Extract<Action, { type: 'take' }>[];
  if (level === 0) {
    const ok = takes.filter((m) => m.row < 5 && value(s, m) > -1);
    const pool = ok.length ? ok : takes;
    return pool[rng.int(pool.length)];
  }
  const scored = takes.map((m) => ({ m, v: value(s, m) + rng.next() * 0.05 })).sort((a, b) => b.v - a.v);
  if (level === 1) return scored[0].m;
  // сложный: минус лучший ответ следующего (по 10 лучшим своим)
  let best = scored[0].m;
  let bv = -Infinity;
  for (const { m, v } of scored.slice(0, 10)) {
    const t = apply(s, m, fixed).state;
    let reply = 0;
    if (!t.over && t.phase === 'take' && t.round === s.round && t.turn !== seat) {
      for (const r of legal(t)) if (r.type === 'take') reply = Math.max(reply, value(t, r));
    }
    const val = v - reply * 0.6;
    if (val > bv) (bv = val), (best = m);
  }
  return best;
}

