#!/usr/bin/env bash
# Коммерсы: очередь контента на 4070 (comfy-big). Уже готовое не пересчитывается.
#   bash studio/pipeline_kommersy.sh            всё
#   bash studio/pipeline_kommersy.sh 03 05      только эти партии
set -u
cd "$(dirname "$0")"
PY=G:/ai/ComfyUI/venv/Scripts/python.exe
OUT=G:/temp/studio/out/kommersy
export PYTHONIOENCODING=utf-8

step() { echo "=== $(date '+%F %T') $*"; }
want() { [ -z "$SEL" ] || [[ " $SEL " == *" $1 "* ]]; }
SEL="${*:-}"

$PY -X utf8 jobs/kommersy/make_jobs.py
for b in 03-kolyan-looks 05-npc 04-panoramas; do
  want "${b%%-*}" || continue
  step "картинки $b"
  $PY -X utf8 run.py "jobs/kommersy/$b.yaml" || step "ОШИБКА $b"
  $PY -X utf8 post/sheet.py "$OUT/$b" --cell 256 || true
done
step "конвейер kommersy закончен"
