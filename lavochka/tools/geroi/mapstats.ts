/* Где фракция отстаёт на карте: npx tsx tools/geroi/mapstats.ts [партий] [сдвиг сидов]
 * Партии Средний против Среднего (как в mapbalance), по каждой фракции к дням 8/15/22: сила армии (семки), семки в казне,
 * построек, уровень и показатели героев; плюс бои с чужими героями и городами — кто напал и кто выиграл. */
import { battleLevels, fightOut } from '../../src/geroi/bot/advplay';
import { botStep, newMem } from '../../src/geroi/bot/advbot';
import { act, applyBattle, battleSetup, heroById, type World } from '../../src/geroi/sim/adv/world';
import { generateMap } from '../../src/geroi/sim/adv/gen';
import type { TownFaction } from '../../src/geroi/sim/adv/town';
import { CREATURES, FACTIONS, type Faction } from '../../src/geroi/sim/creatures';
import { factionClasses } from '../../src/geroi/sim/heroes';

const N = Number(process.argv[2] ?? 24);
const base = Number(process.argv[3] ?? 0);
const TF = FACTIONS.map((f) => f.id as TownFaction);
const DAYS = [8, 15, 22];

type Acc = { n: number; army: number; semki: number; built: number; lvl: number; atk: number; def: number; power: number; know: number; spells: number; heroes: number; dw: number; up: number };
const zero = (): Acc => ({ n: 0, army: 0, semki: 0, built: 0, lvl: 0, atk: 0, def: 0, power: 0, know: 0, spells: 0, heroes: 0, dw: 0, up: 0 });
const acc: Record<string, Acc[]> = Object.fromEntries(TF.map((f) => [f, DAYS.map(zero)]));
const pvp: Record<string, { att: number; attWin: number; def: number; defWin: number; neut: number; neutLost: number; before: number; after: number }> = Object.fromEntries(
  TF.map((f) => [f, { att: 0, attWin: 0, def: 0, defWin: 0, neut: 0, neutLost: 0, before: 0, after: 0 }]),
);
const res: Record<string, { w: number; g: number }> = Object.fromEntries(TF.map((f) => [f, { w: 0, g: 0 }]));

const armyValue = (army: ({ cre: string; count: number } | null)[]): number => army.reduce((s, x) => s + (x ? CREATURES[x.cre].cost * x.count : 0), 0);

function snap(w: World, k: number): void {
  for (const p of w.players) {
    if (!p.alive) continue;
    const a = acc[p.faction][k];
    const hs = w.heroes.filter((h) => h.owner === p.id);
    const main = [...hs].sort((x, y) => y.level - x.level)[0];
    a.n++;
    a.army += hs.reduce((s, h) => s + armyValue(h.army), 0) + w.towns.filter((t) => t.owner === p.id).reduce((s, t) => s + armyValue(t.garrison), 0);
    a.semki += p.res.semki;
    a.built += w.towns.filter((t) => t.owner === p.id).reduce((s, t) => s + t.built.length, 0);
    a.heroes += hs.length;
    const t0 = w.towns.find((t) => t.owner === p.id);
    if (t0) {
      a.dw += Math.max(0, ...t0.built.filter((x) => /^dwell\d$/.test(x)).map((x) => Number(x.slice(5))));
      a.up += t0.built.filter((x) => /^up\d$/.test(x)).length;
    }
    if (main) {
      a.lvl += main.level;
      a.atk += main.atk;
      a.def += main.def;
      a.power += main.power;
      a.know += main.know;
      a.spells += main.spells.length;
    }
  }
}

for (let a = 0; a < 4; a++)
  for (let b = a + 1; b < 4; b++)
    for (let i = 0; i < N; i++) {
      const swap = i % 2 === 1;
      const fs = swap ? [TF[b], TF[a]] : [TF[a], TF[b]];
      const seed = base + 2000 + i * 7 + a * 31 + b;
      const spec = { seed, players: fs.map((f, j) => ({ name: 'АБ'[j], faction: f, hero: { cls: factionClasses(f as Faction)[(seed >> j) % 2].id, n: j + 1 } })) };
      const w = generateMap(spec, { template: 'duel', size: 's', water: 'lakes', guard: 'normal', seed });
      const mems = [newMem(), newMem()];
      let k = 0;
      for (let step = 0; step < 60000 && !w.over && w.day < 200; step++) {
        while (k < DAYS.length && w.day >= DAYS[k]) snap(w, k++);
        if (w.pending?.t === 'battle') {
          const pb = w.pending;
          const att = heroById(w, pb.hero)!;
          const af = w.players[att.owner].faction;
          const defOwner = pb.def.k === 'hero' ? heroById(w, pb.def.id)!.owner : pb.def.k === 'town' ? w.towns.find((t) => t.id === pb.def.id)!.owner : -1;
          const before = armyValue(att.army);
          const b2 = fightOut(battleSetup(w).setup, battleLevels(w, ['medium', 'medium']));
          if (defOwner >= 0 && defOwner !== att.owner) {
            const df = w.players[defOwner].faction;
            pvp[af].att++;
            pvp[df].def++;
            if (b2.winner === 0) pvp[af].attWin++;
            else pvp[df].defWin++;
          } else if (defOwner < 0) {
            pvp[af].neut++;
            if (b2.winner !== 0) pvp[af].neutLost++;
          }
          applyBattle(w, b2);
          if (defOwner < 0) {
            pvp[af].before += before;
            pvp[af].after += heroById(w, pb.hero) ? armyValue(heroById(w, pb.hero)!.army) : 0;
          }
          continue;
        }
        act(w, botStep(w, 'medium', mems[w.current]));
      }
      if (w.over && w.winner >= 0) {
        res[fs[w.winner]].w++;
        for (const f of fs) res[f].g++;
      }
    }

const r = (x: number, n: number) => (n ? x / n : 0);
for (const f of TF) {
  console.log(`${f}: побед ${Math.round(r(res[f].w, res[f].g) * 100)} %; напал ${pvp[f].att} (выиграл ${pvp[f].attWin}), защищался ${pvp[f].def} (выстоял ${pvp[f].defWin}), нейтралы ${pvp[f].neut} (проиграл ${pvp[f].neutLost}), потери в них ${Math.round((1 - r(pvp[f].after, pvp[f].before)) * 100)} %`);
  DAYS.forEach((d, k) => {
    const a = acc[f][k];
    const n = a.n || 1;
    console.log(`  д${d}: армия ${Math.round(a.army / n)}, семки ${Math.round(a.semki / n)}, построек ${(a.built / n).toFixed(1)}, героев ${(a.heroes / n).toFixed(1)}, гл. герой ур ${(a.lvl / n).toFixed(1)} ${(a.atk / n).toFixed(1)}/${(a.def / n).toFixed(1)}/${(a.power / n).toFixed(1)}/${(a.know / n).toFixed(1)}, закл ${(a.spells / n).toFixed(1)}, жилище до ${(a.dw / n).toFixed(1)}, улучшений ${(a.up / n).toFixed(1)}`);
  });
}
