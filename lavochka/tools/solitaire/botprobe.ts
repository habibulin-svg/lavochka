/* Сколько партий бот доводит до конца: npx tsx tools/solitaire/botprobe.ts <пасьянс> [уровень бота] [раздач] */
import { SeededRng } from '../../src/core/rng';
import { def } from '../../src/games/solitaire/def';
const [game = 'klondike', lvl = '2', N = '10', extra = '{}'] = process.argv.slice(2);
let won = 0; let moves = 0; const t0 = Date.now(); const prog: number[] = [];
for (let k = 1; k <= Number(N); k++) {
  const rng = new SeededRng(k);
  let s = def.setup([{ seat: 0, kind: 'bot', name: 'x', level: Number(lvl) }], { game, level: 'any', ...JSON.parse(extra) }, rng);
  for (let i = 0; i < 20000 && !def.result(s); i++) {
    const a = def.bot.choose(def.view(s, [0]), 0, Number(lvl), rng) as any;
    const r = def.apply(s, 0, a, rng); if (!r) { console.log('отклонён', a); break; } s = r.state;
  }
  const b = s.boards[0]; if (b.end === 1) won++; moves += b.moves; prog.push(def.view(s, [0]).sum[0].prog);
}
console.log(game, extra, 'бот', lvl, `сошлось ${won}/${N}`, 'убрано', prog.join(' '), `в среднем ходов ${(moves / Number(N)).toFixed(0)}`, `${((Date.now() - t0) / Number(N)).toFixed(0)} мс/партию`);
