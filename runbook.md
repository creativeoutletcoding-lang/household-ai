# Household AI — Runbook

Operational manual for the running stack. All commands assume you are SSH'd into the droplet as the `household` user, in the repo directory.

```bash
cd ~/household-ai
```

## Check service status

```bash
# All four containers should be "Up" and (where applicable) "healthy"
docker compose ps

# Caddy lives on the host, not in compose
sudo systemctl status caddy --no-pager

# Firewall
sudo ufw status verbose
```

Quick health probes:

```bash
curl -I https://chat.creativeoutletcoding.com     # expect 200 / 302
curl -I https://n8n.creativeoutletcoding.com      # expect 401 (basic auth)
```

## View logs

```bash
# Live tail, all services
docker compose logs -f --tail=200

# One service at a time
docker compose logs -f n8n
docker compose logs -f open-webui
docker compose logs -f postgres

# Caddy (access + error)
sudo journalctl -u caddy -f
```

Claude API errors usually show up in `n8n` (for Telegram/agent flows) or `open-webui` (for direct chat). Grep `401` or `rate_limit` first.

## Restart services

```bash
# Single service
docker compose restart n8n

# Full stack (no data loss)
docker compose restart

# Full rebuild after a compose/env change
docker compose up -d

# Stop everything (data volumes preserved)
docker compose down

# Reload Caddy after Caddyfile edits
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## Add a new user

**Web chat (Open WebUI):**

1. Edit `.env`, set `OPENWEBUI_ENABLE_SIGNUP=true`.
2. `docker compose up -d open-webui` to apply.
3. Have the new family member sign up at https://chat.creativeoutletcoding.com. Their account will be created with `pending` role.
4. Log in as admin, go to Admin Panel → Users, promote them to `user`.
5. Edit `.env` back to `OPENWEBUI_ENABLE_SIGNUP=false` and `docker compose up -d open-webui` again.

**Telegram:**

1. New user messages `@userinfobot` on Telegram to find their numeric user ID.
2. Edit `.env`, add the ID to the comma-separated `TELEGRAM_ALLOWED_USER_IDS`.
3. `docker compose up -d n8n` to reload the env var.

The n8n workflow checks `TELEGRAM_ALLOWED_USER_IDS` on every incoming message and silently drops anything from an unknown sender.

## Backup

Backups cover two things: the Postgres databases (conversation history, n8n workflows, Open WebUI state) and the Docker named volumes (uploaded files, n8n encryption key, etc.).

```bash
# Create backups directory if you haven't
mkdir -p ~/backups

# Dump all databases (the household user owns all three)
docker compose exec -T postgres \
  pg_dumpall -U household --clean --if-exists \
  | gzip > ~/backups/pg-$(date +%F).sql.gz

# Snapshot the n8n and open-webui volumes
docker run --rm \
  -v household-ai_n8n_data:/src:ro \
  -v ~/backups:/dst \
  alpine tar czf /dst/n8n-$(date +%F).tgz -C /src .

docker run --rm \
  -v household-ai_openwebui_data:/src:ro \
  -v ~/backups:/dst \
  alpine tar czf /dst/openwebui-$(date +%F).tgz -C /src .
```

Keep a copy off the droplet. Simple sync to Backblaze B2 / S3 / your laptop:

```bash
# rsync nightly copy to your laptop (set up ssh key first)
rsync -av ~/backups/ laptop-user@your-home-ip:~/household-ai-backups/
```

**Automated nightly backups.** Drop a systemd timer or this one-liner cron entry as `household`:

```cron
15 3 * * *  cd ~/household-ai && ./scripts/backup.sh >> ~/backups/backup.log 2>&1
```

(`scripts/backup.sh` is yours to write — it should do the three commands above plus `find ~/backups -mtime +14 -delete` to rotate.)

## Restore

From a clean droplet (or a catastrophic failure on the existing one):

```bash
# 1. Stop the stack
docker compose down

# 2. Restore Postgres
docker compose up -d postgres
sleep 5
gunzip -c ~/backups/pg-YYYY-MM-DD.sql.gz \
  | docker compose exec -T postgres psql -U household -d postgres

# 3. Restore named volumes
docker volume create household-ai_n8n_data
docker run --rm \
  -v household-ai_n8n_data:/dst \
  -v ~/backups:/src:ro \
  alpine sh -c "cd /dst && tar xzf /src/n8n-YYYY-MM-DD.tgz"

docker volume create household-ai_openwebui_data
docker run --rm \
  -v household-ai_openwebui_data:/dst \
  -v ~/backups:/src:ro \
  alpine sh -c "cd /dst && tar xzf /src/openwebui-YYYY-MM-DD.tgz"

# 4. Bring the stack back up
docker compose up -d
```

> The `N8N_ENCRYPTION_KEY` in `.env` **must** match the one used when the n8n_data volume was created. If it doesn't, stored credentials (Telegram token, Claude key) in saved workflows will be unreadable and you'll need to re-enter them.

## Update images

Watchtower is configured to pull and restart images nightly at 03:00 local time (`WATCHTOWER_SCHEDULE` in `docker-compose.yml`). To update manually:

```bash
docker compose pull
docker compose up -d
docker image prune -f
```

## Rotate secrets

- **Claude API key:** edit `ANTHROPIC_API_KEY` in `.env`, then `docker compose up -d n8n open-webui`. No data loss.
- **Telegram bot token:** revoke via `@BotFather`, create a new one, update `.env`, `docker compose up -d n8n`.
- **Postgres password:** requires coordinated change — use `ALTER USER household WITH PASSWORD '...'` inside psql and update `.env` in the same window, then `docker compose up -d`. Take a backup first.
- **N8N_ENCRYPTION_KEY:** *do not rotate casually.* Requires re-entering every saved credential inside n8n.

## Troubleshooting

### "Certificate not yet available" / browser shows self-signed

Caddy provisions Let's Encrypt certs lazily on first request. If the first request 404s or fails, check:

```bash
sudo journalctl -u caddy -n 200 --no-pager
```

Common culprits: DNS not yet propagated, port 80 blocked somewhere upstream, or you're hitting the Let's Encrypt rate limit (5 duplicate certs per week — use the staging line in the Caddyfile header while debugging).

### n8n shows 502 Bad Gateway through Caddy

```bash
# Is the container up?
docker compose ps n8n
# Is it listening on localhost:5678?
ss -tlnp | grep 5678
# What is it saying?
docker compose logs --tail=200 n8n
```

Most often: missed the `docker-compose.override.yml` step in `install.sh`, so n8n never bound its port to localhost. Re-run the installer, or create the override file manually.

### Open WebUI "Login failed" or DB errors

Usually a mismatch between `DATABASE_URL` and what's actually in Postgres. From the repo dir:

```bash
docker compose exec postgres psql -U household -d openwebui -c '\dt'
```

If the `openwebui` database doesn't exist, the init script didn't run because you're on an existing volume. Create it by hand:

```bash
docker compose exec postgres psql -U household -d postgres \
  -c "CREATE DATABASE openwebui;"
docker compose restart open-webui
```

### Claude calls failing

```bash
docker compose exec n8n sh -lc 'echo "$ANTHROPIC_API_KEY" | head -c 12; echo'
```

Should print `sk-ant-api03` (or similar). If not, the env didn't propagate — check `.env`, then `docker compose up -d n8n`. If the key is right but requests 401, the key was revoked or the org's billing lapsed.

### Memory pressure on the 2 GB droplet

`docker stats --no-stream` — if anything is pinned at its memory limit, the kernel is likely OOM-killing it. Quick relief:

- Drop Watchtower (low-value, ~64 MB saved).
- Ensure `ENABLE_OLLAMA_API=false` and `RAG_EMBEDDING_ENGINE=""` are set on Open WebUI — both start background workers that eat RAM.
- Bump the droplet to 4 GB. Still $24/mo-ish and removes the whole class of problem. On the Mac Mini this will not matter.

### Full disk

Docker images and Postgres WAL are the usual suspects.

```bash
docker system df           # what's using space
docker image prune -af     # remove unused images
docker builder prune -af   # remove buildkit cache
# Compact Postgres (after a big delete):
docker compose exec postgres vacuumdb -U household --all --full
```

## Useful one-liners

```bash
# Tail all logs, keep only Anthropic-related lines
docker compose logs -f | grep -iE 'anthropic|claude|429|401'

# Exec into a container
docker compose exec n8n sh
docker compose exec postgres psql -U household

# Rebuild just the Caddyfile from a Caddyfile.tmpl (if you templatize it later)
envsubst < Caddyfile.tmpl | sudo tee /etc/caddy/Caddyfile
sudo systemctl reload caddy
```
