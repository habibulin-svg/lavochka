#!/bin/bash
# «Герои»: собирать атласы существ по мере готовности роликов (партия w8-units-anims): все 6 роликов есть → video_atlas.py.
# Пока ComfyUI занят — BiRefNet на CPU; очередь пуста — на GPU. Выход — G:/temp/geroi-wb/atlas-all/<id>.webp/json.
# bash studio/post/atlas_worker.sh   (выходит, когда собраны все существа из w7)
# живописная партия: STAGE=p2-units-paint-anims LIST=p1-units-paint OUT=/g/temp/geroi-wb/atlas-paint bash studio/post/atlas_worker.sh
SRC=/g/ai/out/webbook/geroi/${STAGE:-w8-units-anims}
OUT=${OUT:-/g/temp/geroi-wb/atlas-all}
PY="G:/ai/venvs/3d/Scripts/python.exe"
mkdir -p "$OUT"
ids() { grep -E "^- name: " /g/Claude/Shish/studio/jobs/geroi/wb/${LIST:-w7-units-refine}.yaml | sed 's/- name: //' | if [ -n "$REV" ]; then tac; else cat; fi; }
while :; do
  left=0
  for id in $(ids); do
    [ -f "$OUT/$id.webp" ] && continue
    left=$((left + 1))
    n=$(ls "$SRC/$id"-{idle,walk,attack,hit,defend,death}-*.mp4 2>/dev/null | wc -l)
    [ "$n" -lt 6 ] && continue
    busy=$(curl -s -m 3 http://127.0.0.1:8188/queue | grep -c '"queue_running": \[\[')
    dev=--cpu; [ "$busy" = "0" ] && dev=
    echo "$(date +%H:%M) $id $dev"
    "$PY" -X utf8 /g/Claude/Shish/studio/post/video_atlas.py "$SRC" "$id" "$OUT" $dev 2>&1 | grep -E "готово|Error|error" | tail -2
  done
  [ "$left" = "0" ] && { echo "все атласы собраны"; break; }
  sleep 60
done
