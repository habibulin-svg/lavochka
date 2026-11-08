/* Боты дартса. Видят то же, что человек (всё открыто). Выбирают поле по игре — на «501» правильные закрытия (таблица
 * «чекаутов»: сначала наименьшее число дротиков, удобные удвоения D20/D16/D8…), на крикете — что закрыть или чем набрать, —
 * целятся в середину поля, а рука дрожит: разброс прицела и силы зависит от уровня. */
import type { Rng } from '../../core/types';
import { aimFor, ALL, isDouble, value, type Hit } from './board';
import { CRICKET, type Action, type State } from './engine';
import { V0 } from './physics';

/** Разброс руки по уровню: прицел (м, одно отклонение по каждой оси), сила (м/с). */
export const SHAKE = [
  { aim: 0.027, v: 0.13 },
  { aim: 0.017, v: 0.08 },
  { aim: 0.0105, v: 0.04 },
];

const gauss = (rng: Rng) => {
  let u = 0;
  for (let k = 0; k < 6; k++) u += rng.next();
  return (u - 3) * Math.SQRT2;
};

/** Удобные удвоения для закрытия — в порядке предпочтения. */
const FAV = [20, 16, 18, 10, 8, 12, 14, 6, 4, 2, 19, 17, 15, 13, 11, 9, 7, 5, 3, 1];

/** «Цена» дротика в маршруте: одиночное проще утроения, бык — трудно. */
function cost(h: Hit, last: boolean): number {
  if (last && isDouble(h)) return h.n === 25 ? 6 : 1 + FAV.indexOf(h.n) * 0.05;
  if (h.n === 25) return h.m === 2 ? 6 : 4;
  return h.m === 1 ? 1 : h.m === 3 ? 2.5 : 3.2;
}

type Route = { hits: Hit[]; cost: number } | null;
const routes = new Map<string, Route>();

/** Лучший маршрут закрытия остатка rem не больше чем за darts дротиков (dout — последним удвоением). */
export function checkout(rem: number, darts: number, dout: boolean): Route {
  if (rem <= 0 || darts <= 0) return null;
  const key = `${rem}/${darts}/${dout ? 1 : 0}`;
  if (routes.has(key)) return routes.get(key)!;
  let best: Route = null;
  // одним дротиком
  for (const h of ALL) {
    if (value(h) !== rem || (dout && !isDouble(h))) continue;
    const c = cost(h, true);
    if (!best || c < best.cost) best = { hits: [h], cost: c };
  }
  if (!best && darts > 1) {
    for (const h of ALL) {
      const left = rem - value(h);
      if (left < (dout ? 2 : 1)) continue;
      const r = checkout(left, darts - 1, dout);
      if (!r || r.hits.length + 1 > darts) continue;
      const c = cost(h, false) + r.cost + r.hits.length * 2;
      if (!best || best.hits.length > r.hits.length + 1 || (best.hits.length === r.hits.length + 1 && c < best.cost)) best = { hits: [h, ...r.hits], cost: c };
    }
  }
  routes.set(key, best);
  return best;
}

/** Куда бить на x01. */
export function x01Target(rem: number, dartsLeft: number, dout: boolean, opened: boolean, level: number): Hit {
  if (!opened) return { n: 20, m: 2 };
  const r = checkout(rem, dartsLeft, dout);
  if (r) return r.hits[0];
  const big = level === 0 ? { n: 20, m: 1 } : { n: 20, m: 3 };
  if (rem - value(big) >= 62) return big;
  // подготовка: оставить себе удобное закрытие и не перебрать
  let best: Hit = { n: 20, m: 1 };
  let bs = -Infinity;
  for (const h of ALL) {
    const left = rem - value(h);
    if (left < 2 || (h.n === 25 && level < 2)) continue;
    const one = checkout(left, 1, dout);
    const two = checkout(left, 2, dout);
    const fav = one ? 40 - FAV.indexOf(one.hits[0].n) : two ? 12 : 0;
    // промах соседом по сектору тоже не должен перебрать
    const sc = fav + value(h) * 0.15 - cost(h, false) * (level === 0 ? 6 : 2);
    if (sc > bs) (bs = sc), (best = h);
  }
  return best;
}

function cricketTarget(s: State, i: number, level: number): Hit {
  const me = s.p[i];
  const others = s.p.filter((_, j) => j !== i);
  const cut = s.cfg.cut;
  const lead = others.length ? (cut ? me.score <= Math.min(...others.map((q) => q.score)) : me.score >= Math.max(...others.map((q) => q.score))) : true;
  let best = { n: 20, m: 3 };
  let bs = -Infinity;
  CRICKET.forEach((n, k) => {
    const openOpp = others.filter((q) => q.marks[k] < 3).length;
    let v: number;
    if (me.marks[k] < 3) v = n * (1 + (3 - me.marks[k]) * 0.1) + (openOpp ? 0 : 6) + (others.some((q) => q.marks[k] >= 3) ? 8 : 0);
    else v = openOpp ? n * (lead ? 0.6 : 1.4) : -1;
    if (n === 25) v *= level === 2 ? 0.75 : 0.45;
    if (v > bs) (bs = v), (best = { n, m: n === 25 ? (level === 2 ? 2 : 1) : level === 0 ? 1 : 3 });
  });
  return best;
}

export function target(s: State, i: number, level: number): Hit {
  const p = s.p[i];
  const c = s.cfg;
  if (c.mode === 'x01') return x01Target(p.score, 3 - s.dart, c.dout, p.opened, level);
  if (c.mode === 'clock') {
    if (p.target === 25) return { n: 25, m: level === 2 ? 2 : 1 };
    return { n: p.target, m: c.skip && level === 2 ? 3 : 1 };
  }
  if (c.mode === 'cricket') return cricketTarget(s, i, level);
  if (c.mode === 'shanghai') {
    const got = new Set(s.hits.filter((h) => h.n === s.round).map((h) => h.m));
    const want = level === 0 ? [1, 3, 2] : [3, 1, 2];
    const m = want.find((x) => !got.has(x)) ?? 3;
    return { n: s.round, m };
  }
  // убийца
  if (!p.killer) return { n: p.num, m: 2 };
  let vi = -1;
  s.p.forEach((q, j) => {
    if (j === i || q.out) return;
    if (vi < 0 || q.lives > s.p[vi].lives || (q.lives === s.p[vi].lives && q.killer && !s.p[vi].killer)) vi = j;
  });
  return { n: vi >= 0 ? s.p[vi].num : 20, m: 2 };
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  const i = s.seats.indexOf(seat);
  if (i < 0 || s.over || i !== s.cur) return null;
  const lv = Math.max(0, Math.min(2, level));
  const h = target(s, i, lv);
  const a = aimFor(h.n, h.m);
  const sh = SHAKE[lv];
  return { type: 'throw', x: a.x + gauss(rng) * sh.aim, y: a.y + gauss(rng) * sh.aim, v: V0 + gauss(rng) * sh.v, side: 0 };
}
