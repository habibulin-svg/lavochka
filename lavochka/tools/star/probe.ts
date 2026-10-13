/* Проверка «Звезды Африки»: партия ботов с отладкой — как в тестовом харнессе (два rng, как в Authority).
 * npx tsx tools/star/probe.ts [игроков] [ходов] [уровень] [seed] [preset] */
import { SeededRng } from '../../src/core/rng';
import { def } from '../../src/games/star/def';
import { CELLS, TOKEN_AT } from '../../src/games/star/engine';

const players = Number(process.argv[2] ?? 3);
const limit = Number(process.argv[3] ?? 3000);
const level = Number(process.argv[4] ?? 1);
const seed = Number(process.argv[5] ?? 7);
const preset = process.argv[6] ?? 'classic';
const setupRng = new SeededRng(seed);
const botRng = new SeededRng(seed ^ 0x5bd1e995);
const seats = Array.from({ length: players }, (_, s) => ({ seat: s, kind: 'bot' as const, name: 'x', level }));
const opts = preset === 'calm' ? { robbers: 'off' } : { robbers: 'on' };
let s = def.setup(seats, opts, setupRng);
const at = (cell: number) => (TOKEN_AT[cell] ? CELLS[cell].t : CELLS[cell].id);
const dump = () => s.seats.map((x) => `${x}:${at(s.pos[x])}${s.diamond === x ? '💎' : ''}${s.bandit[x] ? '🗡' : ''}`).join(' | ');
let moves = 0;
for (; moves < limit && s.winner == null; moves++) {
  const a = def.bot.choose(def.view(s, 'all') as never, s.turn, level, botRng);
  if (!a) {
    console.log('бот не нашёл хода:', moves, 'фаза', s.phase, 'ход', s.turn, dump());
    break;
  }
  const r = def.apply(s, s.turn, a, setupRng);
  if (!r) {
    console.log('отказ на ходе', moves, JSON.stringify(a), 'фаза', s.phase, 'ход', s.turn, at(s.pos[s.turn]));
    break;
  }
  if (moves > limit - 40) {
    console.log(String(moves).padStart(5), JSON.stringify(a).slice(0, 40).padEnd(40), 'фаза', s.phase, 'шагов', s.left, dump(), 'деньги', s.seats.map((x) => s.money[x]).join(','));
  }
  s = r.state;
  if (moves % 500 === 0) {
    console.log(
      String(moves).padStart(5),
      'открыто', String(s.open.filter(Boolean).length).padStart(2),
      'алмаз', s.diamond,
      'наКейптауне', s.diamondSite >= 0 ? 'да' : 'нет',
      'позиции', dump(),
      'деньги', s.seats.map((x) => s.money[x]).join(','),
      'пропуск', s.seats.map((x) => s.skip[x]).join(',')
    );
  }
}
console.log('партия:', s.winner == null ? 'не кончилась' : `победил ${s.winner}`, 'ходов', moves, 'открыто', s.open.filter(Boolean).length);
console.log(
  'итог: алмаз', s.diamond, 'наКейптауне', s.diamondSite >= 0,
  'бандиты', s.seats.filter((x) => s.bandit[x]).join(',') || '-',
  'разбойников открыто', s.tokens.filter((t, i) => t === 'robber' && s.open[i]).length,
  'закрытых жетонов', s.tokens.filter((t, i) => t && !s.open[i]).length,
  'деньги', s.seats.map((x) => s.money[x]).join(','),
  'позиции', dump()
);
