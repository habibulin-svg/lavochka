/* Боты морских игр. Видят только свой view (пираты не знают, где золото, пока галион не потоплен).
 * Лёгкий — идёт к ближайшей цели и стреляет, если есть по кому. Средний — чинится, укрепляет порты, бьёт по золотому галиону.
 * Сложный — бьёт залпом, обходит опасные клетки, выбирает колонии по цене и расстоянию. */
import type { Rng } from '../../core/types';
import { cheb, charAt, inside, portAt, type SeaMap } from './maps';
import {
  canRepairAt,
  colonies,
  mapOf,
  portStrength,
  range,
  reach,
  seatNow,
  shipsOf,
  sinkAt,
  targetsOf,
  harbored,
  busy,
  type Action,
  type Ship,
  type State,
  type Target,
  type XY,
} from './engine';
import { POINT_STEP, POINTS } from './wind';

export const LEVELS = ['Лёгкий', 'Средний', 'Сложный'];

/** Расстояние по воде от целей (8 соседей); цели могут быть портами или сушей — из них можно выйти. */
function bfs(m: SeaMap, goals: XY[]): Int16Array {
  const d = new Int16Array(m.w * m.h).fill(-1);
  const q: number[] = [];
  for (const g of goals) {
    if (!inside(m, g.x, g.y)) continue;
    const k = g.y * m.w + g.x;
    if (d[k] < 0) {
      d[k] = 0;
      q.push(k);
    }
  }
  for (let h = 0; h < q.length; h++) {
    const k = q[h];
    const x = k % m.w;
    const y = (k / m.w) | 0;
    for (const p of POINTS) {
      const nx = x + POINT_STEP[p][0];
      const ny = y + POINT_STEP[p][1];
      if (!inside(m, nx, ny)) continue;
      const c = charAt(m, nx, ny);
      const nk = ny * m.w + nx;
      if (d[nk] >= 0 || (c !== '.' && c !== 'H')) continue;
      d[nk] = d[k] + 1;
      q.push(nk);
    }
  }
  return d;
}

const cache = new Map<string, Int16Array>();
function field(m: SeaMap, key: string, goals: () => XY[]) {
  const k = m.id + ':' + key;
  let f = cache.get(k);
  if (!f) {
    f = bfs(m, goals());
    cache.set(k, f);
  }
  return f;
}

/** Расстояние до цели; из порта (он не в поле) — через соседнюю воду. */
function at(m: SeaMap, f: Int16Array, p: XY): number {
  const v = f[p.y * m.w + p.x];
  if (v >= 0) return v;
  let best = 999;
  for (const q of POINTS) {
    const x = p.x + POINT_STEP[q][0];
    const y = p.y + POINT_STEP[q][1];
    if (inside(m, x, y) && f[y * m.w + x] >= 0) best = Math.min(best, f[y * m.w + x] + 1);
  }
  return best;
}

interface Goal {
  f: Int16Array;
  /** Достаточно подойти на столько клеток (стрелять по цели). */
  near?: XY;
  r?: number;
}

/** Куда идти кораблю: лучшая клетка из досягаемых или null — лучше стоять. */
function bestMove(s: State, sh: Ship, g: Goal, level: number, danger: (p: XY) => number): Action | null {
  const m = mapOf(s);
  const score = (p: XY) => {
    // из порта и из квадратика старта не стреляют — там «подошёл на выстрел» не считается
    const safe = !!portAt(m, p.x, p.y) || charAt(m, p.x, p.y) === 'H';
    let v = g.near && g.r !== undefined && cheb(p, g.near) <= g.r && !safe ? 0 : at(m, g.f, p) + (safe && g.near ? 1 : 0);
    if (level >= 1) v += danger(p);
    return v;
  };
  const here = score(sh);
  let best: { a: Action; v: number } | null = null;
  for (const r of reach(s, sh)) {
    const v = score(r.to) - r.steps * 0.01;
    if (!best || v < best.v) best = { a: { type: 'move', ship: sh.id, course: r.course, steps: r.steps }, v };
  }
  return best && best.v < here - 0.001 ? best.a : null;
}

function shootAction(s: State, seat: number, level: number, pick: (ts: Target[], sh: Ship) => Target | null): Action | null {
  for (const sh of shipsOf(s, seat)) {
    const ts = targetsOf(s, sh);
    if (!ts.length) continue;
    const t = pick(ts, sh);
    if (!t) continue;
    // залп: все свои корабли, которые достают до той же цели
    const ships =
      level >= 2
        ? shipsOf(s, seat)
            .filter((x) => targetsOf(s, x).some((y) => JSON.stringify(y) === JSON.stringify(t)))
            .map((x) => x.id)
        : [sh.id];
    return { type: 'shoot', ships, target: t };
  }
  return null;
}

/* ---------------- «Пираты» ---------------- */

function piraty(s: State, seat: number, level: number, rng: Rng): Action {
  const m = mapOf(s);
  const side = s.side[seat];
  const gold = s.ships.find((x) => x.gold && !x.sunk);
  const enemies = s.ships.filter((x) => !x.sunk && !x.derelict && x.side !== side && !harbored(s, x));
  const danger = (p: XY) => (side === 'es' ? enemies.filter((e) => cheb(e, p) <= 2).length * 2 : 0);

  // починка
  for (const sh of shipsOf(s, seat))
    if (!busy(sh) && canRepairAt(s, sh) && (level >= 1 || sh.hits >= sinkAt(sh) - 1) && !(sh.gold && sh.side === 'es' && sh.hits < 2)) return { type: 'repair', ship: sh.id };

  const pickTarget = (ts: Target[]): Target | null => {
    const ships = ts.filter((t): t is { ship: number } => 'ship' in t).map((t) => s.ships[t.ship]);
    if (!ships.length) return null;
    const g = ships.find((x) => x.gold);
    if (g && level >= 1) return { ship: g.id };
    ships.sort((a, b) => b.hits - a.hits || a.id - b.id);
    return { ship: ships[0].id };
  };
  const shot = shootAction(s, seat, level, pickTarget);
  if (shot) return shot;

  const myBases = m.ports.filter((p) => p.kind === side);
  const cadiz = m.ports.find((p) => p.name === 'Кадикс')!;
  const galleons = s.ships.filter((x) => !x.sunk && x.side === 'es');
  for (const sh of shipsOf(s, seat)) {
    if (sh.moved || busy(sh)) continue;
    let goal: Goal;
    if (sh.gold && sh.side === 'es') goal = { f: field(m, 'cadiz', () => [cadiz]) };
    else if (sh.gold && sh.side === 'pi') goal = { f: field(m, 'pibases', () => myBases) };
    else if (level >= 1 && sh.hits >= sinkAt(sh) - 1) goal = { f: field(m, 'ports-' + side, () => myBases) };
    else if (gold?.derelict) goal = { f: bfs(m, [gold]), near: gold, r: 1 };
    else if (side === 'es') {
      // охрана: если золото у пиратов — отбивать, иначе держаться у золотого галиона или идти в Кадикс
      if (gold && gold.side === 'pi') goal = { f: bfs(m, [gold]), near: gold, r: range(sh) };
      else if (gold && level >= 1) {
        const threat = enemies.filter((e) => cheb(e, gold) <= 5).sort((a, b) => cheb(a, gold) - cheb(b, gold))[0];
        goal = threat ? { f: bfs(m, [threat]), near: threat, r: range(sh) } : { f: field(m, 'cadiz', () => [cadiz]), near: gold, r: 1 };
      } else goal = { f: field(m, 'cadiz', () => [cadiz]) };
    } else {
      // пират: если золото известно — за ним; иначе каждый преследует свой галион
      let t = gold && gold.side === 'es' ? gold : null;
      if (!t && galleons.length) {
        const own = shipsOf(s, seat);
        t = level >= 1 ? galleons[own.indexOf(sh) % galleons.length] : galleons.slice().sort((a, b) => cheb(a, sh) - cheb(b, sh))[0];
      }
      if (!t) continue;
      goal = { f: bfs(m, [t]), near: t, r: range(sh) };
    }
    const mv = bestMove(s, sh, goal, level, danger);
    if (mv) return mv;
  }
  if (level === 0 && rng.next() < 0.02) return { type: 'end' };
  return shootAction(s, seat, level, pickTarget) ?? { type: 'end' };
}

/* ---------------- «Захват колоний» ---------------- */

function kolonii(s: State, seat: number, level: number): Action {
  const m = mapOf(s);
  const mine = shipsOf(s, seat);
  const hasCol = colonies(s, seat) > 0;

  for (const sh of mine) {
    const p = portAt(m, sh.x, sh.y);
    if (!busy(sh) && canRepairAt(s, sh) && (level >= 1 || sh.hits >= 2)) return { type: 'repair', ship: sh.id };
    if (p && s.ports[p.id].owner === seat && level >= 1 && sh.ammo > 0 && (p.value ?? 0) >= (level >= 2 ? 3 : 1)) return { type: 'unload', ship: sh.id };
  }
  // свои порты бьют по чужим кораблям
  for (let i = 0; i < m.ports.length; i++) {
    const ps = s.ports[i];
    if (ps.owner !== seat || ps.down || ps.fired) continue;
    const t = s.ships.find((x) => !x.sunk && x.owner !== seat && !harbored(s, x) && cheb(x, m.ports[i]) <= 2);
    if (t) return { type: 'portShot', port: i, ship: t.id };
  }

  // какой порт брать: цена против расстояния
  const worth = (i: number, from: XY) => {
    const p = m.ports[i];
    const ps = s.ports[i];
    if (ps.owner === seat) return -1;
    if (ps.owner !== null && !ps.down && (!hasCol || level === 0)) return -1;
    const d = at(m, field(m, 'port' + i, () => [p]), from);
    if (d >= 999) return -1;
    const cost = ps.down ? 0 : portStrength(s, i) - ps.dmg;
    if (level === 0) return 100 - d;
    return ((p.value ?? 1) + (ps.down ? 4 : 0)) / (d + 3 + cost * (level >= 2 ? 2 : 1));
  };
  const goalFor = (sh: Ship): Goal | null => {
    if (level >= 1 && sh.hits >= 2) {
      const own = m.ports.filter((p) => s.ports[p.id].owner === seat);
      if (own.length) return { f: bfs(m, own) };
    }
    let best = -1;
    let bi = -1;
    for (let i = 0; i < m.ports.length; i++) {
      const w = worth(i, sh);
      if (w > best) {
        best = w;
        bi = i;
      }
    }
    if (bi < 0) return null;
    const p = m.ports[bi];
    const f = field(m, 'port' + bi, () => [p]);
    return s.ports[bi].down ? { f } : { f, near: p, r: 2 };
  };

  const pick = (ts: Target[]): Target | null => {
    const ports = ts.filter((t): t is { port: number } => 'port' in t);
    if (ports.length) {
      ports.sort((a, b) => (m.ports[b.port].value ?? 0) - (m.ports[a.port].value ?? 0));
      return ports[0];
    }
    const ships = ts.filter((t): t is { ship: number } => 'ship' in t);
    if (ships.length && level >= 1) return ships[0];
    return null;
  };
  const shot = shootAction(s, seat, level, pick);
  if (shot) return shot;

  const enemies = s.ships.filter((x) => !x.sunk && x.owner !== seat && !harbored(s, x));
  const danger = (p: XY) => (level >= 2 ? enemies.filter((e) => cheb(e, p) <= 2).length : 0);
  for (const sh of mine) {
    if (sh.moved || busy(sh)) continue;
    const g = goalFor(sh);
    if (!g) continue;
    const mv = bestMove(s, sh, g, level, danger);
    if (mv) return mv;
  }
  return { type: 'end' };
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.result) return null;
  if (s.phase === 'gold') {
    const g = s.ships.filter((x) => x.side === 'es');
    return { type: 'gold', ship: g[rng.int(g.length)].id };
  }
  if (seatNow(s) !== seat) return null;
  if (s.phase === 'spin') return { type: 'spin' };
  return s.game === 'piraty' ? piraty(s, seat, level, rng) : kolonii(s, seat, level);
}
