#!/usr/bin/env bash
# Герои: старшие ступени (6–7) крупнее — кадр 400 px вместо 320, иначе на поле они растягиваются и мылятся.
# pipeline_geroi_hd.sh [имя существа ...] — без имён все существа 6–7 ступени с готовым мешем; после — post/pack_geroi.py --only creatures.
# Лог: G:/temp/studio/pipeline-geroi-hd.log
set -u
cd "$(dirname "$0")"
PY=G:/ai/ComfyUI/venv/Scripts/python.exe
BLENDER="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
OUT=G:/temp/studio/out/geroi/20-creature-3d
step() { echo "=== $(date '+%F %T') $*"; }
names="$*"
[ -n "$names" ] || names=$($PY -X utf8 -c "import json;print(' '.join(c['name'] for c in json.load(open('jobs/geroi/creatures.json',encoding='utf-8')) if c['tier']>=6))")
for n in $names; do
  d="$OUT/$n"
  [ -f "$d/mesh.glb" ] || { step "нет меша $n"; continue; }
  step "кадры $n"
  "$BLENDER" -b -P blender/creature_sprites.py -- "$d/mesh.glb" "$d/mesh-cut.png" "$d/frames" 400 > "$d/blender.log" 2>&1 || step "ОШИБКА Blender $n"
done
step "конвейер geroi-hd закончен"
