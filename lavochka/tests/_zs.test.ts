/* Ручной прогон «Заколдованной страны»: ZS=1 npx vitest run tests/_zs.test.ts (OPTS='{"quick":true}', N=шагов, P=игроков). */
import { it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { DEFS } from '../src/games/defs';
import { botSeats, defaults } from './harness';
it.skipIf(!process.env.ZS)('zs', async () => {
  const def = await DEFS.zakoldovannaya();
  for (const n of (process.env.P ?? '2,4,6').split(',').map(Number)) {
    const rng = new SeededRng(Number(process.env.SEED ?? 7 + n));
    const seats = botSeats(def, n, JSON.parse(process.env.LV ?? '[0,1,2]'));
    let s = def.setup(seats, { ...defaults(def), ...JSON.parse(process.env.OPTS ?? '{}') }, rng);
    const last: string[] = [];
    let steps = 0;
    const max = Number(process.env.N ?? 3000);
    while (!def.result(s) && steps < max) {
      const ta = def.toAct(s);
      if (!ta.length) { console.log('никто не ходит', JSON.stringify(s.scene), s.phase); break; }
      const seat = ta[0];
      const lvl = seats.find((x) => x.seat === seat)?.level ?? 1;
      const a = await def.bot.choose(def.view(s, [seat]), seat, lvl, rng);
      if (!a) { console.log('бот без хода', seat, JSON.stringify(s.scene?.wait), s.phase); break; }
      const r = def.apply(s, seat, a, rng);
      if (!r) { console.log('отклонено', seat, JSON.stringify(a), JSON.stringify(s.where), JSON.stringify(s.scene?.wait)); break; }
      s = r.state;
      last.push(`${seat}:${JSON.stringify(a)} @${s.where.k === 'site' ? s.where.site + ':' + s.where.room : 'n' + s.where.node}`);
      if (last.length > 25) last.shift();
      steps++;
    }
    const res = def.result(s);
    console.log(n, 'шагов', steps, 'итог', res?.text ?? '—', 'день', s.world.day, 'пройдено мест', new Set(s.world.visited.map((v: string) => v.split(':')[0])).size, 'сцен', s.world.done.length, 'колода', s.world.deck.length);
    if (!res) console.log(last.join('\n'));
  }
}, 600_000);
