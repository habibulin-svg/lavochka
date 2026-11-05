/* Генератор случайных карт (DESIGN.md §7). Всё — от сида, без DOM и без Math.random: тот же код на сервере и в тестах.
 * Порядок: шаблон → силовая укладка зон → взвешенный Вороной с шумом → местность, озёра, берега → города → реки → проходы и дороги (A* с поворотами)
 * → стены по границам зон → объекты и охрана по бюджету зоны → препятствия из шума, горы и деревья → починка проходимости вырезанием → герои.
 * Честность для PvP: каждая вещь считается для одной доли карты и поворачивается на остальных игроков (180° для двоих, 90° для четверых). */
import { Rng, fnv1a } from '../../../gops/sim/rng';
import { CREATURES, type Faction, factionCreatures } from '../creatures';
import { type HeroPick, factionClasses } from '../heroes';
import { SPELL_LEVEL } from '../spells';
import { FACTION_RES, MOUNT_H, MOUNT_W, NATIVE, OBJECTS, type Purse, ROAD_COST, type ResId, TERRAINS, TERRAIN_INDEX, type TerrainId, TOWN_H, TOWN_W, WATER } from './data';
import { type Army, artList } from './hero';
import { type EdgeT, type MapTemplate, type SizeId, TEMPLATES, type ZoneT } from './templates';
import { DECOR_SIZE, type GameSpec, TOWN_NAMES, decorArts, noise } from './testmap';
import { type Decor, type MapObject, type Player, type World, cellOf, emptyArmy, makeHero, makeTown, placeObject, reveal, startArmy, tavernOffer } from './world';

export { TEMPLATES, type SizeId };
export const MAP_SIZES: Record<SizeId, { n: number; name: string }> = { s: { n: 36, name: 'Малая' }, m: { n: 72, name: 'Средняя' }, l: { n: 108, name: 'Большая' } };
export type WaterId = 'none' | 'lakes' | 'much';
export const WATERS: Record<WaterId, string> = { none: 'Без воды', lakes: 'Озёра и реки', much: 'Много воды' };
export type GuardId = 'weak' | 'normal' | 'strong';
export const GUARDS: Record<GuardId, { name: string; k: number }> = { weak: { name: 'Слабая охрана', k: 0.6 }, normal: { name: 'Обычная охрана', k: 1 }, strong: { name: 'Сильная охрана', k: 1.6 } };

export interface GenOptions {
  template: string;
  size: SizeId;
  water: WaterId;
  guard: GuardId;
  seed: number;
}

/** Ход за день, по которому меряется честность (DESIGN.md §7.5): запас хода героя с армией средней скорости. */
export const DAY_MP = 1500;

/** Корень без Math.sqrt: Ньютон, только + − × ÷ — одинаково на всех машинах. */
export function root(v: number): number {
  if (v <= 0) return 0;
  let x = v > 1 ? v / 2 : 1;
  for (let i = 0; i < 40; i++) {
    const nx = (x + v / x) / 2;
    if (nx === x) break;
    x = nx;
  }
  return x;
}

/** Двоичная куча по первому числу. */
export class Heap {
  private a: [number, number][] = [];
  get size(): number {
    return this.a.length;
  }
  push(d: number, v: number): void {
    const a = this.a;
    a.push([d, v]);
    let i = a.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (a[up][0] <= a[i][0]) break;
      [a[up], a[i]] = [a[i], a[up]];
      i = up;
    }
  }
  pop(): [number, number] {
    const a = this.a;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const rr = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (rr < a.length && a[rr][0] < a[m][0]) m = rr;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

interface Zone {
  t: ZoneT;
  /** Доля игрока; −1 — общая. */
  sector: number;
  x: number;
  y: number;
  r: number;
  terrain: number;
  center: number;
  /** Та же зона в доле, повёрнутой на g: orbit[g]. */
  orbit: number[];
}

interface Link {
  a: number;
  b: number;
  e: EdgeT;
}

/** Нейтралы по местности: охрана «этой местности» (DESIGN.md §7.4). */
const NEUTRALS: Record<TerrainId, string[]> = {
  meadow: ['neutral-wolf', 'neutral-bandit', 'neutral-boar', 'neutral-bear', 'neutral-stonegiant'],
  swamp: ['neutral-bandit', 'neutral-leshak', 'neutral-kikimora', 'neutral-sirin', 'neutral-poloz'],
  ash: ['neutral-wolf', 'neutral-boar', 'neutral-salamander', 'neutral-stonegiant', 'neutral-poloz'],
  pine: ['neutral-wolf', 'neutral-leshak', 'neutral-bear', 'neutral-sirin', 'neutral-stonegiant'],
  rough: ['neutral-bandit', 'neutral-boar', 'neutral-salamander', 'neutral-sirin', 'neutral-stonegiant'],
  sand: ['neutral-bandit', 'neutral-wolf', 'neutral-kikimora', 'neutral-salamander', 'neutral-poloz'],
  water: ['neutral-kikimora', 'neutral-sirin'],
  underground: ['neutral-salamander', 'neutral-stonegiant'],
  coast: ['neutral-crab', 'neutral-raven', 'neutral-bandit', 'neutral-sirin', 'neutral-griffin'],
  snow: ['neutral-wolf', 'neutral-lynx', 'neutral-bear', 'neutral-raven', 'neutral-stonegiant'],
  saltflat: ['neutral-nomad', 'neutral-scorpion', 'neutral-salamander', 'neutral-griffin', 'neutral-poloz'],
  heath: ['neutral-raven', 'neutral-nomad', 'neutral-lynx', 'neutral-bear', 'neutral-griffin'],
};
const RANDOM_TERRAIN: [TerrainId, number][] = [['meadow', 3], ['swamp', 2], ['ash', 2], ['pine', 3], ['rough', 2], ['sand', 1]];
const RARE: ResId[] = ['amber', 'salt', 'stariron', 'resin'];
/** Прирост жилища нейтралов в неделю по ступени. */
const DWELL_GROWTH = [0, 12, 8, 6, 4, 3, 2, 1];

/** Таблица объектов для бюджета зоны: ценность в семках, вес выбора, где можно, сколько раз в зоне. */
interface Pick {
  kind: string;
  v: number;
  w: number;
  where: string;
  max?: number;
}
const TABLE: Pick[] = [
  { kind: 'res-semki', v: 800, w: 6, where: 'smtc', max: 4 },
  { kind: 'res-wood', v: 1000, w: 4, where: 'smtc', max: 3 },
  { kind: 'res-stone', v: 1000, w: 4, where: 'smtc', max: 3 },
  { kind: 'res-rare', v: 1500, w: 4, where: 'smtc', max: 3 },
  { kind: 'chest', v: 1500, w: 5, where: 'smtc', max: 4 },
  { kind: 'campfire', v: 1000, w: 3, where: 'smtc', max: 2 },
  { kind: 'art1', v: 3000, w: 3, where: 'smtc', max: 2 },
  { kind: 'art2', v: 6000, w: 2, where: 'mtc', max: 2 },
  { kind: 'art3', v: 10000, w: 1, where: 'tc', max: 1 },
  { kind: 'shrine1', v: 2000, w: 2, where: 'smt', max: 1 },
  { kind: 'shrine2', v: 4000, w: 2, where: 'mtc', max: 1 },
  { kind: 'shrine3', v: 7000, w: 1, where: 'tc', max: 1 },
  { kind: 'learnstone', v: 3000, w: 2, where: 'smtc', max: 1 },
  { kind: 'wisewell', v: 1500, w: 1, where: 'smt', max: 1 },
  { kind: 'luckfountain', v: 1500, w: 1, where: 'smt', max: 1 },
  { kind: 'gloryhill', v: 3000, w: 1, where: 'mtc', max: 1 },
  { kind: 'stables', v: 1500, w: 1, where: 'mt', max: 1 },
  { kind: 'tavern', v: 1000, w: 1, where: 'mc', max: 1 },
  { kind: 'tradepost', v: 2500, w: 1, where: 'mc', max: 1 },
  { kind: 'watchtower', v: 1000, w: 1, where: 'smt', max: 1 },
  { kind: 'windmill', v: 2500, w: 1, where: 'smt', max: 1 },
  { kind: 'watermill', v: 2500, w: 1, where: 'smt', max: 1 },
  { kind: 'mine-semki', v: 7000, w: 1, where: 'mt', max: 1 },
  { kind: 'mine-rare', v: 6000, w: 1, where: 'mtc', max: 1 },
  { kind: 'dwell', v: 5000, w: 2, where: 'mtc', max: 2 },
  { kind: 'prison', v: 8000, w: 1, where: 'tc', max: 1 },
  { kind: 'treasury', v: 12000, w: 1, where: 'mtc', max: 1 },
  { kind: 'seerhut', v: 3000, w: 1, where: 'm', max: 1 },
  { kind: 'obelisk', v: 1000, w: 1, where: 'mtc', max: 1 },
];
const KIND_LETTER: Record<string, string> = { start: 's', mid: 'm', treasure: 't', center: 'c', water: '' };
/** Сила охраны объектов по типу зоны (в долях ценности). */
const ZONE_GUARD: Record<string, number> = { start: 0.5, mid: 1, treasure: 1.4, center: 1.8, water: 1 };
/** Страж прохода: ценность армии по силе ребра. */
const EDGE_GUARD = [0, 3500, 9000, 22000];
/** Множитель ценности зон: насыщенность объектами. */
const DENSITY = 2.5;

export const templateFits = (t: MapTemplate, size: SizeId): boolean => t.sizes.includes(size);

/** Случайная карта. Игроков — столько, сколько в шаблоне. */
export function generateMap(spec: GameSpec, o: GenOptions): World {
  const t = TEMPLATES[o.template] ?? TEMPLATES.duel;
  const G = t.players;
  if (spec.players.length !== G) throw new Error(`Шаблон «${t.name}» — на ${G} игроков`);
  const S = MAP_SIZES[o.size]?.n ?? 72;
  const N = S * S;
  const seed = (o.seed ^ fnv1a(`gen:${t.id}:${o.size}:${o.water}:${o.guard}`)) >>> 0;
  const r = new Rng(seed);
  const guardK = GUARDS[o.guard]?.k ?? 1;
  const factions = spec.players.map((p) => p.faction);

  const w: World = {
    seed: o.seed, rng: r.u32(), w: S, h: S, levels: 1, terrain: Array<number>(N).fill(0), road: Array<number>(N).fill(0), block: Array<number>(N).fill(0), decor: [], objects: [], entries: {}, towns: [], heroes: [],
    players: spec.players.map((p, id): Player => ({
      id, name: p.name, faction: p.faction, res: { semki: 15000, wood: 20, stone: 20, amber: 8, salt: 8, stariron: 8, resin: 8 }, explored: Array<number>(N).fill(0), alive: true, townless: 0, keys: [], obelisks: [], scrap: {}, ...(p.bot ? { bot: p.bot } : {}),
    })),
    day: 0, current: 0, pending: null, nextObj: 1, nextHero: 1, shard: -1, shardHint: [0, 0], winner: -1, over: false, weekNote: '',
    name: `${t.name}, ${MAP_SIZES[o.size].name.toLowerCase()}`,
  };

  // ---------------------------------------------------------------- симметрия
  const X = (c: number): number => c % S;
  const Y = (c: number): number => Math.trunc(c / S);
  const at = (x: number, y: number): number => x + y * S;
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < S && y < S;
  const rot1 = G === 2 ? (c: number): number => at(S - 1 - X(c), S - 1 - Y(c)) : (c: number): number => at(S - 1 - Y(c), X(c));
  const rot = (c: number, g: number): number => {
    let v = c;
    for (let i = 0; i < g; i++) v = rot1(v);
    return v;
  };
  const rotP = (x: number, y: number, g: number): [number, number] => {
    let a = x;
    let b = y;
    for (let i = 0; i < g; i++) [a, b] = G === 2 ? [1 - a, 1 - b] : [1 - b, a];
    return [a, b];
  };
  const canon = new Int32Array(N);
  for (let c = 0; c < N; c++) {
    let best = c;
    for (let g = 1; g < G; g++) best = Math.min(best, rot(c, g));
    canon[c] = best;
  }
  /** Все копии клетки: [g] — в доле, повёрнутой на g. */
  const copies = (c: number): number[] => Array.from({ length: G }, (_, g) => rot(c, g));
  const N8: [number, number][] = [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]];
  const N4: [number, number][] = [[1, 0], [0, -1], [-1, 0], [0, 1]];
  const around = (c: number, dirs = N8): number[] => {
    const out: number[] = [];
    const x = X(c);
    const y = Y(c);
    for (const [dx, dy] of dirs) if (inside(x + dx, y + dy)) out.push(at(x + dx, y + dy));
    return out;
  };
  const cheb = (a: number, b: number): number => Math.max(Math.abs(X(a) - X(b)), Math.abs(Y(a) - Y(b)));

  // ---------------------------------------------------------------- зоны и укладка
  const zones: Zone[] = [];
  const zoneIdx: Record<string, number[]> = {};
  for (const zt of t.zones) {
    zoneIdx[zt.id] = [];
    for (let g = 0; g < (zt.shared ? 1 : G); g++) {
      zoneIdx[zt.id].push(zones.length);
      zones.push({ t: zt, sector: zt.shared ? -1 : g, x: 0.5, y: 0.5, r: 0, terrain: 0, center: -1, orbit: [] });
    }
  }
  const zid = (id: string, g: number): number => (zoneIdx[id].length === 1 ? zoneIdx[id][0] : zoneIdx[id][((g % G) + G) % G]);
  for (const z of zones) z.orbit = Array.from({ length: G }, (_, g) => (z.sector < 0 ? zones.indexOf(z) : zid(z.t.id, z.sector + g)));
  const total = zones.reduce((s, z) => s + z.t.size, 0);
  for (const z of zones) z.r = root(z.t.size / total / 3.14159);

  const links: Link[] = [];
  /** Представители рёбер: из доли 0; копии — повороты. */
  const reps: Link[] = [];
  for (const e of t.edges) {
    for (let g = 0; g < G; g++) {
      const l = { a: zid(e.a, g), b: zid(e.b, e.cross ? g + 1 : g), e };
      if (l.a === l.b || links.some((k) => (k.a === l.a && k.b === l.b) || (k.a === l.b && k.b === l.a))) continue;
      links.push(l);
      if (g === 0) reps.push(l);
    }
  }
  const linked = (i: number, j: number): boolean => links.some((l) => (l.a === i && l.b === j) || (l.a === j && l.b === i));

  // начальные места с дрожью, затем силовая укладка; общие зоны — посередине
  const place0 = zones.filter((z) => z.sector === 0);
  for (const z of place0) {
    z.x = z.t.at[0] + (r.f() - 0.5) * 0.06;
    z.y = z.t.at[1] + (r.f() - 0.5) * 0.06;
  }
  const spread = (): void => {
    for (const z of place0) {
      for (let g = 1; g < G; g++) {
        const c = zones[z.orbit[g]];
        [c.x, c.y] = rotP(z.x, z.y, g);
      }
    }
  };
  spread();
  for (let it = 0; it < 160; it++) {
    for (const z of place0) {
      const i = zones.indexOf(z);
      let fx = 0;
      let fy = 0;
      zones.forEach((o2, j) => {
        if (j === i) return;
        const dx = o2.x - z.x;
        const dy = o2.y - z.y;
        const d = root(dx * dx + dy * dy) + 1e-6;
        const want = (z.r + o2.r) * 0.95;
        let f = 0;
        if (linked(i, j) && d > want) f = (d - want) * 0.06;
        else if (d < want) f = -(want - d) * 0.1;
        fx += (dx / d) * f;
        fy += (dy / d) * f;
      });
      // к своему месту в шаблоне — слабая пружина, чтобы доля не уползала
      fx += (z.t.at[0] - z.x) * 0.02;
      fy += (z.t.at[1] - z.y) * 0.02;
      const lim = 0.015;
      z.x = Math.min(1 - z.r * 0.6, Math.max(z.r * 0.6, z.x + Math.max(-lim, Math.min(lim, fx))));
      z.y = Math.min(1 - z.r * 0.6, Math.max(z.r * 0.6, z.y + Math.max(-lim, Math.min(lim, fy))));
    }
    spread();
  }

  // взвешенный Вороной с шумом: клетка достаётся зоне с наименьшим (расстояние / радиус)²; шум — по канонической клетке
  const zoneOf = new Int32Array(N);
  const warpA = noise(r.u32(), S / 6);
  const warpB = noise(r.u32(), S / 6);
  const warpC = noise(r.u32(), S / 14);
  const warp = S * (t.islands ? 0.16 : 0.12);
  for (let c = 0; c < N; c++) {
    if (canon[c] !== c) continue;
    const x = X(c) + 0.5;
    const y = Y(c) + 0.5;
    const wx = x + (warpA(x, y) - 0.5 + (warpC(x, y) - 0.5) * 0.4) * warp;
    const wy = y + (warpB(x, y) - 0.5 + (warpC(y + 31, x + 17) - 0.5) * 0.4) * warp;
    let best = 0;
    let bs = Infinity;
    zones.forEach((z, i) => {
      const dx = wx - z.x * S;
      const dy = wy - z.y * S;
      const s = (dx * dx + dy * dy) / (z.r * z.r * S * S);
      if (s < bs) {
        bs = s;
        best = i;
      }
    });
    copies(c).forEach((k, g) => (zoneOf[k] = zones[best].orbit[g]));
  }

  // ---------------------------------------------------------------- местность
  const isSea = (c: number): boolean => zones[zoneOf[c]].t.terrain === 'water';
  for (const z of zones) {
    if (z.t.terrain === 'water') z.terrain = WATER;
    else if (z.t.terrain === 'owner' && z.sector >= 0) z.terrain = TERRAIN_INDEX[NATIVE[factions[z.sector]]];
  }
  for (const z of zones) {
    if (z.t.terrain !== 'random' || z.sector > 0) continue;
    const sum = RANDOM_TERRAIN.reduce((s, [, k]) => s + k, 0);
    let roll = r.below(sum);
    let pick: TerrainId = 'meadow';
    for (const [id, k] of RANDOM_TERRAIN) {
      if (roll < k) {
        pick = id;
        break;
      }
      roll -= k;
    }
    for (const i of z.orbit) zones[i].terrain = TERRAIN_INDEX[pick];
  }
  for (let c = 0; c < N; c++) w.terrain[c] = zones[zoneOf[c]].terrain;

  // глубина клетки в зоне: шаги до чужой зоны (8 соседей)
  const inner = new Int32Array(N).fill(-1);
  {
    const q: number[] = [];
    for (let c = 0; c < N; c++) {
      if (around(c).some((n) => zoneOf[n] !== zoneOf[c]) || X(c) === 0 || Y(c) === 0 || X(c) === S - 1 || Y(c) === S - 1) {
        inner[c] = 0;
        q.push(c);
      }
    }
    for (let i = 0; i < q.length; i++) {
      for (const n of around(q[i])) {
        if (inner[n] >= 0) continue;
        inner[n] = inner[q[i]] + 1;
        q.push(n);
      }
    }
  }
  // середина зоны: самая глубокая клетка, при равенстве — ближе к месту укладки
  for (const z of zones) {
    if (z.sector > 0) continue;
    const zi = zones.indexOf(z);
    let best = -1;
    let bs = -Infinity;
    for (let c = 0; c < N; c++) {
      if (zoneOf[c] !== zi) continue;
      const dx = X(c) + 0.5 - z.x * S;
      const dy = Y(c) + 0.5 - z.y * S;
      const s = Math.min(inner[c], 9) * 10 - root(dx * dx + dy * dy) * 0.5;
      if (s > bs) {
        bs = s;
        best = c;
      }
    }
    if (best < 0) best = at(Math.trunc(z.x * S), Math.trunc(z.y * S));
    z.center = best;
    for (let g = 1; g < G; g++) if (z.sector === 0) zones[z.orbit[g]].center = rot(best, g);
  }

  // озёра: по шуму, подальше от середины зоны
  const lake = noise(r.u32(), S / 7);
  const lake2 = noise(r.u32(), 4);
  const lakeThr = o.water === 'much' ? 0.66 : o.water === 'lakes' ? 0.75 : 9;
  for (let c = 0; c < N; c++) {
    if (canon[c] !== c || isSea(c)) continue;
    const z = zones[zoneOf[c]];
    if (cheb(c, z.center) <= (z.t.kind === 'start' ? 7 : 4)) continue;
    if (lake(X(c), Y(c)) * 0.8 + lake2(X(c), Y(c)) * 0.2 > lakeThr) for (const k of copies(c)) w.terrain[k] = WATER;
  }
  // берег: песок у моря, у озёр — местами
  const speck = noise(r.u32(), 3);
  for (let c = 0; c < N; c++) {
    if (canon[c] !== c || w.terrain[c] === WATER) continue;
    const ns = around(c);
    const sea = ns.some((n) => isSea(n));
    const wet = ns.some((n) => w.terrain[n] === WATER);
    if (sea || (wet && speck(X(c), Y(c)) > 0.45)) for (const k of copies(c)) w.terrain[k] = TERRAIN_INDEX.sand;
  }

  // ---------------------------------------------------------------- занятость
  /** 0 — свободно, 1 — держать открытым (дорога, проход), 2 — тело (город, объект, вход), 3 — поле вокруг объекта (лес можно, кроме входа), 4 — чисто вокруг города. */
  const res = new Uint8Array(N);
  /** Тело объекта или города: не проходимо, не вырубается. */
  const body = new Uint8Array(N);
  /** Вход: дальше не пройти (кроме стражи). */
  const stop = new Uint8Array(N);
  const anyCopy = (c: number, f: (k: number) => boolean): boolean => copies(c).some(f);

  // города: ворота — середина стартовой зоны
  const gates: number[] = Array<number>(G).fill(-1);
  const townOk = (gate: number): boolean => copies(gate).every((g) => {
    const gx = X(g);
    const gy = Y(g);
    for (let y = gy - TOWN_H - 1; y <= gy + 2; y++) {
      for (let x = gx - (TOWN_W >> 1) - 1; x <= gx + (TOWN_W >> 1) + 1; x++) {
        if (!inside(x, y)) return false;
        const c = at(x, y);
        if (zoneOf[c] !== zoneOf[g] || w.terrain[c] === WATER || res[c]) return false;
      }
    }
    return true;
  });
  for (const z of zones) {
    if (z.sector !== 0 || z.t.kind !== 'start') continue;
    let gate = -1;
    for (let rad = 0; rad <= 14 && gate < 0; rad++) {
      for (let dy = -rad; dy <= rad && gate < 0; dy++) {
        for (let dx = -rad; dx <= rad && gate < 0; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
          const x = X(z.center) + dx;
          const y = Y(z.center) + dy;
          if (inside(x, y) && townOk(at(x, y))) gate = at(x, y);
        }
      }
    }
    if (gate < 0) gate = z.center;
    z.center = gate;
    copies(gate).forEach((g, k) => {
      zones[z.orbit[k]].center = g;
      gates[zones[z.orbit[k]].sector] = g;
      const gx = X(g);
      const gy = Y(g);
      // за городом — ряд: туда уходит верх рисунка
      for (let y = gy - TOWN_H - 1; y <= gy + 2; y++) {
        for (let x = gx - (TOWN_W >> 1) - 1; x <= gx + (TOWN_W >> 1) + 1; x++) {
          if (!inside(x, y)) continue;
          const c = at(x, y);
          if (res[c] === 2) continue;
          const foot = y <= gy && y > gy - TOWN_H && Math.abs(x - gx) <= TOWN_W >> 1;
          if (w.terrain[c] === WATER) w.terrain[c] = TERRAIN_INDEX.sand;
          if (foot && c !== g) {
            res[c] = 2;
            body[c] = 1;
            w.block[c] = 1;
          } else if (c === g) {
            res[c] = 2;
            stop[c] = 1;
          } else res[c] = 4;
        }
      }
    });
  }

  // ---------------------------------------------------------------- реки: от высокого к низкому, по шуму высот
  const height = noise(r.u32(), S / 5);
  const river = new Uint8Array(N);
  if (o.water !== 'none' && !t.islands) {
    for (const z of zones) {
      if (z.sector > 0 || z.t.terrain === 'water' || z.t.kind === 'start') continue;
      if (r.f() > (o.water === 'much' ? 0.9 : 0.55)) continue;
      const zi = zones.indexOf(z);
      let src = -1;
      let hs = -1;
      for (let c = 0; c < N; c++) {
        if (zoneOf[c] !== zi || inner[c] < 3 || w.terrain[c] === WATER || anyCopy(c, (k) => res[k] > 0)) continue;
        if (z.sector < 0 && canon[c] !== c) continue;
        const v = height(X(c), Y(c));
        if (v > hs) {
          hs = v;
          src = c;
        }
      }
      if (src < 0) continue;
      const path: number[] = [src];
      const seen = new Set([src]);
      for (let step = 0; step < S * 0.6; step++) {
        const c = path[path.length - 1];
        if (around(c, N4).length < 4) break;
        let next = -1;
        let nv = Infinity;
        for (const n of around(c, N4)) {
          if (seen.has(n) || anyCopy(n, (k) => res[k] > 0)) continue;
          // спуск по высотам с примесью: реки не ходят по линейке
          const v = height(X(n), Y(n)) + speck(X(n) * 2, Y(n) * 2) * 0.04;
          if (v < nv) {
            nv = v;
            next = n;
          }
        }
        if (next < 0) break;
        path.push(next);
        seen.add(next);
        if (w.terrain[next] === WATER) break;
      }
      if (path.length < 6) continue;
      // копии реки не должны налезать друг на друга (в общей зоне)
      const all = path.flatMap((c) => copies(c));
      if (new Set(all).size !== all.length) continue;
      path.forEach((c, i) => {
        for (const k of copies(c)) {
          // броды: через каждые 9 клеток
          if (i % 9 === 4) {
            w.terrain[k] = TERRAIN_INDEX.sand;
            continue;
          }
          w.terrain[k] = WATER;
          river[k] = 1;
        }
      });
    }
  }
  const isLand = (c: number): boolean => w.terrain[c] !== WATER;

  // ---------------------------------------------------------------- проходы и дороги: A* со штрафом за поворот
  const roadType = new Uint8Array(N);
  const guards: { cell: number; value: number; terr: TerrainId }[] = [];
  const findPath = (from: number, to: number, za: number, zb: number): number[] => {
    const M = N * 8;
    const dist = new Float64Array(M).fill(Infinity);
    const prev = new Int32Array(M).fill(-1);
    const heap = new Heap();
    const tx = X(to);
    const ty = Y(to);
    const hcost = (c: number): number => {
      const dx = Math.abs(X(c) - tx);
      const dy = Math.abs(Y(c) - ty);
      return Math.max(dx, dy) * 10 + Math.min(dx, dy) * 4;
    };
    for (let d = 0; d < 8; d++) {
      dist[from * 8 + d] = 0;
      heap.push(hcost(from), from * 8 + d);
    }
    let end = -1;
    while (heap.size) {
      const [f, s] = heap.pop();
      const c = Math.trunc(s / 8);
      const dir = s % 8;
      if (f - hcost(c) > dist[s]) continue;
      if (c === to) {
        end = s;
        break;
      }
      const x = X(c);
      const y = Y(c);
      N8.forEach(([dx, dy], nd) => {
        if (!inside(x + dx, y + dy)) return;
        const n = at(x + dx, y + dy);
        // у концов пути смотрим только свою долю: повёрнутые города закрыли бы подход к воротам; разрыв у чужих ворот закроет починка
        const solid = (k: number): boolean => body[k] === 1 || stop[k] === 1;
        if (n !== to && (cheb(n, from) <= 2 || cheb(n, to) <= 2 ? solid(n) : anyCopy(n, solid))) return;
        if (isSea(n)) return;
        let k = dx && dy ? 14 : 10;
        k *= zoneOf[n] === za || zoneOf[n] === zb ? 1 : 6;
        if (!isLand(n)) k += 40;
        if (nd !== dir) k += 4;
        const ns = n * 8 + nd;
        const nd2 = dist[s] + k;
        if (nd2 < dist[ns]) {
          dist[ns] = nd2;
          prev[ns] = s;
          heap.push(nd2 + hcost(n), ns);
        }
      });
    }
    if (end < 0) return [];
    const out: number[] = [];
    for (let s = end; s >= 0; s = prev[s]) out.push(Math.trunc(s / 8));
    return out.reverse();
  };
  const border = (c: number): boolean => isLand(c) && around(c).some((n) => isLand(n) && zoneOf[n] !== zoneOf[c] && !isSea(n));
  for (const l of reps) {
    const za = zones[l.a];
    const zb = zones[l.b];
    if (za.t.terrain === 'water' || zb.t.terrain === 'water') continue;
    const path = findPath(za.center, zb.center, l.a, l.b);
    if (!path.length) continue;
    const kind = za.t.kind === 'start' || zb.t.kind === 'start' || za.t.kind === 'center' || zb.t.kind === 'center' ? 2 : 1;
    // страж — на первой клетке чужой зоны
    const cross = path.findIndex((c) => zoneOf[c] !== l.a);
    for (let g = 0; g < G; g++) {
      for (const c of path) {
        const k = rot(c, g);
        if (res[k] === 2) continue;
        res[k] = 1;
        if (!isLand(k)) {
          w.terrain[k] = TERRAIN_INDEX.sand;
          roadType[k] = 3;
          river[k] = 0;
        } else if (!roadType[k] || roadType[k] < kind) roadType[k] = Math.max(roadType[k], kind);
      }
      // проход в стене шириной в три клетки
      for (const c of path) {
        if (!border(c)) continue;
        for (const n of [c, ...around(c)]) {
          const k = rot(n, g);
          if (res[k] === 0 && isLand(k)) res[k] = 1;
        }
      }
    }
    if (l.e.guard > 0 && cross > 0) {
      const terr = TERRAINS[zones[zoneOf[path[cross]]].terrain].id;
      for (let g = 0; g < G; g++) guards.push({ cell: rot(path[cross], g), value: EDGE_GUARD[l.e.guard] * guardK, terr });
    }
  }
  // дороги: тип по богатству зоны; мосты — где прошли по воде
  for (let c = 0; c < N; c++) if (roadType[c]) w.road[c] = roadType[c];

  // стены: клетки суши у границы с другой сухопутной зоной, кроме проходов
  const wall = new Uint8Array(N);
  for (let c = 0; c < N; c++) if (border(c) && res[c] === 0) wall[c] = 1;

  // ---------------------------------------------------------------- объекты
  const terrId = (c: number): TerrainId => TERRAINS[w.terrain[c]].id;
  const rareOf = (g: number, k: number): ResId => {
    const list = FACTION_RES[factions[g] as Exclude<Faction, 'neutral'>].filter((x) => x !== 'wood' && x !== 'stone');
    return list[k] ?? RARE.filter((x) => !(list as ResId[]).includes(x))[k % 3];
  };
  const spellOf = (lv: number): string => {
    const list = Object.keys(SPELL_LEVEL).filter((s) => SPELL_LEVEL[s] === lv);
    return list[r.below(list.length)];
  };
  const artOf = (rank: number): string => {
    const list = artList(rank).length ? artList(rank) : artList(2);
    return list[r.below(list.length)];
  };
  const pileN = (res2: ResId): number => {
    if (res2 === 'semki') return 500 + r.below(6) * 100;
    if (res2 === 'wood' || res2 === 'stone') return 5 + r.below(6);
    return 3 + r.below(4);
  };
  const guardArmy = (value: number, terr: TerrainId): Army | undefined => {
    if (value < 1200) return undefined;
    const list = (NEUTRALS[terr] ?? NEUTRALS.meadow).map((id) => CREATURES[id]).filter(Boolean).sort((a, b) => b.tier - a.tier);
    const c = list.find((x) => value / x.cost >= 6) ?? list[list.length - 1];
    const army = emptyArmy();
    army[0] = { cre: c.id, count: Math.max(2, Math.trunc(value / c.cost)) };
    return army;
  };
  const usedPicks = new Set(spec.players.map((p) => `${p.hero.cls}:${p.hero.n}`));
  const captives = (): HeroPick[] => {
    const all: HeroPick[] = [];
    for (const f of ['zatulye', 'zatonye', 'kuznya', 'akademiya'] as Faction[]) for (const cls of factionClasses(f)) for (let n = 1; n <= 4; n++) if (!usedPicks.has(`${cls.id}:${n}`)) all.push({ cls: cls.id, n });
    const out: HeroPick[] = [];
    for (let g = 0; g < G && all.length; g++) {
      const p = all.splice(r.below(all.length), 1)[0];
      usedPicks.add(`${p.cls}:${p.n}`);
      out.push(p);
    }
    return out;
  };

  /** Клетки объекта с входом в c: тело над входом, вход — нижний ряд посередине. */
  const footprint = (c: number, fw: number, fh: number): number[] | null => {
    const x = X(c);
    const y = Y(c);
    const left = x - (fw >> 1);
    const out: number[] = [];
    for (let yy = y - fh + 1; yy <= y; yy++) {
      for (let xx = left; xx < left + fw; xx++) {
        if (!inside(xx, yy)) return null;
        if (xx !== x || yy !== y) out.push(at(xx, yy));
      }
    }
    return out;
  };
  const fits = (c: number, kind: string): boolean => {
    const def = OBJECTS[kind];
    const foot = footprint(c, def.w, def.h);
    if (!foot) return false;
    const zc = zoneOf[c];
    for (const k of [c, ...foot]) if (res[k] !== 0 || wall[k] || !isLand(k) || zoneOf[k] !== zc) return false;
    const x = X(c);
    const y = Y(c);
    const left = x - (def.w >> 1);
    for (let yy = y - def.h; yy <= y + 1; yy++) {
      for (let xx = left - 1; xx <= left + def.w; xx++) {
        if (!inside(xx, yy)) return false;
        const k = at(xx, yy);
        if (res[k] === 2 || wall[k]) return false;
      }
    }
    // перед входом можно встать
    const front = at(x, y + 1);
    return isLand(front) && !wall[front] && res[front] !== 2;
  };
  /** Поставить объект во всех долях сразу; kindOf(g) — вид для копии g (свои ресурсы и местность). */
  const placeOrbit = (c: number, kindOf: (g: number) => string, make: (g: number, cell: number, kind: string) => Partial<MapObject>): boolean => {
    const cs = copies(c);
    const cells: number[] = [];
    for (let g = 0; g < G; g++) {
      if (!fits(cs[g], kindOf(g))) return false;
      const def = OBJECTS[kindOf(g)];
      const x = X(cs[g]);
      const left = x - (def.w >> 1);
      for (let yy = Y(cs[g]) - def.h; yy <= Y(cs[g]) + 1; yy++) for (let xx = left - 1; xx <= left + def.w; xx++) cells.push(at(xx, yy));
    }
    if (new Set(cells).size !== cells.length) return false;
    for (let g = 0; g < G; g++) {
      const kind = kindOf(g);
      const def = OBJECTS[kind];
      const cell = cs[g];
      const foot = footprint(cell, def.w, def.h)!;
      const x = X(cell);
      const left = x - (def.w >> 1);
      for (let yy = Y(cell) - def.h; yy <= Y(cell) + 1; yy++) {
        for (let xx = left - 1; xx <= left + def.w; xx++) {
          const k = at(xx, yy);
          if (res[k] === 0) res[k] = 3;
        }
      }
      for (const k of foot) {
        res[k] = 2;
        body[k] = 1;
      }
      res[cell] = 2;
      stop[cell] = 1;
      placeObject(w, { kind, cell, owner: -1, cells: foot, ...make(g, cell, kind) });
    }
    return true;
  };

  const zoneCells = (zi: number, depth = 2): number[] => {
    const z = zones[zi];
    const out: number[] = [];
    for (let c = 0; c < N; c++) if (zoneOf[c] === zi && inner[c] >= depth && (z.sector >= 0 || canon[c] === c)) out.push(c);
    return out;
  };
  /** Подобрать место: случайные пробы из клеток зоны, с условием на расстояние до середины. */
  const tryPlace = (zi: number, cand: number[], ok: (c: number) => boolean, kindOf: (g: number) => string, make: (g: number, cell: number, kind: string) => Partial<MapObject>): boolean => {
    const pool = cand.filter(ok);
    for (let i = 0; i < 80 && pool.length; i++) {
      const c = pool.splice(r.below(pool.length), 1)[0];
      if (placeOrbit(c, kindOf, make)) return true;
    }
    // наугад не встало — перебором: на тесной карте место бывает одно
    return pool.some((c) => placeOrbit(c, kindOf, make));
  };

  // стража проходов — сначала: на их клетки объекты не встанут
  for (const gd of guards) {
    if (res[gd.cell] === 2) continue;
    const army = guardArmy(gd.value, gd.terr);
    if (!army) continue;
    res[gd.cell] = 2;
    stop[gd.cell] = 1;
    placeObject(w, { kind: 'stack', cell: gd.cell, owner: -1, army });
  }

  const caps = captives();
  // два прохода: сначала обязательное во всех зонах, потом мелочь по бюджету — иначе мелочь первых зон отнимет место у шахт и сокровищниц следующих
  for (const phase of [0, 1]) for (const z of zones) {
    if ((z.sector !== 0 && z.sector !== -1) || z.t.terrain === 'water') continue;
    const zi = zones.indexOf(z);
    const cand = zoneCells(zi);
    const kind = z.t.kind;
    const zk = ZONE_GUARD[kind] * guardK;
    const terrOf = (g: number): TerrainId => terrId(zones[z.orbit[g]].center);
    const terr0 = terrOf(0);
    const near = (lo: number, hi: number) => (c: number): boolean => cheb(c, z.center) >= lo && cheb(c, z.center) <= hi;
    const guarded = (v: number) => (): Partial<MapObject> => ({ army: guardArmy(v * zk, terr0) });
    const any = (): boolean => true;
    // насыщенность как в жанре: объект на каждые ~15–20 клеток суши
    let budget = (z.t.value * DENSITY * cand.length) / 100 - (kind === 'start' || kind === 'treasure' ? 12000 : 0);

    // обязательное
    if (phase === 1) {
      // уже стоит
    } else if (kind === 'start') {
      const free = (): Partial<MapObject> => ({});
      if (t.islands) {
        // верфь у берега и бесплатная лодка
        const coast = (c: number): boolean => {
          for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (inside(X(c) + dx, Y(c) + dy) && isSea(at(X(c) + dx, Y(c) + dy))) return true;
          return false;
        };
        // верфь — до остального: без неё и лодки остров — тюрьма
        if (!tryPlace(zi, cand, coast, () => 'shipyard', free)) tryPlace(zi, zoneCells(zi, 1), coast, () => 'shipyard', free) || tryPlace(zi, zoneCells(zi, 0), coast, () => 'shipyard', free);
      }
      // обязательные шахты: сначала в своём кольце, не вышло — шире
      const must = (lo: number, hi: number, kindOf: (g: number) => string, make: () => Partial<MapObject>): boolean =>
        tryPlace(zi, cand, near(lo, hi), kindOf, make) || tryPlace(zi, cand, near(3, hi + 8), kindOf, make) || tryPlace(zi, zoneCells(zi, 0), near(3, 99), kindOf, make)
        // своя зона тесна — в соседнюю своей доли или в общую
        || zones.some((o2, zj) => o2.sector <= 0 && zj !== zi && o2.t.terrain !== 'water' && tryPlace(zj, zoneCells(zj, 0), any, kindOf, make));
      must(4, 9, () => 'mine-wood', free);
      must(4, 9, () => 'mine-stone', free);
      must(6, 14, () => 'mine-semki', guarded(4000));
      must(7, 16, (g) => `mine-${rareOf(g, 0)}`, guarded(5000));
      tryPlace(zi, cand, near(2, 5), () => 'signpost', () => ({ text: 'Свой край. Дальше — охраняемые проходы к соседям.' }));
    } else if (kind === 'mid') {
      tryPlace(zi, cand, any, (g) => `mine-${z.sector < 0 ? RARE[0] : rareOf(g, 1)}`, guarded(6000));
    } else if (kind === 'treasure') {
      const reward = { semki: 6000, [RARE[r.below(4)]]: 5 } as Purse;
      const art = artOf(2);
      const kindOf = (g: number): string => `treasury-${tArt(terrOf(g))}`;
      const make = (): Partial<MapObject> => ({ army: guardArmy(12000 * zk, terr0), reward: { ...reward }, art });
      tryPlace(zi, cand, any, kindOf, make) || tryPlace(zi, zoneCells(zi, 1), any, kindOf, make) || zones.some((o2, zj) => o2.sector <= 0 && zj !== zi && o2.t.kind !== 'start' && o2.t.terrain !== 'water' && tryPlace(zj, zoneCells(zj, 1), any, kindOf, make));
      tryPlace(zi, cand, any, () => 'mine-semki', guarded(7000));
    } else if (kind === 'center') {
      const reward = { semki: 8000, [RARE[r.below(4)]]: 6 } as Purse;
      const art = artOf(2);
      const spell = spellOf(3);
      tryPlace(zi, cand, near(3, 12), (g) => `treasury-${tArt(terrOf(g))}`, () => ({ army: guardArmy(14000 * zk, terr0), reward: { ...reward }, art }));
      tryPlace(zi, cand, any, () => 'shrine3', () => ({ army: guardArmy(7000 * zk, terr0), spell }));
      tryPlace(zi, cand, any, () => 'obelisk', () => ({}));
    }

    if (phase === 0) continue;
    // по бюджету
    const count: Record<string, number> = {};
    const letter = KIND_LETTER[kind];
    let misses = 0;
    while (budget > 600 && misses < 6) {
      // мелочь (кучи, сундуки, костры, простые вещи) — сколько влезет по площади, редкое — штучно
      const cap = (p: Pick): number => (p.v <= 3000 ? Math.max(p.max ?? 9, Math.round(((p.max ?? 9) * cand.length) / 160)) : (p.max ?? 9));
      const opts = TABLE.filter((p) => p.where.includes(letter) && (count[p.kind] ?? 0) < cap(p) && p.v <= budget + 1500);
      if (!opts.length) break;
      const sum = opts.reduce((s, p) => s + p.w, 0);
      let roll = r.below(sum);
      let p = opts[0];
      for (const x of opts) {
        if (roll < x.w) {
          p = x;
          break;
        }
        roll -= x.w;
      }
      const ok = place(p, zi, cand, z, zk, terr0, terrOf);
      if (ok) {
        count[p.kind] = (count[p.kind] ?? 0) + 1;
        budget -= p.v;
        misses = 0;
      } else misses++;
    }
  }

  function tArt(tid: TerrainId): string {
    return decorArts(tid);
  }

  /** Один объект из таблицы: вид, награда и охрана — одинаковые во всех долях, ресурс — по фракции хозяина доли. */
  function place(p: Pick, zi: number, cand: number[], z: Zone, zk: number, terr0: TerrainId, terrOf: (g: number) => TerrainId): boolean {
    const shared = z.sector < 0;
    const g0 = (c: number): boolean => cheb(c, z.center) >= (z.t.kind === 'start' ? 4 : 0);
    const army = (v: number): Army | undefined => guardArmy(v * zk, terr0);
    const fixedRare = RARE[r.below(4)];
    const rareK = r.below(2);
    const rare = (g: number): ResId => (shared ? fixedRare : rareOf(g, rareK));
    switch (p.kind) {
      case 'res-semki':
      case 'res-wood':
      case 'res-stone': {
        const n = pileN(p.kind.slice(4) as ResId);
        return tryPlace(zi, cand, g0, () => p.kind, () => ({ n, army: army(p.v * 0.6) }));
      }
      case 'res-rare': {
        const n = pileN('amber');
        return tryPlace(zi, cand, g0, (g) => `res-${rare(g)}`, () => ({ n, army: army(p.v * 0.6) }));
      }
      case 'chest':
        return tryPlace(zi, cand, g0, () => 'chest', () => ({ n: 1000 + r.below(3) * 500, army: army(p.v * 0.6) }));
      case 'campfire':
        return tryPlace(zi, cand, g0, () => 'campfire', () => ({ n: 500, army: army(p.v * 0.6) }));
      case 'art1':
      case 'art2':
      case 'art3': {
        const art = artOf(Number(p.kind[3]));
        return tryPlace(zi, cand, g0, () => 'artifact', () => ({ art, army: army(p.v) }));
      }
      case 'shrine1':
      case 'shrine2':
      case 'shrine3': {
        const spell = spellOf(Number(p.kind[6]));
        return tryPlace(zi, cand, g0, () => p.kind, () => ({ spell, army: army(p.v * 0.8) }));
      }
      case 'mine-semki':
        return tryPlace(zi, cand, g0, () => 'mine-semki', () => ({ army: army(p.v) }));
      case 'mine-rare':
        return tryPlace(zi, cand, g0, (g) => `mine-${rare(g)}`, () => ({ army: army(p.v) }));
      case 'dwell': {
        const pool = (NEUTRALS[terr0] ?? NEUTRALS.meadow).filter((id) => OBJECTS[`dwell-${id.slice(8)}`] && CREATURES[id].tier <= (z.t.kind === 'center' ? 7 : z.t.kind === 'treasure' ? 6 : 4));
        if (!pool.length) return false;
        const cre = pool[r.below(pool.length)];
        const tier = CREATURES[cre].tier;
        const guard = emptyArmy();
        guard[0] = { cre, count: Math.max(2, Math.trunc((p.v * zk) / CREATURES[cre].cost)) };
        return tryPlace(zi, cand, g0, () => `dwell-${cre.slice(8)}`, () => ({ army: guard.map((s) => (s ? { ...s } : s)) as Army, n: DWELL_GROWTH[tier] }));
      }
      case 'prison': {
        if (caps.length < G) return false;
        const list = caps.splice(0, G);
        return tryPlace(zi, cand, g0, () => 'prison', (g) => ({ captive: list[g], army: army(p.v * 0.7) }));
      }
      case 'treasury': {
        const reward = { semki: 5000 + r.below(4) * 1000, [fixedRare]: 4 + r.below(4) } as Purse;
        const art = artOf(2);
        return tryPlace(zi, cand, g0, (g) => `treasury-${tArt(terrOf(g))}`, () => ({ army: army(p.v * 1.2), reward, art }));
      }
      case 'seerhut': {
        if (shared) return false;
        const reward = { [fixedRare]: 8, semki: 2000 } as Purse;
        return tryPlace(zi, cand, g0, () => 'seerhut', (g) => ({ quest: { cre: factionCreatures(factions[g]).find((c) => c.tier === 1 && !c.up)!.id, count: 15, reward: { ...reward }, xp: 1500 } }));
      }
      default:
        return tryPlace(zi, cand, g0, () => p.kind, () => ({ army: army(p.v * 0.8) }));
    }
  }

  // ---------------------------------------------------------------- препятствия: шум с искажением, стены, одиночные деревья
  const ob1 = noise(r.u32(), S / 9);
  const ob2 = noise(r.u32(), 3.5);
  const obW = noise(r.u32(), S / 10);
  const mask = new Uint8Array(N);
  // лес подходит к объектам вплотную, как в жанре; свободны только клетки у входов
  const nearEntry = (k: number): boolean => stop[k] === 1 || around(k).some((n) => stop[n] === 1);
  const busy = (k: number): boolean => res[k] === 1 || res[k] === 2 || res[k] === 4 || (res[k] === 3 && nearEntry(k));
  for (let c = 0; c < N; c++) {
    if (canon[c] !== c) continue;
    if (!isLand(c) || anyCopy(c, busy)) continue;
    const z = zones[zoneOf[c]];
    let m = wall[c] === 1;
    if (!m && cheb(c, z.center) > (z.t.kind === 'start' ? 3 : 2)) {
      const x = X(c);
      const y = Y(c);
      const wx = x + (obW(x, y) - 0.5) * 8;
      const wy = y + (obW(y + 50, x + 50) - 0.5) * 8;
      const v = ob1(wx, wy) * 0.7 + ob2(wx, wy) * 0.3;
      // у границы с сушей лес гуще — стена выглядит природной; у моря берег открыт
      const coast = inner[c] <= 2 && around(c).some((n) => isSea(n) || around(n).some(isSea));
      m = v > (z.t.kind === 'start' ? 0.47 : 0.44) || (inner[c] <= 1 && v > 0.38 && !coast);
    }
    if (m) for (const k of copies(c)) mask[k] = 1;
  }
  // диск Пуассона: одиночные деревья в открытом поле
  {
    const open = Array.from({ length: N }, (_, c) => c).filter((c) => canon[c] === c && !mask[c] && isLand(c) && !anyCopy(c, busy) && inner[c] >= 2);
    const taken: number[] = [];
    for (let i = 0; i < open.length >> 1; i++) {
      const c = open[r.below(open.length)];
      if (taken.some((k) => cheb(k, c) < 2)) continue;
      taken.push(c);
      for (const k of copies(c)) mask[k] = 1;
    }
  }
  // горы 4×3: где маска сплошная (для четверых — квадрат 4×4, чтобы повёрнутая копия тоже легла)
  const mountainAt = new Int32Array(N).fill(-1);
  const mountains: { cell: number; cells: number[]; art: string }[] = [];
  const boxH = G === 4 ? MOUNT_W : MOUNT_H;
  const mountainFree = (k: number): boolean => mask[k] === 1 && mountainAt[k] < 0;
  for (let c = 0; c < N; c++) {
    if (canon[c] !== c || !mask[c] || mountainAt[c] >= 0) continue;
    if (speck(X(c) + 7, Y(c) + 3) < 0.3) continue;
    // c — левый нижний угол
    const box = (k: number): number[] | null => {
      const out: number[] = [];
      for (let yy = Y(k) - boxH + 1; yy <= Y(k); yy++) for (let xx = X(k); xx < X(k) + MOUNT_W; xx++) {
        if (!inside(xx, yy)) return null;
        out.push(at(xx, yy));
      }
      return out;
    };
    const b0 = box(c);
    if (!b0 || !b0.every(mountainFree)) continue;
    // копии квадрата: повёрнутый квадрат — тот же квадрат, левый нижний угол ищем по клеткам
    const sets = copies(c).map((_, g) => b0.map((k) => rot(k, g)));
    const all = sets.flat();
    if (new Set(all).size !== all.length || !all.every(mountainFree)) continue;
    for (const set of sets) {
      const minX = Math.min(...set.map(X));
      const maxY = Math.max(...set.map(Y));
      const cells = set.filter((k) => Y(k) > maxY - MOUNT_H);
      const anchor = at(minX, maxY);
      const tid = terrId(anchor);
      const art = tid === 'ash' ? 3 : tid === 'swamp' ? 2 : tid === 'pine' ? 1 : 1 + (anchor % 2) * 3;
      for (const k of cells) mountainAt[k] = mountains.length;
      mountains.push({ cell: anchor, cells, art: `mountain-${art}` });
    }
  }
  const trees = new Map<number, Decor>();
  for (let c = 0; c < N; c++) {
    if (!mask[c] || mountainAt[c] >= 0) continue;
    const i = new Rng(Math.imul(c + 1, 2654435761) ^ seed).below(8);
    trees.set(c, { cell: c, art: `decor-${decorArts(terrId(c))}-${i + 1}`, size: DECOR_SIZE[i] });
  }
  for (let c = 0; c < N; c++) if (mask[c]) w.block[c] = 1;

  // ---------------------------------------------------------------- починка проходимости (DESIGN.md §7.3: вырезаем проход, а не новый сид)
  const open = (c: number): void => {
    if (body[c]) return;
    const m = mountainAt[c];
    if (m >= 0) {
      for (const k of mountains[m].cells) {
        mountainAt[k] = -1;
        w.block[k] = 0;
        mask[k] = 0;
      }
      mountains[m].cells = [];
    }
    if (trees.has(c)) trees.delete(c);
    w.block[c] = 0;
    mask[c] = 0;
    if (!isLand(c) && !isSea(c)) {
      w.terrain[c] = TERRAIN_INDEX.sand;
      river[c] = 0;
    }
  };
  const passable = (c: number, boat: boolean): boolean => !body[c] && !w.block[c] && (isLand(c) || boat);
  const stacks = new Set<number>();
  const flood = (boat: boolean): Uint8Array => {
    stacks.clear();
    for (const x of w.objects) if (x.kind === 'stack') stacks.add(x.cell);
    const seen = new Uint8Array(N);
    const q = gates.filter((g) => g >= 0);
    for (const g of q) seen[g] = 1;
    for (let i = 0; i < q.length; i++) {
      const c = q[i];
      // со входа дальше не идём; страж проходим — его можно побить
      if (stop[c] && !gates.includes(c) && !stacks.has(c)) continue;
      for (const n of around(c)) {
        if (seen[n] || !passable(n, boat)) continue;
        seen[n] = 1;
        q.push(n);
      }
    }
    return seen;
  };
  /** Лодка на воде: достижима, если рядом достижимый берег. */
  const reached = (seen: Uint8Array, c: number): boolean => seen[c] === 1 || (!isLand(c) && around(c).some((n) => seen[n] && isLand(n) && !stop[n]));
  const startZone = (c: number): boolean => zones[zoneOf[c]].t.kind === 'start';
  /** Прорубить путь от цели к достижимому. Симметрично: путь годится во всех копиях (тела объектов и входы — по всем долям), кончается там, где достижимы все копии;
   * у самой цели — только своя доля (входы у копий смотрят вниз по-разному). Не вышло — путь только для этой копии. */
  const fix = (seen: Uint8Array, target: number, boat: boolean): void => {
    const free = (k: number): boolean => seen[k] === 1 && isLand(k) && (!stop[k] || stacks.has(k));
    const run = (sym: boolean): boolean => {
      const dist = new Float64Array(N).fill(Infinity);
      const prev = new Int32Array(N).fill(-1);
      const q = new Heap();
      q.push(0, target);
      dist[target] = 0;
      let end = -1;
      while (q.size) {
        const [d, c] = q.pop();
        if (d > dist[c]) continue;
        if (c !== target && (sym ? copies(c).every(free) : free(c))) {
          end = c;
          break;
        }
        for (const n of around(c)) {
          const own = !sym || cheb(n, target) <= 1;
          // сквозь чужой вход не пройти: с него дальше не шагают (кроме стражи — её бьют)
          const solid = (k: number): boolean => body[k] === 1 || (stop[k] === 1 && !stacks.has(k) && !gates.includes(k));
          if (own ? solid(n) : anyCopy(n, solid)) continue;
          if (isSea(n) && !boat) continue;
          let k = 1;
          if (w.block[n]) k = mountainAt[n] >= 0 ? 25 : 4;
          if (wall[n]) k += 20;
          if (!isLand(n) && !isSea(n)) k = 6;
          if (dist[c] + k < dist[n]) {
            dist[n] = dist[c] + k;
            prev[n] = c;
            q.push(dist[n], n);
          }
        }
      }
      if (end < 0) return false;
      for (let k = end; k >= 0; k = prev[k]) for (const m of sym ? copies(k) : [k]) open(m);
      return true;
    };
    if (!run(true)) run(false);
  };
  const targets = (): number[] => [...w.objects.map((x) => x.cell), ...gates, ...zones.filter((z) => z.t.terrain !== 'water').map((z) => z.center).filter((c) => isLand(c) && !body[c])];
  for (let round = 0; round < 2000; round++) {
    const foot = flood(false);
    const wet = t.islands ? flood(true) : foot;
    const miss = targets().find((c) => (t.islands && !startZone(c) ? !reached(wet, c) : !reached(foot, c)));
    if (miss === undefined) break;
    fix(t.islands && !startZone(miss) ? wet : foot, miss, t.islands === true && !startZone(miss));
  }

  // осколок кастета — ближе к середине карты; обелиски на него указывают
  {
    const foot = t.islands ? flood(true) : flood(false);
    const mid = at(S >> 1, S >> 1);
    let best = -1;
    let bd = Infinity;
    for (let c = 0; c < N; c++) {
      if (!isLand(c) || w.block[c] || res[c] === 2 || !foot[c]) continue;
      const d = cheb(c, mid) * 4 + (speck(X(c), Y(c)) > 0.5 ? 1 : 0);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    w.shard = best;
    w.shardHint = [r.int(-12, 12), r.int(-12, 12)];
  }

  // выравнивание: вход у объекта всегда снизу, и в повёрнутой копии лес «за спиной» оказывается перед подходом.
  // Кому до своей копии объекта дальше — тому прорубаем повёрнутый путь самого удачливого (DESIGN.md §7.5)
  const walk = (from: number): { dist: Int32Array; prev: Int32Array } => {
    const dist = new Int32Array(N).fill(-1);
    const prev = new Int32Array(N).fill(-1);
    const q = new Heap();
    q.push(0, from);
    dist[from] = 0;
    while (q.size) {
      const [d, c] = q.pop();
      if (d > dist[c]) continue;
      if (c !== from && stop[c] && !stacks.has(c)) continue;
      for (const n of around(c)) {
        // на островах — на лодке по любой воде, как в игре
        if (w.block[n] || body[n] || (!isLand(n) && !t.islands)) continue;
        let k = w.road[n] && isLand(n) ? ROAD_COST[w.road[n]] : 100;
        if (X(n) !== X(c) && Y(n) !== Y(c)) k = Math.trunc((k * 141) / 100);
        if (dist[n] < 0 || d + k < dist[n]) {
          dist[n] = d + k;
          prev[n] = c;
          q.push(d + k, n);
        }
      }
    }
    return { dist, prev };
  };
  for (let it = 0; it < 4; it++) {
    flood(false);
    const runs = gates.map((g0) => walk(g0));
    const done = new Set<number>();
    let changed = false;
    // цели: объекты (копия g — у игрока g) и соседние города (игроку g — город g + j)
    const goals: { cs: number[]; fw: number; fh: number }[] = [];
    for (const o of w.objects) {
      if (done.has(o.cell)) continue;
      const cs = copies(o.cell);
      for (const k of cs) done.add(k);
      if (cs.every((k) => w.entries[k] !== undefined)) goals.push({ cs, fw: OBJECTS[o.kind].w, fh: OBJECTS[o.kind].h });
    }
    for (let j = 1; j < G; j++) goals.push({ cs: copies(gates[j]), fw: TOWN_W, fh: TOWN_H });
    // осколок один, но его повёрнутые места рядом: подходы к середине у всех одинаковые
    if (w.shard >= 0) goals.push({ cs: copies(w.shard), fw: 1, fh: 1 });
    for (const { cs, fw, fh } of goals) {
      const d = cs.map((k, g) => runs[g].dist[k]);
      if (d.some((x) => x < 0)) continue;
      const best = d.indexOf(Math.min(...d));
      if (Math.max(...d) - d[best] <= 300) continue;
      const path: number[] = [];
      for (let k = cs[best]; k >= 0; k = runs[best].prev[k]) path.push(k);
      for (let g = 0; g < G; g++) {
        if (g === best || d[g] - d[best] <= 300) continue;
        // повёрнутый путь приводит к «спине» объекта — кольцо вокруг тела, чтобы обойти его ко входу
        const ring: number[] = [];
        for (let yy = Y(cs[g]) - fh; yy <= Y(cs[g]) + 1; yy++) for (let xx = X(cs[g]) - (fw >> 1) - 1; xx <= X(cs[g]) - (fw >> 1) + fw; xx++) if (inside(xx, yy)) ring.push(at(xx, yy));
        for (const k of [...path.map((c) => rot(c, (g - best + G) % G)), ...ring]) {
          if (w.block[k] && !body[k] && !wall[k]) {
            open(k);
            changed = true;
          }
        }
      }
    }
    if (!changed) break;
  }

  // осколок — у середины, там, куда всем идти поровну
  if (w.shard >= 0) {
    const runs = gates.map((g0) => walk(g0));
    const mid = at(S >> 1, S >> 1);
    let best = w.shard;
    let bs = Infinity;
    for (let c = 0; c < N; c++) {
      if (cheb(c, mid) > Math.max(6, S >> 3) || !isLand(c) || w.block[c] || res[c] === 2) continue;
      const d = runs.map((x) => x.dist[c]);
      if (d.some((x) => x < 0)) continue;
      const v = (Math.max(...d) - Math.min(...d)) * 4 + cheb(c, mid) * 60;
      if (v < bs) {
        bs = v;
        best = c;
      }
    }
    w.shard = best;
  }

  // лодки у островов: на воде у берега, ближе к воротам
  if (t.islands) {
    const foot = flood(false);
    /** Вода у своего берега, куда дойти пешком от своих ворот. */
    const shore = (c: number, zi: number): boolean =>
      isSea(c) && w.terrain[c] === WATER && res[c] !== 2 && around(c, N4).some((n) => foot[n] && zoneOf[n] === zi && isLand(n) && !stop[n] && !w.block[n]);
    const starts = zones.filter((z) => z.t.kind === 'start');
    const z0 = starts.find((z) => z.sector === 0)!;
    const zi0 = zones.indexOf(z0);
    let best = -1;
    let bd = Infinity;
    for (let c = 0; c < N; c++) {
      if (!shore(c, zi0) || !copies(c).every((k, g) => shore(k, z0.orbit[g]))) continue;
      const d = cheb(c, z0.center);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    // поровну не вышло — каждому свою, ближе к воротам
    const cells = best >= 0 ? copies(best) : starts.map((z) => {
      const zi = zones.indexOf(z);
      let b = -1;
      let d0 = Infinity;
      for (let c = 0; c < N; c++) if (shore(c, zi) && cheb(c, z.center) < d0) {
        d0 = cheb(c, z.center);
        b = c;
      }
      if (b >= 0) return b;
      // берег зарос: лодку — к ближайшему берегу своей зоны, к ней прорубаем тропу
      let land = -1;
      for (let c = 0; c < N; c++) {
        if (!isSea(c) || w.terrain[c] !== WATER || res[c] === 2) continue;
        const n = around(c, N4).find((k) => zoneOf[k] === zi && isLand(k) && !body[k] && !stop[k]);
        if (n !== undefined && cheb(c, z.center) < d0) {
          d0 = cheb(c, z.center);
          b = c;
          land = n;
        }
      }
      if (land >= 0) {
        open(land);
        fix(flood(false), land, false);
      }
      return b;
    });
    for (const k of cells) {
      if (k < 0) continue;
      res[k] = 2;
      stop[k] = 1;
      placeObject(w, { kind: 'boat', cell: k, owner: -1 });
    }
  }

  // ---------------------------------------------------------------- декор, города, герои
  for (let c = 0; c < N; c++) w.block[c] = body[c] || mask[c] ? 1 : 0;
  for (const m of mountains) if (m.cells.length) w.decor.push({ cell: m.cell, art: m.art, size: MOUNT_W + 1.2 });
  for (const d of trees.values()) w.decor.push(d);
  w.decor.sort((a, b) => a.cell - b.cell);

  spec.players.forEach((p, i) => {
    const dup = spec.players.slice(0, i).filter((o2) => o2.faction === p.faction).length;
    w.towns.push(makeTown(w, p.faction, i, gates[i], TOWN_NAMES[p.faction] + (dup ? `-${dup + 1}` : '')));
  });

  spec.players.forEach((p, i) => {
    const h = makeHero(w, p.hero, i, gates[i]);
    startArmy(h);
    w.heroes.push(h);
    reveal(w, i, gates[i], 8);
  });
  w.rng = r.s;
  for (const tw of w.towns) tw.tavern = tavernOffer(w, tw.faction);
  return w;
}

/** Ссылка на карту: всё, что нужно, чтобы собрать ту же самую. */
export function genQuery(o: GenOptions): string {
  return `gen=${o.template}&size=${o.size}&water=${o.water}&guard=${o.guard}&seed=${o.seed}`;
}
export function parseGen(q: URLSearchParams): GenOptions | null {
  const tpl = q.get('gen');
  if (!tpl || !TEMPLATES[tpl]) return null;
  const size = (q.get('size') ?? 'm') as SizeId;
  const water = (q.get('water') ?? 'lakes') as WaterId;
  const guard = (q.get('guard') ?? 'normal') as GuardId;
  return {
    template: tpl,
    size: MAP_SIZES[size] && TEMPLATES[tpl].sizes.includes(size) ? size : TEMPLATES[tpl].sizes[0],
    water: WATERS[water] ? water : 'lakes',
    guard: GUARDS[guard] ? guard : 'normal',
    seed: (Number(q.get('seed')) || 1) >>> 0,
  };
}
/** Карта дня: сид от даты «ГГГГ-ММ-ДД». */
export const daySeed = (date: string): number => fnv1a(`geroi-day:${date}`) % 1000000;

export { cellOf };
