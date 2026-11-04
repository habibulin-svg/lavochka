#!/usr/bin/env bash
# Герои, переделки после отбора (партии <партия>-redo из make_jobs.py REDO): картинки на 4070, звуки на 5060.
# Лог: G:/temp/studio/pipeline-geroi-redo.log; листы для отбора — G:/temp/geroi-pick/<партия>-redo-NN.jpg
set -u
cd "$(dirname "$0")"
PY=G:/ai/ComfyUI/venv/Scripts/python.exe
PY3D=G:/ai/venvs/3d/Scripts/python.exe
OUT=G:/temp/studio/out/geroi
export PYTHONIOENCODING=utf-8 CUDA_DEVICE_ORDER=PCI_BUS_ID
step() { echo "=== $(date '+%F %T') $*"; }
(CUDA_VISIBLE_DEVICES=1 $PY3D -X utf8 runners/sfx.py jobs/geroi/19-sfx-redo.yaml > G:/temp/studio/pipeline-geroi-redo-sfx.log 2>&1; echo "звуки готовы" >> G:/temp/studio/pipeline-geroi-redo-sfx.log) &
for b in "$@"; do
  step "картинки $b-redo"
  $PY -X utf8 run.py "jobs/geroi/$b-redo.yaml" || step "ОШИБКА $b"
  $PY -X utf8 post/pick_sheets.py "$OUT/$b-redo" G:/temp/geroi-pick 230 || true
  step "партия $b-redo готова"
done
wait
step "переделки закончены"
