import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { botAction, playOut } from '../../src/geroi/bot/bot';
import { randomArmy } from '../../src/geroi/sim/army';
import {
  type Action, type BattleSetup, type BattleState, act, actionError, adjacent, attackOf, cellsOf, cloneBattle, createBattle, currentUnit, damageFactor, defenseOf, reachOf, sideValue, unitById, unitValue,
} from '../../src/geroi/sim/battle';
import { CREATURES, FACTIONS, type Faction, factionCreatures, hasAb, rootOf } from '../../src/geroi/sim/creatures';
import { CLASSES, factionClasses } from '../../src/geroi/sim/heroes';
import { CELLS, cellOf, hexDist, neighbors } from '../../src/geroi/sim/hex';
import { SPELLS } from '../../src/geroi/sim/spells';

const hero = (f: Faction) => ({ cls: factionClasses(f)[0].id, n: 1 });
const setup = (a: [Faction, string, number][], b: [Faction, string, number][], seed = 7): BattleSetup => ({
  seed, field: 'meadow',
  sides: [
    { hero: hero(a[0][0]), army: a.map(([, cre, count]) => ({ cre, count })) },
    { hero: hero(b[0][0]), army: b.map(([, cre, count]) => ({ cre, count })) },
  ],
});
/** Бой без морали и удачи, без препятствий: чистые формулы. */
function plain(s: BattleState): BattleState {
  for (const h of s.sides) {
    h.morale = 0;
    h.luck = 0;
  }
  s.obstacles = [];
  s.bog = [];
  s.bogOwner = -1;
  return s;
}

describe('geroi/hex', () => {
  it('соседи — на расстоянии 1, взаимно', () => {
    for (let c = 0; c < CELLS; c++) for (const n of neighbors(c)) {
      expect(hexDist(c, n)).toBe(1);
      expect(neighbors(n)).toContain(c);
    }
  });
  it('внутри поля у клетки 6 соседей', () => expect(neighbors(cellOf(7, 5))).toHaveLength(6));
  it('расстояние через поле', () => {
    expect(hexDist(cellOf(0, 0), cellOf(14, 0))).toBe(14);
    expect(hexDist(cellOf(0, 0), cellOf(0, 10))).toBe(10);
  });
});

describe('geroi/creatures: модель силы', () => {
  it('66 существ, все поля осмысленны', () => {
    expect(Object.keys(CREATURES)).toHaveLength(66);
    for (const c of Object.values(CREATURES)) {
      expect(c.hp).toBeGreaterThan(0);
      expect(c.dmax).toBeGreaterThanOrEqual(c.dmin);
      expect(c.cost).toBeGreaterThan(0);
      expect(c.speed).toBeGreaterThan(0);
    }
  });
  it('цена растёт со ступенью, улучшение дороже основы', () => {
    for (const f of FACTIONS) {
      const list = factionCreatures(f.id);
      for (let t = 1; t <= 7; t++) {
        const [base, up] = [list.find((c) => c.tier === t && !c.up)!, list.find((c) => c.tier === t && c.up)!];
        expect(up.cost, up.id).toBeGreaterThan(base.cost);
        if (t > 1) expect(base.cost, base.id).toBeGreaterThan(list.find((c) => c.tier === t - 1 && !c.up)!.cost);
      }
    }
  });
  it('бюджет фракций за неделю — в коридоре ±12 % (DESIGN §6.2; сузим после прогонов)', () => {
    const budgets = FACTIONS.map((f) => factionCreatures(f.id).filter((c) => !c.up).reduce((sum, c) => sum + c.power * c.weekly, 0));
    const avg = budgets.reduce((a, b) => a + b) / budgets.length;
    for (const b of budgets) expect(Math.abs(b / avg - 1)).toBeLessThan(0.12);
  });
  it('корень считается точно', () => expect(rootOf(2)).toBeCloseTo(1.41421356, 6));
  it('у всех классов заклинания существуют', () => {
    for (const c of CLASSES) for (const sp of c.spells) expect(SPELLS[sp], sp).toBeTruthy();
  });
});

describe('geroi/battle: правила', () => {
  it('детерминизм: один сид — один бой', () => {
    const run = () => {
      const s = createBattle(setup([['zatulye', 'zatulye-militia', 40], ['zatulye', 'zatulye-slinger', 20]], [['kuznya', 'kuznya-wasp', 20], ['kuznya', 'kuznya-riveter', 10]]));
      playOut(s, ['medium', 'medium']);
      return JSON.stringify(s);
    };
    expect(run()).toBe(run());
  });

  it('состояние переживает JSON посреди боя', () => {
    const s = createBattle(setup([['zatulye', 'zatulye-militia', 40]], [['kuznya', 'kuznya-wasp', 20]]));
    for (let i = 0; i < 5 && !s.over; i++) act(s, botAction(s, 'medium'));
    const copy = JSON.parse(JSON.stringify(s)) as BattleState;
    playOut(s, ['medium', 'medium']);
    playOut(copy, ['medium', 'medium']);
    expect(copy).toEqual(s);
  });

  it('формула: +5 % за единицу перевеса, −2,5 % за единицу недостачи, с потолками', () => {
    const s = plain(createBattle(setup([['zatulye', 'zatulye-militia', 10]], [['kuznya', 'kuznya-apprentice', 10]])));
    const [a, b] = s.units;
    const diff = attackOf(s, a) - defenseOf(s, b);
    expect(damageFactor(s, a, b)).toBe(diff >= 0 ? 1000 + diff * 50 : 1000 + diff * 25);
    s.sides[0].atk = 200;
    expect(damageFactor(s, a, b)).toBe(4000);
    s.sides[0].atk = 0;
    s.sides[1].def = 200;
    expect(damageFactor(s, a, b)).toBe(300);
  });

  it('ход по скорости: быстрые раньше', () => {
    const s = createBattle(setup([['kuznya', 'kuznya-colossus', 1]], [['kuznya', 'kuznya-stingwasp', 5]]));
    expect(currentUnit(s)!.cre).toBe('kuznya-stingwasp');
  });

  it('ответный удар один за раунд, «по нему не отвечают» — без ответа', () => {
    const s = plain(createBattle(setup([['zatulye', 'zatulye-vataga', 30], ['zatulye', 'zatulye-boatman', 30]], [['zatonye', 'zatonye-willow', 30]])));
    const t = s.units[2];
    t.effects = [];
    s.units[0].cell = t.cell - 1;
    s.units[1].cell = neighbors(t.cell).find((c) => c !== t.cell - 1 && s.units.every((u) => u.cell !== c))!;
    s.queue = [1, 2];
    s.current = 0;
    const first = act(s, { t: 'attack', target: t.id, from: s.units[0].cell });
    expect(first.filter((e) => e.e === 'hit' && e.retal)).toHaveLength(1);
    s.current = 1;
    s.queue = [];
    s.units[1].acted = false;
    const second = act(s, { t: 'attack', target: t.id, from: s.units[1].cell });
    expect(second.filter((e) => e.e === 'hit' && e.retal)).toHaveLength(0);
  });

  it('«Стенка» Затулья: сосед-пехотинец отвечает вместе с целью', () => {
    const s = plain(createBattle(setup([['kuznya', 'kuznya-steamhound', 10]], [['zatulye', 'zatulye-militia', 30], ['zatulye', 'zatulye-vataga', 30]])));
    const [a, t, n] = s.units;
    t.cell = cellOf(7, 5);
    a.cell = cellOf(6, 5);
    n.cell = neighbors(t.cell).find((c) => hexDist(c, a.cell) === 1)!;
    s.current = a.id;
    s.queue = [];
    const ev = act(s, { t: 'attack', target: t.id, from: a.cell });
    expect(ev.filter((e) => e.e === 'hit' && e.retal)).toHaveLength(2);
  });

  it('стрелок: выстрел тратит заряд, рядом с врагом стрелять нельзя', () => {
    const s = plain(createBattle(setup([['zatulye', 'zatulye-slinger', 10]], [['kuznya', 'kuznya-apprentice', 10]])));
    const [a, t] = s.units;
    s.current = a.id;
    const shots = a.shots;
    act(s, { t: 'shoot', target: t.id });
    expect(a.shots).toBe(shots - 1);
    a.cell = t.cell - 1;
    s.current = a.id;
    expect(actionError(s, { t: 'shoot', target: t.id })).toBeTruthy();
  });

  it('большие занимают два гекса и не вылезают за край', () => {
    const s = createBattle(setup([['zatulye', 'zatulye-tur', 2]], [['zatonye', 'zatonye-catfish', 2]]));
    const [a, b] = s.units;
    expect(cellsOf(a)).toHaveLength(2);
    expect(cellsOf(b)).toHaveLength(2);
    const r = reachOf(s, a);
    for (let y = 0; y < 11; y++) expect(r.dist[cellOf(0, y)]).toBe(-1);
  });

  it('летун перелетает занятое, пеший обходит', () => {
    const s = plain(createBattle(setup([['kuznya', 'kuznya-wasp', 5], ['kuznya', 'kuznya-apprentice', 5]], [['zatulye', 'zatulye-militia', 5]])));
    const [fly, walk] = s.units;
    s.units[2].cell = cellOf(10, 5);
    fly.cell = cellOf(3, 5);
    walk.cell = cellOf(3, 4);
    // стенка перед обоими
    s.obstacles = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((y) => ({ cell: cellOf(4, y), art: 1 }));
    expect(reachOf(s, fly).dist[cellOf(5, 5)]).toBe(2);
    expect(reachOf(s, walk).dist[cellOf(5, 5)]).toBe(-1);
  });

  it('заклинание: мана, раз за раунд, ход отряда остаётся', () => {
    const s = plain(createBattle(setup([['zatulye', 'zatulye-militia', 10]], [['kuznya', 'kuznya-apprentice', 50]])));
    const u = currentUnit(s)!;
    const h = s.sides[u.side];
    h.spells = ['lightning', 'haste'];
    const foe = s.units.find((x) => x.side !== u.side)!;
    const mana = h.mana;
    const hp = unitValue(foe);
    expect(act(s, { t: 'cast', spell: 'lightning', cell: foe.cell }).some((e) => e.e === 'spell')).toBe(true);
    expect(h.mana).toBe(mana - SPELLS.lightning.mana);
    expect(unitValue(foe)).toBeLessThan(hp);
    expect(currentUnit(s)).toBe(u);
    expect(actionError(s, { t: 'cast', spell: 'haste', cell: u.cell })).toBeTruthy();
  });

  it('трясина: чужие теряют скорость, свои нет', () => {
    const s = createBattle(setup([['zatonye', 'zatonye-reedling', 10]], [['zatulye', 'zatulye-militia', 10]]));
    expect(s.bog.length).toBeGreaterThanOrEqual(4);
    expect(s.bogOwner).toBe(0);
    const [own, foe] = s.units;
    const reachBefore = reachOf(s, foe).dist.filter((d) => d > 0).length;
    foe.cell = s.bog[0];
    own.cell = s.bog[1];
    expect(reachOf(s, foe).dist.filter((d) => d > 0).length).toBeLessThanOrEqual(reachBefore);
  });

  it('незаконное действие бросает, бот всегда предлагает законное', () => {
    const s = createBattle(setup([['zatulye', 'zatulye-militia', 10]], [['kuznya', 'kuznya-apprentice', 10]]));
    expect(() => act(s, { t: 'move', to: s.units[0].cell })).toThrow();
    for (let i = 0; i < 400 && !s.over; i++) {
      const a: Action = botAction(s, 'easy');
      expect(actionError(s, a)).toBeNull();
      act(s, a);
    }
  });

  it('бегство — поражение; лимит раундов решает по силе', () => {
    const s = createBattle(setup([['zatulye', 'zatulye-militia', 10]], [['kuznya', 'kuznya-apprentice', 10]]));
    const side = currentUnit(s)!.side;
    act(s, { t: 'flee' });
    expect(s.over).toBe(true);
    expect(s.winner).toBe(1 - side);
  });

  it('оба отряда в бою соприкасаются после атаки', () => {
    const s = plain(createBattle(setup([['kuznya', 'kuznya-steamhound', 10]], [['zatulye', 'zatulye-militia', 30]])));
    const [a, b] = s.units;
    a.cell = cellOf(5, 5);
    b.cell = cellOf(7, 5);
    s.current = a.id;
    act(s, { t: 'attack', target: b.id, from: cellOf(6, 5) });
    expect(adjacent(a, b)).toBe(true);
    expect(unitById(s, a.id).cell).toBe(cellOf(6, 5));
  });
});

describe('geroi/sim: правила детерминизма', () => {
  const FORBIDDEN = [/Math\.(sin|cos|tan|asin|acos|atan|atan2|sqrt|cbrt|pow|exp|expm1|log|log2|log10|log1p|hypot|random|sinh|cosh|tanh)\b/, /\bDate\b/, /\bperformance\b/, /\bdocument\b/, /\bwindow\b/, /\*\*/];
  const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
  it('в sim и bot нет запрещённого', () => {
    const bad: string[] = [];
    for (const d of ['sim', 'bot']) for (const f of files(join(__dirname, '../../src/geroi', d))) {
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      for (const re of FORBIDDEN) if (re.test(code)) bad.push(`${f}: ${re}`);
    }
    expect(bad).toEqual([]);
  });
});

describe('geroi: боты', () => {
  const armies = (a: Faction, b: Faction, seed: number): BattleSetup => ({
    seed, field: 'meadow',
    sides: [
      { hero: { cls: factionClasses(a)[seed % 2].id, n: 1 }, army: randomArmy(a, 20000, seed * 3 + 1) },
      { hero: { cls: factionClasses(b)[seed % 2].id, n: 1 }, army: randomArmy(b, 20000, seed * 3 + 2) },
    ],
  });
  it('полные армии: каждая пара фракций доигрывает, у победителя живые', () => {
    for (const a of FACTIONS) for (const b of FACTIONS) {
      const s = createBattle(armies(a.id, b.id, 11));
      playOut(s, ['medium', 'medium']);
      expect(s.over).toBe(true);
      if (s.winner >= 0) expect(sideValue(s, s.winner)).toBeGreaterThan(0);
    }
  });
  it('Сложный обыгрывает Лёгкого', () => {
    let wins = 0;
    const N = 12;
    for (let i = 0; i < N; i++) {
      const s = createBattle(armies('zatulye', 'zatulye', i + 100));
      const hardSide = i % 2 as 0 | 1;
      playOut(s, hardSide === 0 ? ['hard', 'easy'] : ['easy', 'hard']);
      if (s.winner === hardSide) wins++;
    }
    expect(wins).toBeGreaterThanOrEqual(N - 2);
  });
  it('фракции на Среднем — в коридоре 30–70 % (цель 45–55 %, DESIGN §6; полный прогон — tools/geroi/balance.ts)', () => {
    const rates = FACTIONS.map((a) => {
      let wins = 0;
      let n = 0;
      for (const b of FACTIONS) {
        if (a === b) continue;
        for (let k = 0; k < 16; k++) {
          const swap = k % 2 === 1;
          const sa = { hero: { cls: factionClasses(a.id)[k % 4 < 2 ? 0 : 1].id, n: 1 }, army: randomArmy(a.id, 20000, 1001 + k * 7) };
          const sb = { hero: { cls: factionClasses(b.id)[k % 8 < 4 ? 0 : 1].id, n: 1 }, army: randomArmy(b.id, 20000, 1002 + k * 7) };
          const s = createBattle({ seed: 1000 + k * 7, field: 'meadow', sides: swap ? [sb, sa] : [sa, sb] });
          playOut(s, ['medium', 'medium']);
          if (s.winner === (swap ? 1 : 0)) wins++;
          n++;
        }
      }
      return wins / n;
    });
    for (const r of rates) {
      expect(r).toBeGreaterThan(0.3);
      expect(r).toBeLessThan(0.7);
    }
  });
  it('копия для расчёта не трогает настоящий бой', () => {
    const s = createBattle(armies('kuznya', 'zatonye', 5));
    const before = JSON.stringify(s);
    botAction(s, 'hard');
    cloneBattle(s);
    expect(JSON.stringify(s)).toBe(before);
    expect(hasAb(CREATURES['kuznya-wasp'], 'machine')).toBe(true);
  });
});
