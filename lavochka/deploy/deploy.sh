#!/bin/sh
# Выкладка на прод-сервер (FirstVDS): забрать main, собрать, перезапустить.
# Сама — по таймеру lavochka-autodeploy (autodeploy.sh); вручную с машины разработчика:
#   ssh lavochka sh /srv/lavochka/app/lavochka/deploy/deploy.sh
# Сборка не удалась — откатываемся на прежний коммит и собираем его, чтобы сайт не остался без dist/.
set -e
cd /srv/lavochka/app
PREV=$(sudo -u lavochka git rev-parse HEAD)
sudo -u lavochka git pull -q --ff-only
# ассеты крупных игр — в Git LFS (docs/PRODUCTION.md §4): без git-lfs на сервере вместо картинок были бы файлы-указатели
if command -v git-lfs >/dev/null 2>&1; then sudo -u lavochka -H git lfs pull; else echo "ВНИМАНИЕ: нет git-lfs — ассеты ГОПС не скачаны"; fi
cd lavochka
# Сборка — в своей cgroup: живой памяти не больше 2500 МБ (VPS «Разгон», 4 ГБ), остальное — в подкачку (/swapfile, 2 ГБ,
# deploy/README.md). Без потолка vite build (~1,5 ГБ кучи) выдавливал сервер игр и sshd, и VPS вис намертво (02.11.2026).
LIMIT="systemd-run --scope -q -p MemoryMax=2500M -p MemorySwapMax=2G nice -n 10"
build() {
  $LIMIT sudo -u lavochka -H npm ci --include=dev --no-audit --no-fund --loglevel=error &&
  # Как npm run build, но без tsc: типы проверены перед пушем (npm run check, Stop-хук), а на 2 ГБ памяти tsc падает.
  $LIMIT sudo -u lavochka -H env NODE_OPTIONS=--max-old-space-size=1800 sh -c 'npx vite build && npx tsx tools/prerender.ts && npm run build:server' >/tmp/lavochka-build.log 2>&1
}
# прежний сайт — в запас: vite build стирает dist/, и если не соберётся и откат, сайт остался бы без страниц
rm -rf /tmp/lavochka-dist-prev && cp -a dist /tmp/lavochka-dist-prev 2>/dev/null || true
if ! build; then
  tail -30 /tmp/lavochka-build.log
  echo "сборка не удалась — откат на $PREV"
  sudo -u lavochka git reset -q --hard "$PREV"
  if ! build && [ -d /tmp/lavochka-dist-prev ]; then
    echo "и откат не собрался — возвращаю прежний dist/"
    rm -rf dist && cp -a /tmp/lavochka-dist-prev dist
  fi
  systemctl restart lavochka
  exit 1
fi
systemctl restart lavochka
sleep 2
curl -fsS http://127.0.0.1:8787/api/health && echo
# IndexNow: сообщить поисковикам изменившиеся страницы, lastmod в sitemap.xml (не вышло — не беда)
sudo -u lavochka node tools/indexnow.mjs /srv/lavochka/data || true
sudo -u lavochka git log -1 --oneline
