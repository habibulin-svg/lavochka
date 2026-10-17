/* Прогон ботов «Швамбрании»: npx tsx tools/sea/shv-probe.ts [партий] [игроков] [уровень] [letters|easy|none] */
import { SeededRng } from '../../src/core/rng';
import { apply, newShv, toAct, type ShvState } from '../../src/games/sea/shv/engine';
import { chooseShv } from '../../src/games/sea/shv/bot';

const N = Number(process.argv[2] ?? 20);
const players = Number(process.argv[3] ?? 3);
const level = Number(process.argv[4] ?? 1);
const quiz = (process.argv[5] ?? 'letters') as ShvState['o']['quiz'];
const tally: Record<string, number> = {};
const seen: Record<string, number> = {};
let rounds = 0;
for (let g = 0; g < N; g++) {
  const rng = new SeededRng(500 + g);
  let s = newShv(Array.from({ length: players }, (_, i) => i), [], { quiz }, rng);
  let k = 0;
  while (!s.result && k < 50000) {
    const seat = toAct(s)[0];
    const a = chooseShv(s, seat, level, rng);
    if (!a) throw new Error('нет хода в фазе ' + s.phase);
    const r = apply(s, seat, a, rng);
    if (!r) throw new Error('отклонено ' + JSON.stringify(a) + ' фаза ' + s.phase);
    for (const e of r.events) if (e.t === 'point') seen[e.kind] = (seen[e.kind] ?? 0) + 1;
    s = r.state;
    k++;
  }
  rounds += s.round;
  const w = s.result?.winners[0];
  const key = s.result ? (w !== undefined ? (s.ships[w].wrecked ? 'пешком' : 'морем') + (s.ships[w].escaped ? ', из плена' : '') : 'ничья') : 'не кончилась';
  tally[key] = (tally[key] ?? 0) + 1;
  console.log('партия', g, 'кругов', s.round, s.result?.text, 'марки', s.seats.map((x) => s.ships[x].marks).join('/'));
}
console.log(tally, 'в среднем кругов', (rounds / N).toFixed(1));
console.log(seen);
