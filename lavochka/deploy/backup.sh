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

# база аккаунтов (PostgreSQL) — дамп рядом, 30 дней
if command -v pg_dump >/dev/null && sudo -u postgres psql -Atqc "select 1 from pg_database where datname = 'lavochka'" | grep -q 1; then
  P=$D/pg-$(date +%F).sql.gz
  sudo -u postgres pg_dump --no-owner lavochka | gzip > "$P.part" && mv "$P.part" "$P"
  chmod 600 "$P"
  find $D -name 'pg-*.sql.gz' -mtime +30 -delete
  echo "база $P $(du -h "$P" | cut -f1)"
fi

# Копия вне сервера — Яндекс Диск через REST API (WebDAV на бесплатном тарифе закрыт — 402).
# Токен OAuth с доступом только к папке приложения («Приложения/…» на Диске) — YADISK_TOKEN в
# /etc/lavochka-backup.env (`lavochka-secret YADISK_TOKEN /etc/lavochka-backup.env`), живёт год.
# Туда — только данные, без секретов: ключи и сертификаты в чужое хранилище не отдаём
# (их вводят заново / выпускают заново), конфиги — в git.
[ -f /etc/lavochka-backup.env ] || exit 0
. /etc/lavochka-backup.env
[ -n "${YADISK_TOKEN:-}" ] || exit 0
API=https://cloud-api.yandex.net/v1/disk/resources
O=$D/data-$(date +%F).tar.gz
tar -czf "$O" -C / srv/lavochka/data $(cd / && ls -d var/backups/lavochka/pg-*.sql.gz 2>/dev/null | tail -1)
ya() { curl -4 -s -m 300 -H "Authorization: OAuth $YADISK_TOKEN" "$@"; }
href=$(ya "$API/upload?path=app:/$(basename "$O")&overwrite=true" | sed -n 's/.*"href":"\([^"]*\)".*/\1/p')
code=000
[ -n "$href" ] && code=$(curl -4 -s -m 300 -o /dev/null -w '%{http_code}' -T "$O" "$href")
rm -f "$O"
case $code in 2*) echo "копия на Яндекс Диск: $(basename "$O")";; *) echo "Яндекс Диск: ошибка ${code} (токен YADISK_TOKEN?)" >&2; exit 1;; esac
# на Диске храним 30 дней: стираем копии 31–45-дневной давности (пропуски ночей не копят мусор)
for n in $(seq 31 45); do ya -o /dev/null -X DELETE "$API?path=app:/data-$(date -d "$n days ago" +%F).tar.gz&permanently=true" || true; done
