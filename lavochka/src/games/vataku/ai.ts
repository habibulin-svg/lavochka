/* «В атаку!» — боты. Видят свой view: чужие мины скрыты.
 * Лёгкий — случайный ход, охотно бьёт. Средний — оценка хода: кого побил, под чей удар встал (карта ударов соперника),
 * пехота — к чужой рамке (нужно трое пехотинцев в шести клетках), остальные — на перехват тех, кто рвётся к нашей.
 * Сложный — то же, но карту ударов пересчитывает после своего хода и бережёт фигуры, которых некому прикрыть. */
import type { Rng } from '../../core/types';
import { apply, col, FRAME, half, legal, moves, N, RIVER, row, type Action, type Kind, type State } from './engine';

const V: Record<Kind, number> = { rocket: 3, plane: 5, tank: 5, gun: 4, inf: 4 };

const dist = (a: number, b: number) => Math.abs(col(a) - col(b)) + Math.abs(row(a) - row(b));
const toFrame = (p: number, fr: number[]) => Math.min(...fr.map((q) => dist(p, q)));

/** Клетки, которые сторона side может побить в свою серию (по одному ходу). */
function reach(s: State, side: number): Set<number> {
  const out = new Set<number>();
  for (let p = 0; p < N; p++) {
    const c = s.cells[p];
    if (!c || c.side !== side) continue;
    for (const q of moves(s, p).keys()) out.add(q);
    if (c.kind === 'gun') {
      // пушка бьёт по прямой до трёх — в том числе пустые сейчас клетки
      for (const d of [-20, 20, -1, 1]) {
        let q = p;
        for (let k = 1; k <= 3; k++) {
          q += d;
          if (q < 0 || q >= N || ((d === 1 || d === -1) && row(q) !== row(p))) break;
          out.add(q);
        }
      }
    }
  }
  return out;
}

function score(v: State, a: Action, me: number, foe: Set<number>, mine: Set<number>, deep: boolean): number {
  if (a.type !== 'move' && a.type !== 'shoot') return 0;
  const pc = v.cells[a.from]!;
  const t = v.cells[a.to];
  const op = 1 - me;
  const myFrame = FRAME[me];
  const theirFrame = FRAME[op];
  let s = 0;
  if (t) {
    s += V[t.kind];
    // кто у нашей рамки — опаснее всего
    s += Math.max(0, 8 - toFrame(a.to, myFrame)) * 0.8;
    if (pc.kind === 'rocket' && a.type === 'move') s -= V.rocket * 0.6;
  }
  if (a.type === 'shoot') return s + 0.5;
  const to = a.to;
  // мины соперника — неизвестны: каждая клетка его половины на пути немного опасна
  const path = moves(v, a.from).get(to) ?? [];
  const risky = path.slice(1).filter((q) => half(op, q) && !v.cells[q]).length;
  if (pc.kind !== 'rocket' && pc.kind !== 'plane') s -= risky * 0.06 * V[pc.kind];
  else if (half(op, to) && !t) s -= 0.06 * V[pc.kind];
  // угроза на новом месте
  if (foe.has(to)) s -= V[pc.kind] * (deep && mine.has(to) ? 0.3 : 0.55);
  if (foe.has(a.from)) s += V[pc.kind] * 0.5;
  // пехота — к чужой рамке, в рамку — особенно
  if (pc.kind === 'inf') s += (toFrame(a.from, theirFrame) - toFrame(to, theirFrame)) * 1.8 + (theirFrame.includes(to) ? 3 : 0) - (theirFrame.includes(a.from) ? 3 : 0);
  else if (theirFrame.includes(to)) s += 1.5;
  else if (theirFrame.includes(a.from)) s -= 1.5;
  else {
    // остальные — к фигурам соперника, особенно к тем, что ближе к нашей рамке
    let best = 99;
    let was = 99;
    for (let q = 0; q < N; q++) {
      const c = v.cells[q];
      if (!c || c.side !== op) continue;
      const w = toFrame(q, myFrame) * 0.5;
      best = Math.min(best, dist(to, q) + w);
      was = Math.min(was, dist(a.from, q) + w);
    }
    s += (was - best) * 0.7;
  }
  if (RIVER.has(to)) s -= 0.3;
  return s;
}

export function choose(v: State, seat: number, level: number, rng: Rng): Action | null {
  if (v.phase === 'deploy') {
    if (v.ready[seat]) return null;
    if (level > 0 && !v.laid[seat]) return { type: 'auto' };
    return { type: 'ready' };
  }
  if (v.phase !== 'play' || v.side !== seat) return null;
  const acts = legal(v, seat);
  if (!acts.length) return null;
  if (level === 0) {
    const hits = acts.filter((a) => a.type === 'shoot' || (a.type === 'move' && v.cells[a.to]));
    if (hits.length && rng.next() < 0.6) return hits[rng.int(hits.length)];
    return acts[rng.int(acts.length)];
  }
  const foe = reach(v, 1 - seat);
  const mine = reach(v, seat);
  const ranked = acts.map((a) => ({ a, sc: score(v, a, seat, foe, mine, level > 1) + rng.next() * (level === 1 ? 0.8 : 0.2) })).sort((x, y) => y.sc - x.sc);
  if (level === 1) return ranked[0].a;
  // сложный: для лучших ходов пересчитать удары соперника после хода — не подставить ли кого-то ещё
  let best = ranked[0];
  let bv = -Infinity;
  const noop: Rng = { next: () => 0.5, int: () => 0, getState: () => 0 };
  for (const c of ranked.slice(0, 8)) {
    const r = apply(v, seat, c.a, noop);
    if (!r) continue;
    const s2 = r.state;
    if (s2.phase === 'over') return c.a;
    const foe2 = reach(s2, 1 - seat);
    const mine2 = reach(s2, seat);
    let exposed = 0;
    for (let p = 0; p < N; p++) {
      const pc = s2.cells[p];
      if (pc && pc.side === seat && foe2.has(p)) exposed = Math.max(exposed, V[pc.kind] * (mine2.has(p) ? 0.5 : 1));
    }
    const val = c.sc - exposed * 0.5;
    if (val > bv) {
      bv = val;
      best = c;
    }
  }
  return best.a;
}
