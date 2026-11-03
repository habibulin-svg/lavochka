"""Демо: сводка по выбранному в шаге approve (selected.json) → report.md."""
import json
import os
import pathlib
import sys

sel = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
out = pathlib.Path(os.environ.get('LGS_OUT', '.')) / 'report.md'
lines = ['# Выбрано', ''] + [f'- {s["name"]}: {pathlib.Path(s["file"]).name} (шаг {s["step"]})' for s in sel]
out.write_text('\n'.join(lines) + '\n', encoding='utf-8')
print(f'выбрано {len(sel)}')
print(f'@output {out}')
