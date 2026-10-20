#!/bin/sh
# Хук certbot (renewal-hooks/deploy): Postfix перечитывает продлённый сертификат.
systemctl reload postfix
