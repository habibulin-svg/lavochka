// Выгрузка клеток для проверки разметки: npx tsx tools/magiya/dump.ts > cells.json
import { CELLS, LINES, WEBS } from '../../src/games/magiya/data';
console.log(JSON.stringify({ cells: CELLS, lines: LINES, webs: WEBS }));
