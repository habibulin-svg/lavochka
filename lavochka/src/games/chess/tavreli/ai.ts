/* Таврели — боты: оценка по башням (хозяин верхушки владеет всей башней, пленные — его добыча) и альфа-бета. */
import type { Rng } from '../../../core/types';
import { tuning } from '../ai';
import { inCheck, legalMoves, owner, playBoard, rankOf, fileOf, top, type Kind, type Stack, type TAction, type TMove, type TState } from './engine';

const VAL: Record<Kind, number> = { V: 0, K: 900, H: 1150, R: 500, B: 320, N: 310, P: 100 };

/** Оценка за белых. Своя таврель в своей башне — полная цена, пленная чужая — почти полная в пользу хозяина башни
 * (её освободят, только отбив башню). Верхушка, стоящая под боем без защиты, — повод для поиска, а не для оценки. */
export function evaluate(board: Stack[]): number {
  let v = 0;
  for (let i = 0; i < 64; i++) {
    const st = board[i];
    if (!st.length) continue;
    const o = owner(st);
    const sg = o === 0 ? 1 : -1;
    for (let j = 0; j < st.length; j++) {
      const t = st[j];
      const val = t.k === 'P' && t.s === 'H' ? 130 : VAL[t.k];
      if (t.c === o) v += sg * (j === st.length - 1 ? val : val * 0.85);
      else v += sg * val * 0.9; // пленник
      // и сам он у соперника пропал из войска
    }
    const p = st[st.length - 1];
    // ратник ближе к превращению, фигуры — к центру
    if (p.k === 'P') v += sg * (p.c === 0 ? rankOf(i) - 1 : 6 - rankOf(i)) * (p.s === 'H' ? 14 : 8);
    else if (p.k !== 'V') {
      const f = fileOf(i);
      const r = rankOf(i);
      v += sg * (6 - (Math.abs(3.5 - f) + Math.abs(3.5 - r))) * (p.k === 'N' ? 5 : 2);
    }
    // высокая башня — сила, но и лакомая добыча; чуть поощряем
    v += sg * (st.length - 1) * 4;
  }
  return v;
}

/** Порядок перебора: взятия (дороже добыча — раньше), ходы целой башней раньше частей. */
function ordered(s: TState, all: TMove[]): TMove[] {
  const score = (m: TMove) => {
    let x = 0;
    if (m.capture) for (const t of s.board[m.to]) x += VAL[t.k] + 10;
    if (m.n === s.board[m.from].length) x += 5;
    return x;
  };
  return all.map((m) => ({ m, x: score(m) })).sort((a, b) => b.x - a.x).map((o) => o.m);
}

function child(s: TState, m: TMove): TState {
  const { board } = playBoard(s.board, m);
  const p = top(s.board[m.from])!;
  const double = p.k === 'P' && Math.abs(rankOf(m.to) - rankOf(m.from)) === 2;
  return { ...s, board, turn: (1 - s.turn) as 0 | 1, ep: double ? (m.from + m.to) / 2 : -1, epAt: double ? m.to : -1 };
}

interface Ctx {
  nodes: number;
  limit: number;
}

function search(s: TState, depth: number, alpha: number, beta: number, ctx: Ctx): number {
  const sg = s.turn === 0 ? 1 : -1;
  if (depth <= 0 || ctx.nodes > ctx.limit) return sg * evaluate(s.board);
  const all = legalMoves(s);
  ctx.nodes += all.length;
  if (!all.length) return inCheck(s) ? -100000 - depth : 0;
  let best = -Infinity;
  for (const m of ordered(s, all)) {
    // на последнем слое отсекаем части башен без взятия — их слишком много
    if (depth === 1 && !m.capture && m.n !== s.board[m.from].length && m.n !== 1) continue;
    const v = -search(child(s, m), depth - 1, -beta, -alpha, ctx);
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

function rootScores(s: TState, depth: number, limit: number): { m: TMove; v: number }[] {
  const ctx: Ctx = { nodes: 0, limit };
  const all = ordered(s, legalMoves(s));
  return all
    .map((m) => ({ m, v: -search(child(s, m), depth - 1, -Infinity, Infinity, ctx) }))
    .sort((a, b) => b.v - a.v);
}

const act = (m: TMove): TAction => ({ type: 'move', from: m.from, to: m.to, n: m.n });

export function chooseT(s: TState, seat: number, level: number, rng: Rng): TAction | null {
  if (s.phase === 'over') return null;
  if (s.phase === 'draw') {
    const v = (seat === 0 ? 1 : -1) * evaluate(s.board);
    return { type: v < (level >= 2 ? -80 : -150) ? 'accept' : 'decline' };
  }
  if (s.turn !== seat) return null;
  const legal = legalMoves(s);
  if (!legal.length) return null;
  // волхв под боем после хода невозможен (legalMoves), но лёгкий бот ещё и иногда «зевает»
  if (level === 0) {
    if (rng.next() < 0.2) return act(legal[rng.int(legal.length)]);
    const sc = rootScores(s, 1, 1e9);
    const good = sc.filter((x) => x.v >= sc[0].v - 80);
    return act(good[rng.int(good.length)].m);
  }
  if (level === 1) {
    const sc = rootScores(s, 2, tuning.fast ? 6000 : 40000);
    const good = sc.filter((x) => x.v >= sc[0].v - 15);
    return act(good[rng.int(good.length)].m);
  }
  const sc = rootScores(s, tuning.fast ? 2 : legal.length <= 40 ? 4 : 3, tuning.fast ? 8000 : 250000);
  const top3 = sc.filter((x) => x.v >= sc[0].v - 5);
  return act(top3[rng.int(top3.length)].m);
}
