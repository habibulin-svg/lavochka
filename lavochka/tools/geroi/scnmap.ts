/* Карта сценария кампании символами — проверить набросок без браузера.
 * npx tsx tools/geroi/scnmap.ts c1-2 [play]  — play: ещё и прогнать партию ботов (место человека — Сложный) до 60 дней. */
import { CAMPAIGNS } from '../../src/geroi/campaign';
import { buildScenario } from '../../src/geroi/campaign/types';
import { playBotGame } from '../../src/geroi/bot/advplay';
import { TERRAINS, WATER } from '../../src/geroi/sim/adv/data';

const id = process.argv[2];
const s = CAMPAIGNS.flatMap((c) => c.scenarios).find((x) => x.id === id);
if (!s) throw new Error(`Нет сценария ${id}: ${CAMPAIGNS.flatMap((c) => c.scenarios.map((x) => x.id)).join(', ')}`);
const w = buildScenario(s, 'normal', null);
const T: Record<string, string> = { meadow: '.', swamp: ',', ash: ':', pine: ';', rough: '-', sand: '_', water: '~', underground: ' ' };
const out: string[] = [];
for (let y = 0; y < w.h; y++) {
  let row = '';
  for (let x = 0; x < w.w; x++) {
    const c = x + y * w.w;
    const hero = w.heroes.find((h) => h.cell === c);
    const town = w.towns.find((t) => t.cell === c);
    const o = w.entries[c] !== undefined ? w.objects.find((ob) => ob.id === w.entries[c]) : undefined;
    if (hero) row += String(hero.owner);
    else if (town) row += 'T';
    else if (o) row += o.kind === 'stack' ? 'x' : o.kind.startsWith('mine') ? 'M' : o.kind[0].toUpperCase();
    else if (w.road[c] === 3) row += '=';
    else if (w.road[c]) row += '+';
    else if (w.block[c]) row += w.terrain[c] === WATER ? '~' : '#';
    else row += T[TERRAINS[w.terrain[c]].id] ?? '?';
  }
  out.push(`${String(y).padStart(3)} ${row}`);
}
console.log(out.join('\n'));
console.log(`${w.w}×${w.h}, объектов ${w.objects.length}, героев ${w.heroes.length}, закрыто ${w.block.filter((b) => b).length}`);
if (process.argv[3] === 'play') {
  const levels = w.players.map((p) => p.bot ?? 'hard');
  const t0 = Date.now();
  const r = playBotGame(w, levels, 60);
  console.log(`партия: ${w.scn?.result ?? 'не кончилась'} (${w.scn?.why ?? ''}), день ${r.days}, ${Date.now() - t0} мс; задания:`, w.scn?.goals.map((g) => `${g.id}${g.done ? '✓' : ''}`).join(' '));
}
