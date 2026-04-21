#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# smoke-test.sh
#
# End-to-end post-deploy sanity check. Fires a synthetic webhook payload at
# the n8n workflow (bypassing Discord), waits for the pipeline to run, and
# confirms that:
#   1. the user row landed in discord_conversations
#   2. an assistant reply row landed in discord_conversations
#   3. the [memory] log lines fired (meaning auto-memory branch executed)
#
# Exits 0 on success, 1 on failure — chain after sync-workflow.sh:
#   ./scripts/sync-workflow.sh && ./scripts/smoke-test.sh
#
# The test row gets a clearly-tagged synthetic message_id (`smoke-<ts>-<pid>`)
# and discord_user_id (`smoke-test-user`). Both are cleaned up at the end,
# pass or fail, so you don't pollute history. Comment out the DELETE at the
# bottom of the remote block if you want to inspect them manually.
#
# The payload routes through #jake-personal by default (historyScope=user,
# behavior=always, so Bruce will reply without needing a mention). Override
# TEST_CHANNEL_ID / TEST_CHANNEL_NAME to hit a different channel.
# ---------------------------------------------------------------------------

set -euo pipefail

VPS="${VPS:-root@147.182.142.176}"
TEST_CHANNEL_NAME="${TEST_CHANNEL_NAME:-jake-personal}"
TEST_CHANNEL_ID="${TEST_CHANNEL_ID:-1495249843000000001}"   # placeholder — override to a real channel id
TEST_MSG="${TEST_MSG:-smoke test: I am allergic to shellfish}"
WAIT_SECS="${WAIT_SECS:-20}"

TEST_USER_ID="smoke-test-user"
TEST_MSG_ID="smoke-$(date +%s)-$$"

ssh "$VPS" \
  TEST_MSG_ID="$TEST_MSG_ID" \
  TEST_USER_ID="$TEST_USER_ID" \
  TEST_CHANNEL_ID="$TEST_CHANNEL_ID" \
  TEST_CHANNEL_NAME="$TEST_CHANNEL_NAME" \
  TEST_MSG="$TEST_MSG" \
  WAIT_SECS="$WAIT_SECS" \
  bash -s <<'REMOTE'
set -euo pipefail

N8N_CONTAINER="household-n8n"
PG_CONTAINER="household-postgres"
PG_USER="household"
PG_DB="n8n"
WEBHOOK_URL="http://localhost:5678/webhook/discord-bruce"

# Build payload matching discord-relay's buildPayload() shape.
PAYLOAD=$(cat <<JSON
{
  "id": "${TEST_MSG_ID}",
  "content": "${TEST_MSG}",
  "author": {"id": "${TEST_USER_ID}", "username": "smoke", "bot": false},
  "channel_id": "${TEST_CHANNEL_ID}",
  "channel_name": "${TEST_CHANNEL_NAME}",
  "guild_id": "1495249842778148954",
  "is_thread": false,
  "thread_id": "",
  "thread_name": "",
  "mentions": [],
  "attachments": [],
  "referenced_message": null
}
JSON
)

echo "==> POST $WEBHOOK_URL"
echo "    msg_id=${TEST_MSG_ID} channel=${TEST_CHANNEL_NAME}"
HTTP_CODE=$(curl -sS -o /tmp/smoke-resp.txt -w '%{http_code}' \
  -X POST -H 'content-type: application/json' --data "$PAYLOAD" "$WEBHOOK_URL")
if [[ "$HTTP_CODE" != "200" ]]; then
  echo "FAIL: webhook returned HTTP $HTTP_CODE"
  cat /tmp/smoke-resp.txt
  # still attempt cleanup below
fi

echo "==> sleeping ${WAIT_SECS}s for workflow to complete"
sleep "$WAIT_SECS"

# ---- Check the DB ---------------------------------------------------------
echo "==> checking Postgres rows"
USER_ROWS=$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -tAc \
  "SELECT COUNT(*) FROM discord_conversations WHERE message_id = '${TEST_MSG_ID}';")
ASSIST_ROWS=$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -tAc \
  "SELECT COUNT(*) FROM discord_conversations
    WHERE discord_user_id = '${TEST_USER_ID}'
      AND role = 'assistant'
      AND created_at > NOW() - INTERVAL '5 minutes';")

echo "    user row (message_id=${TEST_MSG_ID}):      ${USER_ROWS}"
echo "    assistant rows in last 5 min for smoke:    ${ASSIST_ROWS}"

# ---- Check n8n memory logs ------------------------------------------------
echo "==> checking [memory] log lines (last 3 min)"
MEM_LINES=$(docker logs --since 3m "$N8N_CONTAINER" 2>&1 | grep -c '\[memory\]' || true)
echo "    [memory] lines found: ${MEM_LINES}"
if [[ "$MEM_LINES" -gt 0 ]]; then
  docker logs --since 3m "$N8N_CONTAINER" 2>&1 | grep '\[memory\]' | tail -5 | sed 's/^/      /'
fi

# ---- Cleanup --------------------------------------------------------------
echo "==> cleaning up smoke-test rows"
docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -tAc \
  "DELETE FROM discord_conversations WHERE discord_user_id = '${TEST_USER_ID}';
   DELETE FROM user_memories WHERE discord_user_id = '${TEST_USER_ID}';
   DELETE FROM user_model_preferences WHERE discord_user_id = '${TEST_USER_ID}';" > /dev/null

# ---- Verdict --------------------------------------------------------------
echo
if [[ "$USER_ROWS" -ge 1 && "$ASSIST_ROWS" -ge 1 && "$MEM_LINES" -ge 1 ]]; then
  echo "SMOKE OK"
  exit 0
fi

echo "SMOKE FAIL"
[[ "$USER_ROWS" -lt 1 ]] && echo "  - user row never persisted (check Persist User Message, maybe empty-content guard fired)"
[[ "$ASSIST_ROWS" -lt 1 ]] && echo "  - no assistant reply (check Call Claude, Persist Assistant Message, or the routing for ${TEST_CHANNEL_NAME})"
[[ "$MEM_LINES" -lt 1 ]] && echo "  - no [memory] log lines (Build Memory Extraction Request branch may not be executing — check connections)"
exit 1
REMOTE
