#!/usr/bin/env bash
# Герои, вторая волна (платная часть), очередь на 4070 (comfy-big :8188): картинки → ролики → музыка.
# Задания — studio/jobs/geroi/make_jobs_w2.py; вторая очередь (5060 + Blender) — pipeline_geroi_w2_3d.sh.
# Лог: G:/temp/studio/pipeline-geroi-w2.log
set -u
cd "$(dirname "$0")"
PY=G:/ai/ComfyUI/venv/Scripts/python.exe
PY3D=G:/ai/venvs/3d/Scripts/python.exe
OUT=G:/temp/studio/out/geroi
export PYTHONIOENCODING=utf-8
step() { echo "=== $(date '+%F %T') $*"; }

for b in 30-creatures 31-heroes 31b-mounts 32-towns 33-map 34-battle 35-icons 36-cutscene-keys; do
  step "картинки $b"
  $PY -X utf8 run.py "jobs/geroi/$b.yaml" || step "ОШИБКА $b"
  $PY -X utf8 post/sheet.py "$OUT/$b" || true
  step "партия $b готова"
done
step "ролики"
$PY -X utf8 runners/video.py jobs/geroi/37-videos.yaml || step "ОШИБКА ролики"
$PY -X utf8 post/video_sheet.py "$OUT/37-videos" || true
step "музыка"
$PY3D -X utf8 runners/yue2.py jobs/geroi/38-music.yaml || step "ОШИБКА музыка"
step "конвейер geroi-w2 закончен"
