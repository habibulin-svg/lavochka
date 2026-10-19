# Прод-сервер

FirstVDS VDS-KVM-NVMe-Старт, Ubuntu 24.04, IP `82.146.38.203` (`habibulin.fvds.ru`). Вход — только по SSH-ключу (`ssh lavochka`, адрес в `~/.ssh/config`), пароль отключён, fail2ban, ufw: 22/80/443.

- Код — `/srv/lavochka/app` (клон репозитория, владелец — системный пользователь `lavochka`), рекорды — `/srv/lavochka/data`.
- Служба `lavochka` (`lavochka.service`): `node dist-server/index.js` на `127.0.0.1:8787`, переменные — `/etc/lavochka.env` (`PORT`, `DATA_DIR`, TURN). Логи: `journalctl -u lavochka`.
- nginx (`nginx-lavochka.conf` → `/etc/nginx/sites-available/lavochka`): HTTPS, `/assets/` с диска с годовым кэшем, остальное и `/ws` — к Node. Основной адрес `https://lavochka-games.ru`; `www`, `lavochkagames.ru`, `lavochka-games.online` и http — 301 на него.
- Сертификат Let's Encrypt `lavochka` на все шесть имён, продлевает `certbot.timer`, после продления — `reload nginx`.

Выкладка (после пуша в `main`, прошедшего `npm run check`):

```
ssh lavochka sh /srv/lavochka/app/lavochka/deploy/deploy.sh
```
