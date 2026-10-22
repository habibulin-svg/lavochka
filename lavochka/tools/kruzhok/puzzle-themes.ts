/* Указатель «задача → темы» для журнала кружка: журналу не нужна вся база задач (900 КБ), только темы решённых и
 * сколько задач в каждой теме. Пишет public/kruzhok/themes-index.json; запускать после tools/kruzhok/puzzles.py
 * (тест kruzhok-content сверяет, что указатель не отстал от базы).
 * Запуск: npx tsx tools/kruzhok/puzzle-themes.ts */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { themeIndex } from '../../src/games/kruzhok/themes';

const pub = join(import.meta.dirname, '../../public/kruzhok');
const db = JSON.parse(readFileSync(join(pub, 'puzzles.json'), 'utf8')) as { p: [string, string, string, number, string][] };
writeFileSync(join(pub, 'themes-index.json'), JSON.stringify(themeIndex(db.p.map(([id, , , , th]) => [id, th.split(' ')]))));
console.log('задач', db.p.length);
