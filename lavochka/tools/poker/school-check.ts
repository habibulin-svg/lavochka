/* Проверка уроков школы покера (src/games/poker/school/lessons/*.json).
 * Запуск: npx tsx tools/poker/school-check.ts [--only 01,07] [--v]
 * Каждый стол собирается движком, каждая задача решается расчётом (school/solve.ts) и сверяется с заявленным ответом.
 * --v — показать расчёт по каждой задаче (для вычитки объяснений). Код выхода 1, если есть ошибки. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { solve } from '../../src/games/poker/school/solve';
import type { Lesson } from '../../src/games/poker/school/types';
import { checkLesson } from '../../src/games/poker/school/validate';

const dir = join(import.meta.dirname, '../../src/games/poker/school/lessons');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const verbose = args.includes('--v');
let bad = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  if (only && !only.some((o) => f.startsWith(o))) continue;
  const l = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Lesson;
  const errs = checkLesson(l);
  bad += errs.length;
  console.log(`${errs.length ? '✗' : '✓'} ${f}: шагов ${l.steps?.length ?? 0}, задач ${l.tasks?.length ?? 0}`);
  for (const e of errs) console.log('   ' + e);
  if (verbose)
    for (const t of l.tasks ?? []) {
      const r = solve(t);
      console.log(`   · ${t.id} [${t.kind}] → ${r.answer}${r.margin != null ? ` (запас ${r.margin.toFixed(3)})` : ''}: ${r.facts.replace(/<[^>]+>/g, '')}`);
    }
}
console.log(bad ? `Ошибок: ${bad}` : 'Ошибок нет');
process.exit(bad ? 1 : 0);
