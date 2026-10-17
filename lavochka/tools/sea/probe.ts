/* Прогон ботов морских игр: npx tsx tools/sea/probe.ts [piraty|kolonii] [партий] [игроков] [уровень] */
import { SeededRng } from '../../src/core/rng';
import { apply, newState, toAct, points } from '../../src/games/sea/engine';
import { choose } from '../../src/games/sea/bot';
import type { MapId } from '../../src/games/sea/maps';

const game = (process.argv[2] ?? 'piraty') as MapId;
const N = Number(process.argv[3] ?? 10);
const players = Number(process.argv[4] ?? 2);
const level = Number(process.argv[5] ?? 2);
const tally: Record<string, number> = {};
let rounds = 0;
let steps = 0;
for (let g = 0; g < N; g++) {
  const rng = new SeededRng(1000 + g);
  let s = newState(Array.from({ length: players }, (_, i) => i), { game }, rng);
  let k = 0;
  while (!s.result && k < 60000) {
    const seat = toAct(s)[0];
    const a = choose(s, seat, level, rng);
    if (!a) throw new Error('нет хода');
    const r = apply(s, seat, a, rng);
    if (!r) throw new Error('отклонено ' + JSON.stringify(a) + ' фаза ' + s.phase);
    s = r.state;
    k++;
  }
  steps += k;
  rounds += s.round;
  const key = s.result ? (s.result.winners.length ? s.result.winners.map((w) => s.side[w]).join('') + ':' + s.result.text.slice(0, 30) : 'ничья') : 'не кончилась';
  tally[key] = (tally[key] ?? 0) + 1;
  if (game === 'kolonii') console.log('партия', g, 'кругов', s.round, 'очки', s.seats.map((x) => points(s, x)).join('/'), 'потоплено', s.ships.filter((x) => x.sunk).length);
  else console.log('партия', g, 'кругов', s.round, s.result?.text, 'потоплено', s.ships.filter((x) => x.sunk).length);
}
console.log(tally, 'в среднем кругов', rounds / N, 'шагов', steps / N);
