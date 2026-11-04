/* Опыт баланса: одна фракция против остальных с отключённой способностью (или без неё).
 * npx tsx tools/geroi/probe.ts <фракция> <бюджет> <партий на пару> [способность …]
 * Способность снимается у всех существ фракции; «base» — без изменений. Печатает % побед фракции. */
import { type BotLevel, playOut } from '../../src/geroi/bot/bot';
import { randomArmy } from '../../src/geroi/sim/army';
import { createBattle } from '../../src/geroi/sim/battle';
import { CREATURES, type CreatureDef, FACTIONS, type Faction } from '../../src/geroi/sim/creatures';
import { factionClasses } from '../../src/geroi/sim/heroes';

const [fac, budgetArg, nArg, ...variants] = process.argv.slice(2);
const F = fac as Faction;
const BUDGET = Number(budgetArg ?? 100000);
const N = Number(nArg ?? 12);
const LEVEL: BotLevel = 'medium';

/** «swapN»: существа фракции N-й ступени заменены ровесниками Затулья на те же семки. */
let swap = 0;
function swapTier(army: { cre: string; count: number }[]): { cre: string; count: number }[] {
  if (!swap) return army;
  return army.map((x) => {
    const c = CREATURES[x.cre];
    if (c.tier !== swap) return x;
    const o = Object.values(CREATURES).find((y) => y.faction === 'zatulye' && y.tier === c.tier && y.up === c.up)!;
    return { cre: o.id, count: Math.max(1, Math.round((x.count * c.cost) / o.cost)) };
  });
}

function score(seedBase: number): number {
  let wins = 0;
  let games = 0;
  for (const b of FACTIONS) {
    if (b.id === F) continue;
    for (let k = 0; k < N; k++) {
      const seed = seedBase + k * 7 + b.id.length * 13;
      const swap = k % 2 === 1;
      const sa = { hero: { cls: factionClasses(F)[k % 4 < 2 ? 0 : 1].id, n: 1 }, army: swapTier(randomArmy(F, BUDGET, seed + 1)) };
      const sb = { hero: { cls: factionClasses(b.id)[k % 8 < 4 ? 0 : 1].id, n: 1 }, army: randomArmy(b.id, BUDGET, seed + 2) };
      const s = createBattle({ seed, field: 'meadow', sides: swap ? [sb, sa] : [sa, sb] });
      playOut(s, [LEVEL, LEVEL]);
      if (s.winner === (swap ? 1 : 0)) wins++;
      games++;
    }
  }
  return wins / games;
}

for (const v of variants.length ? variants : ['base']) {
  const saved = new Map<string, CreatureDef['abilities']>();
  swap = v.startsWith('swap') ? Number(v.slice(4)) : 0;
  if (v !== 'base' && !swap)
    for (const c of Object.values(CREATURES))
      if (c.faction === F && c.abilities.includes(v as never)) {
        saved.set(c.id, c.abilities);
        c.abilities = c.abilities.filter((x) => x !== v);
      }
  const t0 = Date.now();
  const r = score(Number(process.env.SEED ?? 1000));
  console.log(`${F} ${BUDGET} ${v.padEnd(10)} ${Math.round(r * 100)} %  (${N * 3} партий, ${((Date.now() - t0) / 1000).toFixed(0)} с, снято у ${saved.size})`);
  for (const [id, ab] of saved) CREATURES[id].abilities = ab;
}
