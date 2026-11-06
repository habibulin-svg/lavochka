#!/usr/bin/env bash
# Герои: постройки замков заново (партия 42, make_jobs_bld.py) — все 8 замков, на 4070; вырезка фона — на 5060.
# Ждёт пробную партию (Затулье + Плотина), затем переделывает в ней панорамы и трактиры (промпт поправлен) и делает остальные замки.
# Лог: G:/temp/studio/pipeline-geroi-bld.log
set -u
cd "$(dirname "$0")"
PY=G:/ai/ComfyUI/venv/Scripts/python.exe
PY3D=G:/ai/venvs/3d/Scripts/python.exe
OUT=G:/temp/studio/out/geroi/42-buildings
export PYTHONIOENCODING=utf-8
step() { echo "=== $(date '+%F %T') $*"; }

until grep -q "выход:" G:/temp/geroi-pick/bld-pilot.log 2>/dev/null; do sleep 30; done
step "пробная партия готова: переделываю панорамы, трактиры и жилища пробы"
$PY -X utf8 - <<'EOF'
import json, pathlib
out = pathlib.Path('G:/temp/studio/out/geroi/42-buildings')
m = json.loads((out / 'manifest.json').read_text(encoding='utf-8'))
redo = lambda e: e['item'].endswith('-site') or e['item'].endswith('-tavern') or '-dwell' in e['item']
for e in m:
    if redo(e):
        (out / e['file']).unlink(missing_ok=True)
(out / 'manifest.json').write_text(json.dumps([e for e in m if not redo(e)], ensure_ascii=False, indent=1), encoding='utf-8')
EOF
$PY -X utf8 jobs/geroi/make_jobs_bld.py
step "картинки 42-buildings"
$PY -X utf8 run.py jobs/geroi/42-buildings.yaml || step "ОШИБКА картинки"
$PY -X utf8 post/sheet.py "$OUT" || true
step "вырезка фона"
CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1 $PY3D -X utf8 runners/cutout.py "$OUT/cut" "$OUT"/bld-*.png || step "ОШИБКА вырезка"
step "конвейер geroi-bld закончен"
