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
  # 2 ГБ памяти: tsc по умолчанию упирается в ~900 МБ кучи и падает — даём больше (остальное добирает zram)
  sudo -u lavochka -H env NODE_OPTIONS=--max-old-space-size=1600 npm run build >/tmp/lavochka-build.log 2>&1
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
# IndexNow: сообщить поисковикам изменившиеся страницы, lastmod в sitemap.xml (не вышло — не беда)
sudo -u lavochka node tools/indexnow.mjs /srv/lavochka/data || true
sudo -u lavochka git log -1 --oneline
