#!/bin/sh
# Ночной бэкап: рекорды (/srv/lavochka/data) и настройки сервера → /var/backups/lavochka, храним 30 дней.
# Код не бэкапим — он в git. Забрать копии к себе: tools/server/pull-backups.sh
set -e
D=/var/backups/lavochka
mkdir -p $D && chmod 700 $D
F=$D/lavochka-$(date +%F).tar.gz
tar -czf "$F.part" --ignore-failed-read \
  /srv/lavochka/data /etc/lavochka.env /etc/turnserver.conf \
  /etc/nginx/sites-available/lavochka /etc/systemd/system/lavochka* /etc/letsencrypt 2>/dev/null || [ -s "$F.part" ]
mv "$F.part" "$F"
find $D -name 'lavochka-*.tar.gz' -mtime +30 -delete
echo "бэкап $F $(du -h "$F" | cut -f1)"
