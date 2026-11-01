#!/usr/bin/env bash
# Анимации гопника для всех бригад: Blender (EEVEE) → кадры → атлас + JSON → лист и GIF для проверки.
# bash studio/pipeline_anims.sh [бригада ...]   (по умолчанию все шесть; ~4 мин на бригаду)
set -e
cd "$(dirname "$0")"
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
PY="G:/ai/ComfyUI/venv/Scripts/python.exe"
SRC=G:/temp/studio/out/gops/04-build
OUT=G:/temp/studio/out/gops/28-anims
GIFS=idle,walk,backflip,hurt-fly,deflate,drown,throw,swing,victory-dance,taunt,smoke-break,celebrate-hit
BR=${*:-zatulinka rastochka zaton pervomayka chemskoy leninskiy}
for b in $BR; do
  echo "== $b"
  "$B" -b -P blender/gopnik_sprites.py -- "$SRC/gopnik-$b.blend" "$OUT/$b" 192 > "$OUT/$b.log" 2>&1
  grep -q "^кадры:" "$OUT/$b.log" || { echo "ошибка рендера $b, см. $OUT/$b.log"; exit 1; }
  "$PY" -X utf8 post/atlas.py "$OUT/$b" "$OUT/$b-atlas"
  "$PY" -X utf8 post/anim_sheet.py "$OUT/$b" "$OUT/$b-sheet.png" --cols 19 --crop 0.1,0,0.9,1 \
    --gif "$GIFS" --gifdir "$OUT/gif/$b"
done
