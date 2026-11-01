#!/usr/bin/env bash
# ГОПС, вторая очередь ночного конвейера: ждёт конец первой (pipeline_gops.sh), потом
# живые снаряды и волны жидкостей (Wan), нарезка эффектов/снарядов/жидкостей в спрайты.
set -u
cd "$(dirname "$0")"
PY=G:/ai/ComfyUI/venv/Scripts/python.exe
PY3D=G:/ai/venvs/3d/Scripts/python.exe
OUT=G:/temp/studio/out/gops
LOG1=G:/temp/studio/pipeline-gops.log
export PYTHONIOENCODING=utf-8
step() { echo "=== $(date '+%F %T') $*"; }

until grep -q "конвейер закончен" "$LOG1" 2>/dev/null; do sleep 120; done
for b in 29-actors 30-liquids; do
  step "ролики $b"
  $PY -X utf8 runners/video.py "jobs/gops/$b.yaml" || step "ОШИБКА $b"
  $PY -X utf8 post/video_sheet.py "$OUT/$b" || true
done
step "спрайты"
CUDA_VISIBLE_DEVICES=1 $PY3D -X utf8 post/video_sprites.py "$OUT/29-actors" "$OUT/31-sprites/actors" --frames 12 --size 192 || step "ОШИБКА actors"
CUDA_VISIBLE_DEVICES=1 $PY3D -X utf8 post/video_sprites.py "$OUT/25-videos" "$OUT/31-sprites/fx" --glob 'fx-*.mp4' --frames 16 --size 256 --key luma || step "ОШИБКА fx"
step "конвейер 2 закончен"
