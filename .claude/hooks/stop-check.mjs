// Stop: если код сборника менялся с последней удачной проверки — tsc + vitest. Ошибки возвращают Claude к работе.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP, ROOT, git, out, readInput, run } from './lib.mjs';

const input = await readInput();
const WATCH = ['lavochka/src', 'lavochka/server', 'lavochka/tests', 'lavochka/package.json', 'lavochka/tsconfig.json', 'lavochka/vite.config.ts'];
const changed = git('status', '--porcelain', '--', ...WATCH)
  .split('\n')
  .map((l) => l.slice(3).trim().replace(/^"|"$/g, ''))
  .filter(Boolean);

if (!changed.length) process.exit(0); // всё закоммичено — проверено при коммите

const h = createHash('sha1');
for (const f of changed.sort()) {
  const p = join(ROOT, f);
  h.update(f);
  try {
    if (existsSync(p) && statSync(p).isFile()) h.update(readFileSync(p));
  } catch {
    /* файл мог исчезнуть */
  }
}
const fp = h.digest('hex');
const cacheDir = join(ROOT, '.claude', '.cache');
const cacheFile = join(cacheDir, 'last-check');
if (existsSync(cacheFile) && readFileSync(cacheFile, 'utf8') === fp) process.exit(0);

const tsc = run(join(APP, 'node_modules', 'typescript', 'bin', 'tsc'), ['--noEmit', '--pretty', 'false']);
const tests = tsc.ok ? run(join(APP, 'node_modules', 'vitest', 'vitest.mjs'), ['run', '--reporter=dot']) : { ok: false, out: '(тесты не запускались: сначала типы)' };

if (tsc.ok && tests.ok) {
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cacheFile, fp);
  out({ systemMessage: `✓ Типы и тесты в порядке. Незакоммиченных файлов: ${changed.length}.` });
  process.exit(0);
}

const tail = (s) => s.trim().split('\n').slice(-40).join('\n');
const report = (tsc.ok ? '' : `TypeScript:\n${tail(tsc.out)}\n\n`) + (tests.ok ? '' : `Тесты:\n${tail(tests.out)}`);
if (input.stop_hook_active) {
  // уже возвращали к работе — не зацикливаемся, просто предупреждаем
  out({ systemMessage: '⚠ Проверки сборника всё ещё не проходят (см. npm run check в lavochka).' });
  process.exit(0);
}
out({ decision: 'block', reason: `Проверки сборника не прошли — почини перед завершением.\n\n${report}` });
