#!/usr/bin/env bash
# «Коммерсы 2.0»: очередь контента на 4070 (comfy-big). Уже готовое не пересчитывается.
#   bash studio/pipeline_kommersy2.sh            картинки → реакции → музыка
#   bash studio/pipeline_kommersy2.sh 24 27      только эти партии
# Отбор и упаковка — studio/post/pack_kommersy2.py; звуки (28) — runners/sfx.py --cpu, можно параллельно.
set -u
cd "$(dirname "$0")"
PY=G:/ai/ComfyUI/venv/Scripts/python.exe
PY3D=G:/ai/venvs/3d/Scripts/python.exe
OUT=G:/temp/studio/out/kommersy2
export PYTHONIOENCODING=utf-8

step() { echo "=== $(date '+%F %T') $*"; }
want() { [ -z "$SEL" ] || [[ " $SEL " == *" $1 "* ]]; }
SEL="${*:-}"

$PY -X utf8 jobs/kommersy2/make_jobs.py
for b in 22-kolyan-looks 23-npc 21-panoramas 25-cards; do
  want "${b%%-*}" || continue
  step "картинки $b"
  $PY -X utf8 run.py "jobs/kommersy2/$b.yaml" || step "ОШИБКА $b"
  $PY -X utf8 post/sheet.py "$OUT/$b" --cell 256 || true
done
if want 24; then
  step "реакции Коляна"
  $PY -X utf8 post/pack_kommersy2.py keys
  $PY -X utf8 runners/video.py jobs/kommersy2/24-kolyan-reactions.yaml || step "ОШИБКА 24"
fi
if want 27; then
  step "музыка"
  $PY3D -X utf8 runners/yue2.py jobs/kommersy2/27-music.yaml || step "ОШИБКА 27"
fi
step "конвейер kommersy2 закончен"
