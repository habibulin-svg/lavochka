#!/bin/sh
# Забрать бэкапы с прод-сервера к себе (копия вне сервера): sh tools/server/pull-backups.sh [папка]
# По умолчанию — D:/backup/lavochka. Скачивает только новые архивы.
# В архивах — ключи сертификатов и секрет TURN: папку никуда не выкладывать.
DST=${1:-/d/backup/lavochka}
mkdir -p "$DST"
for f in $(ssh lavochka 'ls /var/backups/lavochka'); do
  if [ ! -f "$DST/$f" ]; then scp -q "lavochka:/var/backups/lavochka/$f" "$DST/" && echo "$f"; fi
done
