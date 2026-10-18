/* Отладка: партия как в tests/games.test.ts (ZS2=1 N=… P=… K=…), след последних ходов. */
import { it } from 'vitest';
import { Authority } from '../src/core/authority';
import { SeededRng } from '../src/core/rng';
import { DEFS } from '../src/games/defs';
import { botSeats, defaults } from './harness';
const MIX = [[0], [1], [2], [0, 1, 2]];
it.skipIf(!process.env.ZS2)('zs2', async () => {
  const def = await DEFS.zakoldovannaya();
  const n = Number(process.env.P ?? 3), k = Number(process.env.K ?? 2);
  const seats = botSeats(def, n, MIX[k % 4]);
  const seed = 1000 * n + k;
  const opts = defaults(def);
  const a = new Authority(def, seats, opts);
  a.rng = new SeededRng(seed);
  a.state = def.setup(seats, opts, a.rng);
  const botRng = new SeededRng(seed ^ 0x5bd1e995);
  const last: string[] = [];
  let steps = 0;
  while (!a.result && steps < Number(process.env.N ?? 20000)) {
    const seat = a.toAct()[0];
    const action = await def.bot.choose(a.viewFor([seat]), seat, seats.find((s) => s.seat === seat)!.level, botRng);
    a.act(seat, action);
    const s = a.state as any;
    last.push(`${steps} ${seat}:${JSON.stringify(action)} @${s.where.k === 'site' ? s.where.site + ':' + s.where.room : 'n' + s.where.node} d${s.world.day}`);
    if (last.length > 40) last.shift();
    steps++;
  }
  console.log(steps, a.result?.text ?? 'НЕ КОНЧИЛАСЬ');
  if (!a.result) console.log(last.join('\n'));
}, 600_000);
