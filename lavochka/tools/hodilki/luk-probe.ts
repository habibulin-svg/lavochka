/* Отладка серии «Лукоморье»: партия ботов по всем четырём частям (у каждого места своя карта).
 * Запуск из lavochka/:  npx tsx tools/hodilki/luk-probe.ts [игроков] [ходов] [уровень] [seed] [часть] [--quiet] */
import { SeededRng } from '../../src/core/rng';
import { boardOf, def } from '../../src/games/hodilki/def';
import { mapOf } from '../../src/games/hodilki/core';

const players = Number(process.argv[2] ?? 3);
const limit = Number(process.argv[3] ?? 4000);
const level = Number(process.argv[4] ?? 1);
const seed = Number(process.argv[5] ?? 7);
const part = Number(process.argv[6] ?? 1);
const quiet = process.argv.includes('--quiet');
const setupRng = new SeededRng(seed);
const botRng = new SeededRng(seed ^ 0x5bd1e995);
const seats = Array.from({ length: players }, (_, s) => ({ seat: s, kind: 'bot' as const, name: 'x', level }));
let s = def.setup(seats, { map: 'luk1', lukStart: String(part) }, setupRng);
console.log('старт с части', part, '→ поле', s.map);

const where = (seat: number) => {
  const b = boardOf(mapOf(s, seat));
  const c = b.cells[s.pos[seat]];
  return `${b.id}:${c?.label ?? (c?.off ? 'дорога' : s.pos[seat])}`;
};
const line = (moves: number) =>
  [
    String(moves).padStart(6),
    'ход',
    s.map.padEnd(5),
    'фаза',
    String(s.phase ?? 'roll').padEnd(6),
    'бон',
    s.seats.map((x) => s.coins?.[x] ?? 0).join(','),
    'фишки',
    s.seats.map(where).join(' | '),
    'предметы',
    s.seats.map((x) => (s.items?.[x] ?? []).map((i) => i[0]).join('') || '-').join(','),
  ].join(' ');

let moves = 0;
for (; moves < limit && s.winner == null; moves++) {
  const a = def.bot.choose(def.view(s, 'all') as never, s.turn, level, botRng);
  if (!a) {
    console.log('бот не нашёл хода', moves, 'фаза', s.phase, 'ход', s.turn, s.seats.map(where).join(' | '));
    break;
  }
  const r = def.apply(s, s.turn, a, setupRng);
  if (!r) {
    console.log('ход отклонён', moves, JSON.stringify(a), 'фаза', s.phase, 'ход', s.turn, where(s.turn));
    break;
  }
  if (r.state.coins?.some((c) => !Number.isFinite(c))) {
    console.log('!!! испортились боны на ходе', moves, JSON.stringify(a), 'события', JSON.stringify(r.events));
    break;
  }
  s = r.state;
  if (!quiet && (moves % 1000 === 0 || moves === limit - 1)) console.log(line(moves));
}
console.log('партия:', s.winner == null ? 'НЕ кончилась' : `победил ${s.winner}`, 'ходов', moves, 'поле', s.map);
