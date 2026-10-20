#!/bin/sh
# Postfix → сайт: письмо со стандартного ввода уходит в Node (/api/mail/in, server/support.ts) и становится обращением.
# Запускается из /etc/aliases как «|/usr/local/bin/lavochka-mailin <ящик>» от имени nobody.
# Сбой (сайт перезапускается, база недоступна) — код 75: Postfix оставит письмо в очереди и повторит позже.
BOX=$(printf %s "$1" | tr -cd 'a-z0-9-')
[ -n "$BOX" ] || exit 64
SECRET=$(cat /etc/lavochka-mailin.secret 2>/dev/null) || exit 75
curl -sf --max-time 60 -o /dev/null -X POST \
  -H "x-mail-secret: $SECRET" -H 'content-type: message/rfc822' \
  --data-binary @- "http://127.0.0.1:8787/api/mail/in?to=$BOX@lavochka-games.ru" || exit 75
