/* Скорость боевого бота: npx tsx tools/geroi/botspeed.ts [боёв] [уровень] [бюджет] — мс на действие и на бой. */
import { type BotLevel, botAction } from '../../src/geroi/bot/bot';
import { randomArmy } from '../../src/geroi/sim/army';
import { act, createBattle } from '../../src/geroi/sim/battle';
import { FACTIONS } from '../../src/geroi/sim/creatures';
import { SPELLS } from '../../src/geroi/sim/spells';
import { factionClasses } from '../../src/geroi/sim/heroes';

const N = Number(process.argv[2] ?? 6);
const LEVEL = (process.argv[3] ?? 'hard') as BotLevel;
const BUDGET = Number(process.argv[4] ?? 20000);
/** «full» — как у героя с карты к середине партии: все заклинания и много маны, плюс осада. */
const FULL = process.argv[5] === 'full';
let total = 0;
let actions = 0;
let worst = 0;
let wins = 0;
for (let k = 0; k < N; k++) {
  const fa = FACTIONS[k % FACTIONS.length].id;
  const fb = FACTIONS[(k + 1) % FACTIONS.length].id;
  const side = (f: string, seed: number) => ({ hero: { cls: factionClasses(f as never)[0].id, n: 1 }, army: randomArmy(f as never, BUDGET, seed) });
  const s = createBattle({ seed: 1000 + k, field: 'meadow', ...(FULL ? { siege: 2 } : {}), sides: [side(fa, k * 7 + 1), side(fb, k * 7 + 2)] });
  if (FULL) for (const h of s.sides) Object.assign(h, { spells: Object.keys(SPELLS), mana: 120, power: 6, know: 8 });
  const t0 = performance.now();
  while (!s.over) {
    const a0 = performance.now();
    const a = botAction(s, LEVEL);
    worst = Math.max(worst, performance.now() - a0);
    act(s, a);
    actions++;
  }
  total += performance.now() - t0;
  if (s.winner === 0) wins++;
}
console.log(`${LEVEL} ${BUDGET}: ${(total / N).toFixed(0)} мс на бой, ${(total / actions).toFixed(1)} мс на действие, худшее ${worst.toFixed(0)} мс, ${actions} действий, побед первой стороны ${wins}/${N}`);
