/* Коридор — боты. Оценка — гонка: насколько мой кратчайший путь к цели короче, чем у самого опасного соперника
 * (у кого путь короче всех), плюс запас стенок и очередь хода. Стенки перебираются не все, а только те, что
 * перегораживают кратчайший путь соперника (и свой — чтобы видеть, чем он может ответить).
 *   Лёгкий — чаще просто идёт по кратчайшему пути, иногда ставит случайную полезную стенку;
 *   Средний — лучший ход на один вперёд с небольшим шумом; Сложный — альфа-бета на три полухода (на троих-четверых —
 *   на один ход без шума: перебор «все против меня» там играл хуже). */
import { bestMove, type SearchGame } from '../../core/minimax';
import type { Rng } from '../../core/types';
import { apply0, dist, isGoal, pawnMoves, wallOk, X, Y, type Action, type State, type Wall } from './engine';

/** Один кратчайший путь места (клетки от пешки до цели). */
export function path(s: State, seat: number): number[] {
  const n = s.cfg.n;
  const from = s.pos[seat];
  const prev = new Int16Array(n * n).fill(-1);
  prev[from] = from;
  const q = [from];
  const DX = [0, 1, 0, -1];
  const DY = [-1, 0, 1, 0];
  for (let i = 0; i < q.length; i++) {
    const p = q[i];
    if (isGoal(n, seat, p)) {
      const out = [p];
      let c = p;
      while (c !== from) out.push((c = prev[c]));
      return out.reverse();
    }
    const x = X(n, p);
    const y = Y(n, p);
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const r = ny * n + nx;
      if (prev[r] >= 0 || blockedEdge(s, p, r)) continue;
      prev[r] = p;
      q.push(r);
    }
  }
  return [from];
}

function blockedEdge(s: State, a: number, b: number): boolean {
  const n = s.cfg.n;
  const m = n - 1;
  const ax = X(n, a);
  const ay = Y(n, a);
  const bx = X(n, b);
  const by = Y(n, b);
  if (ax === bx) {
    const row = Math.min(ay, by);
    return (ax > 0 && s.hw[row * m + ax - 1] > 0) || (ax < m && s.hw[row * m + ax] > 0);
  }
  const col = Math.min(ax, bx);
  return (ay > 0 && s.vw[(ay - 1) * m + col] > 0) || (ay < m && s.vw[ay * m + col] > 0);
}

/** Стенки, перегораживающие путь: на каждом шаге — две стенки, закрывающие этот проход. */
function blockers(s: State, cells: number[]): Wall[] {
  const n = s.cfg.n;
  const m = n - 1;
  const out: Wall[] = [];
  for (let i = 0; i + 1 < cells.length && i < 8; i++) {
    const a = cells[i];
    const b = cells[i + 1];
    const ax = X(n, a);
    const ay = Y(n, a);
    if (ax === X(n, b)) {
      const row = Math.min(ay, Y(n, b));
      for (const x of [ax - 1, ax]) if (x >= 0 && x < m) out.push({ x, y: row, o: 'h' });
    } else {
      const col = Math.min(ax, X(n, b));
      for (const y of [ay - 1, ay]) if (y >= 0 && y < m) out.push({ x: col, y, o: 'v' });
    }
  }
  return out;
}

/** Ходы для перебора: шаги пешкой и стенки поперёк путей соперников (и своего). */
export function candidates(s: State): Action[] {
  if (s.over) return [];
  const out: Action[] = pawnMoves(s, s.turn).map((to) => ({ type: 'move', to }));
  if (s.left[s.turn] > 0) {
    const seen = new Set<string>();
    for (const q of s.order) {
      for (const w of blockers(s, path(s, q))) {
        const k = `${w.o}${w.x},${w.y}`;
        if (seen.has(k)) continue;
        seen.add(k);
        if (wallOk(s, w)) out.push({ type: 'wall', ...w });
      }
    }
  }
  return out;
}

/** Цена стенки в запасе на троих-четверых. */
const WALL4 = 6;

export function score(s: State, me: number): number {
  const n = s.cfg.n;
  if (s.over) return s.winner === me ? 10000 - s.ply : -10000 + s.ply;
  const mine = dist(n, s.hw, s.vw, me, s.pos[me]);
  let opp = Infinity;
  let oppLeft = 0;
  for (const q of s.order) {
    if (q === me) continue;
    const d = dist(n, s.hw, s.vw, q, s.pos[q]);
    if (d < opp) opp = d;
    oppLeft = Math.max(oppLeft, s.left[q]);
  }
  // на троих-четверых стенка, поставленная лидеру, помогает и остальным — свой запас стенок ценнее
  if (s.order.length > 2) return (opp - mine) * 10 + s.left[me] * WALL4 + (s.turn === me ? 4 : 0);
  return (opp - mine) * 10 + (s.left[me] - oppLeft) * 2 + (s.turn === me ? 4 : 0);
}

const game: SearchGame<State, Action> = {
  moves: candidates,
  play: (s, a) => apply0(s, a).state,
  side: (s) => s.turn,
  over: (s) => s.over,
  score,
  order: (s, a) => (a.type === 'move' ? 5 - dist(s.cfg.n, s.hw, s.vw, s.turn, a.to) : 0),
};

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over || s.turn !== seat) return null;
  const n = s.cfg.n;
  const steps = pawnMoves(s, seat);
  if (level <= 0) {
    // лёгкий: иногда стенка соперникам поперёк дороги, обычно — шаг к цели
    if (s.left[seat] > 0 && rng.next() < 0.22) {
      const walls = candidates(s).filter((a) => a.type === 'wall');
      if (walls.length) return walls[rng.int(walls.length)];
    }
    let bd = Infinity;
    let best: number[] = [];
    for (const to of steps) {
      const d = isGoal(n, seat, to) ? -1 : dist(n, s.hw, s.vw, seat, to);
      if (d < bd) {
        bd = d;
        best = [to];
      } else if (d === bd) best.push(to);
    }
    if (best.length && rng.next() < 0.85) return { type: 'move', to: best[rng.int(best.length)] };
    if (steps.length) return { type: 'move', to: steps[rng.int(steps.length)] };
    return candidates(s)[0] ?? null;
  }
  // дошёл одним шагом — сразу
  for (const to of steps) if (isGoal(n, seat, to)) return { type: 'move', to };
  // на троих-четверых «все против меня» играет хуже жадного хода: сложный там смотрит на ход вперёд без шума
  const many = s.order.length > 2;
  return bestMove(game, s, level === 1 || many ? 1 : 3, rng, level === 1 ? (many ? 10 : 3) : 0);
}
