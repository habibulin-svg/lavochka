/* Так — боты: альфа-бета (core/minimax) с оценкой позиции.
 *   Лёгкий — на один ход с большим разбросом;
 *   Средний — на один ход, почти без разброса;
 *   Сложный — на два полухода (видит ответ соперника: не даёт ему достроить дорогу).
 * Оценка: сколько ещё камней не хватает до дороги (кратчайший путь от края до края: свои плоские — даром, пустые — по камню,
 * чужие и стенки — стена), счёт плоских сверху, свои камни, захваченные в стопках, запас. */
import type { Rng } from '../../core/types';
import { bestMove, type SearchGame } from '../../core/minimax';
import { flatCount, legal, next, step, top, type Action, type State } from './engine';

/** Сколько камней не хватает до дороги (по лучшему направлению). */
function roadGap(s: State, me: number): number {
  const n = s.cfg.size;
  const cost = (c: number) => {
    const t = top(s, c);
    if (!t) return 1;
    if (t.o === me && t.k !== 'S') return 0;
    return 99;
  };
  let best = 99;
  for (const vertical of [true, false]) {
    const dist = new Array<number>(n * n).fill(Infinity);
    const dq: number[] = [];
    for (let i = 0; i < n; i++) {
      const c = vertical ? i : i * n;
      const w = cost(c);
      if (w < 99) (dist[c] = w), dq.push(c);
    }
    // простая волна (веса 0/1): несколько проходов — доска маленькая
    for (let it = 0; it < n * n && dq.length; it++) {
      const c = dq.shift()!;
      for (let d = 0; d < 4; d++) {
        const p = next(n, c, d);
        if (p < 0) continue;
        const w = cost(p);
        if (w >= 99) continue;
        if (dist[c] + w < dist[p]) {
          dist[p] = dist[c] + w;
          if (w === 0) dq.unshift(p);
          else dq.push(p);
        }
      }
      if (!dq.length) break;
    }
    for (let i = 0; i < n; i++) {
      const c = vertical ? (n - 1) * n + i : i * n + n - 1;
      best = Math.min(best, dist[c]);
    }
  }
  return best;
}

function score(s: State, me: number): number {
  if (s.over) return s.winner === me ? 10000 - s.ply : s.winner == null ? 0 : -10000 + s.ply;
  const op = 1 - me;
  const g1 = roadGap(s, me);
  const g2 = roadGap(s, op);
  const roadV = (g: number) => (g >= 99 ? 0 : 60 / (g + 0.6));
  // кому ходить — тому дорога ближе на полхода
  let v = roadV(s.turn === me ? g1 - 0.4 : g1) - roadV(s.turn === op ? g2 - 0.4 : g2);
  const f = flatCount(s);
  v += (f[me] - f[op]) * 4;
  for (const st of s.board) {
    const t = st[st.length - 1];
    if (!t || st.length < 2) continue;
    const mine = st.filter((p) => p.o === t.o).length;
    v += (t.o === me ? 1 : -1) * mine * 0.8;
  }
  v += (s.caps[me] - s.caps[op]) * -0.5;
  return v;
}

const game: SearchGame<State, Action> = {
  moves: (s) => legal(s),
  play: (s, m) => step(s, m)!.state,
  side: (s) => s.turn,
  over: (s) => s.over,
  score,
  order: (_s, m) => (m.type === 'place' ? (m.kind === 'F' ? 2 : m.kind === 'C' ? 1 : 0) : 1 + m.drops.length * 0.1),
};

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over || s.turn !== seat) return null;
  const depth = level === 2 ? 2 : 1;
  return bestMove(game, s, depth, rng, level === 0 ? 30 : level === 1 ? 1 : 0);
}
