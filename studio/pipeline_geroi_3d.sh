#!/usr/bin/env bash
# Герои, ночная очередь на 5060 + Blender: звуки → (ждёт эталоны существ с 4070) → каждое существо: TripoSG → Blender-анимации.
# 3D строится по первому сиду эталона (41); отбор и переделка — утром (мой отбор по overview.jpg).
# Лог: G:/temp/studio/pipeline-geroi-3d.log
set -u
cd "$(dirname "$0")"
PY=G:/ai/ComfyUI/venv/Scripts/python.exe
PY3D=G:/ai/venvs/3d/Scripts/python.exe
BLENDER="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
OUT=G:/temp/studio/out/geroi
LOG1=G:/temp/studio/pipeline-geroi.log
export PYTHONIOENCODING=utf-8 CUDA_DEVICE_ORDER=PCI_BUS_ID
step() { echo "=== $(date '+%F %T') $*"; }

step "звуки"
CUDA_VISIBLE_DEVICES=1 $PY3D -X utf8 runners/sfx.py jobs/geroi/19-sfx.yaml || step "ОШИБКА звуки"

until grep -q "партия 10-creatures готова" "$LOG1" 2>/dev/null; do sleep 60; done
names=$($PY -X utf8 -c "import json;print(' '.join(c['name'] for c in json.load(open('jobs/geroi/creatures.json',encoding='utf-8'))))")
for n in $names; do
  d="$OUT/20-creature-3d/$n"
  if [ -f "$d/frames/meta.json" ]; then continue; fi
  mkdir -p "$d"
  step "3D $n"
  CUDA_VISIBLE_DEVICES=1 $PY3D -X utf8 runners/to3d.py "$OUT/10-creatures/$n-41.png" "$d/mesh.glb" --faces 12000 > "$d/to3d.log" 2>&1 || { step "ОШИБКА 3D $n"; continue; }
  "$BLENDER" -b -P blender/creature_sprites.py -- "$d/mesh.glb" "$d/mesh-cut.png" "$d/frames" 320 > "$d/blender.log" 2>&1 || step "ОШИБКА Blender $n"
done
$PY -X utf8 post/geroi_sheets.py "$OUT/20-creature-3d" "$OUT/10-creatures" || true
step "конвейер geroi-3d закончен"
