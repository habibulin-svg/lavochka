import { describe, expect, it } from 'vitest';
import { botAction } from '../../src/geroi/bot/bot';
import { act as battleAct, createBattle } from '../../src/geroi/sim/battle';
import { CREATURES, FACTIONS, type Faction, factionCreatures } from '../../src/geroi/sim/creatures';
import { factionClasses } from '../../src/geroi/sim/heroes';
import { RES, OBJECTS, WATER } from '../../src/geroi/sim/adv/data';
import { ARTIFACTS, SKILLS, armyEmpty, heroMaxMp, xpForLevel } from '../../src/geroi/sim/adv/hero';
import { BUILDINGS, type TownFaction, buildError, has } from '../../src/geroi/sim/adv/town';
import { type GameSpec, makeTestMap } from '../../src/geroi/sim/adv/testmap';
import {
  type AdvAction, type World, act, actionError, applyBattle, battleSetup, cellOf, dailyIncome, gainXp, guardOf, heroAt, heroById, neighbors, objAt, pathOf, placeObject, reachOf, stepCost, townAt, xOf, yOf,
} from '../../src/geroi/sim/adv/world';

const TF = FACTIONS.map((f) => f.id as TownFaction);
const spec = (a: TownFaction = 'zatulye', b: TownFaction = 'zatonye', seed = 5): GameSpec => ({
  seed,
  players: [
    { name: 'Первый', faction: a, hero: { cls: factionClasses(a as Faction)[0].id, n: 1 } },
    { name: 'Второй', faction: b, hero: { cls: factionClasses(b as Faction)[1].id, n: 2 } },
  ],
});
const fresh = (a?: TownFaction, b?: TownFaction, seed?: number): World => makeTestMap(spec(a, b, seed));
const hero0 = (w: World) => w.heroes.find((h) => h.owner === 0)!;
/** Убрать всё, что мешает, вокруг клетки: для точечных проверок. */
function clear(w: World, c: number, r = 2): void {
  const x = xOf(w, c);
  const y = yOf(w, c);
  for (let yy = y - r; yy <= y + r; yy++) {
    for (let xx = x - r; xx <= x + r; xx++) {
      if (xx < 0 || yy < 0 || xx >= w.w || yy >= w.h) continue;
      const k = cellOf(w, xx, yy);
      if (townAt(w, k)) continue;
      const o = objAt(w, k);
      if (o) {
        w.objects.splice(w.objects.indexOf(o), 1);
        delete w.entries[k];
      }
      w.block[k] = 0;
      w.terrain[k] = 0;
      w.road[k] = 0;
    }
  }
}
function neighborStep(w: World, c: number, dx: number, dy: number): number {
  return cellOf(w, xOf(w, c) + dx, yOf(w, c) + dy);
}
/** Прямо поставить героя (герой не на воротах, вокруг чисто). */
function standAt(w: World, x: number, y: number) {
  const h = hero0(w);
  const c = cellOf(w, x, y);
  clear(w, c, 4);
  h.cell = c;
  h.mp = heroMaxMp(h);
  return h;
}

describe('geroi/adv: тестовая карта', () => {
  it('детерминизм: один сид — один мир, и он JSON', () => {
    const a = fresh();
    const b = fresh();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
    expect(JSON.stringify(fresh('zatulye', 'zatonye', 6))).not.toBe(JSON.stringify(a));
  });
  it('все фракции: всё достижимо из своего города, города соединены мостом', () => {
    for (const a of TF) for (const b of TF) {
      if (a === b) continue;
      const w = fresh(a, b, 7);
      const h = hero0(w);
      // пешком, охрану считаем проходимой: проверяем сам рельеф
      const seen = new Set([h.cell]);
      const q = [h.cell];
      for (let i = 0; i < q.length; i++) {
        for (const nb of neighbors(w, q[i])) {
          if (seen.has(nb) || w.terrain[nb] === WATER || w.block[nb]) continue;
          seen.add(nb);
          q.push(nb);
        }
      }
      const unreachable = [...w.objects.map((o) => `${o.kind}@${xOf(w, o.cell)},${yOf(w, o.cell)}`).filter((_, i) => !seen.has(w.objects[i].cell)), ...w.towns.filter((t) => !seen.has(t.cell)).map((t) => t.name)];
      expect(unreachable, `${a} ${b}`).toEqual([]);
      expect(w.shard).toBeGreaterThanOrEqual(0);
    }
  });
  it('зеркальность: те же расстояния от обоих городов до шахт', () => {
    const w = fresh('zatulye', 'kuznya');
    const r0 = reachOf(w, hero0(w));
    const h1 = w.heroes.find((h) => h.owner === 1)!;
    const r1 = reachOf(w, h1);
    const nearest = (r: typeof r0): number => Math.min(...w.objects.filter((o) => o.kind === 'mine-wood').map((o) => r.dist[o.cell]).filter((d) => d >= 0));
    expect(nearest(r0)).toBeGreaterThan(0);
    // вход у объекта всегда снизу, поэтому зеркало не точное; DESIGN §7.5 допускает день хода
    expect(Math.abs(nearest(r0) - nearest(r1))).toBeLessThanOrEqual(1500);
  });
  it('объекты описаны для всего, что ставит карта', () => {
    const w = fresh();
    for (const o of w.objects) expect(OBJECTS[o.kind], o.kind).toBeTruthy();
    expect(Object.keys(ARTIFACTS).length).toBe(60);
    expect(SKILLS.length).toBe(24);
    for (const f of TF) for (const b of Object.values(BUILDINGS[f])) for (const q of b.req) expect(BUILDINGS[f][q], `${f}: ${b.id} → ${q}`).toBeTruthy();
  });
});

describe('geroi/adv: ход', () => {
  it('идём по пути: тратится ход, открывается туман, дальше запаса не уйти', () => {
    const w = fresh();
    const h = standAt(w, 20, 20);
    const to = cellOf(w, 22, 20);
    const before = h.mp;
    const explored = w.players[0].explored.reduce((a, b) => a + b, 0);
    const ev = act(w, { t: 'move', hero: h.id, to });
    expect(h.cell).toBe(to);
    expect(before - h.mp).toBe(stepCost(w, h, cellOf(w, 20, 20), cellOf(w, 21, 20)) * 2);
    expect(ev.filter((e) => e.e === 'step').length).toBe(2);
    expect(w.players[0].explored.reduce((a, b) => a + b, 0)).toBeGreaterThan(explored);
  });
  it('диагональ дороже, родная местность без штрафа, дорога дешевле', () => {
    const w = fresh('zatulye', 'zatonye');
    const h = standAt(w, 20, 20);
    const c = h.cell;
    expect(stepCost(w, h, c, neighborStep(w, c, 1, 0))).toBe(100);
    expect(stepCost(w, h, c, neighborStep(w, c, 1, 1))).toBe(141);
    w.terrain[neighborStep(w, c, 1, 0)] = 1;
    expect(stepCost(w, h, c, neighborStep(w, c, 1, 0))).toBe(175);
    w.road[neighborStep(w, c, 1, 0)] = 2;
    expect(stepCost(w, h, c, neighborStep(w, c, 1, 0))).toBe(50);
  });
  it('день: запас хода и доход, неделя: прирост', () => {
    const w = fresh();
    const h = hero0(w);
    const t = w.towns[0];
    h.mp = 0;
    const semki = w.players[0].res.semki;
    act(w, { t: 'end' });
    expect(w.current).toBe(1);
    expect(w.day).toBe(0);
    act(w, { t: 'end' });
    expect(w.current).toBe(0);
    expect(w.day).toBe(1);
    expect(h.mp).toBe(heroMaxMp(h));
    expect(w.players[0].res.semki).toBe(semki + dailyIncome(w, 0).semki!);
    const avail = t.avail[0];
    for (let i = 0; i < 12; i++) act(w, { t: 'end' });
    expect(w.day).toBe(7);
    expect(t.avail[0]).toBeGreaterThan(avail);
  });
  it('шахта: флаг и доход, куча: ресурс и исчезает', () => {
    const w = fresh();
    const h = standAt(w, 25, 25);
    const m = placeObject(w, { kind: 'mine-wood', cell: cellOf(w, 26, 25), owner: -1, cells: [] });
    const before = dailyIncome(w, 0).wood ?? 0;
    act(w, { t: 'move', hero: h.id, to: m.cell });
    expect(m.owner).toBe(0);
    expect(dailyIncome(w, 0).wood).toBe(before + 2);
    const pile = placeObject(w, { kind: 'res-stone', cell: cellOf(w, 27, 25), owner: -1, n: 7, cells: [] });
    const stone = w.players[0].res.stone;
    act(w, { t: 'move', hero: h.id, to: pile.cell });
    expect(w.players[0].res.stone).toBe(stone + 7);
    expect(objAt(w, pile.cell)).toBeUndefined();
  });
  it('отряд стережёт соседние клетки и останавливает бой', () => {
    const w = fresh();
    const h = standAt(w, 25, 25);
    const army = Array(7).fill(null);
    army[0] = { cre: 'neutral-wolf', count: 3 };
    const s = placeObject(w, { kind: 'stack', cell: cellOf(w, 28, 25), owner: -1, army, cells: [] });
    expect(guardOf(w, cellOf(w, 27, 25))).toBe(s);
    // путь сквозь охрану не проложен
    const r = reachOf(w, h);
    expect(r.prev[cellOf(w, 29, 25)]).not.toBe(cellOf(w, 28, 25));
    // щелчок по самому отряду: путь есть и кончается рядом с ним боем
    expect(reachOf(w, h).dist[s.cell]).toBeGreaterThan(0);
    act(w, { t: 'move', hero: h.id, to: s.cell });
    expect(xOf(w, h.cell)).toBe(27);
    expect(w.pending?.t).toBe('battle');
    const b = battleSetup(w);
    expect(b.setup.sides[1].hero).toBeNull();
    expect(actionError(w, { t: 'end' })).toBeTruthy();
  });
  it('бой: победа убирает отряд и даёт опыт, поражение — герой гибнет', () => {
    const play = (w: World) => {
      const b = createBattle(battleSetup(w).setup);
      for (let i = 0; i < 2000 && !b.over; i++) battleAct(b, botAction(b, 'medium'));
      expect(b.over).toBe(true);
      return applyBattle(w, b);
    };
    const w = fresh();
    const h = standAt(w, 25, 25);
    h.army = [{ cre: factionCreatures('zatulye').find((c) => c.tier === 7)!.id, count: 10 }, null, null, null, null, null, null];
    const army = Array(7).fill(null);
    army[0] = { cre: 'neutral-wolf', count: 2 };
    const s = placeObject(w, { kind: 'stack', cell: cellOf(w, 27, 25), owner: -1, army, cells: [] });
    act(w, { t: 'move', hero: h.id, to: cellOf(w, 26, 25) });
    expect(w.pending).toBeTruthy();
    play(w);
    expect(w.pending).toBeNull();
    expect(objAt(w, s.cell)).toBeUndefined();
    expect(h.xp).toBeGreaterThan(0);

    const w2 = fresh();
    const h2 = standAt(w2, 25, 25);
    h2.army = [{ cre: factionCreatures('zatulye').find((c) => c.tier === 1)!.id, count: 1 }, null, null, null, null, null, null];
    const big = Array(7).fill(null);
    big[0] = { cre: 'neutral-stonegiant', count: 9 };
    const s2 = placeObject(w2, { kind: 'stack', cell: cellOf(w2, 27, 25), owner: -1, army: big, cells: [] });
    act(w2, { t: 'move', hero: h2.id, to: cellOf(w2, 26, 25) });
    play(w2);
    expect(heroById(w2, h2.id)).toBeUndefined();
    expect(objAt(w2, s2.cell)).toBeTruthy();
  });
  it('повышение: стат растёт сразу, навык — на выбор, без выбора идти нельзя', () => {
    const w = fresh();
    const h = standAt(w, 25, 25);
    const sum = h.atk + h.def + h.power + h.know;
    gainXp(w, h, xpForLevel(2), []);
    expect(h.level).toBe(2);
    expect(h.atk + h.def + h.power + h.know).toBe(sum + 1);
    expect(h.ups.length).toBe(1);
    expect(actionError(w, { t: 'move', hero: h.id, to: cellOf(w, 26, 25) })).toBeTruthy();
    const opt = h.ups[0].options[0];
    act(w, { t: 'skill', hero: h.id, skill: opt });
    expect(h.skills.some((s) => s.id === opt)).toBe(true);
    expect(h.ups.length).toBe(0);
  });
});

describe('geroi/adv: город', () => {
  it('постройки: зависимости и один раз в день, найм только из жилища', () => {
    const w = fresh();
    const t = w.towns[0];
    w.players[0].res = { semki: 999999, wood: 999, stone: 999, amber: 999, salt: 999, stariron: 999, resin: 999 };
    expect(buildError(t, 'dwell7')).toBeTruthy();
    expect(actionError(w, { t: 'build', town: t.id, b: 'dwell2' })).toBeNull();
    act(w, { t: 'build', town: t.id, b: 'dwell2' });
    expect(has(t, 'dwell2')).toBe(true);
    expect(actionError(w, { t: 'build', town: t.id, b: 'dwell3' })).toBe('Сегодня уже строили');
    const c = factionCreatures('zatulye').find((x) => x.tier === 2 && !x.up)!;
    expect(t.avail[1]).toBe(c.weekly);
    act(w, { t: 'recruit', town: t.id, cre: c.id, count: c.weekly });
    expect(t.garrison.find((s) => s?.cre === c.id)?.count).toBe(c.weekly);
    expect(t.avail[1]).toBe(0);
    expect(actionError(w, { t: 'recruit', town: t.id, cre: c.id, count: 1 })).toBeTruthy();
    expect(actionError(w, { t: 'recruit', town: t.id, cre: factionCreatures('zatulye').find((x) => x.tier === 7)!.id, count: 1 })).toBeTruthy();
  });
  it('передача отрядов: герой не остаётся без армии', () => {
    const w = fresh();
    const h = hero0(w);
    const t = w.towns[0];
    expect(heroAt(w, t.cell)).toBe(h);
    const slots = h.army.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
    const free = t.garrison.indexOf(null);
    for (const i of slots.slice(0, -1)) act(w, { t: 'transfer', from: { h: h.id }, fromSlot: i, to: { t: t.id }, toSlot: t.garrison.indexOf(null) });
    expect(free).toBe(0);
    expect(actionError(w, { t: 'transfer', from: { h: h.id }, fromSlot: slots[slots.length - 1], to: { t: t.id }, toSlot: t.garrison.indexOf(null) })).toBe('Герой не может остаться без армии');
    expect(armyEmpty(h.army)).toBe(false);
  });
  it('Кузня: механизмы отливаются за камень и железо, не из прироста', () => {
    const w = fresh('kuznya', 'zatonye');
    const t = w.towns[0];
    w.players[0].res = { semki: 99999, wood: 99, stone: 99, amber: 99, salt: 99, stariron: 99, resin: 99 };
    t.built.push('dwell2');
    const wasp = CREATURES['kuznya-wasp'];
    const stone = w.players[0].res.stone;
    t.forge = wasp.cost * 3;
    act(w, { t: 'recruit', town: t.id, cre: wasp.id, count: 3 });
    expect(w.players[0].res.stone).toBeLessThan(stone);
    expect(t.forge).toBe(0);
    expect(actionError(w, { t: 'recruit', town: t.id, cre: wasp.id, count: 1 })).toBe('Плавка не тянет столько');
    for (let i = 0; i < 2; i++) act(w, { t: 'end' });
    expect(t.forge).toBeGreaterThan(0);
  });
  it('Академия: гильдия пуста, заклинания — из опытов', () => {
    const w = fresh('akademiya', 'zatonye');
    const t = w.towns[0];
    w.players[0].res.amber = 50;
    expect(t.guild.flat().length).toBe(0);
    t.built.push('guild1', 'lab');
    act(w, { t: 'research', town: t.id, school: 'fire' });
    expect(actionError(w, { t: 'research', town: t.id, school: 'water' })).toBeTruthy();
    for (let i = 0; i < 6; i++) act(w, { t: 'end' });
    expect(t.research).toBeNull();
    expect(t.guild[0]).toContain('fire-arrow');
  });
  it('Затулье: сход предлагает три указа', () => {
    const w = fresh('zatulye', 'zatonye');
    const t = w.towns[0];
    w.players[0].res = { semki: 99999, wood: 99, stone: 99, amber: 99, salt: 99, stariron: 99, resin: 99 };
    t.built.push('hall2');
    act(w, { t: 'build', town: t.id, b: 'skhod' });
    expect(t.decrees.length).toBe(3);
    const semki = w.players[0].res.semki;
    t.decrees = ['semki', 'discount', 'militia'];
    act(w, { t: 'decree', town: t.id, id: 'semki' });
    expect(w.players[0].res.semki).toBe(semki + 2000);
    expect(t.decrees.length).toBe(0);
  });
  it('взятие пустого города без боя; без городов и героев — проигрыш', () => {
    const w = fresh();
    const t1 = w.towns[1];
    const foe = w.heroes.find((h) => h.owner === 1)!;
    w.heroes.splice(w.heroes.indexOf(foe), 1);
    const h = standAt(w, xOf(w, t1.cell), yOf(w, t1.cell) + 2);
    h.mp = 5000;
    act(w, { t: 'move', hero: h.id, to: t1.cell });
    expect(t1.owner).toBe(0);
    expect(w.over).toBe(true);
    expect(w.winner).toBe(0);
  });
});

describe('geroi/adv: партия случайными ходами', () => {
  it('300 дней случайных действий: мир цел и остаётся JSON', () => {
    for (const seed of [1, 2]) {
      const w = fresh(TF[seed], TF[(seed + 1) % 4], seed);
      let rng = seed * 97 + 3;
      const rand = (n: number): number => {
        rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
        return rng % n;
      };
      for (let step = 0; step < 900 && !w.over; step++) {
        if (w.pending?.t === 'battle') {
          const b = createBattle(battleSetup(w).setup);
          for (let i = 0; i < 3000 && !b.over; i++) battleAct(b, botAction(b, 'easy'));
          applyBattle(w, b);
          continue;
        }
        if (w.pending?.t === 'choice') {
          act(w, { t: 'choose', id: w.pending.options[0].id });
          continue;
        }
        const mine = w.heroes.filter((h) => h.owner === w.current);
        const pendingUp = mine.find((h) => h.ups.length);
        if (pendingUp) {
          act(w, { t: 'skill', hero: pendingUp.id, skill: pendingUp.ups[0].options[0] ?? null });
          continue;
        }
        const choices: AdvAction[] = [{ t: 'end' }];
        for (const h of mine) {
          const r = reachOf(w, h);
          const cells: number[] = [];
          for (let c = 0; c < r.dist.length; c++) if (r.dist[c] > 0) cells.push(c);
          if (cells.length) for (let i = 0; i < 3; i++) choices.push({ t: 'move', hero: h.id, to: cells[rand(cells.length)] });
        }
        for (const t of w.towns.filter((x) => x.owner === w.current)) {
          for (const b of Object.keys(BUILDINGS[t.faction])) choices.push({ t: 'build', town: t.id, b });
        }
        const a = choices[rand(choices.length)];
        if (!actionError(w, a)) act(w, a);
      }
      const copy = JSON.parse(JSON.stringify(w)) as World;
      expect(copy).toEqual(w);
      for (const h of w.heroes) {
        expect(h.cell).toBeGreaterThanOrEqual(0);
        for (const s of h.army) if (s) expect(s.count).toBeGreaterThan(0);
        expect(pathOf(reachOf(w, h), h.cell)).toEqual([]);
      }
      for (const r of RES) for (const p of w.players) expect(p.res[r]).toBeGreaterThanOrEqual(0);
    }
  }, 120000);
});
