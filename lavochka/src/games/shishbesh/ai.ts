/* Шиш-беш — боты трёх уровней сложности. */
import type { Rng } from '../../core/types';
import { geoOf, isBlocked, legalMoves, movePiece, type Geo, type Move, type State } from './engine';

// 21 уникальная комбинация двух кубиков с весами (из 36).
const OUTCOMES: [number, number, number][] = [];
for (let a = 1; a <= 6; a++) for (let b = a; b <= 6; b++) OUTCOMES.push([a, b, a === b ? 1 : 2]);

// Ценность одного лишнего броска (дубль/рубка).
const EXTRA_ROLL = 9;

type Sim = State & { captures?: number };

function light(s: Sim): Sim {
  return {
    ...s,
    players: s.players.map((p) => ({ seat: p.seat, pieces: p.pieces.slice(), house: p.house.slice() })),
    dice: [s.dice[0], s.dice[1]],
    used: [s.used[0], s.used[1]],
    phase: 'move',
  };
}

function simApply(s: Sim, m: Move): Sim {
  const n = light(s);
  const { captured } = movePiece(n, n.cur, m.piece, m.to);
  n.used[m.die] = true;
  n.captures = (s.captures || 0) + captured.length;
  return n;
}

// Куда фишка может попасть одним кубиком (без учёта занятости клеток — для оценки угроз).
function reach(G: Geo, p: number, d: number, dice: [number, number]): number[] {
  if (p === -1) return G.canEnter(d, dice) ? [0] : [];
  if (p >= G.HS) return [];
  const r: number[] = [];
  if (p + d <= G.L) r.push(p + d);
  if (G.isCorner(p)) {
    if (d === 1) r.push(G.wrap(p, G.Q), G.wrap(p, -G.Q));
    if (d === 3) r.push(G.wrap(p, 2 * G.Q));
  }
  return r;
}

// Глобальные клетки, на которые соперник может встать этим броском (a, b).
function hitCells(s: State, oi: number, a: number, b: number, into: Set<number>) {
  const G = geoOf(s);
  const op = s.players[oi];
  const dice: [number, number] = [a, b];
  op.pieces.forEach((p, k) => {
    if (isBlocked(s, oi, k)) return;
    for (const [d1, d2] of [
      [a, b],
      [b, a],
    ]) {
      for (const t of reach(G, p, d1, dice)) {
        if (G.onLoop(t)) into.add(G.toGlobal(op.seat, t));
        for (const t2 of reach(G, t, d2, dice)) if (G.onLoop(t2)) into.add(G.toGlobal(op.seat, t2));
      }
    }
  });
}

/** Вероятность, что фишку на клетке g срубят до нашего следующего хода. */
function threatMap(s: State, meIdx: number, cells: number[]) {
  const safe = new Map(cells.map((g) => [g, 1]));
  s.players.forEach((_op, oi) => {
    if (oi === meIdx) return;
    const hitW = new Map(cells.map((g) => [g, 0]));
    for (const [a, b, w] of OUTCOMES) {
      const set = new Set<number>();
      hitCells(s, oi, a, b, set);
      for (const g of cells) if (set.has(g)) hitW.set(g, hitW.get(g)! + w);
    }
    for (const g of cells) safe.set(g, safe.get(g)! * (1 - hitW.get(g)! / 36));
  });
  const res = new Map<number, number>();
  for (const g of cells) res.set(g, 1 - safe.get(g)!);
  return res;
}

function pieceValue(s: State, pi: number, k: number) {
  const G = geoOf(s);
  const p = s.players[pi].pieces[k];
  if (p < 0) return 0;
  if (p === 0) return 9; // на старте — уже в игре и в безопасности
  if (p >= G.HS) return G.L + 16 + (p - G.HS) * 4;
  let v = 11 + p;
  // С угла одним прыжком можно уйти на угол у своего луча — это почти весь круг.
  if (G.isCorner(p) && p < G.homeCorner) v += (G.homeCorner - p) * 0.3;
  if (isBlocked(s, pi, k)) v -= 1.5;
  return v;
}

function playerValue(s: State, pi: number) {
  let v = 0;
  for (let k = 0; k < 4; k++) v += pieceValue(s, pi, k);
  return v;
}

function evaluate(s: Sim, meIdx: number, dangerW: number) {
  const G = geoOf(s);
  const me = s.players[meIdx];
  let mine = playerValue(s, meIdx) + (s.captures || 0) * EXTRA_ROLL;
  if (dangerW > 0) {
    const exposed: [number, number][] = [];
    me.pieces.forEach((p, k) => {
      if (G.onLoop(p) && !me.house[k]) exposed.push([G.toGlobal(me.seat, p), pieceValue(s, meIdx, k) + 9]);
    });
    if (exposed.length) {
      const tm = threatMap(s, meIdx, exposed.map((e) => e[0]));
      for (const [g, v] of exposed) mine -= dangerW * tm.get(g)! * v;
    }
  }
  const opp: number[] = [];
  s.players.forEach((_op, oi) => oi !== meIdx && opp.push(playerValue(s, oi)));
  const mean = opp.reduce((a, b) => a + b, 0) / opp.length;
  return mine - (0.5 * mean + 0.5 * Math.max(...opp));
}

function best(moves: Move[], score: (m: Move) => number) {
  let bm = moves[0];
  let bs = -Infinity;
  for (const m of moves) {
    const v = score(m);
    if (v > bs) {
      bs = v;
      bm = m;
    }
  }
  return bm;
}

/** level: 0 — лёгкий, 1 — средний, 2 — сложный. */
export function chooseMove(state: State, level: number, rng: Rng): Move | null {
  const moves = legalMoves(state);
  if (!moves.length) return null;
  if (moves.length === 1) return moves[0];
  const s0 = light(state);
  const meIdx = state.cur;

  if (level <= 0) {
    // Лёгкий: наполовину случайный, иначе жадный без оценки опасности.
    if (rng.next() < 0.55) return moves[rng.int(moves.length)];
    return best(moves, (m) => evaluate(simApply(s0, m), meIdx, 0));
  }
  if (level === 1) {
    // Средний: лучший одиночный ход с учётом угроз.
    return best(moves, (m) => evaluate(simApply(s0, m), meIdx, 0.6) + rng.next() * 1.5);
  }
  // Сложный: перебор обоих кубиков целиком.
  return best(moves, (m) => {
    const s1 = simApply(s0, m);
    const next = legalMoves(s1);
    if (!next.length) return evaluate(s1, meIdx, 1);
    let b = -Infinity;
    for (const m2 of next) b = Math.max(b, evaluate(simApply(s1, m2), meIdx, 1));
    return b;
  });
}
