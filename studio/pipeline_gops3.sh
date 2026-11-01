#!/usr/bin/env bash
# ГОПС, третья очередь: ждёт конец второй (pipeline_gops2.sh), потом переделка неудачных иконок (22b) с вырезкой фона.
set -u
cd "$(dirname "$0")"
PY=G:/ai/ComfyUI/venv/Scripts/python.exe
PY3D=G:/ai/venvs/3d/Scripts/python.exe
OUT=G:/temp/studio/out/gops
LOG2=G:/temp/studio/pipeline-gops2.log
export PYTHONIOENCODING=utf-8
step() { echo "=== $(date '+%F %T') $*"; }

until grep -q "конвейер 2 закончен" "$LOG2" 2>/dev/null; do sleep 120; done
step "картинки 22b-arsenal-fix"
$PY -X utf8 run.py jobs/gops/22b-arsenal-fix.yaml || step "ОШИБКА 22b"
$PY -X utf8 post/sheet.py "$OUT/22b-arsenal-fix" --cell 256 || true
step "вырезка 22b"
CUDA_VISIBLE_DEVICES=1 $PY3D -X utf8 runners/cutout.py "$OUT/22b-arsenal-fix/cut" "$OUT"/22b-arsenal-fix/icon-*.png || step "ОШИБКА вырезки 22b"
step "конвейер 3 закончен"
