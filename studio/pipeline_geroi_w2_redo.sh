#!/usr/bin/env bash
# Герои, вторая волна: переделки после отбора на 4070 — ждёт конца pipeline_geroi_w2.sh.
# Ключи роликов c4-3b, c7-2b (36-cutscene-keys-redo) → ролики по ним (37-videos-redo). Лог: G:/temp/studio/pipeline-geroi-w2-redo.log
set -u
cd "$(dirname "$0")"
PY=G:/ai/ComfyUI/venv/Scripts/python.exe
OUT=G:/temp/studio/out/geroi
export PYTHONIOENCODING=utf-8
step() { echo "=== $(date '+%F %T') $*"; }
until grep -q "конвейер geroi-w2 закончен" G:/temp/studio/pipeline-geroi-w2.log; do sleep 120; done
step "ключи 36-redo"
$PY -X utf8 run.py jobs/geroi/36-cutscene-keys-redo.yaml || step "ОШИБКА ключи"
step "ролики 37-redo"
$PY -X utf8 runners/video.py jobs/geroi/37-videos-redo.yaml || step "ОШИБКА ролики"
$PY -X utf8 post/video_sheet.py "$OUT/37-videos-redo" || true
step "конвейер geroi-w2-redo закончен"
