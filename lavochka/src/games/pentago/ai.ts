/* Пентаго — боты. Ход для перебора — целиком: лунка + поворот (повороты, которые ничего не меняют, — один раз).
 * Оценка — окна по пять клеток: окно, где шарики только одного игрока, стоит тем дороже, чем их больше
 * (четыре — почти ряд). Чужие окна — в минус, у того, кто ходит следующим, — чуть дороже.
 * На троих-четверых — «параноидальный» перебор: все остальные играют против меня.
 *   Лёгкий — на один ход с шумом; Средний — на один ход; Сложный — на два хода (на большой доске — двенадцать
 *   лучших ходов с худшим ответом следующего игрока). */
import { bestMove, type SearchGame } from '../../core/minimax';
import type { Rng } from '../../core/types';
import { dirs, legal, quads, step, still, windows, type Action, type State } from './engine';

/** Ход целиком: лунка и поворот (q = −1 — без поворота). */
export interface Full {
  p: number;
  q: number;
  dir: number;
}

const W = [0, 1, 6, 36, 260, 0];

function fulls(s: State): Full[] {
  if (s.over || s.phase !== 'place') return [];
  const c = s.cfg;
  const out: Full[] = [];
  for (let p = 0; p < s.board.length; p++) {
    if (s.board[p] >= 0) continue;
    const b = s.board.slice();
    b[p] = s.turn;
    let idle = c.free;
    for (let q = 0; q < quads(c); q++) {
      if (still(c, b, q)) {
        idle = true;
        continue;
      }
      for (const dir of dirs(c)) out.push({ p, q, dir });
    }
    if (idle) {
      // ничего не меняющий поворот (или «не крутить»)
      let q = -1;
      if (!c.free) for (let k = 0; k < quads(c) && q < 0; k++) if (still(c, b, k)) q = k;
      out.push({ p, q, dir: q < 0 ? 0 : 1 });
    }
  }
  return out;
}

function play(s: State, m: Full): State {
  const r = step(s, { type: 'place', p: m.p }).state;
  if (r.over) return r;
  return step(r, { type: 'twist', q: m.q, dir: m.dir }).state;
}

/** Оценка позиции для места me. */
export function score(s: State, me: number): number {
  if (s.over) return s.winners.includes(me) ? (s.winners.length > 1 ? 0 : 10000 - s.ply) : s.winners.length ? -10000 + s.ply : 0;
  const b = s.board;
  const next = s.turn;
  let v = 0;
  for (const w of windows(s.cfg)) {
    let who = -1;
    let k = 0;
    let mixed = false;
    for (let i = 0; i < w.length; i++) {
      const x = b[w[i]];
      if (x < 0) continue;
      if (who < 0) who = x;
      else if (x !== who) {
        mixed = true;
        break;
      }
      k++;
    }
    if (mixed || who < 0) continue;
    const t = W[k] * (who === next ? 1.25 : 1);
    v += who === me ? t : -t;
  }
  return v;
}

const game: SearchGame<State, Full> = {
  moves: fulls,
  play,
  side: (s) => s.turn,
  over: (s) => s.over,
  score,
  order: (s, m) => score(play(s, m), s.turn),
};

/** Есть ли у места seat ход, сразу дающий ряд (постановкой или с поворотом). */
function wins(s: State): boolean {
  for (const m of fulls(s)) {
    const r = play(s, m);
    if (r.over && r.winners.length === 1 && r.winners[0] === s.turn) return true;
  }
  return false;
}

/** Лучший ход целиком. */
function best(s: State, level: number, rng: Rng): Full | null {
  const ms = fulls(s);
  if (!ms.length) return null;
  const me = s.turn;
  // свой ряд — сразу
  for (const m of ms) {
    const r = play(s, m);
    if (r.over && r.winners.length === 1 && r.winners[0] === me) return m;
  }
  if (level >= 2 && s.cfg.size === 6) return bestMove(game, s, 2, rng, 0);
  const scored = ms.map((m) => {
    const r = play(s, m);
    return { m, r, v: score(r, me) + (level <= 0 ? (rng.next() - 0.5) * 120 : 0) };
  });
  scored.sort((a, b) => b.v - a.v);
  if (level >= 2) {
    // большая доска: лучшие кандидаты — с худшим для меня ответом следующего игрока
    let bv = -Infinity;
    let pick: Full | null = null;
    for (const x of scored.slice(0, 12)) {
      let worst = x.r.over ? score(x.r, me) : Infinity;
      if (!x.r.over)
        for (const m of fulls(x.r)) {
          const v = score(play(x.r, m), me);
          if (v < worst) worst = v;
          if (worst <= bv) break;
        }
      if (worst > bv) {
        bv = worst;
        pick = x.m;
      }
    }
    if (pick) return pick;
  }
  const top = scored.filter((x) => x.v >= scored[0].v - 1e-6);
  return top[rng.int(top.length)].m;
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over || s.turn !== seat) return null;
  if (s.phase === 'place') {
    const m = best(s, level, rng);
    return m ? { type: 'place', p: m.p } : null;
  }
  // поворот: шарик уже стоит — выбираем поворот тем же взглядом на ход вперёд
  const acts = legal(s);
  let bestV = -Infinity;
  let pick: Action[] = [];
  for (const a of acts) {
    const r = step(s, a).state;
    let v = score(r, seat);
    if (r.over && r.winners.length === 1 && r.winners[0] === seat) v = 1e6;
    else if (level >= 2 && s.cfg.size === 6 && !r.over) {
      // сложный на малой доске — как в переборе на два хода: худший для меня ответ соперника
      let worst = Infinity;
      for (const m of fulls(r)) {
        const x = score(play(r, m), seat);
        if (x < worst) worst = x;
        if (worst < bestV) break;
      }
      v = worst;
    } else if (level >= 1 && !r.over && wins(r)) v -= 5000;
    if (level <= 0) v += (rng.next() - 0.5) * 120;
    if (v > bestV + 1e-6) {
      bestV = v;
      pick = [a];
    } else if (Math.abs(v - bestV) <= 1e-6) pick.push(a);
  }
  return pick[rng.int(pick.length)] ?? null;
}

