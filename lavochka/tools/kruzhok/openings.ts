/* Дебюты для кружка — справочник Lichess chess-openings (CC0, github.com/lichess-org/chess-openings, файлы a…e.tsv).
 * Запуск: npx tsx tools/kruzhok/openings.ts D:/temp/kruzhok
 * Каждая линия проверяется нашим разбором записи; результат — public/kruzhok/openings.json:
 * { src, o: [[eco, название по-английски, ходы UCI через пробел, FEN после линии, название по-русски], ...] }.
 * Русские названия — по словарю tools/kruzhok/openings-ru.json (семейства и варианты; перевод — агенты на Sonnet). */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseLine } from '../../src/games/chess/notation';

const dir = process.argv[2] ?? 'D:/temp/kruzhok';
const ru = JSON.parse(readFileSync('tools/kruzhok/openings-ru.json', 'utf8')) as { families: Record<string, string>; variations: Record<string, string> };
/** «Sicilian Defense: Najdorf Variation, English Attack» → «Сицилианская защита, вариант Найдорфа, английская атака». */
const ruName = (name: string) => {
  const [fam, rest = ''] = name.split(': ');
  return [ru.families[fam] ?? fam, ...rest.split(', ').filter(Boolean).map((v) => ru.variations[v] ?? v)].join(', ');
};
const out: [string, string, string, string, string][] = [];
let bad = 0;
for (const f of 'abcde') {
  const rows = readFileSync(join(dir, `${f}.tsv`), 'utf8').trim().split('\n').slice(1);
  for (const row of rows) {
    const [eco, name, pgn] = row.split('\t');
    try {
      const l = parseLine(pgn);
      out.push([eco, name, l.uci.join(' '), l.fens[l.fens.length - 1], ruName(name)]);
    } catch (e) {
      bad++;
      console.error(eco, name, (e as Error).message);
    }
  }
}
mkdirSync('public/kruzhok', { recursive: true });
writeFileSync('public/kruzhok/openings.json', JSON.stringify({ src: 'Lichess chess-openings, CC0 — github.com/lichess-org/chess-openings', o: out }));
console.log(`дебютов ${out.length}, не разобрано ${bad}`);
