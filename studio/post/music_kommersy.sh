#!/bin/sh
# «Коммерсы»: песни YuE2 (flac) → ogg для игры, громкость выровнена (EBU R128, −16 LUFS), конец — затухание.
# sh studio/post/music_kommersy.sh   → lavochka/public/kommersy/a/music/<песня>-<сид>.ogg
SRC=G:/temp/studio/out/kommersy/06-music
DST=lavochka/public/kommersy/a/music
FF=G:/ai/ffmpeg/bin/ffmpeg
mkdir -p "$DST"
for f in "$SRC"/*.flac; do
  n=$(basename "$f" .flac)
  d=$(G:/ai/ffmpeg/bin/ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
  st=$(awk "BEGIN{print $d-4}")  # YuE2 обрывает песню на лимите — гасим последние 4 с
  "$FF" -v error -y -i "$f" -af "loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=out:st=$st:d=4" -ac 2 -ar 44100 -c:a libvorbis -q:a 3 "$DST/$n.ogg" && echo "$n"
done
