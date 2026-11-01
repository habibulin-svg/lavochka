#!/usr/bin/env bash
# ГОПС, четвёртая очередь: переделка эффектов и ролика «квас» (24c ключи → 25c ролики → нарезка эффектов в спрайты).
set -u
cd "$(dirname "$0")"
PY=G:/ai/ComfyUI/venv/Scripts/python.exe
PY3D=G:/ai/venvs/3d/Scripts/python.exe
OUT=G:/temp/studio/out/gops
export PYTHONIOENCODING=utf-8
step() { echo "=== $(date '+%F %T') $*"; }

step "картинки 24c-fix-keys"
$PY -X utf8 run.py jobs/gops/24c-fix-keys.yaml || step "ОШИБКА 24c"
$PY -X utf8 post/sheet.py "$OUT/24c-fix-keys" --cell 256 || true
step "ролики 25c-fix-videos"
$PY -X utf8 runners/video.py jobs/gops/25c-fix-videos.yaml || step "ОШИБКА 25c"
$PY -X utf8 post/video_sheet.py "$OUT/25c-fix-videos" || true
step "спрайты эффектов"
CUDA_VISIBLE_DEVICES=1 $PY3D -X utf8 post/video_sprites.py "$OUT/25c-fix-videos" "$OUT/31-sprites/fx2" --glob 'fx2-*.mp4' --frames 16 --size 256 --key luma || step "ОШИБКА fx2"
step "конвейер 4 закончен"
