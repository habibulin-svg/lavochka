import { SeededRng } from '../../src/core/rng';
import { def } from '../../src/games/solitaire/def';
const [game = 'klondike', seed = '5'] = process.argv.slice(2);
const rng = new SeededRng(Number(seed));
let s = def.setup([{ seat: 0, kind: 'bot', name: 'x', level: 2 }], { game, level: 'any' }, rng);
const log: string[] = [];
for (let i = 0; i < 20000 && !def.result(s); i++) { const a = def.bot.choose(def.view(s, [0]), 0, 2, rng) as any; if (a.t !== 'think') log.push(JSON.stringify(a)); s = def.apply(s, 0, a, rng)!.state; }
const v = def.view(s, [0]); const b = v.boards[0];
const nm = (id: number) => { const x = v.deck[id]; return x ? (x.r > 10 ? 'JQKA'[x.r - 11] : x.r) + x.s : '##'; };
console.log(log.slice(-12).join(' '));
console.log('stall', b.stall, 'moves', b.moves, 'end', b.end);
b.p.forEach((p, i) => console.log(i, p.map(nm).join(' ')));
