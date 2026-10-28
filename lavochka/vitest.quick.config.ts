/* Быстрая проверка по ходу работы (npm run check:quick, Stop-хук): общие тесты — все, а партии ботов по играм
 * (games-N) и собственные тесты игр (tests/<игра>.test.ts, tests/<игра>-….test.ts) — только для игр, чьи папки
 * менялись (git status), партии — по одной на число игроков. Задеты общие core/cards/harness — все игры.
 * Полная проверка (npm run check) — перед пушем в конце большого этапа. */
import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config';

function touched(): string {
  let files: string[];
  try {
    files = execSync('git status --porcelain --untracked-files=all', { encoding: 'utf8' })
      .split('\n')
      .map((l) => l.slice(3).trim().replace(/^"|"$/g, ''))
      .filter(Boolean);
  } catch {
    return '*';
  }
  const ids = new Set<string>();
  for (const f of files) {
    const m = f.match(/src\/games\/([^/]+)\//);
    if (m) ids.add(m[1]);
    else if (/src\/(core|cards)\/|tests\/(harness|games-suite)/.test(f)) return '*';
  }
  return [...ids].join(',');
}

// Быструю проверку часто гоняют несколько сессий сразу: на ядро меньше обычного, иначе главный процесс vitest
// не успевает отвечать обработчикам («Timeout calling onTaskUpdate») и прогон падает при зелёных тестах.
const workers = Math.max(1, availableParallelism() - 2);

const only = process.env.GAMES_ONLY ?? touched();

/** Тестовые файлы игр, которых правка не касалась: имя файла (или его начало до «-») — папка игры. */
function untouchedGameTests(): string[] {
  if (only === '*') return [];
  const keep = new Set(only.split(',').filter(Boolean));
  const games = new Set(readdirSync('src/games', { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name));
  return readdirSync('tests')
    .filter((f) => f.endsWith('.test.ts'))
    .filter((f) => {
      const name = f.slice(0, -'.test.ts'.length);
      const id = games.has(name) ? name : name.split('-')[0];
      return games.has(id) && !keep.has(id);
    })
    .map((f) => `tests/${f}`);
}

export default mergeConfig(
  base,
  defineConfig({
    test: { passWithNoTests: true, maxWorkers: workers, minWorkers: 1, exclude: ['**/node_modules/**', ...untouchedGameTests()], env: { GAMES_ONLY: only } },
  })
);
