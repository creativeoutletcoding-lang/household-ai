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

**Discord:**

1. The person joins the server via the invite link.
2. Right-click their name → Copy User ID. Paste into `.env` as `DISCORD_<NAME>_USER_ID` (e.g. `DISCORD_LOUBI_USER_ID=...`).
3. In Discord: right-click the categories they should access (their own placeholder category, plus any shared like `LAKE` / `CPS` if relevant) → Edit Category → Permissions → Add Member → grant **View Channel**, **Send Messages**, **Read Message History**.
4. `docker compose up -d n8n` to pick up the env var change.

No need to re-run the channel provisioner for this — it only creates channels/categories that are missing, and deliberately won't touch permissions on existing ones.

## Discord operations

### Add a new Discord channel

Four small steps:

```bash
# 1. Edit the provisioner's STRUCTURE or add the channel manually in Discord.
$EDITOR scripts/setup-discord-channels.js
(cd scripts && node setup-discord-channels.js)

# 2. Write a persona.
$EDITOR prompts/channel-personas/<slug>.md

# 3. Route the channel.
$EDITOR config/channel-routing.json
# Add:   "<slug>": { "behavior": "always" | "mention-only" | "read-only", "persona": "<slug>.md" }
```

Then in n8n: open the **Discord — Bruce** workflow, edit the **Channel Router** Code node, add matching entries in `ROUTING` and `PERSONAS`, save. Activate if not active.

Until the Code node is updated, the new channel defaults to `read-only` and Bruce stays silent in it.

### Modify a persona

```bash
$EDITOR prompts/channel-personas/<slug>.md
```

Then in n8n, open the Discord — Bruce workflow → **Channel Router** node → paste the updated content into the `PERSONAS` entry for that slug → save. No restart needed.

### Clean up orphaned Discord conversation history

```bash
# Drop all conversation history for a removed channel
docker compose exec postgres psql -U household -d n8n \
  -c "DELETE FROM discord_conversations WHERE channel_name = '<slug>';"

# Drop everything older than 180 days
docker compose exec postgres psql -U household -d n8n \
  -c "DELETE FROM discord_conversations WHERE created_at < now() - interval '180 days';"

# Reset history for one user in one channel (e.g. to let them "start fresh")
docker compose exec postgres psql -U household -d n8n \
  -c "DELETE FROM discord_conversations WHERE discord_user_id = '<user_id>' AND channel_name = '<slug>';"

# How much history do we have?
docker compose exec postgres psql -U household -d n8n \
  -c "SELECT channel_name, COUNT(*) FROM discord_conversations GROUP BY 1 ORDER BY 2 DESC;"
```

### Re-run the channel provisioner safely

The provisioner is idempotent — categories and channels that already exist are left alone. It's safe to re-run any time you edit `STRUCTURE` in `scripts/setup-discord-channels.js`. It will NOT modify permissions on existing categories; manual tweaks in Discord are preserved.

### Discord relay

The Gateway connection lives in the dedicated `discord-relay` container (a ~100-line Node.js service), not inside n8n. See `docs/discord-relay.md` for the full reference; common ops:

```bash
# Is it running?
docker compose ps discord-relay

# Healthy start-up looks like:
#   ... [relay] logged in as Bruce#1234 (998877...)
#   ... [relay] forwarding messages from guild <id> -> http://n8n:5678/webhook/discord-bruce
docker compose logs -f discord-relay

# Restart after token rotation or if the logs show repeated login failures
docker compose restart discord-relay

# Rebuild after editing discord-relay/index.js
docker compose build discord-relay
docker compose up -d discord-relay
```

If messages aren't reaching n8n, walk the checklist in `docs/discord-relay.md` → "Debugging — messages aren't flowing". The two usual culprits are (1) the n8n workflow being inactive, so the webhook 404s, or (2) **Message Content Intent** being off in the Discord Developer Portal — without it, the relay receives events with empty `content` and the router has nothing to route.

### In-Discord commands

These are typed directly in any Discord channel where Bruce is listening. They run through the Channel Router in the Bruce workflow; no n8n access needed.

- `/use <model>` — switch the Claude model Bruce uses for *you in this channel*. Shortcuts: `haiku`, `sonnet`, `opus` (= `claude-opus-4-7`), `opus6` (= `claude-opus-4-6`). Or pass a full model string.
- `/use default` — clear your override and go back to the channel's default model.
- `/remember <text>` — store a long-term memory for yourself in this channel (or thread). Bruce injects these into the system prompt on every reply there.
- `/forget <id>` — delete one memory. Run `/memories` first to see IDs.
- `/memories` — list all of your saved memories.
- `/image <prompt>` — render an image with Replicate's Flux Schnell (fast).
- `/image --hd <prompt>` — render with Flux Pro (slower, higher quality).
- `/search <query>` — web search via Perplexity; returns an answer plus citations.

Per-user model preferences live in `user_model_preferences`; long-term memories live in `user_memories`. Both tables are in the `n8n` database and are safe to inspect/edit by hand:

```bash
docker compose exec postgres psql -U household -d n8n \
  -c "SELECT * FROM user_model_preferences ORDER BY updated_at DESC LIMIT 20;"

docker compose exec postgres psql -U household -d n8n \
  -c "SELECT id, discord_user_id, scope, channel_name, content FROM user_memories ORDER BY created_at DESC LIMIT 20;"
```

### Threads

Bruce responds inside Discord threads using the *parent channel's* persona and routing (a thread inside `#jake-personal` uses the `jake-personal` persona). Conversation history and `/remember` memories are scoped to the thread — so side-conversations don't pollute the main channel's memory and vice versa.

The `discord-relay` container auto-joins every thread it sees. If Bruce doesn't respond inside a thread you created before the relay was upgraded, add him manually once (right-click the thread → Invite Members → pick Bruce) and he'll stay from then on.

### Bruce is replying in the wrong tone / with wrong context

Open the workflow → Channel Router node → compare the `PERSONAS` entry for that channel with `prompts/channel-personas/<slug>.md`. If they've drifted, paste the file content into the Code node and save.

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
