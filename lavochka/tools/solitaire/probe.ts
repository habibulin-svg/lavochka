import { SeededRng, shuffle } from '../../src/core/rng';
import { ctxOf, type Cfg, type GameId } from '../../src/games/solitaire/engine';
import { GAMES } from '../../src/games/solitaire/games';
import { solve } from '../../src/games/solitaire/solver';
const base: Cfg = { draw: 1, passes: 0, vegas: false, suits: 1, cells: 4, baker: false, wrap: false };
const id = process.argv[2] as GameId; const extra = JSON.parse(process.argv[3] || '{}'); const N = Number(process.argv[4] || 20); const budget = Number(process.argv[5] || 50000);
const cfg = { ...base, ...extra }; const g = GAMES[id];
let ok = 0; const nodes: number[] = []; const t0 = Date.now();
for (let s = 1; s <= N; s++) {
  const deck = shuffle(g.cards(cfg), new SeededRng(s));
  const c = ctxOf(g, cfg, deck); const b = g.deal(c);
  const r = solve(c, b, budget); if (r.ok) { ok++; nodes.push(r.nodes); } else nodes.push(-(r.best ?? 0));
}
nodes.sort((a, b) => a - b);
console.log(id, JSON.stringify(extra), `решено ${ok}/${N}`, 'узлы', nodes.join(' '), `${((Date.now() - t0) / N).toFixed(0)} мс/раздачу`);
