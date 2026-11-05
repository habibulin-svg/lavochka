// Вторая четвёрка фракций (платная часть): механики боя Плотины, Острога, Базара и Курганов, новые способности.
import { describe, expect, it } from 'vitest';
import { playOut } from '../../src/geroi/bot/bot';
import { randomArmy } from '../../src/geroi/sim/army';
import { type BattleSetup, type BattleState, act, attackOf, createBattle, currentUnit, damageFactor, defenseOf, pathTo, reachOf, speedOf } from '../../src/geroi/sim/battle';
import { CREATURES, PAID_FACTIONS, type Faction, isPaidFaction } from '../../src/geroi/sim/creatures';
import { factionClasses } from '../../src/geroi/sim/heroes';
import { MapRoom, type MapPeer } from '../../src/geroi/net/maproom';
import { newDraft } from '../../src/geroi/sim/draft';
import { classOf } from '../../src/geroi/sim/heroes';

const hero = (f: Faction) => ({ cls: factionClasses(f)[0].id, n: 1 });
const setup = (a: [Faction, string, number][], b: [Faction, string, number][], seed = 7): BattleSetup => ({
  seed, field: 'meadow',
  sides: [
    { hero: hero(a[0][0]), army: a.map(([, cre, count]) => ({ cre, count })) },
    { hero: hero(b[0][0]), army: b.map(([, cre, count]) => ({ cre, count })) },
  ],
});
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
/** Все защищаются, пока не наступит раунд n. */
function toRound(s: BattleState, n: number): void {
  for (let i = 0; i < 400 && s.round < n && !s.over; i++) act(s, { t: 'defend' });
}

describe('geroi: вторая четвёрка фракций', () => {
  it('платные фракции — ровно четыре новые', () => {
    expect([...PAID_FACTIONS]).toEqual(['plotina', 'ostrog', 'bazar', 'kurgany']);
    expect(isPaidFaction('zatulye')).toBe(false);
    for (const f of PAID_FACTIONS) expect(factionClasses(f)).toHaveLength(2);
  });

  it('Плотина: разгон — урон растёт с пройденными гексами, до +40 %', () => {
    const s = plain(createBattle(setup([['plotina', 'plotina-lockguard', 10]], [['zatulye', 'zatulye-militia', 10]])));
    const [a, t] = s.units;
    const m0 = damageFactor(s, a, t, { steps: 0 });
    expect(damageFactor(s, a, t, { steps: 5 })).toBe(Math.trunc((m0 * 120) / 100));
    expect(damageFactor(s, a, t, { steps: 15 })).toBe(Math.trunc((m0 * 140) / 100));
  });

  it('Плотина: буря на 3-м раунде замедляет чужих летунов, своих — нет', () => {
    const s = plain(createBattle(setup([['plotina', 'plotina-stormbird', 5]], [['akademiya', 'akademiya-owl', 5]])));
    const own = s.units[0];
    const foe = s.units[1];
    toRound(s, 3);
    expect(s.round).toBe(3);
    expect(foe.effects.some((e) => e.k === 'speed' && e.v < 0)).toBe(true);
    expect(own.effects.some((e) => e.k === 'speed' && e.v < 0)).toBe(false);
  });

  it('Острог: строй в первом раунде (+1 скорость, +2 защиты), ранги — +1 к атаке и защите', () => {
    const st = setup([['ostrog', 'ostrog-recruit', 10]], [['zatulye', 'zatulye-militia', 10]]);
    const s = plain(createBattle(st));
    const u = s.units[0];
    const c = CREATURES[u.cre];
    expect(speedOf(s, u)).toBe(c.speed + 1);
    const d1 = defenseOf(s, u);
    toRound(s, 2);
    expect(defenseOf(s, u)).toBe(d1 - 2);
    st.sides[0].army[0].rank = 3;
    const r = plain(createBattle(st));
    expect(attackOf(r, r.units[0])).toBe(attackOf(s, s.units[0]) + 3);
  });

  it('Базар: ловушка только у одной стороны; наступивший пропускает ход', () => {
    const one = createBattle(setup([['bazar', 'bazar-pickpocket', 10]], [['zatulye', 'zatulye-militia', 10]]));
    expect(one.trap?.owner).toBe(0);
    const both = createBattle(setup([['bazar', 'bazar-pickpocket', 10]], [['bazar', 'bazar-pickpocket', 10]]));
    expect(both.trap).toBeUndefined();
    // чужой отряд идёт прямо через ловушку
    const s = plain(createBattle(setup([['bazar', 'bazar-camel', 1]], [['zatulye', 'zatulye-militia', 10]])));
    s.trap = undefined;
    for (let i = 0; i < 20 && currentUnit(s)?.side !== 1; i++) act(s, { t: 'defend' });
    const u = currentUnit(s)!;
    expect(u.side).toBe(1);
    const r = reachOf(s, u);
    const to = u.cell - 3;
    expect(r.dist[to]).toBeGreaterThan(0);
    const path = pathTo(r, u.cell, to);
    s.trap = { cell: path[1], owner: 0 };
    const ev = act(s, { t: 'move', to });
    expect(ev.some((e) => e.e === 'proc' && e.k === 'trap')).toBe(true);
    expect(u.cell).toBe(path[1]);
    expect(s.trap).toBeUndefined();
    expect(u.effects.some((e) => e.k === 'stun')).toBe(true);
  });

  it('Курганы: последний живой отряд бьёт вдвое; духов не травят', () => {
    const s = plain(createBattle(setup([['kurgany', 'kurgany-barrowknight', 10], ['kurgany', 'kurgany-shadowherd', 10]], [['zatonye', 'zatonye-frog', 10]])));
    const [a, b, t] = s.units;
    const m2 = damageFactor(s, a, t);
    b.count = 0;
    expect(damageFactor(s, a, t)).toBe(m2 * 2);
    expect(CREATURES['kurgany-barrowknight'].abilities).toContain('ghost');
  });

  it('каменные бабы стоят на месте, но стреляют', () => {
    const s = plain(createBattle(setup([['kurgany', 'kurgany-stonebaba', 10]], [['zatulye', 'zatulye-militia', 10]])));
    const r = reachOf(s, s.units[0]);
    expect([...r.dist].filter((d) => d > 0)).toHaveLength(0);
    expect(CREATURES['kurgany-stonebaba'].shots).toBeGreaterThan(0);
  });

  it('Сложные боты доигрывают бои новых фракций со старыми', () => {
    const old: Faction[] = ['zatulye', 'zatonye', 'kuznya', 'akademiya'];
    for (const f of PAID_FACTIONS)
      for (const g of [...old, ...PAID_FACTIONS]) {
        const seed = f.length * 31 + g.length;
        const st: BattleSetup = { seed, field: 'meadow', sides: [{ hero: hero(f), army: randomArmy(f, 10000, seed) }, { hero: hero(g), army: randomArmy(g, 10000, seed + 1) }] };
        const s = createBattle(st);
        playOut(s, ['medium', 'medium']);
        expect(s.over, `${f}–${g}`).toBe(true);
      }
  });

  it('сеть: платную фракцию в лобби берёт только купивший; драфт «Арены» без покупки — только база', () => {
    const box: unknown[] = [];
    const mk = (id: number, full: boolean): MapPeer => ({ id, name: 'p' + id, token: 't' + id, user: null, full, send: (m) => box.push(m) });
    const room = new MapRoom({ template: 'duel', size: 's', water: 'lakes', guard: 'normal', seed: 3 }, () => 1000);
    const poor = mk(1, false);
    const rich = mk(2, true);
    room.add(poor);
    room.add(rich);
    const seats = () => (room as unknown as { seats: { faction: string }[] }).seats;
    const cls = factionClasses('plotina')[0].id;
    room.message(poor, { t: 'mseat', faction: 'plotina', hero: { cls, n: 1 } });
    expect(seats()[0].faction).not.toBe('plotina');
    room.message(rich, { t: 'mseat', faction: 'plotina', hero: { cls, n: 2 } });
    expect(seats()[1].faction).toBe('plotina');
    for (let seed = 1; seed < 40; seed++) {
      const d = newDraft(seed, 10000);
      for (const sd of d.sides) for (const c of sd.offer) if ('hero' in c) expect(isPaidFaction(classOf(c.hero.cls).faction)).toBe(false);
    }
    const all = new Set<string>();
    for (let seed = 1; seed < 40; seed++) for (const sd of newDraft(seed, 10000, true).sides) for (const c of sd.offer) if ('hero' in c) all.add(classOf(c.hero.cls).faction);
    expect([...all].some(isPaidFaction)).toBe(true);
  });
});
