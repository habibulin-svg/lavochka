/* «Поединок» — боты: альфа-бета (core/minimax). Оценка: кубики на поле, угроза королям (может ли кто-то докатиться
 * до короля за один ход), близость своего короля к чужому дворцу и чужого — к нашему.
 * Лёгкий — глубина 1 с шумом, средний — 2, сложный — 3. */
import { bestMove, type SearchGame } from '../../core/minimax';
import type { Rng } from '../../core/types';
import { apply, col, legal, N, PALACE, routes, row, type Action, type State } from './engine';

function kingAt(s: State, seat: number): number {
  for (let p = 0; p < N; p++) {
    const d = s.cells[p];
    if (d && d.king && d.owner === seat) return p;
  }
  return -1;
}

const dist = (a: number, b: number) => Math.abs(col(a) - col(b)) + Math.abs(row(a) - row(b));

/** Сколько кубиков seat могут докатиться до клетки p за один ход. */
function attackers(s: State, seat: number, p: number): number {
  let n = 0;
  for (let q = 0; q < N; q++) {
    const d = s.cells[q];
    // путь без возвратов: до клетки ровно столько шагов по клеткам, сколько перекатов
    if (d && d.owner === seat && dist(q, p) === (d.king ? 1 : d.t) && routes(s, q).some((r) => r.to === p)) n++;
  }
  return n;
}

function evaluate(s: State, me: number): number {
  if (s.over) return s.winner === me ? 10000 - s.plies : s.winner == null ? 0 : -10000 + s.plies;
  let v = 0;
  for (let p = 0; p < N; p++) {
    const d = s.cells[p];
    if (d && !d.king) v += d.owner === me ? 100 : -100;
  }
  const op = 1 - me;
  const myK = kingAt(s, me);
  const opK = kingAt(s, op);
  // угроза королю того, кто сейчас ходит, — решающая: он под боем на ход соперника
  if (myK >= 0 && attackers(s, op, myK)) v -= s.turn === me ? 60 : 900;
  if (opK >= 0 && attackers(s, me, opK)) v += s.turn === op ? 60 : 900;
  if (!s.cfg.noPalace) {
    if (myK >= 0) v += (12 - dist(myK, PALACE[op])) * 4;
    if (opK >= 0) v -= (12 - dist(opK, PALACE[me])) * 4;
  }
  return v;
}

const game: SearchGame<State, Action> = {
  moves: (s) => legal(s, s.turn),
  play: (s, m) => apply(s, s.turn, m)?.state ?? s,
  side: (s) => s.turn,
  over: (s) => s.over,
  score: evaluate,
  order: (s, m) => {
    if (m.type !== 'move') return 0;
    const r = routes(s, m.from).find((x) => x.a.d1 === m.d1 && x.a.k === m.k && x.a.d2 === m.d2);
    const t = r ? s.cells[r.to] : null;
    return t ? (t.king ? 1000 : 100) : 0;
  },
};

export function choose(v: State, seat: number, level: number, rng: Rng): Action | null {
  if (v.over || v.turn !== seat) return null;
  const depth = [1, 2, 3][level] ?? 2;
  return bestMove(game, v, depth, rng, level === 0 ? 260 : level === 1 ? 20 : 0);
}
