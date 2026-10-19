#!/bin/sh
# /etc/letsencrypt/renewal-hooks/deploy/coturn.sh — копия сертификата для coturn (ему не прочитать /etc/letsencrypt/live)
set -e
install -m 640 -o root -g turnserver /etc/letsencrypt/live/lavochka/fullchain.pem /etc/coturn/fullchain.pem
install -m 640 -o root -g turnserver /etc/letsencrypt/live/lavochka/privkey.pem /etc/coturn/privkey.pem
systemctl restart coturn || true
