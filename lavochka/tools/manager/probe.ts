/* Прогон партий ботов «Менеджера»/«Бизнеса»: сколько кругов, кто выигрывает, сколько построено. Только для отладки баланса.
 * Запуск из lavochka/:  npx tsx tools/manager/probe.ts [поле] [партий] [премия 0|1] */
import { SeededRng } from '../../src/core/rng';
import { def } from '../../src/games/manager/def';
import type { State } from '../../src/games/manager/engine';

const map = process.argv[2] ?? 'biznes';
const games = Number(process.argv[3] ?? 20);
const premium = process.argv[4] === '1';
let rounds = 0;
let ent = 0;
let br = 0;
let stuck = 0;
let ends = 0;
const wins = [0, 0, 0, 0];
for (let g = 0; g < games; g++) {
  const rng = new SeededRng(g + 1);
  const seats = [0, 1, 2, 3].map((seat) => ({ seat, kind: 'bot' as const, name: 'b' + seat, level: [0, 1, 2, 2][seat] }));
  let s = def.setup(seats, { map, premium }, rng) as State;
  let maxEnt = 0;
  let maxBr = 0;
  for (let k = 0; k < 40000 && !s.result; k++) {
    const who = def.toAct(s)[0];
    const a = def.bot!.choose(def.view(s, [who]), who, seats[who].level, rng);
    const r = a && def.apply(s, who, a, rng);
    if (!r) {
      stuck++;
      console.log('застрял', g, s.phase, JSON.stringify(a));
      break;
    }
    s = r.state;
    maxEnt = Math.max(maxEnt, s.houses.filter((h) => h === 4).length);
    maxBr = Math.max(maxBr, s.houses.reduce((n, h) => n + (h < 4 ? h : 0), 0));
  }
  if (s.result) {
    ends++;
    for (const w of s.result.winners) wins[w]++;
  }
  rounds += s.round;
  ent += maxEnt;
  br += maxBr;
  console.log(`#${g + 1}: кругов ${s.round}, ${s.result?.text ?? 'не кончилась'}, победил ${s.result?.winners}, предприятий ${maxEnt}, филиалов ${maxBr}, $ ${s.usd.slice(0, 4)}`);
}
console.log(`кончились ${ends}/${games}, застряли ${stuck}; кругов в среднем ${(rounds / games).toFixed(0)}; победы по уровням (Л, С, Сл, Сл) ${wins}; предприятий ${(ent / games).toFixed(1)}, филиалов ${(br / games).toFixed(1)}`);
