#!/usr/bin/env bash
# Вкладыши: звуки (Stable Audio SFX) и музыка (YuE2 через comfy-big на :8188) на 4070. Готовое не пересчитывается.
#   bash studio/pipeline_vkladyshi.sh            всё
#   bash studio/pipeline_vkladyshi.sh 02         только звуки
set -u
cd "$(dirname "$0")"
PY3D=G:/ai/venvs/3d/Scripts/python.exe
export PYTHONIOENCODING=utf-8 CUDA_DEVICE_ORDER=PCI_BUS_ID

step() { echo "=== $(date '+%F %T') $*"; }
want() { [ -z "$SEL" ] || [[ " $SEL " == *" $1 "* ]]; }
SEL="${*:-}"

if want 02; then
  step "звуки 02-sfx"
  CUDA_VISIBLE_DEVICES=0 $PY3D -X utf8 runners/sfx.py jobs/vkladyshi/02-sfx.yaml || step "ОШИБКА 02-sfx"
fi
if want 03; then
  step "музыка 03-music"
  $PY3D -X utf8 runners/yue2.py jobs/vkladyshi/03-music.yaml || step "ОШИБКА 03-music"
fi
step "конвейер vkladyshi закончен"
