#!/usr/bin/env bash
# Герои: герой на коне для карты — TripoSG (5060) → Blender: 8 направлений, камера сверху 40°, idle + move.
# Аргументы — пары имя=эталон (выбор из picks.json). Выход: G:/temp/studio/out/geroi/21-mounts-3d/<имя>/frames
set -u
cd "$(dirname "$0")"
PY3D=G:/ai/venvs/3d/Scripts/python.exe
D=G:/temp/studio/out/geroi/21-mounts-3d
export PYTHONIOENCODING=utf-8 CUDA_DEVICE_ORDER=PCI_BUS_ID
for a in "$@"; do n=${a%%=*}; ref=${a#*=}; d=$D/$n
  mkdir -p $d
  [ -f $d/mesh.glb ] || CUDA_VISIBLE_DEVICES=1 $PY3D -X utf8 runners/to3d.py "$ref" "$d/mesh.glb" --faces 12000 > "$d/to3d.log" 2>&1 || { echo "ОШИБКА 3D $n"; continue; }
  "/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b -P blender/creature_sprites.py -- "$d/mesh.glb" "$d/mesh-cut.png" "$d/frames" 256 --dirs 8 --elev 40 --anims idle,move > "$d/blender.log" 2>&1 || echo "ОШИБКА Blender $n"
  echo "$n $(grep поворот $d/blender.log)"
done
echo готово
