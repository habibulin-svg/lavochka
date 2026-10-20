# Прод-сервер

FirstVDS VDS-KVM-NVMe-Старт, Ubuntu 24.04, IP `82.146.38.203` (`habibulin.fvds.ru`). Вход — только по SSH-ключу (`ssh lavochka`, адрес в `~/.ssh/config`), пароль отключён, fail2ban, ufw: 22/80/443, TURN 3478, 5349 и 49152–49999/udp.

- Код — `/srv/lavochka/app` (клон репозитория, владелец — системный пользователь `lavochka`), рекорды — `/srv/lavochka/data`.
- Служба `lavochka` (`lavochka.service`): `node dist-server/index.js` на `127.0.0.1:8787`, переменные — `/etc/lavochka.env` (`PORT`, `DATA_DIR`, TURN). Логи: `journalctl -u lavochka`.
- nginx (`nginx-lavochka.conf` → `/etc/nginx/sites-available/lavochka`): HTTPS, `/assets/` с диска с годовым кэшем, остальное и `/ws` — к Node. Основной адрес `https://lavochka-games.ru`; `www`, `lavochkagames.ru`, `lavochka-games.online` и http — 301 на него.
- Сертификат Let's Encrypt `lavochka` на все шесть имён, продлевает `certbot.timer`, после продления — `reload nginx`.

- **TURN для голоса и камеры** — coturn здесь же (`coturn/turnserver.conf` → `/etc/turnserver.conf`): 3478 udp/tcp, TLS 5349 (сертификат копирует хук `coturn/certbot-coturn.sh` → `/etc/letsencrypt/renewal-hooks/deploy/coturn.sh`), ретрансляция 49152–49999/udp. Логины временные (`use-auth-secret`): `/api/ice` выдаёт имя «срок:lavochka» и HMAC от `TURN_SECRET` из `/etc/lavochka.env` — секрет тот же, что `static-auth-secret` в конфиге coturn. Логи: `journalctl -u coturn`.
- **Бэкапы** — `backup.sh`, таймер `lavochka-backup.timer` в 04:20: рекорды и настройки (env, coturn, nginx, службы, сертификаты) → `/var/backups/lavochka/lavochka-ДАТА.tar.gz`, дамп базы → `pg-ДАТА.sql.gz`, хранятся 30 дней. **Копия вне сервера** — Яндекс Диск через REST API (бесплатный тариф WebDAV не пускает, 402): только данные и дамп базы, без ключей и сертификатов, токен `YADISK_TOKEN` в `/etc/lavochka-backup.env` (живёт год — потом получить заново), на Диске — 30 дней. Копия к себе: `sh tools/server/pull-backups.sh` (в `D:/backup/lavochka`). Код в бэкап не входит — он в git.
- **База** — PostgreSQL 16 здесь же, только localhost; база и роль `lavochka`, служба входит по сокету без пароля (`PGHOST`, `PGUSER`, `PGDATABASE` в `/etc/lavochka.env`). Схема — миграции в `server/accounts/pg.ts`, применяются при старте службы. Посмотреть: `ssh lavochka sudo -u lavochka psql`.
- **Секреты** вводит владелец сам: `tools/server/secret-gui.cmd` (окно) или `ssh -t lavochka lavochka-secret ИМЯ [ФАЙЛ]` (`deploy/lavochka-secret.sh` → `/usr/local/bin`).
- **Аккаунты из терминала** — `deploy/lavochka-admin.sh` → `/usr/local/bin/lavochka-admin`: `ssh -t lavochka lavochka-admin create-master <почта> [имя]` (Мастер с паролем и вторым фактором), `grant <почта> <право> [дней]`, `revoke`, `user`.
- **Почта домена** (`mail/`, ставит `sh deploy/mail/setup.sh`): Postfix только **принимает** письма для `lavochka-games.ru` (порт 25, TLS тем же сертификатом, fail2ban) и передаёт их сайту: `/etc/aliases` → `lavochka-mailin <ящик>` → `POST 127.0.0.1:8787/api/mail/in` с секретом (`/etc/lavochka-mailin.secret` = `MAIL_IN_SECRET` в `/etc/lavochka.env`; снаружи адрес закрыт и в nginx) → **обращение** (`server/support.ts`, окно «📮 Обращения» в профиле Мастера). Ящики: `support@`, `bugs@`, `admin@`, `abuse@`, `postmaster@`, `privacy@`, `pay@` (и почта `root`); `noreply@` — в никуда; остальные адреса отвергаются при приёме. Сайт лежит — письмо ждёт в очереди Postfix (`postqueue -p`) и доставится позже. Исходящей почты с сервера нет (`default_transport = error`): письма сайта, уведомления Мастеру и ответы на обращения (от `support@`) уходят через Unisender Go. DNS у REG.RU: `MX 10 lavochka-games.ru`; SPF и DKIM — от Unisender. Логи: `journalctl -u postfix@-`.

## Выкладка

**Сама:** таймер `lavochka-autodeploy.timer` раз в 2 минуты делает `git fetch` и, если в `origin/main` новое, запускает `deploy.sh` (`autodeploy.sh`). Значит, пуш в `main` = выкладка через 2–5 минут — пушить только то, что прошло `npm run check`. Не собралось — `deploy.sh` откатывает на прежний коммит, а неудачный коммит записывается в `/var/lib/lavochka-failed` и повторно не собирается до следующего пуша. Журнал: `journalctl -u lavochka-autodeploy`.

Вручную (то же самое сразу):

```
ssh lavochka sh /srv/lavochka/app/lavochka/deploy/deploy.sh
```

Установка таймеров (один раз): `cp lavochka-*.service lavochka-*.timer /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now lavochka-autodeploy.timer lavochka-backup.timer`.

## Яндекс

Метрика — номер счётчика в `src/site/metrika.ts` (`YM_ID`; 0 — выключена), работает только на `https://lavochka-games.ru`. Просмотры шлёт сам сайт на каждый новый адрес (одностраничник).

**IndexNow** — после каждой выкладки `deploy.sh` запускает `tools/indexnow.mjs /srv/lavochka/data`: сравнивает отпечатки страниц (`dist/pages.json`, пишет пререндер) с прошлыми (`/srv/lavochka/data/pages.json`), шлёт изменившиеся адреса в Яндекс и api.indexnow.org и ставит в `sitemap.xml` дату последнего изменения каждой страницы. Ключ — `public/<ключ>.txt` и константа `KEY` в скрипте. Проверить без отправки: `node tools/indexnow.mjs <папка> --dry`.
