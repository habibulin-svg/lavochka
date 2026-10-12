/* Отбор раздач для «Пасьянсов» по сложности: решатель (src/games/solitaire/solver.ts) раскладывает раздачи,
 * сошедшиеся сортируются по числу просмотренных позиций и делятся на три части — лёгкие, средние, сложные.
 * Запуск: npx tsx tools/solitaire/seeds.ts <ключ|all> [сколько нужно] [минут на ключ] [бюджет позиций]
 * Результат дописывается в src/games/solitaire/seeds.json (уже найденное не теряется). */
import { readFileSync, writeFileSync } from 'node:fs';
import { cfgOf, deckOf, seedKey } from '../../src/games/solitaire/def';
import { ctxOf, type GameId } from '../../src/games/solitaire/engine';
import { GAMES } from '../../src/games/solitaire/games';
import { solve } from '../../src/games/solitaire/solver';

const OUT = new URL('../../src/games/solitaire/seeds.json', import.meta.url);

/** Все наборы настроек, которые меняют решаемость. */
const CONFIGS: { game: GameId; o: Record<string, unknown> }[] = [
  ...[1, 3].flatMap((d) => [0, 3, 1].map((p) => ({ game: 'klondike' as GameId, o: { kDraw: d, kPasses: p } }))),
  ...[1, 2, 4].map((s) => ({ game: 'spider' as GameId, o: { spSuits: s } })),
  ...[4, 3, 2, 1].flatMap((n) => [false, true].map((b) => ({ game: 'freecell' as GameId, o: { fcCells: n, fcBaker: b } }))),
  ...[3, 1, 0].map((p) => ({ game: 'pyramid' as GameId, o: { pyPasses: p } })),
  { game: 'tripeaks', o: { tpWrap: true } },
  { game: 'tripeaks', o: { tpWrap: false } },
  { game: 'golf', o: { gWrap: false } },
  { game: 'golf', o: { gWrap: true } },
  { game: 'thieves', o: {} },
  { game: 'scorpion', o: {} },
  { game: 'well', o: {} },
];

const [which = 'all', wantS = '90', minS = '8', budgetS = '40000'] = process.argv.slice(2);
const want = Number(wantS);
const deadline = Number(minS) * 60_000;
const budget = Number(budgetS);
/** Меньше стольких решённых раздач — уровней сложности нет. */
const MIN = 15;

function load<T>(u: URL, d: T): T {
  try {
    return JSON.parse(readFileSync(u, 'utf8'));
  } catch {
    return d;
  }
}

for (const conf of CONFIGS) {
  const cfg = cfgOf({ game: conf.game, ...conf.o });
  const key = seedKey(conf.game, cfg);
  if (which !== 'all' && !which.split(',').includes(key)) continue;
  // сырые итоги: номер раздачи → позиций до решения (−1 — не решилась в бюджете)
  const rawFile = new URL(`./raw/${key}.json`, import.meta.url);
  const raw = load<Record<string, number>>(rawFile, {});
  const t0 = Date.now();
  let k = Object.keys(raw).length;
  const solved = () => Object.values(raw).filter((n) => n >= 0).length;
  while (solved() < want && Date.now() - t0 < deadline) {
    k++;
    const seed = 1 + ((k * 2654435761) % 2_000_000_000);
    if (raw[seed] != null) continue;
    const deck = deckOf(conf.game, cfg, seed);
    const c = ctxOf(GAMES[conf.game], cfg, deck);
    const r = solve(c, GAMES[conf.game].deal(c), budget);
    raw[seed] = r.ok ? r.nodes : -1;
    if (k % 10 === 0) writeFileSync(rawFile, JSON.stringify(raw));
  }
  writeFileSync(rawFile, JSON.stringify(raw));
  const ok = Object.entries(raw)
    .filter(([, n]) => n >= 0)
    .sort((a, b) => a[1] - b[1])
    .map(([s]) => Number(s));
  const third = Math.ceil(ok.length / 3);
  const out = load<Record<string, unknown>>(OUT, {});
  // доля сошедшихся у решателя — нижняя оценка сходимости; меньше MIN решённых — уровней не делаем, раздача случайная
  const tried = Object.keys(raw).length;
  const rate = tried ? Math.round((ok.length / tried) * 1000) / 10 : 0;
  out[key] = ok.length >= MIN ? { easy: ok.slice(0, third), medium: ok.slice(third, 2 * third), hard: ok.slice(2 * third), rate, tried } : { rate, tried };
  writeFileSync(OUT, JSON.stringify(out, null, 0).replace(/\],"/g, '],\n"').replace(/\},"/g, '},\n"') + '\n');
  console.log(key, `сошлось ${ok.length} из ${Object.keys(raw).length}`, `${((Date.now() - t0) / 1000).toFixed(0)} с`);
}
