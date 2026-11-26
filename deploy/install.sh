#!/bin/bash
# Installation idempotente des services RO·AI (à lancer en root).
set -euo pipefail
D=$(cd "$(dirname "$0")" && pwd)
# Adresse du serveur et réseaux autorisés : propres à chaque installation (jamais dans le dépôt).
#   ROAI_ADDRESS=192.168.1.20 ROAI_LAN="192.168.1.0/24" deploy/install.sh
: "${ROAI_ADDRESS:?variable ROAI_ADDRESS requise : adresse IP ou nom du serveur}"
: "${ROAI_LAN:?variable ROAI_LAN requise : réseaux autorisés, ex. 192.168.1.0/24}"
install -d -m 755 /srv/ai/data /srv/ai/workspace /srv/ai/logs 2>/dev/null || true
chown agent:agent /srv/ai/data /srv/ai/workspace /srv/ai/logs
install -m 644 "$D/ro-ai-core.socket" "$D/ro-ai-core.service" "$D/ro-ai-web.service" /etc/systemd/system/
install -d /etc/systemd/system/user-1000.slice.d
install -m 644 "$D/user-1000-slice.conf" /etc/systemd/system/user-1000.slice.d/50-ro-ai.conf
install -d /etc/caddy && sed -e "s|__ROAI_ADDRESS__|$ROAI_ADDRESS|g" -e "s|__ROAI_LAN__|$ROAI_LAN|g" "$D/Caddyfile" > /etc/caddy/Caddyfile && chmod 644 /etc/caddy/Caddyfile
install -d /etc/systemd/system/ro-ai-web.service.d /etc/systemd/system/ro-ai-core.service.d
printf '[Service]\nEnvironment=ROAI_ALLOWED_HOSTS=%s,localhost,127.0.0.1\n' "$ROAI_ADDRESS" > /etc/systemd/system/ro-ai-web.service.d/site.conf
printf '[Service]\nEnvironment=ROAI_PUBLIC_URL=https://%s\n' "$ROAI_ADDRESS" > /etc/systemd/system/ro-ai-core.service.d/site.conf
install -m 755 "$D/roai-login" /usr/local/bin/roai-login
install -m 755 "$D/roai-ctl" /usr/local/bin/roai-ctl
systemctl daemon-reload
systemctl enable --now ro-ai-core.socket
systemctl enable ro-ai-core.service ro-ai-web.service
systemctl restart ro-ai-core.service ro-ai-web.service
systemctl enable caddy >/dev/null 2>&1 || true
systemctl restart caddy
echo "Services installés."
