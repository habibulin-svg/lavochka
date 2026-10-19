#!/bin/sh
# Выкладка на прод-сервер (FirstVDS): забрать main, собрать, перезапустить.
# Сама — по таймеру lavochka-autodeploy (autodeploy.sh); вручную с машины разработчика:
#   ssh lavochka sh /srv/lavochka/app/lavochka/deploy/deploy.sh
# Сборка не удалась — откатываемся на прежний коммит и собираем его, чтобы сайт не остался без dist/.
set -e
cd /srv/lavochka/app
PREV=$(sudo -u lavochka git rev-parse HEAD)
sudo -u lavochka git pull -q --ff-only
cd lavochka
build() {
  sudo -u lavochka -H npm ci --include=dev --no-audit --no-fund --loglevel=error &&
  sudo -u lavochka -H npm run build >/tmp/lavochka-build.log 2>&1
}
if ! build; then
  tail -30 /tmp/lavochka-build.log
  echo "сборка не удалась — откат на $PREV"
  sudo -u lavochka git reset -q --hard "$PREV"
  build
  systemctl restart lavochka
  exit 1
fi
systemctl restart lavochka
sleep 2
curl -fsS http://127.0.0.1:8787/api/health && echo
sudo -u lavochka git log -1 --oneline
