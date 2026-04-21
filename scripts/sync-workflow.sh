#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# sync-workflow.sh
#
# Local → VPS deploy flow for workflows/discord-bruce.json:
#   1. scp workflow JSON to the VPS
#   2. on the VPS: lookup workflow id via n8n API, deactivate, PUT, activate
#   3. fetch back the live workflow and verify every Postgres + Discord
#      node has the correct credential id (EHBRO07aceirmFzt / om7VabWMiA8gC2i3)
#
# Usage:
#   VPS=root@147.182.142.176 ./scripts/sync-workflow.sh
#
# Required on the VPS (in ~/household-ai/.env):
#   N8N_API_KEY                — preferred; create in n8n UI → Settings → n8n API
#   N8N_BASIC_AUTH_USER/PASS   — fallback, unlikely to work against /api/v1
#
# Requires `jq` on the VPS. Install with: apt-get install -y jq
# ---------------------------------------------------------------------------

set -euo pipefail

VPS="${VPS:-root@147.182.142.176}"
REMOTE_DIR="${REMOTE_DIR:-/root/household-ai}"
LOCAL_WF="${LOCAL_WF:-workflows/discord-bruce.json}"
REMOTE_WF="${REMOTE_DIR}/workflows/discord-bruce.json"

if [[ ! -f "$LOCAL_WF" ]]; then
  echo "FAIL: $LOCAL_WF not found (run from repo root)"
  exit 1
fi

echo "==> scp $LOCAL_WF -> $VPS:$REMOTE_WF"
scp -q "$LOCAL_WF" "$VPS:$REMOTE_WF"

echo "==> running import on VPS"
ssh "$VPS" "REMOTE_DIR=$REMOTE_DIR bash -s" <<'REMOTE'
set -euo pipefail

cd "${REMOTE_DIR:-/root/household-ai}"

# Source .env so we get N8N_API_KEY / N8N_BASIC_AUTH_* and friends.
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  . .env
  set +a
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "FAIL: jq is not installed on the VPS (apt-get install -y jq)"
  exit 1
fi

# Auth: prefer API key, fall back to basic (with a warning).
if [[ -n "${N8N_API_KEY:-}" ]]; then
  AUTH=(-H "X-N8N-API-KEY: ${N8N_API_KEY}")
elif [[ -n "${N8N_BASIC_AUTH_USER:-}" && -n "${N8N_BASIC_AUTH_PASSWORD:-}" ]]; then
  echo "[warn] falling back to basic auth — n8n /api/v1 usually needs N8N_API_KEY"
  AUTH=(-u "${N8N_BASIC_AUTH_USER}:${N8N_BASIC_AUTH_PASSWORD}")
else
  echo "FAIL: need N8N_API_KEY (preferred) or N8N_BASIC_AUTH_USER + N8N_BASIC_AUTH_PASSWORD in .env"
  exit 1
fi

API="http://localhost:5678/api/v1"
WF_FILE="workflows/discord-bruce.json"

# -------- Lookup workflow id by name -----------------------------------------
WF_NAME="$(jq -r '.name' "$WF_FILE")"
echo "==> looking up workflow by name: $WF_NAME"

LIST_JSON="$(curl -sS "${AUTH[@]}" "$API/workflows")"
WF_ID="$(echo "$LIST_JSON" | jq -r --arg n "$WF_NAME" '
  (.data // . ) | map(select(.name == $n)) | .[0].id // empty')"

if [[ -z "$WF_ID" || "$WF_ID" == "null" ]]; then
  echo "FAIL: workflow named \"$WF_NAME\" not found. Available:"
  echo "$LIST_JSON" | jq -r '(.data // .)[] | "  - \(.id)  \(.name)"'
  exit 1
fi
WAS_ACTIVE="$(echo "$LIST_JSON" | jq -r --arg n "$WF_NAME" '(.data // .) | map(select(.name == $n)) | .[0].active')"
echo "    id=$WF_ID  was_active=$WAS_ACTIVE"

# -------- Deactivate first (n8n does not allow PUT on active wf in some vers) -
if [[ "$WAS_ACTIVE" == "true" ]]; then
  echo "==> deactivating"
  curl -sf -X POST "${AUTH[@]}" "$API/workflows/$WF_ID/deactivate" > /dev/null
fi

# -------- Build PUT body (strip extra fields n8n rejects) --------------------
jq '{name, nodes, connections, settings: (.settings // {}), staticData: (.staticData // null)}' \
  "$WF_FILE" > /tmp/wf-put.json

echo "==> PUT /api/v1/workflows/$WF_ID"
HTTP_CODE="$(curl -sS -o /tmp/wf-put-resp.json -w '%{http_code}' \
  -X PUT "${AUTH[@]}" \
  -H 'content-type: application/json' \
  --data @/tmp/wf-put.json \
  "$API/workflows/$WF_ID")"
if [[ "$HTTP_CODE" != "200" ]]; then
  echo "FAIL: PUT returned $HTTP_CODE"
  cat /tmp/wf-put-resp.json
  exit 1
fi
echo "    ok"

# -------- Reactivate ---------------------------------------------------------
echo "==> activating"
curl -sf -X POST "${AUTH[@]}" "$API/workflows/$WF_ID/activate" > /dev/null
echo "    ok"

# -------- Verify credentials on the live workflow ----------------------------
echo "==> verifying credentials"
curl -sS "${AUTH[@]}" "$API/workflows/$WF_ID" > /tmp/wf-live.json

PG_EXPECTED="EHBRO07aceirmFzt"
DC_EXPECTED="om7VabWMiA8gC2i3"

PG_BAD="$(jq -r --arg e "$PG_EXPECTED" '
  .nodes[]
  | select(.type == "n8n-nodes-base.postgres")
  | select((.credentials.postgres.id // "") != $e)
  | "    - \(.name) [cred=\(.credentials.postgres.id // "blank")]"
' /tmp/wf-live.json)"

DC_BAD="$(jq -r --arg e "$DC_EXPECTED" '
  .nodes[]
  | select(.type == "n8n-nodes-base.discord")
  | select((.credentials.discordBotApi.id // "") != $e)
  | "    - \(.name) [cred=\(.credentials.discordBotApi.id // "blank")]"
' /tmp/wf-live.json)"

FAIL=0
if [[ -n "$PG_BAD" ]]; then
  echo "[FAIL] Postgres nodes with wrong/blank creds:"; echo "$PG_BAD"; FAIL=1
fi
if [[ -n "$DC_BAD" ]]; then
  echo "[FAIL] Discord nodes with wrong/blank creds:"; echo "$DC_BAD"; FAIL=1
fi

if [[ $FAIL -ne 0 ]]; then
  echo
  echo "Credential drift detected. Re-open the workflow in the n8n UI, fix the"
  echo "affected nodes, and re-run this script. (n8n drops unrecognized cred"
  echo "ids on import; usually this means you imported from a backup that was"
  echo "edited without the hardcoded id baked in.)"
  exit 1
fi

echo "==> all postgres + discord credentials verified"
echo "DONE"
REMOTE

echo
echo "sync-workflow: OK"
