/* Фанорона — боты. Перебор целыми ходами: цепочка взятий (с выбором подход/отход и остановкой) — один «ход» перебора.
 * Оценка: разница фишек (дорого), подвижность и чужие взятия на следующий ход; в тэлу — две в ряд при пустой третьей.
 *   Лёгкий — на 1 ход с шумом; Средний — на 2; Сложный — на 4 (в тэлу — глубже), сколько успеет в пределах лимита. */
import { bestMove, type SearchGame } from '../../core/minimax';
import type { Rng } from '../../core/types';
import { count, geo, legal, own, step, type Action, type State } from './engine';

/** Целые ходы: последовательности действий до передачи очереди (не больше cap штук). */
export function turns(s: State, cap = 300): Action[][] {
  const out: Action[][] = [];
  const walk = (st: State, path: Action[]) => {
    if (out.length >= cap) return;
    for (const a of legal(st)) {
      const next = step(st, a).state;
      const p = [...path, a];
      if (next.over || next.turn !== st.turn) out.push(p);
      else walk(next, p);
      if (out.length >= cap) return;
    }
  };
  walk(s, []);
  return out;
}

function playAll(s: State, ms: Action[]): State {
  let t = s;
  for (const a of ms) t = step(t, a).state;
  return t;
}

function teloScore(s: State, me: number): number {
  let v = 0;
  for (const r of geo('telo').rows) {
    const mine = r.filter((p) => s.board[p] === own(me)).length;
    const his = r.filter((p) => s.board[p] === own(1 - me)).length;
    if (mine === 2 && !his) v += 10;
    if (his === 2 && !mine) v -= 10;
  }
  if (s.board[4] === own(me)) v += 4;
  else if (s.board[4]) v -= 4;
  return v;
}

function score(s: State, me: number): number {
  if (s.over) return s.winner == null ? 0 : s.winner === me ? 10000 - s.ply : -10000 + s.ply;
  if (s.cfg.size === 'telo') return teloScore(s, me);
  let v = (count(s, me) - count(s, 1 - me)) * 100;
  // угроза: сколько снимет одним шагом тот, кто ходит
  const enemy = 1 - s.turn;
  const before = count(s, enemy);
  let threat = 0;
  for (const a of legal(s).slice(0, 40)) {
    if (a.type !== 'move') continue;
    const lost = before - count(step(s, a).state, enemy);
    if (lost > threat) threat = lost;
  }
  v += (s.turn === me ? 1 : -1) * threat * 30;
  return v;
}

const game: SearchGame<State, Action[]> = {
  moves: (s) => turns(s),
  play: playAll,
  side: (s) => s.turn,
  over: (s) => s.over,
  score,
  order: (s, m) => m.length + (m[0].type === 'move' ? 0 : 1),
};

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over || s.turn !== seat) return null;
  const acts = legal(s);
  if (acts.length === 1) return acts[0];
  const telo = s.cfg.size === 'telo';
  const depth = level <= 0 ? 1 : level === 1 ? (telo ? 4 : 2) : telo ? 8 : 4;
  const best = bestMove(game, s, depth, rng, level <= 0 ? 150 : level === 1 ? 10 : 0);
  return best ? best[0] : acts[rng.int(acts.length)];
}
