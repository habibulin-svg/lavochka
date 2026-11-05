#!/usr/bin/env bash
# Герои, вторая волна, очередь на 5060 + Blender: звуки → (ждёт эталоны существ с 4070) → каждое существо: TripoSG → Blender.
# 3D — по первому сиду эталона (41), старшие ступени (6–7) — кадр 400 (урок первой волны). Отбор и переделки — по overview.jpg.
# Лог: G:/temp/studio/pipeline-geroi-w2-3d.log
set -u
cd "$(dirname "$0")"
PY=G:/ai/ComfyUI/venv/Scripts/python.exe
PY3D=G:/ai/venvs/3d/Scripts/python.exe
BLENDER="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
OUT=G:/temp/studio/out/geroi
LOG1=G:/temp/studio/pipeline-geroi-w2.log
export PYTHONIOENCODING=utf-8 CUDA_DEVICE_ORDER=PCI_BUS_ID
step() { echo "=== $(date '+%F %T') $*"; }

step "звуки"
CUDA_VISIBLE_DEVICES=1 $PY3D -X utf8 runners/sfx.py jobs/geroi/39-sfx.yaml || step "ОШИБКА звуки"

until grep -q "партия 30-creatures готова" "$LOG1" 2>/dev/null; do sleep 60; done
list=$($PY -X utf8 -c "import json;print(' '.join(c['name']+':'+str(c['tier']) for c in json.load(open('jobs/geroi/creatures-w2.json',encoding='utf-8'))))")
for nt in $list; do
  n=${nt%%:*}; t=${nt##*:}; px=320; [ "$t" -ge 6 ] && px=400
  d="$OUT/20-creature-3d/$n"
  if [ -f "$d/frames/meta.json" ]; then continue; fi
  mkdir -p "$d"
  step "3D $n"
  CUDA_VISIBLE_DEVICES=1 $PY3D -X utf8 runners/to3d.py "$OUT/30-creatures/$n-41.png" "$d/mesh.glb" --faces 12000 > "$d/to3d.log" 2>&1 || { step "ОШИБКА 3D $n"; continue; }
  "$BLENDER" -b -P blender/creature_sprites.py -- "$d/mesh.glb" "$d/mesh-cut.png" "$d/frames" $px > "$d/blender.log" 2>&1 || step "ОШИБКА Blender $n"
done
$PY -X utf8 post/geroi_sheets.py "$OUT/20-creature-3d" "$OUT/30-creatures" || true
step "конвейер geroi-w2-3d закончен"
