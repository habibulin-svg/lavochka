/* Быстрая проверка по ходу работы (npm run check:quick, Stop-хук): все тесты, кроме партий ботов по играм, —
 * их гоняем только для игр, чьи папки менялись (git status), по одной партии на число игроков. Задеты общие
 * core/cards/harness — все игры. Полная проверка (npm run check) — перед пушем в конце большого этапа. */
import { execSync } from 'node:child_process';
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

export default mergeConfig(base, defineConfig({ test: { passWithNoTests: true, maxWorkers: workers, minWorkers: 1, env: { GAMES_ONLY: process.env.GAMES_ONLY ?? touched() } } }));
