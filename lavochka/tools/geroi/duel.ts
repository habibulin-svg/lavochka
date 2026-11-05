/* Поединки ровесников: npx tsx tools/geroi/duel.ts — каждое существо против других той же ступени (без магии, Средние боты).
 * Два числа: на 12 и на 60 цен старшего — как сила зависит от размера отряда (малые и большие бюджеты). */
import { playOut } from '../../src/geroi/bot/bot';
import { createBattle } from '../../src/geroi/sim/battle';
import { CREATURES, type CreatureDef } from '../../src/geroi/sim/creatures';
const all = Object.values(CREATURES);
const duel = (a: CreatureDef, b: CreatureDef, n: number, mult: number): number => {
  let wins = 0;
  const money = Math.max(a.cost, b.cost) * mult;
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
for (const up of [false, true]) for (let tier = 1; tier <= 7; tier++) {
  const list = all.filter((c) => c.tier === tier && c.up === up && c.faction !== 'neutral');
  const line = list.map((a) => {
    const v = (m: number) => Math.round((list.filter((b) => b !== a).reduce((s, b) => s + duel(a, b, 8, m), 0) / (list.length - 1)) * 100);
    return `${a.faction.slice(0, 4)} ${v(12)}→${v(60)}`;
  });
  console.log(`${tier}${up ? '+' : ' '} ${line.join(' | ')}`);
}
