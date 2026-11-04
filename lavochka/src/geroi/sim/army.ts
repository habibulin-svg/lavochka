/* Набор армии по бюджету: случайная армия быстрого боя и армия бота. */
import { Rng } from '../../gops/sim/rng';
import { type CreatureDef, type Faction, factionCreatures } from './creatures';

export interface ArmySlot {
  cre: string;
  count: number;
}

/** Доля бюджета на ступень. */
const SHARE = [8, 9, 11, 13, 15, 19, 25];

export const armyCost = (army: { cost: number; count: number }[]): number => army.reduce((s, a) => s + a.cost * a.count, 0);

export function randomArmy(f: Faction, budget: number, seed: number): ArmySlot[] {
  const r = new Rng(seed);
  const all = factionCreatures(f);
  const total = SHARE.reduce((a, b) => a + b, 0);
  const picks: { c: CreatureDef; count: number }[] = [];
  let spent = 0;
  for (let tier = 1; tier <= 7; tier++) {
    const list = all.filter((c) => c.tier === tier);
    const c = list[r.below(list.length)];
    const count = Math.trunc(((budget * SHARE[tier - 1]) / total) / c.cost);
    if (count < 1) continue;
    picks.push({ c, count });
    spent += count * c.cost;
  }
  // остаток — младшим отрядам
  for (const p of picks) {
    const extra = Math.trunc((budget - spent) / p.c.cost);
    if (extra > 0) {
      p.count += extra;
      spent += extra * p.c.cost;
    }
  }
  return picks.map((p) => ({ cre: p.c.id, count: p.count }));
}
