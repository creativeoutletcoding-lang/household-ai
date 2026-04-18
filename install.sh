#!/usr/bin/env bash
# Household AI — one-shot installer for a fresh Ubuntu 24.04 droplet.
#
# What it does:
#   1. Updates the system and installs base tools
#   2. Installs Docker Engine + the compose plugin
#   3. Configures UFW to allow only 22, 80, 443
#   4. Installs Caddy (from the official Cloudsmith repo) as a host service
#   5. Writes /etc/caddy/Caddyfile for the three household subdomains
#   6. Starts the docker compose stack
#   7. Reloads Caddy so certs provision on first request
#
# Run as the non-root `household` user with sudo privileges:
#   sudo ./install.sh
#
# Idempotent — safe to re-run.

set -euo pipefail

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
log() { printf '\n\033[1;34m==>\033[0m %s\n' "$*"; }
err() { printf '\n\033[1;31m!!\033[0m %s\n' "$*" >&2; exit 1; }

need_root() {
  if [[ ${EUID} -ne 0 ]]; then
    err "Run this script with sudo (or as root). Try: sudo ./install.sh"
  fi
}

need_file() {
  [[ -f "$1" ]] || err "Missing $1 — copy .env.example to .env and fill it in first."
}

# -----------------------------------------------------------------------------
# Preflight
# -----------------------------------------------------------------------------
need_root

# The user that owns the checkout — we preserve their ownership on new files.
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_USER="$(stat -c '%U' "${REPO_DIR}")"
REPO_GROUP="$(stat -c '%G' "${REPO_DIR}")"

log "Installing from ${REPO_DIR} (owned by ${REPO_USER}:${REPO_GROUP})"

need_file "${REPO_DIR}/.env"
need_file "${REPO_DIR}/docker-compose.yml"

# Source the env so we know the domain for Caddy.
# shellcheck disable=SC1091
set -a; source "${REPO_DIR}/.env"; set +a
[[ -n "${DOMAIN:-}" ]]      || err "DOMAIN is not set in .env"
[[ -n "${ACME_EMAIL:-}" ]]  || err "ACME_EMAIL is not set in .env"

# -----------------------------------------------------------------------------
# 1. System packages
# -----------------------------------------------------------------------------
log "Updating apt and installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y
apt-get install -y \
  ca-certificates curl gnupg lsb-release ufw \
  debian-keyring debian-archive-keyring apt-transport-https \
  unattended-upgrades

# Enable unattended security upgrades (no kernel auto-reboots).
dpkg-reconfigure -f noninteractive unattended-upgrades || true

# -----------------------------------------------------------------------------
# 2. Docker Engine + compose plugin
# -----------------------------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  log "Installing Docker Engine"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${VERSION_CODENAME}") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin
  usermod -aG docker "${REPO_USER}"
  systemctl enable --now docker
else
  log "Docker already installed — skipping"
fi

# -----------------------------------------------------------------------------
# 3. UFW firewall
# -----------------------------------------------------------------------------
log "Configuring UFW (allow 22, 80, 443 only)"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
ufw status verbose

# -----------------------------------------------------------------------------
# 4. Caddy (host-installed, not containerized — simpler cert flow)
# -----------------------------------------------------------------------------
if ! command -v caddy >/dev/null 2>&1; then
  log "Installing Caddy"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
else
  log "Caddy already installed — skipping"
fi

# -----------------------------------------------------------------------------
# 5. Caddyfile
# -----------------------------------------------------------------------------
log "Writing /etc/caddy/Caddyfile for ${DOMAIN}"
cat > /etc/caddy/Caddyfile <<EOF
{
    email ${ACME_EMAIL}
    # Uncomment the next line to test against Let's Encrypt staging:
    # acme_ca https://acme-staging-v02.api.letsencrypt.org/directory
}

# Root domain — land the family here, redirect to chat.
${DOMAIN} {
    redir https://chat.${DOMAIN}{uri} permanent
    encode gzip
}

# Open WebUI (family chat).
chat.${DOMAIN} {
    encode gzip
    reverse_proxy localhost:8080 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}

# n8n editor + webhooks.
n8n.${DOMAIN} {
    encode gzip
    reverse_proxy localhost:5678 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-Proto {scheme}
        # n8n sends large payloads on executions view:
        flush_interval -1
    }
}
EOF

caddy validate --config /etc/caddy/Caddyfile
systemctl enable --now caddy

# -----------------------------------------------------------------------------
# 6. Wire the stack: bind the two upstreams to localhost so Caddy can reach them
#    without exposing them to the internet. We do this with a small override
#    file so the base docker-compose.yml stays portable (Mac Mini will not
#    need it).
# -----------------------------------------------------------------------------
log "Writing docker-compose.override.yml (localhost-only port binds for Caddy)"
cat > "${REPO_DIR}/docker-compose.override.yml" <<'YAML'
# Auto-generated by install.sh. Do not edit by hand — re-run the installer.
# Binds Open WebUI and n8n to 127.0.0.1 so Caddy (on the host) can reach them
# but the public internet cannot. Postgres stays fully internal.
services:
  open-webui:
    ports:
      - "127.0.0.1:8080:8080"
  n8n:
    ports:
      - "127.0.0.1:5678:5678"
YAML
chown "${REPO_USER}:${REPO_GROUP}" "${REPO_DIR}/docker-compose.override.yml"

# -----------------------------------------------------------------------------
# 7. Bring up the stack
# -----------------------------------------------------------------------------
log "Pulling images and starting the stack"
cd "${REPO_DIR}"
sudo -u "${REPO_USER}" docker compose pull
sudo -u "${REPO_USER}" docker compose up -d

log "Waiting for services to become healthy"
sleep 10
sudo -u "${REPO_USER}" docker compose ps

# -----------------------------------------------------------------------------
# 8. Reload Caddy — cert fetch happens on first real request.
# -----------------------------------------------------------------------------
systemctl reload caddy

# -----------------------------------------------------------------------------
# Done
# -----------------------------------------------------------------------------
cat <<EOF

========================================================================
 Household AI is up.

 Chat UI:      https://chat.${DOMAIN}
 n8n editor:   https://n8n.${DOMAIN}   (basic auth: N8N_BASIC_AUTH_USER)
 Root domain:  https://${DOMAIN}       (redirects to chat)

 Next:
   1. Open the chat URL. The FIRST account you create becomes admin.
   2. Log into n8n, import workflows from ./workflows/ (if present),
      or build your Telegram bot flow from scratch.
   3. See runbook.md for day-to-day operations.

 A reboot is recommended to pick up the new docker group membership.
========================================================================
EOF
