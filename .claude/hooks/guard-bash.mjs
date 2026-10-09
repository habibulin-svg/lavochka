// PreToolUse (Bash/PowerShell): не даём переписать историю на GitHub и закоммитить сканы из materials/.
import { out, readInput } from './lib.mjs';

const input = await readInput();
const cmd = String(input.tool_input?.command || '');
const deny = (reason) => out({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });

if (/\bgit\b[^\n;&|]*\bpush\b[^\n;&|]*(\s--force(?!-with-lease)\b|\s-f\b|\s\+\w)/.test(cmd)) {
  deny('Force-push запрещён правилами проекта: история на GitHub не переписывается. Сделай новый коммит.');
} else if (/\bgit\b[^\n;&|]*\badd\b[^\n;&|]*(\s-f\b|\s--force\b)[^\n;&|]*materials/.test(cmd) || /\bgit\b[^\n;&|]*\badd\b[^\n;&|]*materials[^\n;&|]*\.(jpe?g|png)\b/i.test(cmd)) {
  deny('Сканы из materials/ в репозиторий не кладём (только для личного использования). Ссылки — в materials/README.md.');
}
