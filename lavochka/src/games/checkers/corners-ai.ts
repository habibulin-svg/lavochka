/* Уголки — боты: оценка — насколько шашки продвинулись к дальнему углу (свои против чужих), бонус за занятые поля дома соперника,
 * штраф за засидевшиеся дома шашки ближе к 40-му ходу.
 *   Лёгкий — один ход вперёд, с ошибками; Средний — один ход, лучший; Сложный — свой ход и лучший ответ соперника. */
import type { Rng } from '../../core/types';
import { cMoves, cPlay, homeOf, leaveBy, type CAction, type CMove, type CState } from './corners';

const N = 8;

function dist(s: CState, sq: number, c: number): number {
  let r = Math.floor(sq / N);
  let f = sq % N;
  if (c === 1) {
    r = N - 1 - r;
    f = N - 1 - f;
  }
  // до дальнего угла (h8 для белых)
  const dr = N - 1 - r;
  const df = N - 1 - f;
  return s.cfg.moves === 'diagonal' ? Math.max(dr, df) * 1.4 + Math.min(dr, df) * 0.2 : dr + df;
}

/** Оценка за сторону c. */
function score(s: CState, c: number): number {
  const target = new Set(homeOf(s.cfg, 1 - c));
  const mine = new Set(homeOf(s.cfg, c));
  const me = c === 0 ? 'w' : 'b';
  const lim = leaveBy(s.cfg);
  let v = 0;
  for (let sq = 0; sq < N * N; sq++) {
    if (s.board[sq] !== me) continue;
    v -= dist(s, sq, c) * 10;
    if (target.has(sq)) v += 25;
    if (mine.has(sq)) v -= 4 + Math.max(0, s.made[c] - lim + 12) * 6;
  }
  return v;
}

const evalFor = (s: CState, c: number) => {
  if (s.phase === 'over') return s.winner === c ? 1e6 : s.winner == null ? 0 : -1e6;
  return score(s, c) - score(s, 1 - c);
};

function after(s: CState, m: CMove): CState {
  return cPlay(s, m);
}

export function cChoose(s: CState, seat: number, level: number, rng: Rng): CAction | null {
  if (s.phase === 'over') return null;
  if (s.phase === 'draw') return { type: evalFor(s, seat) < -60 ? 'accept' : 'decline' };
  if (s.turn !== seat) return null;
  const ms = cMoves(s);
  if (!ms.length) return null;
  const act = (m: CMove): CAction => ({ type: 'move', from: m.from, path: m.path });
  const recent = new Set(s.keys.slice(-8));
  const one = ms.map((m) => {
    const n = after(s, m);
    const key = n.board.map((p) => p || '.').join('') + n.turn;
    return { m, n, v: evalFor(n, seat) - (recent.has(key) ? 40 : 0) };
  });
  one.sort((a, b) => b.v - a.v);
  if (level === 0) {
    if (rng.next() < 0.25) return act(ms[rng.int(ms.length)]);
    const good = one.filter((x) => x.v >= one[0].v - 25);
    return act(good[rng.int(good.length)].m);
  }
  if (level === 1) {
    const good = one.filter((x) => x.v >= one[0].v - 2);
    return act(good[rng.int(good.length)].m);
  }
  // сложный: лучший ответ соперника на каждый из лучших своих ходов
  const top = one.slice(0, 14);
  let best = top[0];
  let bestV = -Infinity;
  for (const x of top) {
    let worst = Infinity;
    if (x.n.phase === 'over' || x.n.turn !== 1 - seat) worst = evalFor(x.n, seat);
    else
      for (const r of cMoves(x.n)) {
        const v = evalFor(after(x.n, r), seat);
        if (v < worst) worst = v;
      }
    if (worst === Infinity) worst = evalFor(x.n, seat);
    if (worst > bestV) {
      bestV = worst;
      best = x;
    }
  }
  return act(best.m);
}
