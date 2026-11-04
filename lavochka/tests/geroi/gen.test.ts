import { describe, expect, it } from 'vitest';
import { FACTIONS, type Faction } from '../../src/geroi/sim/creatures';
import { factionClasses } from '../../src/geroi/sim/heroes';
import { MOUNT_H, MOUNT_W, NATIVE, OBJECTS, TERRAINS, TOWN_H, TOWN_W, WATER } from '../../src/geroi/sim/adv/data';
import { FAIR_METRICS, fairness } from '../../src/geroi/sim/adv/fair';
import { DAY_MP, type GenOptions, type SizeId, TEMPLATES, daySeed, genQuery, generateMap, parseGen } from '../../src/geroi/sim/adv/gen';
import type { GameSpec } from '../../src/geroi/sim/adv/testmap';
import type { TownFaction } from '../../src/geroi/sim/adv/town';
import { type World, act, cellOf, neighbors, reachOf, xOf, yOf } from '../../src/geroi/sim/adv/world';

const TF = FACTIONS.map((f) => f.id as TownFaction);
const specOf = (n: number, factions: TownFaction[]): GameSpec => ({
  seed: 1,
  players: Array.from({ length: n }, (_, i) => {
    const f = factions[i % factions.length];
    return { name: `Игрок ${i + 1}`, faction: f, hero: { cls: factionClasses(f as Faction)[i % 2].id, n: 1 + (i >> 1) } };
  }),
});
const gen = (template: string, size: SizeId, seed: number, factions: TownFaction[] = ['zatulye'], more: Partial<GenOptions> = {}): World =>
  generateMap(specOf(TEMPLATES[template].players, factions), { template, size, seed, water: 'lakes', guard: 'normal', ...more });

/** Дойти от городов: охрану бьём, на вход объекта заходим, но дальше не идём; на островах — ещё и на лодке. */
function reach(w: World, boat: boolean): Uint8Array {
  const seen = new Uint8Array(w.w * w.h);
  const stacks = new Set(w.objects.filter((o) => o.kind === 'stack').map((o) => o.cell));
  const stops = new Set([...w.objects.map((o) => o.cell), ...w.towns.map((t) => t.cell)]);
  const q = w.towns.map((t) => t.cell);
  for (const c of q) seen[c] = 1;
  for (let i = 0; i < q.length; i++) {
    const c = q[i];
    if (stops.has(c) && !stacks.has(c) && !w.towns.some((t) => t.cell === c)) continue;
    for (const n of neighbors(w, c)) {
      if (seen[n] || w.block[n] || (w.terrain[n] === WATER && !boat)) continue;
      seen[n] = 1;
      q.push(n);
    }
  }
  return seen;
}

/** Каждая закрытая клетка чем-то закрыта: деревом, горой, объектом или городом — иначе на карте «невидимая стена». */
function uncovered(w: World): number[] {
  const cover = new Uint8Array(w.w * w.h);
  for (const d of w.decor) {
    if (d.art.startsWith('mountain')) {
      for (let y = yOf(w, d.cell) - MOUNT_H + 1; y <= yOf(w, d.cell); y++) for (let x = xOf(w, d.cell); x < xOf(w, d.cell) + MOUNT_W; x++) cover[cellOf(w, x, y)] = 1;
    } else cover[d.cell] = 1;
  }
  for (const o of w.objects) for (const c of o.cells ?? []) cover[c] = 1;
  for (const t of w.towns) {
    for (let y = yOf(w, t.cell) - TOWN_H + 1; y <= yOf(w, t.cell); y++) for (let x = xOf(w, t.cell) - (TOWN_W >> 1); x <= xOf(w, t.cell) + (TOWN_W >> 1); x++) cover[cellOf(w, x, y)] = 1;
  }
  const out: number[] = [];
  for (let c = 0; c < w.w * w.h; c++) if (w.block[c] && !cover[c]) out.push(c);
  return out;
}

function checkWorld(w: World, islands: boolean, label: string): void {
  // объекты описаны, входы не на стене, клетки не пересекаются
  const used = new Map<number, string>();
  for (const o of w.objects) {
    expect(OBJECTS[o.kind], `${label}: ${o.kind}`).toBeTruthy();
    expect(w.block[o.cell], `${label}: вход ${o.kind} закрыт`).toBe(0);
    expect(w.entries[o.cell]).toBe(o.id);
    for (const c of [o.cell, ...(o.cells ?? [])]) {
      expect(used.has(c), `${label}: ${o.kind} налез на ${used.get(c)}`).toBe(false);
      used.set(c, o.kind);
    }
    if (o.kind === 'boat') expect(w.terrain[o.cell]).toBe(WATER);
    else expect(w.terrain[o.cell], `${label}: ${o.kind} на воде`).not.toBe(WATER);
  }
  expect(uncovered(w), `${label}: закрытые клетки без картинки`).toEqual([]);
  // всё достижимо: на островах свой остров — пешком, остальное — на лодке
  const foot = reach(w, false);
  const wet = islands ? reach(w, true) : foot;
  const near = (seen: Uint8Array, c: number): boolean => seen[c] === 1 || neighbors(w, c).some((n) => seen[n] && w.terrain[n] !== WATER);
  const lost = w.objects.filter((o) => !near(wet, o.cell)).map((o) => `${o.kind}@${xOf(w, o.cell)},${yOf(w, o.cell)}`);
  expect(lost, `${label}: не дойти`).toEqual([]);
  if (islands) {
    // своя лодка и верфь — пешком от своего города
    for (const t of w.towns) {
      const own = reach({ ...w, towns: [t] }, false);
      expect(w.objects.some((o) => o.kind === 'boat' && near(own, o.cell)), `${label}: у ${t.name} нет лодки`).toBe(true);
      expect(w.objects.some((o) => o.kind === 'shipyard' && own[o.cell]), `${label}: у ${t.name} нет верфи`).toBe(true);
    }
  } else {
    for (const t of w.towns) expect(foot[t.cell], `${label}: ${t.name}`).toBe(1);
  }
  expect(w.shard).toBeGreaterThanOrEqual(0);
  expect(wet[w.shard], `${label}: осколок не достать`).toBe(1);
}

describe('geroi/gen: случайные карты', () => {
  it('один сид — одна карта, мир — чистый JSON', () => {
    for (const t of Object.keys(TEMPLATES)) {
      const size = TEMPLATES[t].sizes[0];
      const a = gen(t, size, 11, TF);
      const b = gen(t, size, 11, TF);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(JSON.parse(JSON.stringify(a))).toEqual(a);
      expect(JSON.stringify(gen(t, size, 12, TF))).not.toBe(JSON.stringify(a));
    }
  });

  // сидов поменьше на больших картах: время
  // GEN_SEEDS=200 — длинный прогон на многих сидах
  const many = Number(process.env.GEN_SEEDS ?? 0);
  const range = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);
  const SEEDS: Record<SizeId, number[]> = many ? { s: range(many), m: range(many), l: range(Math.max(1, many >> 2)) } : { s: range(6), m: range(3), l: [1] };
  for (const t of Object.values(TEMPLATES)) {
    for (const size of t.sizes) {
      it(`${t.name}, ${size}: проходимость и честность`, () => {
        for (const seed of SEEDS[size]) {
          const label = `${t.id}/${size}/${seed}`;
          // одна фракция у всех: меряем саму карту, а не родную местность
          const f = TF[seed % TF.length];
          const w = gen(t.id, size, seed, [f]);
          checkWorld(w, !!t.islands, label);
          expect(w.towns.length).toBe(t.players);
          const m = fairness(w, !!t.islands);
          for (const k of FAIR_METRICS) {
            // у кольца середина — озеро: осколок один, на чьём-то берегу
            if (k === 'center' && t.id === 'ring') continue;
            const v = m[k];
            // на малой карте сокровищнице иногда (1 из 150) не хватает места — тогда её нет ни у кого, это честно
            if (k === 'treasury' && size === 's' && v.every((x) => x < 0)) continue;
            expect(v.every((x) => x > 0), `${label}: ${k} ${v.join('/')}`).toBe(true);
            expect(Math.max(...v) - Math.min(...v), `${label}: ${k} ${v.join('/')}`).toBeLessThanOrEqual(DAY_MP);
          }
        }
      });
    }
  }

  it('разные фракции: родная местность у города, всё достижимо', () => {
    for (const t of Object.values(TEMPLATES)) {
      const w = gen(t.id, t.sizes[0], 7, TF);
      checkWorld(w, !!t.islands, `${t.id} смесь`);
      for (const town of w.towns) {
        let own = 0;
        let all = 0;
        for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
          const x = xOf(w, town.cell) + dx;
          const y = yOf(w, town.cell) + dy;
          if (x < 0 || y < 0 || x >= w.w || y >= w.h) continue;
          all++;
          if (TERRAINS[w.terrain[cellOf(w, x, y)]].id === NATIVE[town.faction]) own++;
        }
        expect(own / all, `${t.id}: ${town.name}`).toBeGreaterThan(0.5);
      }
    }
  });

  it('мир работает: путь от героя, ход по кругу всех игроков', () => {
    const w = gen('four', 'm', 3, TF);
    const h = w.heroes[0];
    const r = reachOf(w, h);
    expect([...r.dist].filter((d) => d > 0).length).toBeGreaterThan(50);
    for (let i = 0; i < 4; i++) {
      expect(w.current).toBe(i);
      act(w, { t: 'end' });
    }
    expect(w.current).toBe(0);
    expect(w.day).toBe(1);
  });

  it('настройки: без воды — нет озёр и рек, сильная охрана сильнее слабой', () => {
    const dry = gen('duel', 'm', 4, ['kuznya'], { water: 'none' });
    expect(dry.terrain.filter((t) => t === WATER).length).toBe(0);
    const wet = gen('duel', 'm', 4, ['kuznya'], { water: 'much' });
    expect(wet.terrain.filter((t) => t === WATER).length).toBeGreaterThan(50);
    const power = (w: World): number => w.objects.reduce((s, o) => s + (o.army ?? []).reduce((a, x) => a + (x ? x.count : 0), 0), 0);
    expect(power(gen('duel', 'm', 4, ['kuznya'], { guard: 'strong' }))).toBeGreaterThan(power(gen('duel', 'm', 4, ['kuznya'], { guard: 'weak' })));
  });

  it('ссылка и карта дня', () => {
    const o: GenOptions = { template: 'ring', size: 'l', water: 'much', guard: 'strong', seed: 4242 };
    expect(parseGen(new URLSearchParams(genQuery(o)))).toEqual(o);
    expect(parseGen(new URLSearchParams('gen=nope'))).toBeNull();
    // размер, которого у шаблона нет, — первый доступный
    expect(parseGen(new URLSearchParams('gen=four&size=s&seed=5'))?.size).toBe('m');
    expect(daySeed('2026-11-04')).toBe(daySeed('2026-11-04'));
    expect(daySeed('2026-11-04')).not.toBe(daySeed('2026-11-05'));
  });
});
