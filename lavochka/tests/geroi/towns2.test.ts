/* Механики замков второй четвёрки на карте: напор Плотины, ранги Острога, караван-сарай и кредит Базара, память Курганов. */
import { describe, expect, it } from 'vitest';
import { botAction } from '../../src/geroi/bot/bot';
import { botStep, newMem } from '../../src/geroi/bot/advbot';
import { cleanAdvAction, worldView } from '../../src/geroi/net/mapproto';
import { act as battleAct, createBattle } from '../../src/geroi/sim/battle';
import { CREATURES, type Faction, factionCreatures } from '../../src/geroi/sim/creatures';
import { factionClasses } from '../../src/geroi/sim/heroes';
import { type Army, addToArmy, heroMaxMp, rankOfXp } from '../../src/geroi/sim/adv/hero';
import { LOAN, NAPOR_MAX, type TownFaction, bindCost, mercPrice, mercStock, summonCost } from '../../src/geroi/sim/adv/town';
import { type GameSpec, makeTestMap } from '../../src/geroi/sim/adv/testmap';
import { type World, act, actionError, applyBattle, battleSetup, cellOf, objAt, placeObject, townAt, xOf, yOf } from '../../src/geroi/sim/adv/world';

const RICH = { semki: 99999, wood: 99, stone: 99, amber: 99, salt: 99, stariron: 99, resin: 99 };
const spec = (a: TownFaction, b: TownFaction): GameSpec => ({
  seed: 7,
  players: [
    { name: 'Первый', faction: a, hero: { cls: factionClasses(a as Faction)[0].id, n: 1 } },
    { name: 'Второй', faction: b, hero: { cls: factionClasses(b as Faction)[1].id, n: 2 } },
  ],
});
const fresh = (a: TownFaction, b: TownFaction = 'zatulye'): World => {
  const w = makeTestMap(spec(a, b));
  w.players[0].res = { ...RICH };
  return w;
};
const hero0 = (w: World) => w.heroes.find((h) => h.owner === 0)!;
/** Конец дня за обоих: новый день. */
const nextDay = (w: World): void => {
  act(w, { t: 'end' });
  act(w, { t: 'end' });
};
const tier = (f: Faction, n: number, up = false): string => factionCreatures(f).find((c) => c.tier === n && c.up === up)!.id;
const army = (...slots: [string, number, number?][]): Army => {
  const a: Army = Array(7).fill(null);
  slots.forEach(([cre, count, xp], i) => (a[i] = { cre, count, ...(xp ? { xp } : {}) }));
  return a;
};

/** Свободная поляна вокруг героя и отряд нейтралов рядом; бой разыгрывают боты. */
function fightNeutral(w: World, count = 2): ReturnType<typeof createBattle> {
  const h = hero0(w);
  const x = 25;
  const y = 25;
  for (let yy = y - 4; yy <= y + 4; yy++) {
    for (let xx = x - 4; xx <= x + 4; xx++) {
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
  for (const other of w.heroes) if (other !== h && Math.abs(xOf(w, other.cell) - x) < 5 && Math.abs(yOf(w, other.cell) - y) < 5) other.cell = cellOf(w, 2, 2);
  h.cell = cellOf(w, x, y);
  h.mp = heroMaxMp(h);
  const foe: Army = Array(7).fill(null);
  foe[0] = { cre: 'neutral-wolf', count };
  placeObject(w, { kind: 'stack', cell: cellOf(w, x + 2, y), owner: -1, army: foe, cells: [] });
  act(w, { t: 'move', hero: h.id, to: cellOf(w, x + 1, y) });
  expect(w.pending?.t).toBe('battle');
  const b = createBattle(battleSetup(w).setup);
  for (let i = 0; i < 3000 && !b.over; i++) battleAct(b, botAction(b, 'medium'));
  expect(b.over).toBe(true);
  return b;
}

describe('geroi/adv: Плотина бурь — напор', () => {
  it('напор копится (+1, с турбиной +2, до 6), сброс за 3 — на выбор', () => {
    const w = fresh('plotina');
    const t = w.towns[0];
    expect(actionError(w, { t: 'release', town: t.id, use: 'semki' })).toBeTruthy();
    t.built.push('dam');
    nextDay(w);
    expect(t.napor).toBe(1);
    t.built.push('turbine');
    nextDay(w);
    expect(t.napor).toBe(3);
    for (let i = 0; i < 4; i++) nextDay(w);
    expect(t.napor).toBe(NAPOR_MAX);
    const semki = w.players[0].res.semki;
    act(w, { t: 'release', town: t.id, use: 'semki' });
    expect(w.players[0].res.semki).toBe(semki + 1500);
    expect(t.napor).toBe(3);
    // вторая стройка за день — только если сегодня уже строили
    expect(actionError(w, { t: 'release', town: t.id, use: 'build' })).toBeTruthy();
    act(w, { t: 'build', town: t.id, b: 'market' });
    expect(t.builtToday).toBe(true);
    act(w, { t: 'release', town: t.id, use: 'build' });
    expect(t.builtToday).toBe(false);
    expect(t.napor).toBe(0);
    expect(actionError(w, { t: 'release', town: t.id, use: 'semki' })).toContain('напора');
  });
  it('подзарядка: герою в воротах +400 к ходу', () => {
    const w = fresh('plotina');
    const t = w.towns[0];
    t.built.push('dam');
    t.napor = 3;
    const h = hero0(w);
    h.cell = cellOf(w, 1, 1);
    expect(actionError(w, { t: 'release', town: t.id, use: 'mp' })).toBeTruthy();
    h.cell = t.cell;
    const mp = h.mp;
    act(w, { t: 'release', town: t.id, use: 'mp' });
    expect(h.mp).toBe(mp + 400);
  });
});

describe('geroi/adv: Северный острог — опыт и ранги', () => {
  it('ранги по порогам 1/3/6/10/15', () => {
    expect([0, 1, 2, 3, 5, 6, 9, 10, 14, 15, 99].map(rankOfXp)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });
  it('победа даёт выжившим отрядам Острога опыт, ранг уходит в бой', () => {
    const w = fresh('ostrog');
    const h = hero0(w);
    h.army = army([tier('ostrog', 7), 10, 2], [tier('ostrog', 1), 30]);
    const b = fightNeutral(w);
    expect(b.winner).toBe(0);
    applyBattle(w, b);
    expect(h.army[0]?.xp).toBe(3);
    expect(h.army[1]?.xp).toBe(1);
    // в следующем бою ранг передаётся
    const b2 = fightNeutral(w);
    const setupRanks = b2.units.filter((u) => u.side === 0).map((u) => u.rank ?? 0);
    expect(setupRanks[0]).toBe(2);
    expect(setupRanks[1]).toBe(1);
  });
  it('слияние — меньший опыт; разбитый отряд опыт теряет; чужие существа опыта не копят', () => {
    const w = fresh('ostrog');
    const h = hero0(w);
    const t = w.towns[0];
    h.cell = t.cell;
    h.army = army([tier('ostrog', 1), 10, 6], [tier('zatulye', 1), 10]);
    t.garrison = army([tier('ostrog', 1), 5, 2]);
    act(w, { t: 'transfer', from: { t: t.id }, fromSlot: 0, to: { h: h.id }, toSlot: 0 });
    expect(h.army[0]).toEqual({ cre: tier('ostrog', 1), count: 15, xp: 2 });
    // новобранцы из найма не садятся к ветеранам, если есть свободный слот
    addToArmy(h.army, tier('ostrog', 1), 4);
    expect(h.army[0]?.count).toBe(15);
    expect(h.army.find((s, i) => i > 0 && s?.cre === tier('ostrog', 1))?.xp).toBeUndefined();
    const b = fightNeutral(w);
    applyBattle(w, b);
    expect(h.army.find((s) => s?.cre === tier('zatulye', 1))?.xp).toBeUndefined();
  });
  it('плац: гарнизону +1 опыта в неделю; баня: +300 к ходу начавшему день в городе', () => {
    const w = fresh('ostrog');
    const t = w.towns[0];
    t.built.push('drill', 'banya');
    t.garrison = army([tier('ostrog', 2), 8], [tier('zatulye', 1), 5]);
    const h = hero0(w);
    h.cell = t.cell;
    while (w.day % 7 !== 6) nextDay(w);
    expect(t.garrison[0]?.xp).toBeUndefined();
    nextDay(w);
    expect(t.garrison[0]?.xp).toBe(1);
    expect(t.garrison[1]?.xp).toBeUndefined();
    expect(h.mp).toBe(heroMaxMp(h) + 300);
  });
});

describe('geroi/adv: Нахалов базар — караван-сарай, кредит, карманники', () => {
  it('наём чужих базовых существ, если их город виден; наценка ×1,25; запас — половина прироста', () => {
    const w = fresh('bazar', 'zatonye');
    const t = w.towns[0];
    const foe = w.towns[1];
    const cre = tier('zatonye', 1);
    t.built.push('caravanserai');
    w.players[0].explored[foe.cell] = 0;
    expect(actionError(w, { t: 'merc', town: t.id, cre, count: 1 })).toContain('не видели');
    w.players[0].explored[foe.cell] = 1;
    expect(actionError(w, { t: 'merc', town: t.id, cre: tier('zatonye', 1, true), count: 1 })).toBeTruthy();
    expect(actionError(w, { t: 'merc', town: t.id, cre: tier('bazar', 1), count: 1 })).toBeTruthy();
    const stock = mercStock(CREATURES[cre]);
    expect(stock).toBeGreaterThan(0);
    expect(mercPrice(CREATURES[cre], 4).semki).toBe(Math.ceil((CREATURES[cre].cost * 4 * 125) / 100));
    expect(actionError(w, { t: 'merc', town: t.id, cre, count: stock + 1 })).toBeTruthy();
    const semki = w.players[0].res.semki;
    act(w, { t: 'merc', town: t.id, cre, count: stock });
    expect(w.players[0].res.semki).toBe(semki - mercPrice(CREATURES[cre], stock).semki!);
    expect(t.garrison.find((s) => s?.cre === cre)?.count).toBe(stock);
    expect(actionError(w, { t: 'merc', town: t.id, cre, count: 1 })).toBeTruthy();
    // новая неделя — новый запас
    while (w.day % 7 !== 0 || w.day === 0) nextDay(w);
    expect(actionError(w, { t: 'merc', town: t.id, cre, count: 1 })).toBeNull();
  });
  it('кредит: +5000 сейчас, 4 недели по 1500; не хватило — бунт в гарнизоне', () => {
    const w = fresh('bazar');
    const t = w.towns[0];
    const p = w.players[0];
    expect(actionError(w, { t: 'loan', town: t.id })).toBeTruthy();
    t.built.push('market', 'bank');
    p.res.semki = 1000;
    act(w, { t: 'loan', town: t.id });
    expect(p.res.semki).toBe(1000 + LOAN.sum);
    expect(actionError(w, { t: 'loan', town: t.id })).toBeTruthy();
    // неделя 1: платит
    while (w.day % 7 !== 6) nextDay(w);
    const before = p.res.semki;
    nextDay(w);
    expect(p.loan?.left).toBe(3);
    // доход дня приходит после взноса — разница только на доход
    expect(p.res.semki).toBeLessThan(before);
    // неделя 2: денег нет — бунт
    t.garrison = army([tier('bazar', 7), 9], [tier('bazar', 1), 40]);
    while (w.day % 7 !== 6) nextDay(w);
    p.res.semki = 0;
    nextDay(w);
    expect(t.garrison[0]?.count).toBe(4);
    expect(t.garrison[1]?.count).toBe(40);
    expect(p.loan?.left).toBe(2);
    for (let i = 0; i < 14; i++) nextDay(w);
    expect(p.loan).toBeUndefined();
    expect(actionError(w, { t: 'loan', town: t.id })).toBeNull();
  });
  it('семки карманников уходят в казну победителя', () => {
    const w = fresh('bazar');
    const h = hero0(w);
    h.army = army([tier('bazar', 7), 10]);
    const b = fightNeutral(w);
    b.loot = [321, 50];
    const semki = w.players[0].res.semki;
    applyBattle(w, b);
    expect(w.players[0].res.semki).toBe(semki + 321);
  });
});

describe('geroi/adv: Курганы предков — память, призыв, привязка', () => {
  it('память после боя с героем Курганов, потолок за неделю', () => {
    const w = fresh('kurgany');
    const h = hero0(w);
    h.army = army([tier('kurgany', 7), 10]);
    const b = fightNeutral(w, 20);
    applyBattle(w, b);
    const p = w.players[0];
    const fallen = b.units.reduce((sum, u) => sum + (u.start - u.count) * CREATURES[u.cre].cost, 0);
    expect(p.memory).toBe(Math.trunc((fallen * 15) / 100));
    expect(p.memory).toBeGreaterThan(0);
    p.memWeek = 4000;
    const b2 = fightNeutral(w, 20);
    applyBattle(w, b2);
    expect(p.memory).toBe(Math.trunc((fallen * 15) / 100));
    // герой не из Курганов — памяти нет
    const w2 = fresh('zatulye');
    hero0(w2).army = army([tier('zatulye', 7), 10]);
    applyBattle(w2, fightNeutral(w2, 20));
    expect(w2.players[0].memory).toBeUndefined();
  });
  it('призыв духов на 7 дней, уход на новом дне из всех армий; привязка навсегда за янтарь', () => {
    const w = fresh('kurgany');
    const t = w.towns[0];
    const p = w.players[0];
    const cre = tier('kurgany', 1);
    t.built.push('memory');
    p.memory = summonCost(CREATURES[cre], 10);
    expect(actionError(w, { t: 'summon', town: t.id, cre, count: 11 })).toContain('памяти');
    expect(actionError(w, { t: 'summon', town: t.id, cre: tier('kurgany', 4), count: 1 })).toBeTruthy();
    t.garrison = army([cre, 5]);
    act(w, { t: 'summon', town: t.id, cre, count: 10 });
    expect(p.memory).toBe(0);
    // постоянный отряд не стал духом: духи в своём слоте
    expect(t.garrison[0]).toEqual({ cre, count: 5 });
    expect(t.garrison[1]).toEqual({ cre, count: 10, until: w.day + 7 });
    // часть духов — герою
    const h = hero0(w);
    h.cell = t.cell;
    act(w, { t: 'transfer', from: { t: t.id }, fromSlot: 1, to: { h: h.id }, toSlot: 6, count: 4 });
    expect(h.army[6]?.until).toBe(w.day + 7);
    for (let i = 0; i < 6; i++) nextDay(w);
    expect(t.garrison[1]?.count).toBe(6);
    // привязка: только с камнем, за янтарь
    expect(actionError(w, { t: 'bind', town: t.id, ref: { t: t.id }, slot: 1 })).toBeTruthy();
    t.built.push('bindstone');
    expect(actionError(w, { t: 'bind', town: t.id, ref: { t: t.id }, slot: 0 })).toBe('Это не дух');
    const amber = p.res.amber;
    act(w, { t: 'bind', town: t.id, ref: { t: t.id }, slot: 1 });
    expect(p.res.amber).toBe(amber - bindCost(CREATURES[cre], 6));
    expect(t.garrison[1]?.until).toBeUndefined();
    nextDay(w);
    expect(t.garrison[1]?.count).toBe(6);
    expect(h.army[6]).toBeNull();
  });
  it('герой без армии не остаётся: последний дух задерживается одним', () => {
    const w = fresh('kurgany');
    const h = hero0(w);
    h.army = army([tier('kurgany', 3), 8]);
    h.army[0]!.until = w.day + 1;
    nextDay(w);
    expect(h.army[0]).toEqual({ cre: tier('kurgany', 3), count: 1 });
  });
});

describe('geroi/adv: бот и сеть для замков второй четвёрки', () => {
  it('бот Плотины сбрасывает напор в семки, бот Курганов зовёт предков; кредит не берёт', () => {
    const w = fresh('plotina', 'kurgany');
    const t = w.towns[0];
    t.built.push('dam');
    t.napor = 4;
    w.current = 0;
    const a = botStep(w, 'medium', newMem());
    expect(a).toEqual({ t: 'release', town: t.id, use: 'semki' });
    const w2 = fresh('kurgany');
    const t2 = w2.towns[0];
    t2.built.push('memory', 'dwell2');
    w2.players[0].memory = 5000;
    const b = botStep(w2, 'medium', newMem());
    expect(b.t).toBe('summon');
    if (b.t === 'summon') expect(CREATURES[b.cre].faction).toBe('kurgany');
    const w3 = fresh('bazar');
    w3.towns[0].built.push('market', 'bank');
    const mem = newMem();
    for (let i = 0; i < 40; i++) {
      const c = botStep(w3, 'hard', mem);
      expect(c.t).not.toBe('loan');
      if (c.t === 'end' || c.t === 'move') break;
      act(w3, c);
    }
  });
  it('сеть: новые действия проходят разбор, чужие напор, память и кредит скрыты', () => {
    expect(cleanAdvAction({ t: 'release', town: 0, use: 'mp' })).toEqual({ t: 'release', town: 0, use: 'mp' });
    expect(cleanAdvAction({ t: 'release', town: 0, use: 'flood' })).toBeNull();
    expect(cleanAdvAction({ t: 'merc', town: 0, cre: 'x', count: 3 })).toEqual({ t: 'merc', town: 0, cre: 'x', count: 3 });
    expect(cleanAdvAction({ t: 'loan', town: 1 })).toEqual({ t: 'loan', town: 1 });
    expect(cleanAdvAction({ t: 'summon', town: 0, cre: 'x', count: 2 })).toEqual({ t: 'summon', town: 0, cre: 'x', count: 2 });
    expect(cleanAdvAction({ t: 'bind', town: 0, ref: { t: 0 }, slot: 1 })).toEqual({ t: 'bind', town: 0, ref: { t: 0 }, slot: 1 });
    const w = fresh('plotina', 'kurgany');
    w.towns[0].napor = 5;
    w.players[0].memory = 900;
    w.players[0].loan = { town: 0, left: 2 };
    const v = JSON.parse(JSON.stringify(worldView(w, 1))) as World;
    expect(v.towns[0].napor).toBeUndefined();
    expect(v.players[0].memory).toBeUndefined();
    expect(v.players[0].loan).toBeUndefined();
    const own = worldView(w, 0);
    expect(own.towns[0].napor).toBe(5);
  });
});
