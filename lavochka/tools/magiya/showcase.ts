// Позиция превью «Магии» для tools/magiya/thumb.py: npx tsx tools/magiya/showcase.ts > showcase.json
import { CELLS } from '../../src/games/magiya/data';
import { def } from '../../src/games/magiya/def';
const s = def.showcase!();
console.log(JSON.stringify(s.seats.map((x) => ({ seat: x, hero: s.heroes[x].hero, x: CELLS[s.heroes[x].cell].x, y: CELLS[s.heroes[x].cell].y, on: x === s.turn }))));
