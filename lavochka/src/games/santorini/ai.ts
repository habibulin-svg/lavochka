/* Санторин — боты: альфа-бета (core/minimax) по целым ходам (шаг + постройка — один ход).
 *   Лёгкий — на один ход с разбросом;
 *   Средний — на два полухода (видит ответ соперника: не даёт ему подняться на третий ярус);
 *   Сложный — на три полухода.
 * Оценка: высота своих строителей, соседние клетки, на которые можно подняться (особенно ярус 3 рядом со строителем на 2),
 * подвижность и центр поля. */
import type { Rng } from '../../core/types';
import { bestMove, type SearchGame } from '../../core/minimax';
import { apply, around, buildsFrom, N, stepsFrom, type Action, type State } from './engine';

type Turn = [Action] | [Action, Action];

function turns(s: State): Turn[] {
  if (s.phase === 'place') {
    const out: Turn[] = [];
    for (let c = 0; c < N * N; c++) if (!s.workers[0].includes(c) && !s.workers[1].includes(c)) out.push([{ type: 'place', at: c }]);
    return out;
  }
  const me = s.turn;
  const out: Turn[] = [];
  s.workers[me].forEach((from, w) => {
    for (const to of stepsFrom(s, from)) {
      const mv: Action = { type: 'move', w, to };
      if (s.h[to] === 3 && s.h[from] === 2) {
        out.push([mv]);
        continue;
      }
      const after = apply(s, mv).state;
      for (const at of buildsFrom(after, to)) out.push([mv, { type: 'build', at }]);
    }
  });
  return out;
}

function playTurn(s: State, t: Turn): State {
  let x = s;
  for (const a of t) x = apply(x, a).state;
  return x;
}

const CENTER = [0, 1, 2, 1, 0].flatMap((a) => [0, 1, 2, 1, 0].map((b) => Math.min(a, b) + (a === 2 && b === 2 ? 1 : 0)));

function side(s: State, seat: number): number {
  let v = 0;
  for (const c of s.workers[seat]) {
    if (c < 0) continue;
    const h = s.h[c];
    v += h * 14 + CENTER[c] * 2;
    for (const n of around(c)) {
      if (s.dome[n] || s.workers[0].includes(n) || s.workers[1].includes(n)) continue;
      const d = s.h[n] - h;
      if (d <= 1) v += 1 + Math.max(0, s.h[n]) * 1.5; // куда можно шагнуть, повыше — лучше
      if (h === 2 && s.h[n] === 3) v += 40; // угроза подняться
    }
  }
  return v;
}

function score(s: State, me: number): number {
  if (s.over) return s.winner === me ? 10000 - s.ply : -10000 + s.ply;
  return side(s, me) - side(s, 1 - me);
}

const game: SearchGame<State, Turn> = {
  moves: (s) => turns(s),
  play: playTurn,
  side: (s) => s.turn,
  over: (s) => s.over,
  score,
  order: (s, t) => {
    const mv = t[0];
    if (mv.type !== 'move') return 0;
    return s.h[mv.to] * 2 + (t.length === 1 ? 100 : 0);
  },
};

/** Бот решает целый ход, а отдаёт по действию: шаг, потом постройку (запоминаем выбранную). */
let plan: { key: string; build: Action } | null = null;
const posKey = (s: State) => `${s.h.join('')}|${s.dome.map(Number).join('')}|${s.workers.join(';')}|${s.turn}`;

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over || s.turn !== seat) return null;
  if (s.phase === 'build') {
    // постройка из задуманного хода (если позиция та же), иначе — лучшая по оценке
    const want = plan && plan.key === posKey(s) ? plan.build : null;
    const builds = buildsFrom(s, s.workers[seat][s.active!]).map((at) => ({ type: 'build', at }) as Action);
    if (want && want.type === 'build' && builds.some((b) => b.type === 'build' && b.at === want.at)) return want;
    let best = builds[0];
    let bv = -Infinity;
    for (const b of builds) {
      const v = score(apply(s, b).state, seat) + (rng.next() - 0.5) * (level === 0 ? 30 : 0.1);
      if (v > bv) (bv = v), (best = b);
    }
    return best ?? null;
  }
  if (s.phase === 'place') {
    // расстановка: поближе к центру, не вплотную к своему
    const free: number[] = [];
    for (let c = 0; c < N * N; c++) if (!s.workers[0].includes(c) && !s.workers[1].includes(c)) free.push(c);
    const good = free.filter((c) => CENTER[c] >= (level === 0 ? 0 : 1));
    const pool = good.length ? good : free;
    return { type: 'place', at: pool[rng.int(pool.length)] };
  }
  const t = bestMove(game, s, level === 2 ? 3 : level === 1 ? 2 : 1, rng, level === 0 ? 25 : 0.5);
  if (!t) return null;
  plan = t[1] ? { key: posKey(apply(s, t[0]).state), build: t[1] } : null;
  return t[0];
}
