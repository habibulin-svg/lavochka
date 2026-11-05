#!/usr/bin/env bash
# Герои, вторая волна: после основной 3D-очереди (5060) — пересборка 3D существ, у которых выбран не первый эталон
# (список studio/jobs/geroi/w2-3d-redo.txt: имя=картинка), затем кони второй волны (pipeline_geroi_mounts.sh по picks 31b).
# Лог: G:/temp/studio/pipeline-geroi-w2-fix.log
set -u
cd "$(dirname "$0")"
PY=G:/ai/ComfyUI/venv/Scripts/python.exe
PY3D=G:/ai/venvs/3d/Scripts/python.exe
BLENDER="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
OUT=G:/temp/studio/out/geroi
export PYTHONIOENCODING=utf-8 CUDA_DEVICE_ORDER=PCI_BUS_ID
step() { echo "=== $(date '+%F %T') $*"; }
until grep -q "конвейер geroi-w2-3d закончен" G:/temp/studio/pipeline-geroi-w2-3d.log 2>/dev/null; do sleep 60; done
while IFS='=' read -r n ref; do
  [ -n "$n" ] || continue
  tier=$($PY -X utf8 -c "import json,sys;print(next(c['tier'] for c in json.load(open('jobs/geroi/creatures-w2.json',encoding='utf-8')) if c['name']==sys.argv[1]))" "$n")
  px=320; [ "$tier" -ge 6 ] && px=400
  d="$OUT/20-creature-3d/$n"
  rm -rf "$d"; mkdir -p "$d"
  step "3D заново $n ($ref)"
  CUDA_VISIBLE_DEVICES=1 $PY3D -X utf8 runners/to3d.py "$ref" "$d/mesh.glb" --faces 12000 > "$d/to3d.log" 2>&1 || { step "ОШИБКА 3D $n"; continue; }
  "$BLENDER" -b -P blender/creature_sprites.py -- "$d/mesh.glb" "$d/mesh-cut.png" "$d/frames" $px > "$d/blender.log" 2>&1 || step "ОШИБКА Blender $n"
done < jobs/geroi/w2-3d-redo.txt
step "кони"
pairs=$($PY -X utf8 -c "import json;p=json.load(open('jobs/geroi/picks.json',encoding='utf-8'))['31b-mounts'];print(' '.join(f'{k}=G:/temp/studio/out/geroi/31b-mounts/{k}-{v}.png' for k,v in p.items()))")
bash pipeline_geroi_mounts.sh $pairs
$PY -X utf8 post/geroi_sheets.py "$OUT/20-creature-3d" "$OUT/30-creatures" || true
step "конвейер geroi-w2-fix закончен"
