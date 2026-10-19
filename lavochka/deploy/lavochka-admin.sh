#!/bin/sh
# Команды аккаунтов на сервере (Мастер, права). Ставится в /usr/local/bin/lavochka-admin.
#   ssh -t lavochka lavochka-admin create-master <почта> [имя]
#   ssh lavochka lavochka-admin grant <почта> <право> [дней]
# Переменные базы берёт из /etc/lavochka.env, запускает от имени lavochka (вход в базу по сокету).
set -eu
set -a
. /etc/lavochka.env
set +a
cd /srv/lavochka/app/lavochka
exec sudo -u lavochka --preserve-env=PGHOST,PGUSER,PGDATABASE node dist-server/admin.js "$@"
