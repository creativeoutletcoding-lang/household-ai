#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# check-bruce.sh
#
# One-shot "is Bruce alive?" glance:
#   - last 10 meaningful n8n log lines (with the DbClock spam filtered out)
#   - last 5 relay log lines
#
# Usage:
#   VPS=root@147.182.142.176 ./scripts/check-bruce.sh
#   ./scripts/check-bruce.sh                 # uses VPS default below
#
# Set up an SSH alias once so you can just run `./scripts/check-bruce.sh`:
#   # in ~/.ssh/config
#   Host bruce
#     HostName 147.182.142.176
#     User root
# then: VPS=bruce ./scripts/check-bruce.sh
# ---------------------------------------------------------------------------

set -euo pipefail

VPS="${VPS:-root@147.182.142.176}"

ssh "$VPS" bash -s <<'REMOTE'
set -euo pipefail

N8N_CONTAINER="household-n8n"
RELAY_CONTAINER="household-discord-relay"

# Patterns to drop from n8n logs. `dbTime.getTime` and friends spam the
# log on certain n8n builds — it's a known internal clock bug that doesn't
# affect workflows but drowns everything else. "DbClock" covers most of it.
SPAM_PATTERNS='DbClock|dbTime\.getTime|TypeError.*dbTime|Waiting for the database|workflow shared with all|tag shared with all|credential shared with all'

printf '========== n8n: last 10 non-spam lines (container=%s) ==========\n' "$N8N_CONTAINER"
if docker ps --format '{{.Names}}' | grep -q "^${N8N_CONTAINER}$"; then
  docker logs --tail 500 "$N8N_CONTAINER" 2>&1 \
    | grep -Ev "$SPAM_PATTERNS" \
    | tail -n 10
else
  echo "[container $N8N_CONTAINER not running]"
fi

echo
printf '========== relay: last 5 lines (container=%s) ==========\n' "$RELAY_CONTAINER"
if docker ps --format '{{.Names}}' | grep -q "^${RELAY_CONTAINER}$"; then
  docker logs --tail 100 "$RELAY_CONTAINER" 2>&1 | tail -n 5
else
  echo "[container $RELAY_CONTAINER not running]"
fi

echo
echo '========== container health =========='
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep -E '^NAMES|^household-' || true
REMOTE
