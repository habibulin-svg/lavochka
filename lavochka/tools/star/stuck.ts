/* «Звезда Африки»: партия харнесса (как в tests/games.test.ts) с выводом последних ходов, если не доиграна.
 * npx tsx tools/star/stuck.ts [игроков] [номер партии] */
import { simulate, botSeats, defaults } from '../../tests/harness';
import { def } from '../../src/games/star/def';
import { CELLS } from '../../src/games/star/engine';

const n = Number(process.argv[2] ?? 2);
const k = Number(process.argv[3] ?? 5);
const MIX = [[0], [1], [2], [0, 1, 2]];
const orig = def.apply;
let log: string[] = [];
(def as any).apply = (s: any, seat: number, a: any, r: any) => {
  const res = orig(s, seat, a, r);
  log.push(`${seat} ${JSON.stringify(a)} @${CELLS[s.pos[seat]].id} ф=${s.phase} ос=${s.left} $=${s.money.slice(0, n)} 💎=${s.diamond}/${s.diamondSite} 🗡=${s.bandit.slice(0, n)} skip=${s.skip.slice(0, n)}`);
  if (log.length > 4000) log.shift();
  return res;
};
const res = await simulate(def as any, botSeats(def as any, n, MIX[k % MIX.length]), defaults(def as any), 1000 * n + k);
console.log(res);
if (!res.finished) console.log(log.join('\n'));
