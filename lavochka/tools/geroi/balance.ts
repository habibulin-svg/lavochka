/* Прогоны баланса боя (DESIGN.md §6.3): npx tsx tools/geroi/balance.ts [партий на пару] [уровень] [бюджет]
 * Матрица фракций: зеркально по сторонам, равный бюджет; второй блок — как держится каждое существо против ровесников на равные семки. */
import { type BotLevel, playOut } from '../../src/geroi/bot/bot';
import { randomArmy } from '../../src/geroi/sim/army';
import { createBattle } from '../../src/geroi/sim/battle';
import { CREATURES, FACTIONS, type CreatureDef } from '../../src/geroi/sim/creatures';
import { factionClasses } from '../../src/geroi/sim/heroes';

const N = Number(process.argv[2] ?? 40);
const LEVEL = (process.argv[3] ?? 'medium') as BotLevel;
const BUDGET = Number(process.argv[4] ?? 20000);
const pct = (x: number) => `${Math.round(x * 100)}`.padStart(3);

// уровни между собой и длина боя
{
  const pairs: [BotLevel, BotLevel][] = [['hard', 'medium'], ['medium', 'easy'], ['hard', 'easy']];
  for (const [hi, lo] of pairs) {
    let wins = 0;
    let rounds = 0;
    const games = N;
    for (let k = 0; k < games; k++) {
      const f = FACTIONS[k % 4].id;
      const g = FACTIONS[(k >> 2) % 4].id;
      const swap = k % 2 === 1;
      const sa = { hero: { cls: factionClasses(f)[k % 2].id, n: 1 }, army: randomArmy(f, BUDGET, k * 5 + 1) };
      const sb = { hero: { cls: factionClasses(g)[k % 2].id, n: 1 }, army: randomArmy(g, BUDGET, k * 5 + 2) };
      const s = createBattle({ seed: 500 + k, field: 'meadow', sides: swap ? [sb, sa] : [sa, sb] });
      playOut(s, swap ? [lo, hi] : [hi, lo]);
      if (s.winner === (swap ? 1 : 0)) wins++;
      rounds += s.round;
    }
    console.log(`${hi} против ${lo}: ${pct(wins / games)} %, раундов в среднем ${(rounds / games).toFixed(1)}`);
  }
}

console.log(`Фракции: ${N} партий на пару, ${LEVEL}, бюджет ${BUDGET}. Строка — % побед строки над столбцом.`);
const totals = FACTIONS.map(() => [0, 0]);
const rows = FACTIONS.map((a, i) => {
  const row = FACTIONS.map((b, j) => {
    if (i === j) return '  .';
    let wins = 0;
    for (let k = 0; k < N; k++) {
      const seed = 1000 + k * 7 + i * 101 + j * 13;
      const swap = k % 2 === 1;
      const sa = { hero: { cls: factionClasses(a.id)[k % 4 < 2 ? 0 : 1].id, n: 1 }, army: randomArmy(a.id, BUDGET, seed + 1) };
      const sb = { hero: { cls: factionClasses(b.id)[k % 8 < 4 ? 0 : 1].id, n: 1 }, army: randomArmy(b.id, BUDGET, seed + 2) };
      const s = createBattle({ seed, field: 'meadow', sides: swap ? [sb, sa] : [sa, sb] });
      playOut(s, [LEVEL, LEVEL]);
      if (s.winner === (swap ? 1 : 0)) wins++;
    }
    totals[i][0] += wins;
    totals[i][1] += N;
    return pct(wins / N);
  });
  return `${a.id.padEnd(10)} ${row.join(' ')}`;
});
console.log(rows.join('\n'));
FACTIONS.forEach((f, i) => console.log(`${f.name}: ${pct(totals[i][0] / totals[i][1])} %`));

console.log('\nСущества против ровесников той же ступени на равные семки (% побед, среднее):');
const all = Object.values(CREATURES);
const duel = (a: CreatureDef, b: CreatureDef, n: number): number => {
  let wins = 0;
  const money = Math.max(a.cost, b.cost) * 12;
  for (let k = 0; k < n; k++) {
    const swap = k % 2 === 1;
    const sa = { hero: { cls: 'zatulye-sotnik', n: 1 }, army: [{ cre: a.id, count: Math.max(1, Math.round(money / a.cost)) }] };
    const sb = { hero: { cls: 'zatulye-sotnik', n: 1 }, army: [{ cre: b.id, count: Math.max(1, Math.round(money / b.cost)) }] };
    const s = createBattle({ seed: 77 + k * 3, field: 'meadow', sides: swap ? [sb, sa] : [sa, sb] });
    for (const h of s.sides) h.spells = [];
    playOut(s, ['medium', 'medium']);
    if (s.winner === (swap ? 1 : 0)) wins++;
  }
  return wins / n;
};
for (const up of [false, true]) {
  for (let tier = 1; tier <= 7; tier++) {
    const list = all.filter((c) => c.tier === tier && c.up === up && c.faction !== 'neutral');
    const scores = list.map((a) => ({ a, v: list.filter((b) => b !== a).reduce((sum, b) => sum + duel(a, b, 6), 0) / (list.length - 1) }));
    console.log(`${tier}${up ? '+' : ' '} ${scores.map((x) => `${x.a.name} ${pct(x.v)} (${x.a.hp}хп ${x.a.dmin}-${x.a.dmax} ${x.a.cost}с)`).join(' | ')}`);
  }
}
