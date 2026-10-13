/* Проверка «Звезды Африки»: партия ботов с отладкой (npx tsx tools/star/probe.ts [игроков] [ходов]). */
import { SeededRng } from '../../src/core/rng';
import { def } from '../../src/games/star/def';
import { CELLS, TOKEN_AT } from '../../src/games/star/engine';

const players = Number(process.argv[2] ?? 3);
const limit = Number(process.argv[3] ?? 3000);
const level = Number(process.argv[4] ?? 1);
const seed = Number(process.argv[5] ?? 7);
const rng = new SeededRng(seed);
const seats = Array.from({ length: players }, (_, s) => ({ seat: s, kind: 'bot' as const, name: 'x', level }));
let s = def.setup(seats, { robbers: 'on' }, rng);
let moves = 0;
for (; moves < limit && s.winner == null; moves++) {
  const a = def.bot.choose(def.view(s, 'all') as never, s.turn, level, rng);
  if (!a) break;
  const r = def.apply(s, s.turn, a, rng);
  if (!r) {
    console.log('отказ на ходе', moves, JSON.stringify(a), 'фаза', s.phase, 'ход', s.turn, 'позиция', CELLS[s.pos[s.turn]].id);
    break;
  }
  s = r.state;
  if (moves % 500 === 0) {
    console.log(
      String(moves).padStart(5),
      'открыто', String(s.open.filter(Boolean).length).padStart(2),
      'алмаз', s.diamond,
      'позиции', s.seats.map((x) => (TOKEN_AT[s.pos[x]] ? CELLS[s.pos[x]].t : CELLS[s.pos[x]].id)).join(' | '),
      'деньги', s.seats.map((x) => s.money[x]).join(',')
    );
  }
}
console.log('партия:', s.winner == null ? 'не кончилась' : `победил ${s.winner}`, 'ходов', moves, 'открыто', s.open.filter(Boolean).length);
