#!/bin/sh
# Почта домена на прод-сервере: Postfix только ПРИНИМАЕТ письма для lavochka-games.ru и передаёт их сайту
# (lavochka-mailin → /api/mail/in → обращения). Отправлять с сервера нечего: письма сайта уходят через Unisender Go,
# поэтому исходящая доставка выключена (default_transport = error). Повторный запуск безопасен.
#   ssh lavochka sh /srv/lavochka/app/lavochka/deploy/mail/setup.sh
set -e
HERE=$(cd "$(dirname "$0")" && pwd)
DOMAIN=lavochka-games.ru
CERT=/etc/letsencrypt/live/lavochka

if ! command -v postfix >/dev/null; then
  echo "postfix postfix/main_mailer_type select Internet Site" | debconf-set-selections
  echo "postfix postfix/mailname string $DOMAIN" | debconf-set-selections
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q postfix
fi
echo "$DOMAIN" > /etc/mailname

postconf -e \
  "myhostname = $DOMAIN" \
  "mydomain = $DOMAIN" \
  'myorigin = $mydomain' \
  "mydestination = $DOMAIN, localhost" \
  'inet_interfaces = all' \
  'inet_protocols = ipv4' \
  'mynetworks = 127.0.0.0/8' \
  'alias_maps = hash:/etc/aliases' \
  'alias_database = hash:/etc/aliases' \
  'local_recipient_maps = $alias_maps' \
  'relayhost =' \
  'default_transport = error:outbound mail is disabled on this host' \
  'relay_transport = error:outbound mail is disabled on this host' \
  'message_size_limit = 15728640' \
  'mailbox_size_limit = 0' \
  'smtpd_banner = $myhostname ESMTP' \
  'disable_vrfy_command = yes' \
  'smtpd_helo_required = yes' \
  'smtpd_relay_restrictions = permit_mynetworks, reject_unauth_destination' \
  'smtpd_recipient_restrictions = permit_mynetworks, reject_unauth_destination, reject_non_fqdn_sender, reject_unknown_sender_domain, reject_unlisted_recipient' \
  'smtpd_client_connection_rate_limit = 30' \
  'smtpd_client_message_rate_limit = 30' \
  'anvil_rate_time_unit = 60s' \
  "smtpd_tls_cert_file = $CERT/fullchain.pem" \
  "smtpd_tls_key_file = $CERT/privkey.pem" \
  'smtpd_tls_security_level = may' \
  'smtpd_tls_protocols = !SSLv2, !SSLv3, !TLSv1, !TLSv1.1' \
  'smtp_tls_security_level = may' \
  'default_privs = nobody' \
  'allow_mail_to_commands = alias' \
  'biff = no'

install -m 0755 "$HERE/lavochka-mailin.sh" /usr/local/bin/lavochka-mailin
install -m 0644 "$HERE/aliases" /etc/aliases
newaliases

# общий секрет почтового сервера и сайта: файл читает nobody (скрипт), сайт — из /etc/lavochka.env
if [ ! -s /etc/lavochka-mailin.secret ]; then
  head -c 32 /dev/urandom | base64 | tr -d '/+=\n' > /etc/lavochka-mailin.secret
fi
chown root:nogroup /etc/lavochka-mailin.secret
chmod 0640 /etc/lavochka-mailin.secret
SECRET=$(cat /etc/lavochka-mailin.secret)
if grep -q '^MAIL_IN_SECRET=' /etc/lavochka.env; then
  sed -i "s|^MAIL_IN_SECRET=.*|MAIL_IN_SECRET=$SECRET|" /etc/lavochka.env
else
  echo "MAIL_IN_SECRET=$SECRET" >> /etc/lavochka.env
fi

# сертификат продлился — перечитать
install -m 0755 "$HERE/certbot-postfix.sh" /etc/letsencrypt/renewal-hooks/deploy/postfix.sh
# подбор и спам-роботы: fail2ban
install -m 0644 "$HERE/fail2ban-postfix.conf" /etc/fail2ban/jail.d/postfix.conf
systemctl reload fail2ban || systemctl restart fail2ban

ufw allow 25/tcp >/dev/null
systemctl enable --now postfix
systemctl reload postfix
# сайт подхватит MAIL_IN_SECRET при следующей выкладке (или: systemctl restart lavochka)
echo 'почта: готово (порт 25 открыт, ящики — /etc/aliases)'
