/* Опыт баланса: фракция против остальных при правке героев или существ, три набора сидов.
 * npx tsx tools/geroi/tweak.ts <фракция> <бюджет> <партий на пару> <вариант …>
 * Вариант: имя из TWEAKS, «id1,id2*1.15» (дороже в 1,15 раза), «id.поле=число»; через «+» — несколько сразу. */
import { playOut } from '../../src/geroi/bot/bot';
import { randomArmy } from '../../src/geroi/sim/army';
import { createBattle } from '../../src/geroi/sim/battle';
import { CREATURES, FACTIONS, type Faction } from '../../src/geroi/sim/creatures';
import { CLASSES, factionClasses } from '../../src/geroi/sim/heroes';

const [fac, budgetArg, nArg, ...variants] = process.argv.slice(2);
const F = fac as Faction;
const BUDGET = Number(budgetArg);
const N = Number(nArg);
const cls = (id: string) => CLASSES.find((c) => c.id === id)!;
const SAVED = JSON.stringify(CLASSES);
const SAVED_CRE = JSON.stringify(CREATURES);

const TWEAKS: Record<string, () => void> = {
  base: () => {},
  onlyStrazh: () => {},
  onlyZvezd: () => {},
  strazh55: () => Object.assign(cls('akademiya-strazh'), { atk: 5, def: 5 }),
  strazh54: () => Object.assign(cls('akademiya-strazh'), { atk: 5, def: 4 }),
  zvNoMeteor: () => { cls('akademiya-zvezdochet').spells = cls('akademiya-zvezdochet').spells.filter((s) => s !== 'meteors'); },
  zv6: () => { cls('akademiya-zvezdochet').spells = ['lightning', 'fireball', 'ice-bolt', 'haste', 'slow', 'heal-light']; },
  zvKnow4: () => Object.assign(cls('akademiya-zvezdochet'), { know: 4 }),
  zvPow4: () => Object.assign(cls('akademiya-zvezdochet'), { power: 4 }),
};

function score(v: string, seedBase: number): number {
  let wins = 0;
  let games = 0;
  for (const b of FACTIONS) {
    if (b.id === F) continue;
    for (let k = 0; k < N; k++) {
      const seed = seedBase + k * 7 + b.id.length * 13;
      const swap = k % 2 === 1;
      const own = v === 'onlyStrazh' ? 0 : v === 'onlyZvezd' ? 1 : k % 4 < 2 ? 0 : 1;
      const sa = { hero: { cls: factionClasses(F)[own].id, n: 1 }, army: randomArmy(F, BUDGET, seed + 1) };
      const sb = { hero: { cls: factionClasses(b.id)[k % 8 < 4 ? 0 : 1].id, n: 1 }, army: randomArmy(b.id, BUDGET, seed + 2) };
      const s = createBattle({ seed, field: 'meadow', sides: swap ? [sb, sa] : [sa, sb] });
      playOut(s, ['medium', 'medium']);
      if (s.winner === (swap ? 1 : 0)) wins++;
      games++;
    }
  }
  return wins / games;
}

for (const v of variants) {
  const restore = JSON.parse(SAVED) as typeof CLASSES;
  CLASSES.forEach((c, i) => Object.assign(c, restore[i]));
  const rc = JSON.parse(SAVED_CRE) as typeof CREATURES;
  for (const id of Object.keys(rc)) Object.assign(CREATURES[id], rc[id]);
  // «id1,id2*1.15» — дороже в 1,15 раза; «id.поле=число» — правка поля
  for (const part of v.split('+')) {
    const m = /^([\w,-]+)\*([\d.]+)$/.exec(part);
    const f = /^([\w-]+)\.(\w+)=(-?[\d.]+)$/.exec(part);
    if (m) for (const id of m[1].split(',')) CREATURES[id].cost = Math.round(CREATURES[id].cost * Number(m[2]));
    else if (f) (CREATURES[f[1]] as unknown as Record<string, number>)[f[2]] = Number(f[3]);
    else TWEAKS[part]();
  }
  const r = [1000, 7000, 13000].map((sd) => Math.round(score(v, sd) * 100));
  console.log(`${F} ${BUDGET} ${v.padEnd(11)} ${r.join(' / ')}  ≈ ${Math.round((r[0] + r[1] + r[2]) / 3)}`);
}
