#!/bin/sh
# Выкладка на прод-сервер (FirstVDS): забрать main, собрать, перезапустить.
# С машины разработчика:  ssh lavochka sh /srv/lavochka/app/lavochka/deploy/deploy.sh
set -e
cd /srv/lavochka/app
sudo -u lavochka git pull -q --ff-only
cd lavochka
sudo -u lavochka -H npm ci --include=dev --no-audit --no-fund --loglevel=error
sudo -u lavochka -H npm run build >/tmp/lavochka-build.log 2>&1 || { tail -30 /tmp/lavochka-build.log; exit 1; }
systemctl restart lavochka
sleep 2
curl -fsS http://127.0.0.1:8787/api/health && echo
sudo -u lavochka git log -1 --oneline
