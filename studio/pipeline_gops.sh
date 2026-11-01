#!/usr/bin/env bash
# ГОПС: ночной конвейер контента (план — docs/gops/CONTENT.md).
# Картинки и ролики — по очереди на 4070 (comfy-big), вырезка фона — на 5060. Уже готовое не пересчитывается.
#   bash studio/pipeline_gops.sh            всё
#   bash studio/pipeline_gops.sh 21 22      только эти партии (+ их доводка)
set -u
cd "$(dirname "$0")"
PY=G:/ai/ComfyUI/venv/Scripts/python.exe
PY3D=G:/ai/venvs/3d/Scripts/python.exe
OUT=G:/temp/studio/out/gops
export PYTHONIOENCODING=utf-8

step() { echo "=== $(date '+%F %T') $*"; }
want() { [ -z "$SEL" ] || [[ " $SEL " == *" $1 "* ]]; }
SEL="${*:-}"

images() {  # партия картинок + лист выбора
  step "картинки $1"
  $PY -X utf8 run.py "jobs/gops/$1.yaml" || step "ОШИБКА $1"
  $PY -X utf8 post/sheet.py "$OUT/$1" --cell 256 || true
}
cutout() {  # $1 — партия, дальше — шаблоны имён
  local dir="$OUT/$1"; shift
  local files=()
  for pat in "$@"; do for f in "$dir"/$pat; do [ -f "$f" ] && files+=("$f"); done; done
  [ ${#files[@]} -eq 0 ] && return
  step "вырезка $dir (${#files[@]})"
  CUDA_VISIBLE_DEVICES=1 $PY3D -X utf8 runners/cutout.py "$dir/cut" "${files[@]}" || step "ОШИБКА вырезки $dir"
}

for b in 20-brand 24-cutscene-keys 21-themes 22-arsenal 23-common; do
  want "${b%%-*}" || continue
  images "$b"
done

want 21 && cutout 21-themes '*-prop*.png'
want 22 && cutout 22-arsenal 'world-*.png' 'icon-*.png'
want 23 && cutout 23-common 'crate-*.png' 'gas-*.png' 'fuel-*.png' 'cap-*.png' 'target-*.png' 'girder-*.png' 'sunflower-*.png' 'brigade-*.png' 'trophy-*.png' 'ui-*.png'
if want 21; then
  step "бесшовный грунт"
  mkdir -p "$OUT/21-themes/seamless"
  for f in "$OUT"/21-themes/*-ground-*.png; do
    $PY -X utf8 post/seamless.py "$f" "$OUT/21-themes/seamless/$(basename "$f")" 1024 || true
  done
fi

if want 25; then
  step "ролики"
  $PY -X utf8 runners/video.py jobs/gops/25-videos.yaml || step "ОШИБКА роликов"
  $PY -X utf8 post/video_sheet.py "$OUT/25-videos" || true
fi
step "конвейер закончен"
