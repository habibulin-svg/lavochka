/* Бот «Звезды Африки»: идёт по кратчайшей дороге к ближайшему закрытому жетону, а с алмазом — к Танжеру или Каиру.
 * Видит только своё view: что лежит под закрытыми жетонами, ему неизвестно. */
import type { Rng } from '../../core/types';
import { AIR, CELLS, FINISH, NEIGH, TOKEN_AT, type Action, type State } from './engine';

/** Кратчайший путь по числу переходов: расстояния и «откуда пришли» (граф небольшой — считаем по надобности). */
interface Paths {
  dist: number[];
  from: number[];
}
const cache = new Map<number, Paths>();

function paths(goal: number): Paths {
  const hit = cache.get(goal);
  if (hit) return hit;
  const dist = CELLS.map(() => -1);
  const from = CELLS.map(() => -1);
  const q = [goal];
  dist[goal] = 0;
  for (let i = 0; i < q.length; i++) {
    for (const n of NEIGH[q[i]]) {
      if (dist[n] < 0) {
        dist[n] = dist[q[i]] + 1;
        from[n] = q[i];
        q.push(n);
      }
    }
  }
  const p = { dist, from };
  cache.set(goal, p);
  return p;
}

/** Ближайшая цель: финиш (если алмаз у нас) или закрытый жетон. */
function goalFor(v: State, seat: number, cell: number): number {
  const goals = v.diamond === seat ? FINISH.slice() : CELLS.map((_, i) => i).filter((i) => TOKEN_AT[i] && !v.open[i]);
  let best = -1;
  let bestD = 999;
  for (const g of goals) {
    const d = paths(g).dist[cell];
    if (d >= 0 && d < bestD) {
      bestD = d;
      best = g;
    }
  }
  return best;
}

/** Первый шаг по кратчайшей дороге к цели: в поиске от цели «откуда пришли» и есть дорога назад. */
function stepTo(goal: number, cell: number): number {
  const { from, dist } = paths(goal);
  if (dist[cell] <= 0) return -1; // уже на месте (или цель недостижима)
  return from[cell] >= 0 ? from[cell] : -1;
}

export function choose(v: State, seat: number, level: number, rng: Rng): Action | null {
  if (v.winner != null) return null;
  if (v.phase === 'roll') {
    // сложный бот может срезать путь самолётом
    if (level > 1) {
      const fly = wantAir(v, seat);
      if (fly != null) return { type: 'air', to: fly };
    }
    // подкову тратим: лёгкий — на деньги, средний и сложный — на лишний бросок
    if (v.horses[seat] > 0 && level > 0) return { type: 'horse', use: level > 1 ? 'move' : 'money' };
    return { type: 'roll' };
  }
  if (v.phase !== 'step' || v.left <= 0) return { type: 'stop' };
  const here = v.pos[seat];
  const ns = NEIGH[here];
  if (!ns.length) return { type: 'stop' };
  if (level === 0) return { type: 'step', to: ns[rng.int(ns.length)] };
  const goal = goalFor(v, seat, here);
  if (goal < 0) return { type: 'stop' };
  const next = stepTo(goal, here);
  if (next < 0 || !ns.includes(next)) return { type: 'stop' };
  return { type: 'step', to: next };
}

/** Стоит ли лететь: сложный бот сравнивает путь по земле и по воздуху. */
export function wantAir(v: State, seat: number): number | null {
  if (v.phase !== 'roll' || v.money[seat] < 300) return null;
  const here = v.pos[seat];
  const here_goal = goalFor(v, seat, here);
  if (here_goal < 0) return null;
  const own = paths(here_goal).dist[here];
  let best: number | null = null;
  let bestD = own;
  for (const to of AIR[here]) {
    if (to === here_goal) return to; // перелёт прямо в цель
    const d = paths(here_goal).dist[to] + 1;
    if (d < bestD) {
      bestD = d;
      best = to;
    }
  }
  return best;
}
