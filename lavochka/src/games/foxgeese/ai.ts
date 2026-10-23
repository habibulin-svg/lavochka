/* Игры на кресте — боты.
 * Лиса и гуси, асальто: перебор с альфа-бета. Оценка для лисы (офицеров): съеденные, гуси под ударом, подвижность лисы;
 *   в асальто повстанцам ещё важно продвинуться и занять крепость.
 *   Лёгкий — на 1 полуход с шумом; Средний — на 3; Сложный — до 5.
 * «Йога»: Лёгкий прыгает наугад; Средний — жадно (меньше одиноких фишек, ближе к центру);
 *   Сложный ищет полное решение перебором с памятью позиций, а не нашёл — ходит как средний. */
import { bestMove, type SearchGame } from '../../core/minimax';
import type { Rng } from '../../core/types';
import { FOX, geo, isFort, legal, MAN, men, step, type Action, type State } from './engine';

function foxScore(s: State): number {
  if (s.over) return s.winner === 1 ? 10000 - s.ply : s.winner === 0 ? -10000 + s.ply : 0;
  const G = geo(s.cfg);
  let mob = 0;
  let threat = 0;
  let adv = 0;
  let fort = 0;
  s.board.forEach((v, p) => {
    if (v === FOX) {
      for (const [, , a, b] of G.dirs[p]) {
        if (!s.board[a]) mob++;
        else if (s.board[a] === MAN && b >= 0 && !s.board[b]) threat++;
      }
    } else if (v === MAN) {
      const [x, y] = G.xy[p];
      adv += 6 - y;
      if (isFort(x, y)) fort++;
    }
  });
  if (s.cfg.mode === 'asalto') return s.eaten * 90 + threat * (s.turn === 1 ? 35 : 10) + mob * 2 - adv * 3 - fort * 25;
  return s.eaten * 120 + threat * (s.turn === 1 ? 45 : 12) + mob * 6 - adv * 1;
}

const game: SearchGame<State, Action> = {
  moves: legal,
  play: (s, m) => step(s, m).state,
  side: (s) => s.turn,
  over: (s) => s.over,
  score: (s, me) => (me === 1 ? foxScore(s) : -foxScore(s)),
  order: (s, m) => (m.type === 'move' && s.board[m.from] === FOX && !geo(s.cfg).dirs[m.from].some(([, , a]) => a === m.to) ? 10 : 0),
};

/* ---------- солитёр ---------- */

const solved = new Map<string, Action[] | null>();

function key(s: State) {
  return s.board.join('');
}

/** Поиск решения до одной фишки (с центром, если удастся). */
function solve(s: State): Action[] | null {
  const k0 = key(s);
  if (solved.has(k0)) return solved.get(k0)!;
  const dead = new Set<string>();
  let nodes = 0;
  const path: Action[] = [];
  const rec = (p: State): boolean => {
    if (men(p) === 1) return true;
    if (++nodes > 300000) return false;
    const k = key(p);
    if (dead.has(k)) return false;
    const ms = legal(p);
    for (const m of ms) {
      path.push(m);
      if (rec(step(p, m).state)) return true;
      path.pop();
    }
    dead.add(k);
    return false;
  };
  const ok = rec(s);
  const res = ok ? path.slice() : null;
  solved.set(k0, res);
  if (res) {
    // запомнить решение и для всех позиций на пути
    let p = s;
    for (let i = 0; i < res.length; i++) {
      solved.set(key(p), res.slice(i));
      p = step(p, res[i]).state;
    }
  }
  return res;
}

function greedy(s: State, rng: Rng): Action | null {
  const G = geo(s.cfg);
  const ms = legal(s);
  if (!ms.length) return null;
  let best: Action[] = [];
  let bv = -Infinity;
  for (const m of ms) {
    const n = step(s, m).state;
    let v = legal(n).length * 2;
    n.board.forEach((x, p) => {
      if (x !== 1) return;
      const [px, py] = G.xy[p];
      v -= Math.abs(px - 3) + Math.abs(py - 3);
      if (!G.dirs[p].some(([, , a]) => n.board[a])) v -= 6;
    });
    if (v > bv) {
      bv = v;
      best = [m];
    } else if (v === bv) best.push(m);
  }
  return best[rng.int(best.length)];
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over || s.turn !== seat) return null;
  if (s.cfg.mode === 'yoga') {
    const ms = legal(s);
    if (!ms.length) return null;
    if (level <= 0) return ms[rng.int(ms.length)];
    if (level >= 2) {
      const plan = solve(s);
      if (plan && plan.length) return plan[0];
    }
    return greedy(s, rng);
  }
  const depth = level <= 0 ? 1 : level === 1 ? 3 : 5;
  return bestMove(game, s, depth, rng, level <= 0 ? 80 : level === 1 ? 8 : 0);
}
