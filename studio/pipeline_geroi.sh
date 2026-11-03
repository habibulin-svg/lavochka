#!/usr/bin/env bash
# Герои, ночная очередь на 4070 (comfy-big :8188): все картинки → музыка → ролики.
# Ролики последними: если к утру не дойдут до конца — остальное уже готово.
# Задания — studio/jobs/geroi/make_jobs.py; вторая очередь (5060 + Blender) — pipeline_geroi_3d.sh.
# Лог: G:/temp/studio/pipeline-geroi.log
set -u
cd "$(dirname "$0")"
PY=G:/ai/ComfyUI/venv/Scripts/python.exe
PY3D=G:/ai/venvs/3d/Scripts/python.exe
OUT=G:/temp/studio/out/geroi
export PYTHONIOENCODING=utf-8
step() { echo "=== $(date '+%F %T') $*"; }

for b in 10-creatures 11-heroes 11b-mounts 12-towns 13-map 14-battle 15-icons 16-cutscene-keys; do
  step "картинки $b"
  $PY -X utf8 run.py "jobs/geroi/$b.yaml" || step "ОШИБКА $b"
  $PY -X utf8 post/sheet.py "$OUT/$b" || true
  step "партия $b готова"
done
step "музыка"
$PY3D -X utf8 runners/yue2.py jobs/geroi/18-music.yaml || step "ОШИБКА музыка"
step "ролики"
$PY -X utf8 runners/video.py jobs/geroi/17-videos.yaml || step "ОШИБКА ролики"
$PY -X utf8 post/video_sheet.py "$OUT/17-videos" || true
step "конвейер geroi закончен"
