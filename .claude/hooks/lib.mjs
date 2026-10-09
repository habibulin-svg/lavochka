// Общее для хуков: корень проекта, чтение stdin, запуск git/node.
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(process.env.CLAUDE_PROJECT_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
export const APP = join(ROOT, 'lavochka');
export const NODE = process.execPath;

export async function readInput() {
  let s = '';
  for await (const c of process.stdin) s += c;
  try {
    return JSON.parse(s || '{}');
  } catch {
    return {};
  }
}

export function git(...args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

export function run(script, args, cwd = APP) {
  const r = spawnSync(NODE, [script, ...args], { cwd, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' } });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}` };
}

export function out(obj) {
  process.stdout.write(JSON.stringify(obj));
}
