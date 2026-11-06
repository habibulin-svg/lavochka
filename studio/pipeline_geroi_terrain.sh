#!/usr/bin/env bash
# Герои: новый ландшафт (make_jobs_terrain.py) — грунты, декор, горы, поля боя, препятствия на 4070; вырезка фона — на 5060.
# Лог: G:/temp/studio/pipeline-geroi-terrain.log
set -u
cd "$(dirname "$0")"
PY=G:/ai/ComfyUI/venv/Scripts/python.exe
PY3D=G:/ai/venvs/3d/Scripts/python.exe
O=G:/temp/studio/out/geroi
export PYTHONIOENCODING=utf-8
step() { echo "=== $(date '+%F %T') $*"; }
for b in 13-map-redo9 14-battle-redo9 33-map-redo9 34-battle-redo9; do
  step "картинки $b"
  $PY -X utf8 run.py jobs/geroi/$b.yaml || step "ОШИБКА $b"
done
for b in 13-map-redo9 33-map-redo9 14-battle-redo9 34-battle-redo9; do
  step "вырезка $b"
  ls $O/$b/decor-*.png $O/$b/mountain-*.png $O/$b/obstacle-*.png 2>/dev/null > /g/temp/cut-$b.txt
  CUDA_DEVICE_ORDER=PCI_BUS_ID CUDA_VISIBLE_DEVICES=1 $PY3D -X utf8 runners/cutout.py "$O/$b/cut" $(cat /g/temp/cut-$b.txt) || step "ОШИБКА вырезка $b"
done
step "конвейер geroi-terrain закончен"
