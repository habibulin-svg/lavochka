#!/bin/sh
# Автовыкладка: таймер lavochka-autodeploy раз в 2 минуты смотрит origin/main и, если там новое, выкладывает.
# Неудачный коммит запоминается и повторно не собирается (до следующего пуша).
cd /srv/lavochka/app || exit 1
sudo -u lavochka git fetch -q origin main || exit 0
NEW=$(git rev-parse origin/main)
[ "$NEW" = "$(git rev-parse HEAD)" ] && exit 0
[ "$NEW" = "$(cat /var/lib/lavochka-failed 2>/dev/null)" ] && exit 0
echo "выкладка $(git log -1 --format='%h %s' "$NEW")"
if sh lavochka/deploy/deploy.sh; then rm -f /var/lib/lavochka-failed; else echo "$NEW" > /var/lib/lavochka-failed; exit 1; fi
