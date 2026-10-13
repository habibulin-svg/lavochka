/* Отладка «Джио-Джанги»: партия ботов с выводом состояния.
 * npx tsx tools/hodilki/djio-probe.ts [игроков] [ходов] [уровень] [seed] */
import { SeededRng } from '../../src/core/rng';
import { CELLS, toAct } from '../../src/games/djio/engine';
import { def } from '../../src/games/djio/def';

const players = Number(process.argv[2] ?? 2);
const limit = Number(process.argv[3] ?? 400);
const level = Number(process.argv[4] ?? 1);
const seed = Number(process.argv[5] ?? 11);
const setupRng = new SeededRng(seed);
const botRng = new SeededRng(seed ^ 0x9e3779b9);
const seats = Array.from({ length: players }, (_, s) => ({ seat: s, kind: 'bot' as const, name: 'x', level }));
let s = def.setup(seats, { speed: 'long' }, setupRng);
let steps = 0;
let stalls = 0;
for (; steps < limit && !s.over; steps++) {
  const a = def.bot.choose(s, s.turn, level, botRng);
  if (!a) {
    console.log('бот не нашёл хода:', steps, 'фаза', s.phase, 'ход', s.turn);
    break;
  }
  const r = def.apply(s, s.turn, a, setupRng);
  if (!r) {
    console.log('ход отклонён:', steps, JSON.stringify(a), 'фаза', s.phase, 'ход', s.turn, 'деньги', s.money.slice(0, players));
    if (++stalls > 5) break;
    continue;
  }
  stalls = 0;
  s = r.state;
  if (steps % 40 === 0 || s.over) {
    console.log(
      String(steps).padStart(4),
      'ход', s.turn,
      'фаза', String(s.phase).padEnd(6),
      'бросков', s.moves,
      'деньги', s.money.slice(0, players).join(','),
      'клетки', s.pos.slice(0, players).map((p) => CELLS[p].n).join(','),
      'предметов', s.seats.map((x) => s.items[x].length).join(','),
      'шкур', Object.keys(s.skins).length
    );
  }
}
console.log('итог:', s.over ? `окончена, победил ${s.winner}` : 'НЕ окончена', 'шагов', steps, 'бросков', s.moves);
void toAct;
