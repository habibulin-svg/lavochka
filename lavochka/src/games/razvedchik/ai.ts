/* Разведчик и дозор — боты.
 * Оценка — «гонка»: успевает ли разведчик к свободному красному кружку раньше любого дозорного (с учётом порядка ходов:
 *   по коробке за круг каждый дозорный ходит раз, по очереди — один дозорный на ход разведчика), сколько кружков
 *   разведчик «держит» (успевает к ним первым) и сколько у него свободных соседей.
 * Лёгкий — почти наугад с тягой к цели; Средний — лучший ход по оценке на один ход вперёд;
 * Сложный — перебор с альфа-бета на круг ходов (разведчик и все дозорные по коробке, четыре полухода по очереди).
 * Расстановка: дозорные расходятся по краю подальше друг от друга, разведчик выбирает жёлтый кружок по оценке. */
import { bestMove, type SearchGame } from '../../core/minimax';
import type { Rng } from '../../core/types';
import { bfs, freeNeighbors, legal, N, occupied, RED, SCOUT, step, type Action, type State } from './engine';

/** Очередь ходов от текущего: сколько ходов дозорного i будет сделано до k-го хода разведчика. */
function schedule(s: State, maxK: number): number[][] {
  const n = s.cfg.dozors;
  const moves = Array.from({ length: n + 1 }, () => Array(maxK + 2).fill(0));
  const cnt = Array(n + 1).fill(0);
  let k = 0;
  let cur = s.cur;
  let nd = s.nextDozor;
  for (let guard = 0; guard < (n + 1) * (maxK + 2) && k <= maxK; guard++) {
    if (cur === SCOUT) {
      k++;
      for (let i = 1; i <= n; i++) moves[i][k] = cnt[i];
      cur = s.cfg.order === 'box' ? 1 : nd;
    } else {
      cnt[cur]++;
      if (s.cfg.order === 'box') cur = cur === n ? SCOUT : cur + 1;
      else {
        nd = cur === n ? 1 : cur + 1;
        cur = SCOUT;
      }
    }
  }
  return moves;
}

/** Оценка для разведчика: больше — лучше ему. */
export function evaluate(s: State): number {
  if (s.over) return s.winner === 0 ? 10000 - s.scoutMoves : s.winner === 1 ? -10000 + s.scoutMoves : 0;
  if (s.phase === 'place') return 0;
  const occ = occupied(s);
  const sp = s.pos[SCOUT];
  const dS = bfs([sp], occ);
  const n = s.cfg.dozors;
  const dists: number[][] = [];
  for (let i = 1; i <= n; i++) dists.push(bfs([s.pos[i]], occ));
  const maxK = 14;
  const sch = schedule(s, maxK);
  // успевает ли разведчик к точке v раньше всех дозорных
  const first = (v: number) => {
    const k = dS[v];
    if (k === Infinity || k > maxK) return -9;
    let slack = Infinity;
    for (let i = 1; i <= n; i++) slack = Math.min(slack, dists[i - 1][v] - sch[i][k]);
    return slack;
  };
  let escapes = 0;
  let bestSlack = -9;
  let nearRed = 20;
  for (const r of RED) {
    if (occ[r]) continue;
    const sl = first(r);
    if (sl > 0) escapes++;
    if (sl > bestSlack) bestSlack = sl;
    if (dS[r] < nearRed) nearRed = dS[r];
  }
  let land = 0;
  for (let v = 0; v < dS.length; v++) if (v !== sp && dS[v] < Infinity && first(v) > 0) land++;
  const mob = freeNeighbors(s, sp, occ).length;
  return (escapes ? 300 : 0) + 50 * escapes + 20 * Math.max(-3, Math.min(3, bestSlack)) + 5 * land + 12 * mob - 15 * Math.min(nearRed, 12) - (mob <= 1 ? 120 : 0);
}

const team = (s: State) => (s.cur === SCOUT ? 0 : 1);

const game: SearchGame<State, Action> = {
  moves: legal,
  play: (s, m) => step(s, m).state,
  side: team,
  over: (s) => s.over,
  score: (s, me) => (me === 0 ? evaluate(s) : -evaluate(s)),
};

function placeDozor(s: State, level: number, rng: Rng): Action {
  const ms = legal(s);
  if (level <= 0) return ms[rng.int(ms.length)];
  const placed = s.pos.slice(1).filter((p) => p >= 0);
  if (!placed.length) return ms[rng.int(ms.length)];
  // расстояние по всем линиям (занятость не важна): подальше от уже стоящих
  const d = bfs(placed, Array(N).fill(false));
  let best: Action[] = [];
  let bv = -1;
  for (const m of ms) {
    const v = d[m.to];
    if (v > bv) {
      bv = v;
      best = [m];
    } else if (v === bv) best.push(m);
  }
  return best[rng.int(best.length)];
}

function onePly(s: State, rng: Rng, noise: number): Action | null {
  const ms = legal(s);
  if (!ms.length) return null;
  const me = team(s);
  let best: Action[] = [];
  let bv = -Infinity;
  for (const m of ms) {
    const v = (me === 0 ? 1 : -1) * evaluate(step(s, m).state) + (rng.next() - 0.5) * noise;
    if (v > bv + 1e-9) {
      bv = v;
      best = [m];
    } else if (Math.abs(v - bv) <= 1e-9) best.push(m);
  }
  return best[rng.int(best.length)];
}

export function choose(s: State, level: number, rng: Rng): Action | null {
  if (s.over) return null;
  const ms = legal(s);
  if (!ms.length) return null;
  if (s.phase === 'place') {
    if (s.cur !== SCOUT) return placeDozor(s, level, rng);
    if (level <= 0) return ms[rng.int(ms.length)];
    return onePly(s, rng, 0) ?? ms[0];
  }
  // выигрыш в один ход берут все
  for (const m of ms) {
    const r = step(s, m).state;
    if (r.over && r.winner === team(s)) return m;
  }
  if (level <= 0) {
    // наугад, но чаще — к цели: разведчик к красному, дозорный к разведчику
    if (rng.next() < 0.4) return ms[rng.int(ms.length)];
    const occ = occupied(s);
    const goal = s.cur === SCOUT ? RED.filter((r) => !occ[r]) : [s.pos[SCOUT]];
    const d = bfs(goal, occ.map((o, i) => o && !goal.includes(i)));
    let best = ms[0];
    for (const m of ms) if (d[m.to] < d[best.to]) best = m;
    return best;
  }
  if (level === 1) return onePly(s, rng, 30);
  const depth = s.cfg.order === 'box' ? s.cfg.dozors + 1 : 4;
  return bestMove(game, s, depth, rng, 0);
}

