/* «Цена риска» — боты. Цель хода: нет копья и нужна добыча — к охотнику; есть копьё — к нужному зверю; несёт тушу —
 * к стоянке, где его туши ещё нет; всё выложено — домой. Сдвиг перебирается целиком (12 стрелок × 4 поворота), для
 * каждого — лучшая клетка манёвра. Лёгкий — сдвиг наугад, ход к цели с ошибками; средний — лучший сдвиг для себя;
 * сложный — ещё и мешает сопернику, который ближе всех к победе. */
import type { Rng } from '../../core/types';
import { campOf, CAMPS, colOf, isPrey, legal, N, reach, rowOf, slotOk, shifted, type Action, type Kind, type Player, type Prey, type State, type Tile } from './engine';

function targets(s: State, board: Tile[], pl: Player): number[] {
  const home = campOf(s.players.length, pl.seat);
  if (s.cfg.quick) {
    const left = CAMPS.filter((c) => !s.visited[pl.seat].includes(c));
    return left.length ? left : [home];
  }
  const need = CAMPS.filter((c) => pl.laid[c] == null);
  if (!need.length) return [home];
  if (pl.carry.length) return need;
  const want = (k: Kind) => isPrey(k) && !pl.killed.includes(k as Prey);
  const out: number[] = [];
  for (let p = 0; p < N; p++) {
    const k = board[p].k;
    if (pl.spear ? want(k) : k === 'hunter') out.push(p);
  }
  return out.length ? out : need;
}

const dist = (a: number, b: number) => Math.abs(rowOf(a) - rowOf(b)) + Math.abs(colOf(a) - colOf(b));

/** Лучшая клетка манёвра и её ценность на этой доске. */
function bestMove(s: State, board: Tile[], pl: Player, noise: number, rng: Rng): { to: number; v: number } {
  const tg = targets(s, board, pl);
  let best = { to: pl.p, v: -Infinity };
  for (const [p, r] of reach(board, pl, s.cfg)) {
    let v = tg.includes(p) ? 100 : -3 * Math.min(...tg.map((t) => dist(p, t)));
    if (r.torch) v += 4;
    v += rng.next() * noise;
    if (v > best.v) best = { to: p, v };
  }
  return best;
}

/** Как близко соперник к победе (для сложного): выложенные туши и достижимость цели. */
function leader(s: State, me: number): Player | null {
  let best: Player | null = null;
  let bv = -1;
  for (const pl of s.players) {
    if (pl.seat === me) continue;
    const v = s.cfg.quick ? s.visited[pl.seat].length : Object.keys(pl.laid).length * 2 + pl.carry.length;
    if (v > bv) {
      bv = v;
      best = pl;
    }
  }
  return best;
}

export function choose(v: State, seat: number, level: number, rng: Rng): Action | null {
  const acts = legal(v, seat);
  if (!acts.length) return null;
  const me = v.players[seat];
  if (v.phase === 'act') {
    const need = CAMPS.filter((c) => me.laid[c] == null).length;
    return need > me.carry.length ? { type: 'kill' } : { type: 'spare' };
  }
  if (v.phase === 'move') {
    const b = bestMove(v, v.board, me, level === 0 ? 40 : level === 1 ? 1 : 0, rng);
    return { type: 'move', to: b.to };
  }
  // сдвиг
  const shifts = acts.filter((a): a is Extract<Action, { type: 'shift' }> => a.type === 'shift');
  if (level === 0) return shifts[rng.int(shifts.length)];
  const lead = level >= 2 ? leader(v, seat) : null;
  let best = shifts[0];
  let bv = -Infinity;
  for (const a of shifts) {
    if (!slotOk(v, a.slot)) continue;
    const r = shifted(v, a.slot, { k: v.hand!, rot: a.rot });
    const moved = (pl: Player): Player => ({ ...pl, p: r.moves.get(pl.p) ?? pl.p });
    let val = bestMove(v, r.board, moved(me), 0.5, rng).v;
    if (lead) {
      const lv = bestMove(v, r.board, moved(lead), 0, rng).v;
      if (lv >= 100) val -= 40;
      else val -= Math.max(0, lv + 30) * 0.3;
    }
    if (val > bv) {
      bv = val;
      best = a;
    }
  }
  return best;
}
