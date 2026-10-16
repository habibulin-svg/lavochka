/* Прогон партий ботов «Акционеров»: сколько кругов, кто выигрывает, сколько куплено фирм и построено предприятий, банкротства.
 * Только для отладки баланса. Запуск из lavochka/:  npx tsx tools/akcii/probe.ts [партий] [биржа 0|1] [кругов] */
import { SeededRng } from '../../src/core/rng';
import { def } from '../../src/games/akcii/def';
import { FIRM_CELLS } from '../../src/games/akcii/data';
import type { State } from '../../src/games/akcii/engine';

const games = Number(process.argv[2] ?? 20);
const exchange = process.argv[3] !== '0';
const roundsOpt = Number(process.argv[4] ?? 50);
let rounds = 0;
let bought = 0;
let ent = 0;
let bankr = 0;
let stuck = 0;
let ends = 0;
let steps = 0;
const wins = [0, 0, 0, 0];
const kinds: Record<string, number> = {};
const causes: Record<string, number> = {};
for (let g = 0; g < games; g++) {
  const rng = new SeededRng(g + 1);
  const seats = [0, 1, 2, 3].map((seat) => ({ seat, kind: 'bot' as const, name: 'b' + seat, level: [0, 1, 2, 2][seat] }));
  let s = def.setup(seats, { rounds: roundsOpt, exchange }, rng) as State;
  let k = 0;
  for (; k < 60000 && !s.result; k++) {
    const who = def.toAct(s)[0];
    const a = def.bot!.choose(def.view(s, [who]), who, seats[who].level, rng);
    const r = a && def.apply(s, who, a, rng);
    if (!r) {
      stuck++;
      console.log('застрял', g, s.phase, s.ask?.kind, JSON.stringify(a));
      break;
    }
    r.events.forEach((e, i) => {
      if (e.type !== 'bankrupt') return;
      bankr++;
      const prev = r.events.slice(0, i).reverse().find((q) => (q.type === 'pay' && q.from === e.seat) || q.type === 'note');
      const why = prev ? (prev.type === 'pay' ? prev.why.replace(/:.*/, '') : prev.text.replace(/:.*/, '')) : '?';
      causes[why] = (causes[why] ?? 0) + 1;
    });
    if (s.ask) kinds[s.ask.kind] = (kinds[s.ask.kind] ?? 0) + 1;
    s = r.state;
  }
  steps += k;
  if (s.result) {
    ends++;
    for (const w of s.result.winners) wins[w]++;
  }
  rounds += s.round;
  bought += FIRM_CELLS.filter((c) => s.owner[c] != null).length;
  ent += FIRM_CELLS.reduce((n, c) => n + s.ent[c], 0);
  if (g < 5) console.log(`партия ${g}: круг ${s.round}, ${s.result?.text}; деньги ${s.cash.slice(0, 4).join(' / ')}; капитал ${JSON.stringify(s.result?.scores)}`);
}
console.log(`партий ${games}, доиграно ${ends}, застряло ${stuck}; кругов в среднем ${(rounds / games).toFixed(1)}, действий ${(steps / games).toFixed(0)}`);
console.log(`фирм в конце ${(bought / games).toFixed(1)}, предприятий ${(ent / games).toFixed(1)}, банкротств ${(bankr / games).toFixed(2)}; победы по уровням [Л, С, Сл, Сл]: ${wins.join(' ')}`);
console.log('вопросы:', JSON.stringify(kinds));
console.log('банкротства:', JSON.stringify(causes));
