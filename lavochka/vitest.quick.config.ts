/* Быстрая проверка по ходу работы (npm run check:quick, Stop-хук): все тесты, кроме партий ботов по играм, —
 * их гоняем только для игр, чьи папки менялись (git status), по одной партии на число игроков. Задеты общие
 * core/cards/harness — все игры. Полная проверка (npm run check) — перед пушем в конце большого этапа. */
import { execSync } from 'node:child_process';
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

export default mergeConfig(base, defineConfig({ test: { passWithNoTests: true, env: { GAMES_ONLY: process.env.GAMES_ONLY ?? touched() } } }));
