// Прогон баланса «Магии»: npx tsx tools/magiya/probe.ts [партий] [игроков] [need] [apex exact|stop] [уровень]
import { SeededRng } from '../../src/core/rng';
import { apply, botAction, newState, qualified, score, type Opts } from '../../src/games/magiya/engine';

const N = Number(process.argv[2] || 10);
const P = Number(process.argv[3] || 4);
const need = Number(process.argv[4] || 8);
const apex = (process.argv[5] || 'exact') as Opts['apex'];
const level = Number(process.argv[6] ?? 2);
const arrows = (process.argv[7] || 'stop') as Opts['arrows'];
const needPower = Number(process.argv[8] || 4);
const opts: Opts = { need, needPower, arrows, apex, goal: 'first', start: 0, rounds: 0 };
let tot = 0, totRounds = 0, ended = 0;
const prog: number[] = [];
for (let g = 0; g < N; g++) {
  const rng = new SeededRng(100 + g);
  let s = newState(Array.from({ length: P }, (_, i) => ({ seat: i, name: 'Б' + i })), opts);
  let steps = 0;
  const bsq = new Array(P).fill(0);
  const qAt: (number | null)[] = new Array(P).fill(null);
  const pAt: (number | null)[] = new Array(P).fill(null);
  const tAt: (number | null)[] = new Array(P).fill(null);
  while (!s.over && steps < 60000) {
    const a = botAction(s, s.turn, level, rng);
    if (!a) throw new Error('нет хода ' + JSON.stringify({ phase: s.phase, turn: s.turn }));
    const r = apply(s, s.turn, a, rng);
    if (!r) throw new Error('ход отклонён ' + JSON.stringify(a) + ' ' + s.phase);
    for (const e of r.events) if (e.type === 'jump' && e.how === 'bsq') bsq[e.seat]++;
    s = r.state;
    steps++;
    for (const x of s.seats) {
      const h = s.heroes[x];
      if (qAt[x] == null && qualified(h, opts)) qAt[x] = s.turns;
      if (pAt[x] == null && h.power.length >= needPower) pAt[x] = s.turns;
      if (tAt[x] == null && h.prot.length >= need) tAt[x] = s.turns;
    }
  }
  if (s.over) ended++;
  tot += steps;
  totRounds += s.turns;
  const hs = s.seats.map((x) => s.heroes[x]);
  prog.push(...hs.map(score));
  console.log(`партия ${g}: шагов ${steps}, кругов ${s.turns}, ${s.over ? s.over.text : 'не кончилась'}; ` +
    hs.map((h) => `${h.prot.length}з/${h.power.length}в/${h.tri}△@${h.cell}`).join(' ') + ` чк ${bsq.join(',')} власть@${pAt.join(',')} защита@${tAt.join(',')} всё@${qAt.join(',')}`);
}
console.log(`итого: кончилось ${ended}/${N}, в среднем шагов ${Math.round(tot / N)}, кругов ${Math.round(totRounds / N)}`);
