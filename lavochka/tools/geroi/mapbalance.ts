/* Прогоны ботов на случайных картах (DESIGN.md §6.4, этап 5): уровни между собой, матрица фракций, длина партии в днях.
 * npx tsx tools/geroi/mapbalance.ts [партий] [размер s|m|l] [шаблон] [что: levels|factions|all] [сдвиг сидов]
 * Бои считают Средние боевые боты (Сложный боевой бот медленный, на карте решает не он). */
import { type BotLevel } from '../../src/geroi/bot/bot';
import { playBotGame } from '../../src/geroi/bot/advplay';
import { FACTIONS, type Faction } from '../../src/geroi/sim/creatures';
import { factionClasses } from '../../src/geroi/sim/heroes';
import { type SizeId, generateMap } from '../../src/geroi/sim/adv/gen';
import type { TownFaction } from '../../src/geroi/sim/adv/town';

const N = Number(process.argv[2] ?? 20);
const size = (process.argv[3] ?? 's') as SizeId;
const template = process.argv[4] ?? 'duel';
const what = process.argv[5] ?? 'all';
/** Сдвиг сидов: другой набор карт для проверки на шум. */
const base = Number(process.argv[6] ?? 0);
const TF = FACTIONS.map((f) => f.id as TownFaction);

function game(seed: number, fa: TownFaction, fb: TownFaction, la: BotLevel, lb: BotLevel): { winner: number; days: number } {
  const spec = {
    seed,
    players: [
      { name: 'А', faction: fa, hero: { cls: factionClasses(fa as Faction)[seed % 2].id, n: 1 } },
      { name: 'Б', faction: fb, hero: { cls: factionClasses(fb as Faction)[(seed >> 1) % 2].id, n: 2 } },
    ],
  };
  const w = generateMap(spec, { template, size, water: 'lakes', guard: 'normal', seed });
  return playBotGame(w, [la, lb], 200, 'medium');
}

const pct = (a: number, b: number): string => `${Math.round((a * 100) / Math.max(1, b))} %`;
const t0 = performance.now();
const days: number[] = [];

if (what === 'levels' || what === 'all') {
  const pairs: [BotLevel, BotLevel][] = [['hard', 'easy'], ['medium', 'easy'], ['hard', 'medium']];
  console.log(`Уровни: ${N} партий на пару (места меняются), ${template} ${size}`);
  for (const [x, y] of pairs) {
    let win = 0;
    let draw = 0;
    for (let i = 0; i < N; i++) {
      const fa = TF[i % 4];
      const fb = TF[(i + 1 + (i >> 2)) % 4];
      const swap = i % 2 === 1;
      const r = game(base + 1000 + i, fa, fb, swap ? y : x, swap ? x : y);
      days.push(r.days);
      if (r.winner < 0) draw++;
      else if ((r.winner === 0) !== swap) win++;
    }
    console.log(`  ${x} против ${y}: ${win} из ${N} (${pct(win, N)}), ничьих ${draw}`);
  }
}

if (what === 'factions' || what === 'all') {
  console.log(`Фракции: Средний против Среднего, ${N} партий на пару (места меняются)`);
  const wins: Record<string, number> = {};
  const games: Record<string, number> = {};
  for (const f of TF) wins[f] = games[f] = 0;
  const rows: string[] = [];
  for (let a = 0; a < 4; a++) {
    for (let b = a + 1; b < 4; b++) {
      let wa = 0;
      let played = 0;
      for (let i = 0; i < N; i++) {
        const swap = i % 2 === 1;
        const r = game(base + 2000 + i * 7 + a * 31 + b, swap ? TF[b] : TF[a], swap ? TF[a] : TF[b], 'medium', 'medium');
        days.push(r.days);
        if (r.winner < 0) continue;
        played++;
        if ((r.winner === 0) !== swap) wa++;
      }
      wins[TF[a]] += wa;
      wins[TF[b]] += played - wa;
      games[TF[a]] += played;
      games[TF[b]] += played;
      rows.push(`  ${TF[a]} — ${TF[b]}: ${wa}:${played - wa}`);
    }
  }
  console.log(rows.join('\n'));
  for (const f of TF) console.log(`  ${f}: ${pct(wins[f], games[f])} побед`);
}

days.sort((a, b) => a - b);
console.log(`Длина партии, дней: медиана ${days[days.length >> 1]}, от ${days[0]} до ${days[days.length - 1]}; ${Math.round((performance.now() - t0) / 1000)} с`);
