# Migration Playbook — DigitalOcean → Mac Mini M5 Pro

When the Mac Mini arrives, the goal is to move the entire stack off the droplet with zero data loss and at most a short (~15 minute) window where chat/Telegram are unavailable. The droplet stays up as a hot fallback for a week, then gets destroyed.

## Why this migration is easy

Everything already runs in Docker, with Postgres as the single source of truth. There is nothing DigitalOcean-specific in the stack; the only provider-coupled pieces are the firewall (UFW → macOS PF + router) and the public DNS (A records → dynamic DNS). The Anthropic API is reachable from anywhere.

## Target topology

```
          Home router (port-forward 80/443 → Mac Mini)
                          │
                          ▼
                 ┌─────────────────┐
                 │   Mac Mini M5   │
                 │   Pro (macOS)   │
                 │                 │
                 │  Docker Desktop │
                 │  Caddy (brew)   │
                 │  n8n/WebUI/PG   │
                 └─────────────────┘

 Public DNS:
   creativeoutletcoding.com        → home public IP (via DDNS)
   chat.creativeoutletcoding.com   → home public IP
   n8n.creativeoutletcoding.com    → home public IP
```

If you'd rather not expose your home IP, put a Cloudflare Tunnel or Tailscale Funnel in front of Caddy. Both are documented at the end.

## Prerequisites (do before the cut-over)

On the Mac Mini:

1. **macOS up to date**, FileVault on, remote login (SSH) enabled.
2. **Homebrew** installed.
3. **Docker Desktop** installed and running, with resource allocation set generously (8+ CPU, 12+ GB RAM — the M5 Pro can spare it).
4. **Caddy** installed via `brew install caddy`.
5. **Git** installed, repo cloned to `~/household-ai`.
6. **Dynamic DNS** configured if your ISP doesn't give you a static IP. Cloudflare DNS + a `cloudflare-ddns` cron job is the least-friction option. Verify that `dig chat.creativeoutletcoding.com` resolves to your home public IP before the cut-over.
7. **Router port-forward** for TCP 80 + 443 to the Mac Mini's LAN IP. Give the Mac Mini a static DHCP reservation so its IP doesn't drift.
8. **macOS power settings**: Energy Saver → "Prevent automatic sleeping when display is off" ON, "Start up automatically after a power failure" ON.

## Pre-flight checklist

- [ ] DNS TTLs on the three A records lowered to 300 seconds at least 24h before migration.
- [ ] Latest droplet backup in hand and copied to the Mac Mini (`pg-*.sql.gz`, `n8n-*.tgz`, `openwebui-*.tgz`).
- [ ] `.env` copied from the droplet to the Mac Mini and reviewed — especially `N8N_ENCRYPTION_KEY`, which MUST match or credentials become unreadable.
- [ ] Family told: "chat may be down for ~15 minutes at <time>."

## Cut-over procedure

### 1. Freeze the droplet (on the droplet)

```bash
cd ~/household-ai

# Prevent new writes while we copy the final snapshot
docker compose stop n8n open-webui

# Take a final backup
./scripts/backup.sh      # or the commands from runbook.md § Backup

# Copy to the Mac Mini
scp ~/backups/pg-$(date +%F).sql.gz \
    ~/backups/n8n-$(date +%F).tgz \
    ~/backups/openwebui-$(date +%F).tgz \
    mac-mini.local:~/household-ai-migration/
```

### 2. Restore on the Mac Mini

```bash
ssh mac-mini.local
cd ~/household-ai
# .env should already be in place with identical secrets to the droplet

# Bring up Postgres only, restore dump
docker compose up -d postgres
sleep 5
gunzip -c ~/household-ai-migration/pg-*.sql.gz \
  | docker compose exec -T postgres psql -U household -d postgres

# Restore volumes
docker volume create household-ai_n8n_data
docker run --rm \
  -v household-ai_n8n_data:/dst \
  -v ~/household-ai-migration:/src:ro \
  alpine sh -c "cd /dst && tar xzf /src/n8n-*.tgz"

docker volume create household-ai_openwebui_data
docker run --rm \
  -v household-ai_openwebui_data:/dst \
  -v ~/household-ai-migration:/src:ro \
  alpine sh -c "cd /dst && tar xzf /src/openwebui-*.tgz"

# Bring the rest up
docker compose up -d
```

### 3. Stand up Caddy on macOS

macOS Caddy reads `/opt/homebrew/etc/Caddyfile` (on Apple Silicon). Copy the Caddyfile from the droplet verbatim — the domains are the same:

```bash
sudo cp ~/household-ai/Caddyfile /opt/homebrew/etc/Caddyfile
caddy validate --config /opt/homebrew/etc/Caddyfile
sudo brew services start caddy
```

Confirm locally (before DNS flips) with:

```bash
curl --resolve chat.creativeoutletcoding.com:443:127.0.0.1 \
     https://chat.creativeoutletcoding.com -I
```

Should return 200 or 302.

### 4. Flip DNS

Point the three A records at your home public IP:

| Record                             | Value             |
|------------------------------------|-------------------|
| `creativeoutletcoding.com`         | `<home-public-ip>` |
| `chat.creativeoutletcoding.com`    | `<home-public-ip>` |
| `n8n.creativeoutletcoding.com`     | `<home-public-ip>` |

Because TTLs are 300s, the world catches up inside ~5 minutes.

### 5. Verify

From your laptop (not the Mac Mini):

```bash
curl -I https://chat.creativeoutletcoding.com
curl -I https://n8n.creativeoutletcoding.com
```

Both should return 200 / 401 respectively, served by Caddy on the Mac Mini. Check the Caddy access log to be sure you're not accidentally still hitting the droplet:

```bash
tail -f /opt/homebrew/var/log/caddy/access.log
```

Send yourself a Telegram message to the bot — it should still answer, since n8n holds the same Telegram webhook token.

### 6. Hot fallback window (recommended: 1 week)

Leave the droplet up but with `docker compose stop n8n open-webui` — Postgres stays running, read-only, so you still have a replayable backup. If anything goes sideways on the Mac Mini (power cut, ISP outage), flip DNS back.

After one week of clean operation, `doctl droplet delete ...` and cancel.

## Things that change on the Mac Mini

### Firewall

You don't need UFW. Instead:

- macOS application firewall → on (System Settings → Network → Firewall).
- Keep the router firewall tight. Port-forward ONLY 80 and 443 to the Mac Mini. Nothing else.
- If you enable SSH to the Mac Mini from the internet, front it with Tailscale rather than opening port 22.

### Docker resource limits

The `deploy.resources.limits.memory` entries in `docker-compose.yml` were sized for a 2 GB droplet. On the Mac Mini they're harmless but pointlessly tight. Either delete them or bump each by 2–3× — the services will happily use more RAM for caches.

### Watchtower

Still useful. Keep it.

### Backups

Move the backup target off the Mac Mini — the whole point is not to have your backups on the same physical box as the live system. Options:

- An external USB SSD plugged into the Mac Mini, with a nightly `rsync`.
- Backblaze B2 via `rclone`.
- Time Machine, if you want the whole box backed up (note: Docker volumes live inside Docker Desktop's VM disk image, which Time Machine will happily back up but restoration is coarse-grained).

### Power / network resilience

A home setup loses to a cloud setup on uptime. Mitigations:

- **UPS** on the Mac Mini + router. Even a small CyberPower 600VA covers most blips.
- **Starlink / LTE failover** on the router if your ISP is flaky.
- Accept that this is a household service, not a 99.9% public API. A few minutes of downtime per month is fine.

## Optional — hide the home IP

If you'd rather not publish your home IP in DNS:

### Cloudflare Tunnel (free, simplest)

```bash
brew install cloudflared
cloudflared tunnel login
cloudflared tunnel create household
cloudflared tunnel route dns household chat.creativeoutletcoding.com
cloudflared tunnel route dns household n8n.creativeoutletcoding.com
cloudflared tunnel route dns household creativeoutletcoding.com
```

Then `~/.cloudflared/config.yml`:

```yaml
tunnel: <tunnel-id>
credentials-file: /Users/you/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: chat.creativeoutletcoding.com
    service: http://localhost:8080
  - hostname: n8n.creativeoutletcoding.com
    service: http://localhost:5678
  - hostname: creativeoutletcoding.com
    service: http://localhost:80
  - service: http_status:404
```

Start with `brew services start cloudflared`. Kill the router port-forward and remove Caddy — Cloudflare terminates TLS for you. The stack stays the same otherwise.

### Tailscale Funnel

Same idea, simpler if the household is already on a tailnet. Less control than Cloudflare, and https://yourname.ts.net/ URLs are ugly, but it works.

## Rollback

If the Mac Mini cut-over fails and the droplet is still alive:

```bash
# On droplet
cd ~/household-ai
docker compose up -d        # restart what we stopped in step 1
```

Flip the three A records back to the droplet IP. Wait for DNS. You're back where you started. No data was lost because the Mac Mini Postgres was only ever loaded with the snapshot — the droplet Postgres never left the droplet.

## Post-migration cleanup (after 1 week clean)

- Destroy the droplet.
- Remove the DigitalOcean API token (if you had one) from any scripts.
- Update `docker-compose.override.yml` — on the Mac Mini, you probably want `0.0.0.0` binds only if you are NOT using Caddy/Cloudflare (which you should be). Leave it alone otherwise.
- Update DNS TTLs back to something sensible (3600s).
- Put a note in `runbook.md` that the stack is now local, and any references to DigitalOcean-specific commands can be removed.
