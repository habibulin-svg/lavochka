/* Карта сценария по наброску (этап 8): местность — строками символов (один символ — scale×scale клеток), объекты, города и герои — по клеткам,
 * дороги — по опорным точкам. Лес, рисунки декора и края пятен — от сида, так что набросок короткий, а карта живая. Чистый TS, без DOM. */
import { Rng, fnv1a } from '../../../gops/sim/rng';
import type { HeroPick } from '../heroes';
import { MOUNT_H, MOUNT_W, OBJECTS, type Purse, type ResId, TERRAINS, TERRAIN_INDEX, type TerrainId, TOWN_H, TOWN_W, WATER } from './data';
import { type Army, SHARD, addToArmy, artList } from './hero';
import { type Goal, type ScnState, type Trigger, bumpLevel, markSeen } from './scenario';
import { DECOR_SIZE, carvePaths, decorArts, noise } from './testmap';
import type { TownFaction } from './town';
import { type MapObject, type Player, type Quest, type World, cellOf, emptyArmy, makeHero, makeTown, placeObject, reveal, tavernOffer, xOf, yOf } from './world';

/** Символы наброска: строчная — местность, заглавная — она же в лесу, `^` — горы, `~` — вода. */
/** Вторая четвёрка: c — скалистый берег, n — снега, l — солончак, h — пустошь. */
const LAND: Record<string, TerrainId> = { g: 'meadow', s: 'swamp', a: 'ash', p: 'pine', r: 'rough', d: 'sand', c: 'coast', n: 'snow', l: 'saltflat', h: 'heath' };

export type Stack = [string, number];

export interface SketchObj {
  kind: string;
  /** Вход: [x, y]. */
  at: [number, number];
  owner?: number;
  army?: Stack[];
  n?: number;
  art?: string;
  /** Артефакт случайный, такой ступени. */
  artRank?: number;
  spell?: string;
  text?: string;
  key?: string;
  pair?: number;
  quest?: Quest;
  captive?: HeroPick;
  reward?: Purse;
  tag?: string;
}

export interface SketchTown {
  at: [number, number];
  faction: TownFaction;
  owner: number;
  name: string;
  tag?: string;
  /** Сверх начальных построек. */
  built?: string[];
  garrison?: Stack[];
}

export interface SketchHero {
  at: [number, number];
  owner: number;
  pick: HeroPick;
  army: Stack[];
  level?: number;
  tag?: string;
  skills?: { id: string; lv: number }[];
  spells?: string[];
}

export interface SketchPlayer {
  name: string;
  faction: TownFaction;
  bot?: 'easy' | 'medium' | 'hard';
  team?: number;
  keep?: boolean;
  res?: Partial<Record<ResId, number>>;
}

export interface Sketch {
  name: string;
  seed: number;
  scale: number;
  rows: string[];
  players: SketchPlayer[];
  towns: SketchTown[];
  heroes: SketchHero[];
  objects: SketchObj[];
  /** Цепочки опорных точек: дорога по кратчайшему через них, через воду — мостом. */
  roads?: [number, number][][];
  /** Где зарыт осколок. */
  shard?: [number, number];
  /** Закрыть клетки скалами: обход заставы у брода и т. п. */
  walls?: [number, number][];
  /** Лес: доля закрытых клеток в заглавных пятнах (0..1). */
  forest?: number;
}

export interface ScenarioSpec {
  goals: Goal[];
  lose: { text: string; cond: ScnState['lose'][number]['cond'] }[];
  triggers: Trigger[];
}

const START_RES: Record<ResId, number> = { semki: 10000, wood: 15, stone: 15, amber: 5, salt: 5, stariron: 5, resin: 5 };

export function buildSketch(sk: Sketch): World {
  const sw = sk.rows[0].length;
  const sh = sk.rows.length;
  for (const row of sk.rows) if (row.length !== sw) throw new Error(`Набросок «${sk.name}»: строки разной длины`);
  const W = sw * sk.scale;
  const H = sh * sk.scale;
  const n = W * H;
  const r = new Rng(sk.seed ^ fnv1a(sk.name));
  const w: World = {
    seed: sk.seed, rng: r.u32(), w: W, h: H, levels: 1, terrain: Array<number>(n).fill(0), road: Array<number>(n).fill(0), block: Array<number>(n).fill(0), decor: [], objects: [], entries: {}, towns: [], heroes: [],
    players: sk.players.map((p, id): Player => ({
      id, name: p.name, faction: p.faction, res: { ...START_RES, ...p.res }, explored: Array<number>(n).fill(0), alive: true, townless: 0, keys: [], obelisks: [], scrap: {},
      ...(p.bot ? { bot: p.bot } : {}), ...(p.team !== undefined ? { team: p.team } : {}), ...(p.keep ? { keep: true } : {}),
    })),
    day: 0, current: 0, pending: null, nextObj: 1, nextHero: 1, shard: -1, shardHint: [0, 0], winner: -1, over: false, weekNote: '', name: sk.name,
  };

  // местность: края пятен суши дрожат шумом, вода — строго по наброску (реки не рвутся)
  const jx = noise(r.u32(), 5);
  const jy = noise(r.u32(), 5);
  const at = (sx: number, sy: number): string => sk.rows[Math.max(0, Math.min(sh - 1, sy))][Math.max(0, Math.min(sw - 1, sx))];
  const sym = new Array<string>(n);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const raw = at(Math.trunc(x / sk.scale), Math.trunc(y / sk.scale));
      let ch = raw;
      if (raw !== '~') {
        const k = sk.scale * 0.7;
        const dx = Math.trunc((jx(x, y) - 0.5) * 2 * k);
        const dy = Math.trunc((jy(x, y) - 0.5) * 2 * k);
        const j = at(Math.trunc((x + dx) / sk.scale), Math.trunc((y + dy) / sk.scale));
        if (j !== '~') ch = j;
      }
      sym[cellOf(w, x, y)] = ch;
    }
  }
  /** Под горами — местность соседей по наброску. */
  const under = (c: number): number => {
    const sx = Math.trunc(xOf(w, c) / sk.scale);
    const sy = Math.trunc(yOf(w, c) / sk.scale);
    for (let rr = 1; rr < 6; rr++) {
      for (const [dx, dy] of [[rr, 0], [-rr, 0], [0, rr], [0, -rr]]) {
        const ch = at(sx + dx, sy + dy).toLowerCase();
        if (LAND[ch]) return TERRAIN_INDEX[LAND[ch]];
      }
    }
    return TERRAIN_INDEX.rough;
  };
  for (let c = 0; c < n; c++) {
    const ch = sym[c];
    if (ch === '~') w.terrain[c] = WATER;
    else if (ch === '^') w.terrain[c] = under(c);
    else w.terrain[c] = TERRAIN_INDEX[LAND[ch.toLowerCase()] ?? 'meadow'];
  }

  const putDecor = (c: number): void => {
    const t = TERRAINS[w.terrain[c]];
    const i = r.below(8);
    w.block[c] = 1;
    w.decor.push({ cell: c, art: `decor-${decorArts(t.id)}-${i + 1}`, size: DECOR_SIZE[i] });
  };
  const clearDecor = (c: number): void => {
    w.block[c] = 0;
    const i = w.decor.findIndex((d) => d.cell === c && d.art.startsWith('decor'));
    if (i >= 0) w.decor.splice(i, 1);
  };

  // горы: блоки 4×3 по пятнам `^`, остаток — скалы декором
  const mount = new Uint8Array(n);
  for (let y = 0; y + MOUNT_H <= H; y += MOUNT_H) {
    for (let x = 0; x + MOUNT_W <= W; x++) {
      let ok = true;
      for (let yy = y; yy < y + MOUNT_H && ok; yy++) for (let xx = x; xx < x + MOUNT_W && ok; xx++) ok = sym[cellOf(w, xx, yy)] === '^' && !mount[cellOf(w, xx, yy)];
      if (!ok) continue;
      for (let yy = y; yy < y + MOUNT_H; yy++) {
        for (let xx = x; xx < x + MOUNT_W; xx++) {
          mount[cellOf(w, xx, yy)] = 1;
          w.block[cellOf(w, xx, yy)] = 1;
        }
      }
      const tid = TERRAINS[w.terrain[cellOf(w, x, y + MOUNT_H - 1)]].id;
      const art = tid === 'ash' ? 3 : tid === 'swamp' ? 2 : tid === 'pine' ? 1 : 1 + r.below(2) * 3;
      w.decor.push({ cell: cellOf(w, x, y + MOUNT_H - 1), art: `mountain-${art}`, size: MOUNT_W + 1.2 });
      x += MOUNT_W - 1;
    }
  }
  // лес: в заглавных пятнах густо, в открытом поле — редкие деревья
  const forest = noise(r.u32(), 3);
  const thick = sk.forest ?? 0.72;
  for (let c = 0; c < n; c++) {
    if (w.block[c] || w.terrain[c] === WATER) continue;
    const ch = sym[c];
    const dense = ch === '^' || (ch !== ch.toLowerCase() && ch !== '~');
    const f = forest(xOf(w, c), yOf(w, c));
    if (dense ? f < thick + 0.2 && r.f() < thick + 0.15 : r.f() < 0.025) putDecor(c);
  }

  // тела объектов и городов
  const footprint = (x: number, y: number, fw: number, fh: number): number[] => {
    const out: number[] = [];
    const left = x - (fw >> 1);
    for (let yy = y - fh + 1; yy <= y; yy++) {
      for (let xx = left; xx < left + fw; xx++) {
        if ((xx === x && yy === y) || xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        out.push(cellOf(w, xx, yy));
      }
    }
    return out;
  };
  const clearAround = (x: number, y: number, fw: number, fh: number): void => {
    const left = x - (fw >> 1);
    for (let yy = y - fh; yy <= y + 1; yy++) {
      for (let xx = left - 1; xx <= left + fw; xx++) {
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const c = cellOf(w, xx, yy);
        if (!mount[c]) clearDecor(c);
      }
    }
  };
  const dry = (c: number): void => {
    if (w.terrain[c] === WATER) w.terrain[c] = TERRAIN_INDEX.sand;
  };
  const armyOf = (list: Stack[] | undefined): Army | undefined => {
    if (!list?.length) return undefined;
    const a = emptyArmy();
    for (const [cre, k] of list) addToArmy(a, cre, k);
    return a;
  };
  const solid = new Set<number>();

  for (const t of sk.towns) {
    const [x, y] = t.at;
    const c = cellOf(w, x, y);
    clearAround(x, y, TOWN_W, TOWN_H);
    for (const b of [c, ...footprint(x, y, TOWN_W, TOWN_H)]) dry(b);
    for (const b of footprint(x, y, TOWN_W, TOWN_H)) {
      w.block[b] = 1;
      solid.add(b);
    }
    const town = makeTown(w, t.faction, t.owner, c, t.name);
    for (const b of t.built ?? []) if (!town.built.includes(b)) town.built.push(b);
    if (t.garrison) town.garrison = armyOf(t.garrison)!;
    if (t.tag) town.tag = t.tag;
    w.towns.push(town);
  }

  for (const o of sk.objects) {
    const def = OBJECTS[o.kind];
    if (!def) throw new Error(`Набросок «${sk.name}»: нет объекта ${o.kind}`);
    const [x, y] = o.at;
    const c = cellOf(w, x, y);
    clearAround(x, y, def.w, def.h);
    dry(c);
    const cells = o.kind === 'stack' ? undefined : footprint(x, y, def.w, def.h);
    for (const b of cells ?? []) {
      dry(b);
      solid.add(b);
    }
    let art = o.art;
    if (!art && o.artRank) {
      const list = artList(o.artRank);
      art = list[r.below(list.length)];
    }
    const fx = def.effect;
    const obj: Omit<MapObject, 'id'> = {
      kind: o.kind, cell: c, owner: o.owner ?? -1, ...(cells ? { cells } : {}), army: armyOf(o.army),
      n: o.n ?? (fx.t === 'pile' ? fx.min : fx.t === 'dwelling' ? 0 : undefined),
      ...(art ? { art } : {}), ...(o.spell ? { spell: o.spell } : {}), ...(o.text ? { text: o.text } : {}), ...(o.key ? { key: o.key } : {}),
      ...(o.pair !== undefined ? { pair: o.pair } : {}), ...(o.quest ? { quest: { ...o.quest } } : {}), ...(o.captive ? { captive: o.captive } : {}),
      ...(o.reward ? { reward: o.reward } : {}), ...(o.tag ? { tag: o.tag } : {}),
    };
    placeObject(w, obj);
    // отряд и застава стоят прямо на дороге: стерегут брод или проход
    if (o.kind !== 'stack' && o.kind !== 'garrison') solid.add(c);
  }

  // дороги: кратчайший путь между опорными точками, лес рубим, через воду — мост
  for (const chain of sk.roads ?? []) {
    for (let i = 0; i + 1 < chain.length; i++) layRoad(w, cellOf(w, ...chain[i]), cellOf(w, ...chain[i + 1]), solid, mount, clearDecor);
  }

  for (const [x, y] of sk.walls ?? []) {
    const c = cellOf(w, x, y);
    clearDecor(c);
    w.road[c] = 0;
    if (w.terrain[c] === WATER) continue;
    putDecor(c);
  }

  if (sk.shard) {
    w.shard = cellOf(w, ...sk.shard);
    clearDecor(w.shard);
    w.shardHint = [r.int(-10, 10), r.int(-10, 10)];
  }

  for (const s of sk.heroes) {
    const c = cellOf(w, ...s.at);
    clearDecor(c);
    const h = makeHero(w, s.pick, s.owner, c);
    h.army = armyOf(s.army) ?? emptyArmy();
    if (s.level) bumpLevel(h, s.level);
    for (const sk2 of s.skills ?? []) {
      const had = h.skills.find((x) => x.id === sk2.id);
      if (had) had.lv = Math.max(had.lv, sk2.lv);
      else h.skills.push({ ...sk2 });
    }
    for (const sp of s.spells ?? []) if (!h.spells.includes(sp)) h.spells.push(sp);
    if (s.tag) h.tag = s.tag;
    w.heroes.push(h);
  }

  // каждый вход достижим от своих героев и городов; где лес заслонил — просека
  carvePaths(w, ...w.heroes.map((h) => h.cell), ...w.towns.map((t) => t.cell));
  for (const h of w.heroes) {
    reveal(w, h.owner, h.cell, 8);
  }
  for (const t of w.towns) if (t.owner >= 0) reveal(w, t.owner, t.cell, 8);
  w.rng = r.s;
  for (const t of w.towns) t.tavern = tavernOffer(w, t.faction);
  return w;
}

function layRoad(w: World, from: number, to: number, solid: Set<number>, mount: Uint8Array, clearDecor: (c: number) => void): void {
  // Дейкстра на целых весах: поле 2, лес 5, вода 9 (мост)
  const n = w.w * w.h;
  const dist = new Int32Array(n).fill(1 << 30);
  const prev = new Int32Array(n).fill(-1);
  const buckets: number[][] = [];
  dist[from] = 0;
  buckets[0] = [from];
  for (let d = 0; d < buckets.length; d++) {
    const list = buckets[d];
    if (!list) continue;
    for (const c of list) {
      if (dist[c] !== d) continue;
      if (c === to) break;
      const x = xOf(w, c);
      const y = yOf(w, c);
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w.w || ny >= w.h) continue;
        const nc = cellOf(w, nx, ny);
        if ((solid.has(nc) && nc !== to) || mount[nc]) continue;
        const step = w.terrain[nc] === WATER ? 9 : w.block[nc] ? 5 : w.road[nc] ? 1 : 2;
        const nd = d + step;
        if (nd >= dist[nc]) continue;
        dist[nc] = nd;
        prev[nc] = c;
        (buckets[nd] ??= []).push(nc);
      }
    }
    if (dist[to] <= d) break;
  }
  if (dist[to] >= 1 << 30) return;
  for (let c = to; c >= 0; c = prev[c]) {
    if (solid.has(c)) continue;
    if (w.terrain[c] === WATER) {
      w.terrain[c] = TERRAIN_INDEX.sand;
      w.road[c] = 3;
    } else if (w.road[c] !== 3) w.road[c] = 1;
    clearDecor(c);
  }
}

/** Сценарий: карта + задания в мир. */
export function attachScenario(w: World, id: string, human: number, spec: ScenarioSpec): void {
  const s: ScnState = {
    id, human, goals: spec.goals.map((g) => ({ ...g })), lose: spec.lose, triggers: spec.triggers, fired: {}, flags: [], seen: [],
  };
  markSeen(w, s);
  w.scn = s;
}

export { SHARD };
