/* Справки по партиям для авторов комментариев (агенты на Sonnet): ходы русской записью с номерами полуходов,
 * оценка после каждого хода, пометки, остановки «А как сходил бы ты?» и лучшие линии движка.
 * Запуск (после games.ts): npx tsx tools/kruzhok/games-brief.ts [D:/temp/kruzhok] → <dir>/brief/<id>.txt */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fromUci, position, ruSan } from '../../src/games/chess/notation';
import { play } from '../../src/games/chess/engine';
import type { ClassicGame } from '../../src/games/kruzhok/data';

const dir = process.argv[2] ?? 'D:/temp/kruzhok';
mkdirSync(join(dir, 'brief'), { recursive: true });
const ev = (v: number) => (Math.abs(v) >= 9000 ? `мат в ${10000 - Math.abs(v)} (${v > 0 ? 'белые' : 'чёрные'} ставят)` : (v > 0 ? '+' : '') + (v / 100).toFixed(1));

for (const f of readdirSync('public/kruzhok/games')) {
  const g = JSON.parse(readFileSync(join('public/kruzhok/games', f), 'utf8')) as ClassicGame;
  let s = position();
  const rows: string[] = [];
  g.uci.forEach((u, i) => {
    const m = fromUci(s, u)!;
    const no = `${Math.floor(i / 2) + 1}.${i % 2 ? '..' : ''}`;
    const stop = g.stops.find((x) => x.ply === i);
    let t = `ply ${i}: ${no} ${ruSan(s, m)}${g.marks[i] ?? ''}  оценка после хода ${ev(g.ev[i])}`;
    if (stop) t += `\n    ★ ОСТАНОВКА «А как сходил бы ты?»: сыгранный ход сильнее следующего по силе на ${(stop.gap / 100).toFixed(1)} пешки; линия движка: ${g.best[i]}`;
    else if (g.best[i]) t += `\n    движок предлагал: ${g.best[i]}`;
    rows.push(t);
    s = play(s, m);
  });
  const head = `${g.white} — ${g.black}, ${g.place} ${g.year} (${g.event}), ${g.result}, ECO ${g.eco}. Рабочее название: «${g.title}».`;
  writeFileSync(join(dir, 'brief', f.replace('.json', '.txt')), `${head}\nОценка — за белых, в пешках.\n\n${rows.join('\n')}\n`);
}
console.log('готово');
