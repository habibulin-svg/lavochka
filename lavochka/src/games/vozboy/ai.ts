/* «Воздушный бой» — боты. Полная информация, поэтому бот видит то же поле.
 * Лёгкий — случайный полёт, сбивает, если подвернётся. Средний — оценка полёта: сбитый противник, свой самолёт под зениткой,
 * угроза на следующий ход соперника, бомбардировщики — к чужому штабу, истребители — на перехват.
 * Сложный — лучшие полёты среднего проверяет ответом соперника и гонкой к штабам («Игрушка», против среднего ~9:1);
 * в «Аэрофото» у соперника два полёта за ход, просмотр не помог — там сложный лишь точнее среднего (партии ~50:50). */
import type { Rng } from '../../core/types';
import { apply, cell, flights, fly, mapOf, seqsFor, toAct, type Flight, type Plane, type State } from './engine';

const V = { b: 10, f: 6 };

const dist = (w: number, a: number, b: number) => Math.abs((a % w) - (b % w)) + Math.abs(Math.floor(a / w) - Math.floor(b / w));

/** Путь бомбардировщика стороны side к чужому штабу в обход чужих зениток (их узлы закрыты): число шагов от каждого узла. */
const ROUTE = new Map<string, number[]>();
function route(ver: State['cfg']['ver'], side: number): number[] {
  const key = `${ver}${side}`;
  const got = ROUTE.get(key);
  if (got) return got;
  const m = mapOf(ver);
  const n = m.w * m.h;
  const blocked = new Set(m.sides[1 - side].guns.flatMap((g) => (ver === 'b' ? zone(g.c, g.r, 1 - side) : [[g.c, g.r]]).map(([c, r]) => cell(m, c, r))));
  const d = Array(n).fill(99);
  const hq = cell(m, ...m.sides[1 - side].hq);
  d[hq] = 0;
  const q = [hq];
  while (q.length) {
    const p = q.shift()!;
    const c = p % m.w;
    const r = Math.floor(p / m.w);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const cc = c + dc;
      const rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= m.w || rr >= m.h) continue;
      const nb = rr * m.w + cc;
      if (d[nb] <= d[p] + 1 || blocked.has(nb)) continue;
      d[nb] = d[p] + 1;
      q.push(nb);
    }
  }
  ROUTE.set(key, d);
  return d;
}
/** Зона зенитки версии Б (как видит хозяин: свой узел, слева, сверху, слева-сверху). */
function zone(c: number, r: number, owner: number): [number, number][] {
  const k = owner === 0 ? -1 : 1;
  return [[c, r], [c + k, r], [c, r + k], [c + k, r + k]];
}

/** Чем соперник может сбить самолёт, стоящий на p (после нашего хода, в состоянии s). */
function threat(s: State, target: Plane): number {
  const m = mapOf(s.cfg.ver);
  for (const e of s.planes) {
    if (e.side === target.side || dist(m.w, e.p, target.p) > 3) continue;
    for (const q of seqsFor(s.cfg.ver, e)) {
      const f = fly(s, e, q);
      if (f && f.took && f.took.id === target.id && f.shot < 0) return V[target.kind];
    }
  }
  return 0;
}

function after(s: State, f: Flight): State {
  const seat = toAct(s)[0];
  return apply(s, seat, f.a)?.state ?? s;
}

function score(s: State, f: Flight, rng: Rng, noise: number): number {
  const m = mapOf(s.cfg.ver);
  const pl = s.planes.find((x) => x.id === f.a.id)!;
  let v = 0;
  if (f.hq && f.shot < 0) return 10000;
  if (f.shot >= 0) v -= V[pl.kind] * 1.2;
  if (f.took) {
    v += V[f.took.kind] + 0.5;
    // бомбардировщик у нашего штаба — опаснее всего
    if (f.took.kind === 'b') v += 30 / (1 + route(s.cfg.ver, f.took.side)[f.took.p]);
  }
  const s2 = after(s, f);
  if (s2.over) return s2.winner === pl.side ? 9000 : -9000;
  if (f.shot < 0) {
    const me = s2.planes.find((x) => x.id === pl.id);
    if (me) {
      const was = threat(s, pl);
      const now = threat({ ...s2, side: 1 - pl.side }, me);
      v += was * 0.8 - now * 0.9;
      const rt = route(s.cfg.ver, pl.side);
      if (pl.kind === 'b') v += (Math.min(rt[pl.p], 60) - Math.min(rt[me.p], 60)) * 1.2;
      else {
        // перехват: к вражеским бомбардировщикам, тем раньше, чем ближе они к нашему штабу
        const prey = s.planes.filter((x) => x.side !== pl.side);
        const rt2 = route(s.cfg.ver, 1 - pl.side);
        const near = (p: number) => Math.min(99, ...prey.map((x) => dist(m.w, p, x.p) + (x.kind === 'b' ? -2 + Math.min(rt2[x.p], 30) / 3 : 4)));
        v += (near(pl.p) - near(me.p)) * 0.4;
      }
      if (!pl.up && me.p !== pl.p) v += 0.3;
    }
  }
  return v + (rng.next() - 0.5) * noise;
}

export function choose(v: State, seat: number, level: number, rng: Rng): Flight['a'] | null {
  const fs = flights(v, seat);
  if (!fs.length) return null;
  if (level === 0) {
    const hits = fs.filter((f) => (f.took || f.hq) && f.shot < 0);
    if (hits.length && rng.next() < 0.7) return hits[rng.int(hits.length)].a;
    const safe = fs.filter((f) => f.shot < 0);
    const pool = safe.length ? safe : fs;
    return pool[rng.int(pool.length)].a;
  }
  const noise = level === 1 ? 1.5 : 0.3;
  const ranked = fs.map((f) => ({ f, sc: score(v, f, rng, noise) })).sort((a, b) => b.sc - a.sc);
  if (level === 1 || ranked[0].sc >= 9000) return ranked[0].f.a;
  const me = v.side;
  // «Аэрофото»: у соперника два полёта за ход — просмотр ответа там не помогает (проверено партиями), сложный — точная оценка
  if (v.cfg.ver === 'b') return ranked[0].f.a;
  // сложный: соперник отвечает лучшим полётом (по оценке среднего), после ответа — кто ближе к чужому штабу
  let best = ranked[0];
  let bv = -Infinity;
  for (const c of ranked.slice(0, 10)) {
    let s2 = after(v, c.f);
    let val = c.sc;
    // «Аэрофото»: второй полёт того же хода — лучший по быстрой оценке
    if (!s2.over && s2.side === me) {
      const own = flights(s2, toAct(s2)[0]);
      let ob: Flight | null = null;
      let os = -Infinity;
      for (const e of own) {
        const sc = quick(s2, e);
        if (sc > os) {
          os = sc;
          ob = e;
        }
      }
      if (ob) {
        val += Math.min(os, 60) * 0.5;
        s2 = after(s2, ob);
      }
    }
    if (!s2.over && s2.side !== me) {
      const opp = toAct(s2)[0];
      let rb: Flight | null = null;
      let rs = -Infinity;
      for (const e of flights(s2, opp)) {
        const sc = quick(s2, e);
        if (sc > rs) {
          rs = sc;
          rb = e;
        }
      }
      if (rb) {
        val -= Math.min(rs, 60) * 0.7;
        s2 = after(s2, rb);
      }
    }
    if (s2.over) val += s2.winner === me ? 5000 : -5000;
    else val += race(s2, me) * 1.5;
    if (val > bv) {
      bv = val;
      best = c;
    }
  }
  return best.f.a;
}

/** Быстрая оценка ответа соперника: удар по штабу, сбитый, потеря под зениткой, продвижение бомбардировщика. */
function quick(s: State, f: Flight): number {
  const pl = s.planes.find((x) => x.id === f.a.id)!;
  if (f.hq && f.shot < 0) return 5000;
  let v = 0;
  if (f.shot >= 0) v -= V[pl.kind] * 1.2;
  if (f.took) v += V[f.took.kind] + (f.took.kind === 'b' ? 30 / (1 + route(s.cfg.ver, f.took.side)[f.took.p]) : 0);
  if (pl.kind === 'b' && f.shot < 0) {
    const rt = route(s.cfg.ver, pl.side);
    v += (Math.min(rt[pl.p], 60) - Math.min(rt[f.end], 60)) * 1.2;
  }
  return v;
}

/** Гонка к штабам: насколько наш ближайший бомбардировщик ближе к цели, чем ближайший у соперника. */
function race(s: State, me: number): number {
  const near = (side: number) => {
    const rt = route(s.cfg.ver, side);
    return Math.min(40, ...s.planes.filter((x) => x.side === side && x.kind === 'b').map((x) => rt[x.p]));
  };
  return near(1 - me) - near(me);
}
