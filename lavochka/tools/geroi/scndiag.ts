/* Партия ботов по сценарию кампании с журналом боёв человека: npx tsx tools/geroi/scndiag.ts <id> [уровень героя] [сдвиг rng]. */
import { CAMPAIGNS } from '../../src/geroi/campaign';
import { buildScenario } from '../../src/geroi/campaign/types';
import { fightOut, battleLevels } from '../../src/geroi/bot/advplay';
import { botStep, newMem } from '../../src/geroi/bot/advbot';
import { act, applyBattle, battleSetup, heroById, objById, townById } from '../../src/geroi/sim/adv/world';
import { armyPower } from '../../src/geroi/sim/adv/hero';
const id = process.argv[2];
const lv = Number(process.argv[3] ?? 1);
const seed = Number(process.argv[4] ?? 0);
const s = CAMPAIGNS.flatMap((c) => c.scenarios).find((x) => x.id === id)!;
const w = buildScenario(s, 'normal', null);
w.rng = (w.rng + seed * 7919) >>> 0;
const main = w.heroes.find((h) => h.tag === 'main')!;
for (let l = 1; l < lv; l++) { main.level++; (['atk','def','power','know'] as const).forEach((k, i) => { if (l % 4 === i) main[k]++; }); }
const levels = w.players.map((p) => p.bot ?? 'hard');
const mems = levels.map(() => newMem());
for (let i = 0; i < 40000 && !w.over && w.day < 60; i++) {
  if (w.pending?.t === 'battle') {
    const b = w.pending;
    const att = heroById(w, b.hero)!;
    const d = b.def;
    const dname = d.k === 'hero' ? `герой ${heroById(w, d.id)!.tag ?? d.id} (${armyPower(heroById(w, d.id)!.army) | 0})` : d.k === 'town' ? `город ${townById(w, d.id)!.name} (${armyPower(townById(w, d.id)!.garrison) | 0})` : `${objById(w, d.id)!.kind} (${armyPower(objById(w, d.id)!.army ?? []) | 0})`;
    const ap = armyPower(att.army) | 0;
    const r = fightOut(battleSetup(w).setup, battleLevels(w, levels));
    if (att.owner === 0 || (d.k === 'hero' && heroById(w, d.id)!.owner === 0) || d.k === 'town')
      console.log(`д${w.day}: ${att.tag ?? att.id}/игрок${att.owner} (${ap}) → ${dname}: ${r.winner === 0 ? 'победа напавшего' : 'проигрыш напавшего'}`);
    applyBattle(w, r);
    continue;
  }
  act(w, botStep(w, levels[w.current], mems[w.current]));
}
console.log(w.scn!.result, w.scn!.why, 'день', w.day, w.scn!.goals.map((g) => g.id + (g.done ? '✓' : '')).join(' '));
