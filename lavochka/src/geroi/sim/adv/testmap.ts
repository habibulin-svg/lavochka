/* Готовая карта этапа 3: «Две реки», 48×48, два игрока, зеркальна поворотом на 180°: у обоих одинаковые расстояния (DESIGN.md §7.5).
 * Настоящий генератор — этап 4; здесь всё разложено руками, случайны только лес, артефакты и заклинания святилищ. */
import { Rng, fnv1a } from '../../../gops/sim/rng';
import { factionCreatures } from '../creatures';
import type { HeroPick } from '../heroes';
import { SPELL_LEVEL } from '../spells';
import { FACTION_RES, MOUNT_H, MOUNT_W, NATIVE, OBJECTS, type Purse, RES, type ResId, TERRAINS, TERRAIN_INDEX, type TerrainId, TOWN_H, TOWN_W, WATER } from './data';
import { type Army, artList } from './hero';
import type { TownFaction } from './town';
import { type MapObject, type Player, type World, cellOf, emptyArmy, makeHero, makeTown, neighbors, placeObject, reveal, startArmy, tavernOffer, xOf, yOf } from './world';

export const TEST_SIZE = 48;

export interface GameSpec {
  seed: number;
  players: { name: string; faction: TownFaction; hero: HeroPick }[];
}

export const TOWN_NAMES: Record<TownFaction, string> = { zatulye: 'Заречье', zatonye: 'Сомов омут', kuznya: 'Горн', akademiya: 'Сосновый купол' };

/** Шум: значения в узлах сетки, между ними — сглаженно. Только + и ×: одинаково везде. */
export function noise(seed: number, cell: number): (x: number, y: number) => number {
  const at = (ix: number, iy: number): number => new Rng(Math.imul(ix + 7, 73856093) ^ Math.imul(iy + 11, 19349663) ^ seed).f();
  return (x, y) => {
    const fx = x / cell;
    const fy = y / cell;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const a = fx - ix;
    const b = fy - iy;
    const sa = a * a * (3 - 2 * a);
    const sb = b * b * (3 - 2 * b);
    return (at(ix, iy) * (1 - sa) + at(ix + 1, iy) * sa) * (1 - sb) + (at(ix, iy + 1) * (1 - sa) + at(ix + 1, iy + 1) * sa) * sb;
  };
}

/** Нечётная пила: река петляет и при этом зеркальна. */
function bend(u: number): number {
  const p = 28;
  let m = ((u + p + (p >> 1)) % (p * 2) + p * 2) % (p * 2);
  m = m < p ? m : p * 2 - m;
  return ((m - p / 2) * 6) / (p / 2);
}

const BRIDGES = [-26, 0, 26];
export const decorArts = (t: TerrainId): string => (t === 'swamp' || t === 'ash' || t === 'pine' ? t : 'meadow');
/** Какие картинки декора закрывают клетку (деревья, скалы), а не лежат под ногами. */
export const DECOR_SIZE = [1.9, 2.1, 1.3, 1.2, 1.3, 2.4, 1.3, 1.2];

interface Spot {
  kind: string;
  x: number;
  y: number;
  army?: [string, number];
  n?: number;
  art?: number;
  extra?: Partial<MapObject>;
}

export function makeTestMap(spec: GameSpec): World {
  const S = TEST_SIZE;
  const n = S * S;
  const r = new Rng(spec.seed ^ fnv1a('dve-reki'));
  const w: World = {
    seed: spec.seed, rng: r.u32(), w: S, h: S, levels: 1, terrain: Array<number>(n).fill(0), road: Array<number>(n).fill(0), block: Array<number>(n).fill(0), decor: [], objects: [], entries: {}, towns: [], heroes: [],
    players: spec.players.map((p, id): Player => ({
      id, name: p.name, faction: p.faction, res: { semki: 15000, wood: 20, stone: 20, amber: 8, salt: 8, stariron: 8, resin: 8 }, explored: Array<number>(n).fill(0), alive: true, townless: 0, keys: [], obelisks: [], scrap: {},
    })),
    day: 0, current: 0, pending: null, nextObj: 1, nextHero: 1, shard: -1, shardHint: [0, 0], winner: -1, over: false, weekNote: '',
  };
  const mirror = (c: number): number => cellOf(w, S - 1 - xOf(w, c), S - 1 - yOf(w, c));
  const native = spec.players.map((p) => TERRAIN_INDEX[NATIVE[p.faction]]);
  const sand = TERRAIN_INDEX.sand;
  const rough = TERRAIN_INDEX.rough;
  const wobble = noise(r.u32(), 7);
  const forest = noise(r.u32(), 5);
  const speck = noise(r.u32(), 2);

  // местность и река: половину считаем, вторую отражаем
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = x + y - (S - 1);
      if (d > 0 || (d === 0 && x > y)) continue;
      const u = x - y;
      const gap = Math.abs(d - bend(u));
      const c = cellOf(w, x, y);
      const bridge = BRIDGES.some((b) => Math.abs(u - b) <= 1 + (b === 0 ? 1 : 0) && Math.abs(d - bend(b)) <= 5);
      let t = native[0];
      let t2 = native[1];
      if (gap <= 1.5) t = t2 = WATER;
      else if (gap <= 3.5) t = t2 = sand;
      else if (wobble(x, y) + wobble(y * 2 + 5, x * 2 + 3) * 0.5 > 1.02 && gap > 6) t = t2 = rough;
      if (bridge && t === WATER) t = t2 = sand;
      w.terrain[c] = t;
      if (bridge && gap <= 2.5) w.road[c] = 3;
      const m = mirror(c);
      w.terrain[m] = t2;
      w.road[m] = w.road[c];
    }
  }

  const putDecor = (c: number): void => {
    const t = TERRAINS[w.terrain[c]];
    const i = r.below(8);
    w.block[c] = 1;
    w.decor.push({ cell: c, art: `decor-${decorArts(t.id)}-${i + 1}`, size: DECOR_SIZE[i] });
  };
  const clearDecor = (c: number): void => {
    w.block[c] = 0;
    const i = w.decor.findIndex((d) => d.cell === c);
    if (i >= 0) w.decor.splice(i, 1);
  };

  // лес и скалы: пятнами, зеркально; пока только заготовка, поверх лягут проходы и объекты
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const d = x + y - (S - 1);
      if (d >= 0) continue;
      const c = cellOf(w, x, y);
      if (w.terrain[c] === WATER || w.road[c]) continue;
      if (forest(x, y) > 0.56 && speck(x, y) > 0.3) {
        putDecor(c);
        putDecor(mirror(c));
      }
    }
  }

  const footprint = (x: number, y: number, fw: number, fh: number): number[] => {
    const out: number[] = [];
    const left = x - (fw >> 1);
    for (let yy = y - fh + 1; yy <= y; yy++) {
      for (let xx = left; xx < left + fw; xx++) {
        if ((xx === x && yy === y) || xx < 0 || yy < 0 || xx >= S || yy >= S) continue;
        out.push(cellOf(w, xx, yy));
      }
    }
    return out;
  };
  /** Вокруг объекта чисто: иначе вход заслонён деревом. */
  const clearAround = (x: number, y: number, fw: number, fh: number): void => {
    const left = x - (fw >> 1);
    for (let yy = y - fh; yy <= y + 2; yy++) {
      for (let xx = left - 1; xx <= left + fw; xx++) {
        if (xx < 0 || yy < 0 || xx >= S || yy >= S) continue;
        const c = cellOf(w, xx, yy);
        clearDecor(c);
      }
    }
  };

  const fac0 = spec.players[0].faction;
  const fac1 = spec.players[1].faction;
  // горы — по четыре на сторону
  for (const [x, y] of [[2, 9], [20, 3], [28, 14], [7, 36], [16, 27], [23, 13]]) {
    for (const flip of [false, true]) {
      // гора по местности: вулкан только на пепелище
      const at = TERRAINS[w.terrain[cellOf(w, flip ? S - 1 - x : x, flip ? S - 1 - y : y)]].id;
      const art = at === 'ash' ? 3 : at === 'swamp' ? 2 : at === 'pine' ? 1 : 1 + r.below(2) * 3;
      const bx = flip ? S - 1 - x : x;
      const by = flip ? S - 1 - y : y;
      const cx = flip ? bx - MOUNT_W + 1 : bx;
      const cy = flip ? by : by + MOUNT_H - 1;
      const cells: number[] = [];
      for (let yy = cy - MOUNT_H + 1; yy <= cy; yy++) {
        for (let xx = cx; xx < cx + MOUNT_W; xx++) {
          if (xx < 0 || yy < 0 || xx >= S || yy >= S) continue;
          const c = cellOf(w, xx, yy);
          if (w.terrain[c] === WATER || w.road[c]) continue;
          clearDecor(c);
          w.block[c] = 1;
          cells.push(c);
        }
      }
      if (cells.length) w.decor.push({ cell: cellOf(w, cx, cy), art: `mountain-${art}`, size: MOUNT_W + 1.2 });
    }
  }

  // города
  const gates = [cellOf(w, 9, 10), mirror(cellOf(w, 9, 10))];
  spec.players.forEach((p, i) => {
    const x = xOf(w, gates[i]);
    const y = yOf(w, gates[i]);
    clearAround(x, y, TOWN_W, TOWN_H);
    for (const c of footprint(x, y, TOWN_W, TOWN_H)) w.block[c] = 1;
    w.towns.push(makeTown(w, p.faction, i, gates[i], TOWN_NAMES[p.faction] + (spec.players.findIndex((o) => o.faction === p.faction) !== i ? '-2' : '')));
  });

  const low = (id: string): string => id;
  const tierOf = (f: TownFaction, tier: number): string => factionCreatures(f).find((c) => c.tier === tier && !c.up)!.id;
  const rareRes = (f: TownFaction): ResId[] => FACTION_RES[f].filter((x) => x !== 'wood' && x !== 'stone');
  const other = (res: ResId): ResId => (['amber', 'salt', 'stariron', 'resin'] as ResId[]).filter((x) => x !== res)[r.below(3)];
  const r0 = rareRes(fac0);
  const r1 = rareRes(fac1);
  const rare0 = r0[0] ?? other('wood');
  const rare1 = r1[0] ?? other('wood');
  const spellOf = (lv: number): string => {
    const list = Object.keys(SPELL_LEVEL).filter((s) => SPELL_LEVEL[s] === lv);
    return list[r.below(list.length)];
  };
  const pileN = (kind: string): number => {
    const fx = OBJECTS[kind].effect as { min: number; max: number };
    return fx.min + r.below(Math.trunc((fx.max - fx.min) / (kind === 'res-semki' ? 100 : 1)) + 1) * (kind === 'res-semki' ? 100 : 1);
  };
  const artOf = (rank: number): string => {
    const list = artList(rank);
    return list[r.below(list.length)];
  };

  const place = (s: Spot, cell: number, side: number): MapObject => {
    const def = OBJECTS[s.kind];
    const x = xOf(w, cell);
    const y = yOf(w, cell);
    clearAround(x, y, def.w, def.h);
    if (w.terrain[cell] === WATER) w.terrain[cell] = TERRAIN_INDEX.sand;
    const cells = footprint(x, y, def.w, def.h);
    for (const c of cells) if (w.terrain[c] === WATER) w.terrain[c] = TERRAIN_INDEX.sand;
    const army: Army | undefined = s.army ? emptyArmy() : undefined;
    if (army && s.army) army[0] = { cre: low(s.army[0]), count: s.army[1] };
    void side;
    return placeObject(w, { kind: s.kind, cell, owner: -1, cells, army, n: s.n, ...s.extra });
  };

  /** Обе стороны: своё положение и зеркальное; у второй — её ресурсы и местность. */
  const both = (kind0: string, kind1: string, x: number, y: number, o: Omit<Spot, 'kind' | 'x' | 'y'> = {}): void => {
    const c = cellOf(w, x, y);
    place({ kind: kind0, x, y, ...o }, c, 0);
    place({ kind: kind1, x, y, ...o }, mirror(c), 1);
  };
  const same = (kind: string, x: number, y: number, o: Omit<Spot, 'kind' | 'x' | 'y'> = {}): void => both(kind, kind, x, y, o);
  const guard = (x: number, y: number, cre: string, count: number): void => same('stack', x, y, { army: [cre, count] });

  // шахты: рядом свободные, дальше под охраной
  same('mine-wood', 4, 18);
  same('mine-stone', 18, 5);
  same('mine-semki', 19, 13);
  guard(19, 15, 'neutral-bandit', 10);
  both(`mine-${rare0}`, `mine-${rare1}`, 24, 4);
  guard(24, 6, 'neutral-wolf', 12);
  both(`mine-${r0[1] ?? other(rare0)}`, `mine-${r1[1] ?? other(rare1)}`, 5, 25);
  guard(7, 25, 'neutral-wolf', 12);

  // кучи и находки
  for (const [kind, x, y] of [['res-semki', 13, 14], ['res-wood', 15, 17], ['res-stone', 6, 15], ['res-semki', 21, 9], ['res-stone', 2, 22], ['res-wood', 27, 8]] as [string, number, number][]) {
    same(kind, x, y, { n: pileN(kind) });
  }
  both(`res-${rare0}`, `res-${rare1}`, 3, 13, { n: 4 });
  both(`res-${rare0}`, `res-${rare1}`, 14, 21, { n: 4 });
  same('chest', 22, 11, { n: 1500 });
  same('chest', 11, 22, { n: 2000 });
  same('campfire', 13, 25, { n: 500 });
  same('campfire', 30, 7, { n: 500 });
  // артефакты под охраной
  both('artifact', 'artifact', 26, 12, { army: ['neutral-boar', 8], extra: { art: artOf(1) } });
  both('artifact', 'artifact', 12, 30, { army: ['neutral-bear', 4], extra: { art: artOf(2) } });

  // умения и польза
  both('shrine1', 'shrine1', 4, 5, { extra: { spell: spellOf(1) } });
  both('shrine2', 'shrine2', 21, 21, { army: ['neutral-leshak', 10], extra: { spell: spellOf(2) } });
  same('learnstone', 28, 17);
  same('wisewell', 14, 3);
  same('luckfountain', 9, 19);
  same('windmill', 31, 3);
  same('watermill', 4, 31);
  same('watchtower', 16, 24);
  same('gloryhill', 24, 17, { army: ['neutral-salamander', 6] });
  same('stables', 20, 26);
  same('tradepost', 33, 8);
  same('signpost', 12, 13, { extra: { text: 'На восток — брод. За бродом — чужой край. Под ногами — ищи обелиски.' } });
  same('obelisk', 2, 28);
  same('tavern', 26, 2);
  same('dwell-bandit', 34, 4, { army: ['neutral-bandit', 14], n: 8 });
  same('dwell-wolf', 2, 35, { army: ['neutral-wolf', 14], n: 6 });
  same('dwell-bear', 27, 23, { army: ['neutral-bear', 6], n: 3 });
  // провидец просит младших, награда — редкий ресурс и опыт
  const quest = (f: TownFaction) => ({ quest: { cre: tierOf(f, 1), count: 15, reward: { [RES[3 + r.below(4)]]: 10, semki: 2000 } as Purse, xp: 1500 } });
  {
    const c = cellOf(w, 3, 40);
    place({ kind: 'seerhut', x: 3, y: 40, extra: quest(fac0) }, c, 0);
    place({ kind: 'seerhut', x: 3, y: 40, extra: quest(fac1) }, mirror(c), 1);
  }
  // ключ и застава: за заставой сокровищница
  same('keytent', 16, 31, { extra: { key: 'медный' } });
  same('guardtent', 34, 13, { extra: { key: 'медный' } });
  both(`treasury-${TERRAINS[native[0]].id === 'rough' ? 'meadow' : TERRAINS[native[0]].id}`, `treasury-${TERRAINS[native[1]].id === 'rough' ? 'meadow' : TERRAINS[native[1]].id}`, 37, 9, {
    army: ['neutral-stonegiant', 3], extra: { reward: { semki: 6000, stone: 8 }, art: artOf(2) },
  });
  same('prison', 10, 36, { army: ['neutral-kikimora', 10], extra: { captive: { cls: 'kuznya-master', n: 4 } } });
  // портал соединяет края
  {
    const c = cellOf(w, 37, 1);
    const a = place({ kind: 'portal2', x: 37, y: 1, extra: { pair: 1 } }, c, 0);
    const b = place({ kind: 'portal2', x: 37, y: 1, extra: { pair: 1 } }, mirror(c), 1);
    void a;
    void b;
    guard(37, 3, 'neutral-sirin', 5);
  }
  // лодка и верфь у реки
  same('shipyard', 31, 16);
  // стража мостов и главный клад посередине
  for (const b of BRIDGES) {
    const y0 = Math.trunc((S - 1 - b + bend(b)) / 2);
    const x0 = b + y0;
    const c = cellOf(w, x0, y0);
    if (!w.road[c]) continue;
    place({ kind: 'stack', x: x0, y: y0, army: [b === 0 ? 'neutral-stonegiant' : 'neutral-bear', b === 0 ? 4 : 9] }, c, 0);
  }

  // дороги от ворот к мостам: своя половина и её отражение
  const solidCells = new Set<number>();
  for (const o of w.objects) {
    solidCells.add(o.cell);
    for (const c of o.cells ?? []) solidCells.add(c);
  }
  for (const t of gates) {
    const x = xOf(w, t);
    const y = yOf(w, t);
    for (const c of footprint(x, y, TOWN_W, TOWN_H)) solidCells.add(c);
  }
  const layRoad = (from: number, goal: (c: number) => boolean): void => {
    const prev = new Map<number, number>([[from, -1]]);
    const q = [from];
    for (let i = 0; i < q.length; i++) {
      const c = q[i];
      if (goal(c)) {
        for (let k = c; k >= 0; k = prev.get(k)!) {
          for (const v of [k, mirror(k)]) {
            if (solidCells.has(v) || w.terrain[v] === WATER || w.road[v] === 3) continue;
            w.road[v] = 1;
            clearDecor(v);
          }
        }
        return;
      }
      const x = xOf(w, c);
      const y = yOf(w, c);
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= S || ny >= S) continue;
        const n2 = cellOf(w, nx, ny);
        if (prev.has(n2) || w.terrain[n2] === WATER || (solidCells.has(n2) && n2 !== from)) continue;
        // прямая дорога важнее обхода деревьев: лес прорубаем
        prev.set(n2, c);
        q.push(n2);
      }
    }
  };
  const start = cellOf(w, 9, 11);
  for (const b of BRIDGES) layRoad(start, (c) => w.road[c] === 3 && Math.abs(xOf(w, c) - yOf(w, c) - b) <= 2);
  w.road[start] = 1;
  w.road[mirror(start)] = 1;

  // обелиск указывает на осколок: он на чужом клочке у реки, зеркально никому не ближе
  for (let tries = 0; tries < 400 && w.shard < 0; tries++) {
    const x = 16 + r.below(16);
    const y = S - 1 - x;
    const c = cellOf(w, x, y);
    if (w.terrain[c] !== WATER && !w.block[c] && !w.objects.some((o) => o.cell === c)) {
      w.shard = c;
      w.shardHint = [r.int(-14, 14), r.int(-14, 14)];
    }
  }

  // герои и туман
  spec.players.forEach((p, i) => {
    const h = makeHero(w, p.hero, i, gates[i]);
    startArmy(h);
    w.heroes.push(h);
    reveal(w, i, gates[i], 8);
    reveal(w, i, gates[i], 5);
  });

  carvePaths(w, gates[0], gates[1]);
  w.rng = r.s;
  for (const t of w.towns) t.tavern = tavernOffer(w, t.faction);
  return w;
}

/** Каждый вход достижим из своего города: где лес заслонил — прорубаем просеку (DESIGN.md §7.3: чиним, а не новым сидом). */
function carvePaths(w: World, ...starts: number[]): void {
  const n = w.w * w.h;
  const seen = new Uint8Array(n);
  const flood = (): void => {
    seen.fill(0);
    const q = [...starts];
    for (const c of starts) seen[c] = 1;
    for (let i = 0; i < q.length; i++) {
      for (const nb of neighbors(w, q[i])) {
        if (seen[nb] || w.terrain[nb] === WATER || w.block[nb]) continue;
        seen[nb] = 1;
        q.push(nb);
      }
    }
  };
  const open = (c: number): void => {
    w.block[c] = 0;
    const i = w.decor.findIndex((d) => d.cell === c && d.art.startsWith('decor'));
    if (i >= 0) w.decor.splice(i, 1);
  };
  const solid = new Set<number>();
  for (const o of w.objects) for (const c of o.cells ?? []) solid.add(c);
  for (const t of w.towns) {
    const tx = xOf(w, t.cell);
    const ty = yOf(w, t.cell);
    for (let y = ty - TOWN_H + 1; y <= ty; y++) for (let x = tx - (TOWN_W >> 1); x <= tx + (TOWN_W >> 1); x++) if (!(x === tx && y === ty)) solid.add(cellOf(w, x, y));
  }
  const targets = [...w.objects.map((o) => o.cell), ...w.towns.map((t) => t.cell)];
  for (let round = 0; round < targets.length + 2; round++) {
    flood();
    const miss = targets.find((c) => !seen[c] && w.terrain[c] !== WATER);
    if (miss === undefined) return;
    // кратчайшая просека сквозь лес к уже доступному: тела объектов и вода — стена
    const prev = new Map<number, number>([[miss, -1]]);
    const q = [miss];
    for (let i = 0; i < q.length; i++) {
      const c = q[i];
      if (seen[c]) {
        for (let k = c; k >= 0; k = prev.get(k)!) if (!solid.has(k)) open(k);
        break;
      }
      for (const nb of neighbors(w, c)) {
        if (prev.has(nb) || solid.has(nb) || w.terrain[nb] === WATER) continue;
        prev.set(nb, c);
        q.push(nb);
      }
    }
  }
}
