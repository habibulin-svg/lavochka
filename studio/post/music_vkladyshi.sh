#!/bin/sh
# «Вкладыши»: песни YuE2 (flac) → ogg (EBU R128, −16 LUFS, конец — затухание) + list.json; звуки — готовые ogg из sfx.py.
# sh studio/post/music_vkladyshi.sh   → lavochka/public/vkladyshi/a/music/<песня>-<сид>.ogg, .../a/sfx/<имя>-<сид>.ogg
SRC=G:/temp/studio/out/vkladyshi
DST=lavochka/public/vkladyshi/a
FF=G:/ai/ffmpeg/bin/ffmpeg
mkdir -p "$DST/music" "$DST/sfx"
for f in "$SRC"/03-music/*.flac; do
  [ -e "$f" ] || continue
  n=$(basename "$f" .flac)
  d=$(G:/ai/ffmpeg/bin/ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
  st=$(awk "BEGIN{print $d-4}")  # YuE2 обрывает песню на лимите — гасим последние 4 с
  "$FF" -v error -y -i "$f" -af "loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=out:st=$st:d=4" -ac 2 -ar 44100 -c:a libvorbis -q:a 3 "$DST/music/$n.ogg" && echo "$n"
done
(cd "$DST/music" && ls *.ogg 2>/dev/null | awk 'BEGIN{printf "["} {printf "%s\"%s\"", (NR>1?",":""), $0} END{print "]"}') > "$DST/music/list.json"
cp "$SRC"/02-sfx/ogg/*.ogg "$DST/sfx/" 2>/dev/null && echo "звуки: $(ls "$DST/sfx" | wc -l)"
