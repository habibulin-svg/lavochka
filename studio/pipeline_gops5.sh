#!/usr/bin/env bash
# ГОПС, пятая очередь: ждёт конец четвёртой, вторая попытка всплеска (24d ключи → 25d ролики → спрайты fx3).
set -u
cd "$(dirname "$0")"
PY=G:/ai/ComfyUI/venv/Scripts/python.exe
PY3D=G:/ai/venvs/3d/Scripts/python.exe
OUT=G:/temp/studio/out/gops
export PYTHONIOENCODING=utf-8
step() { echo "=== $(date '+%F %T') $*"; }

until grep -q "конвейер 4 закончен" G:/temp/studio/pipeline-gops4.log 2>/dev/null; do sleep 60; done
step "картинки 24d-splash-keys"
$PY -X utf8 run.py jobs/gops/24d-splash-keys.yaml || step "ОШИБКА 24d"
step "ролики 25d-splash-videos"
$PY -X utf8 runners/video.py jobs/gops/25d-splash-videos.yaml || step "ОШИБКА 25d"
step "спрайты всплеска"
CUDA_VISIBLE_DEVICES=1 $PY3D -X utf8 post/video_sprites.py "$OUT/25d-splash-videos" "$OUT/31-sprites/fx3" --glob 'fx3-*.mp4' --frames 16 --size 256 --key luma || step "ОШИБКА fx3"
step "конвейер 5 закончен"
