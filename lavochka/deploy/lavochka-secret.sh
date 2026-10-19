#!/bin/sh
# Записать секрет в файл переменных, не показывая его в чате и в истории.
# Ставится в /usr/local/bin/lavochka-secret. Запуск с компьютера:
#   ssh -t lavochka lavochka-secret ИМЯ [ФАЙЛ]
# ФАЙЛ по умолчанию — /etc/lavochka.env (после записи служба перезапускается).
set -eu
name="${1:?имя переменной, например YANDEX_CLIENT_SECRET}"
file="${2:-/etc/lavochka.env}"
case "$name" in *[!A-Z0-9_]*) echo "имя — только A-Z, 0-9, _" >&2; exit 1;; esac
printf '%s: ' "$name"
stty -echo 2>/dev/null || true
IFS= read -r value
stty echo 2>/dev/null || true
echo
[ -n "$value" ] || { echo "пусто — ничего не записано" >&2; exit 1; }
touch "$file"; chmod 600 "$file"
tmp="$(mktemp)"
grep -v "^$name=" "$file" > "$tmp" || true
printf '%s=%s\n' "$name" "$value" >> "$tmp"
cat "$tmp" > "$file"; rm -f "$tmp"
echo "записано в $file"
if [ "$file" = /etc/lavochka.env ]; then systemctl restart lavochka && echo "служба lavochka перезапущена"; fi
