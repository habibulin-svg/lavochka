// SessionStart: подкладывает в контекст состояние проекта (docs/STATE.md), git и незакоммиченное.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, git, out, readInput } from './lib.mjs';

const input = await readInput();
const parts = [];
const statePath = join(ROOT, 'docs', 'STATE.md');
if (existsSync(statePath)) parts.push('## Состояние проекта (docs/STATE.md)\n\n' + readFileSync(statePath, 'utf8').trim());
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
const log = git('log', '--oneline', '-8');
const dirty = git('status', '--short');
parts.push(`## Git\nВетка: ${branch || '?'}\nПоследние коммиты:\n${log || '—'}\n${dirty ? `Незакоммиченные изменения:\n${dirty}` : 'Рабочее дерево чистое.'}`);
parts.push(`(Сессия: ${input.source || 'start'}. Правила работы — в CLAUDE.md.)`);
out({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: parts.join('\n\n') } });
