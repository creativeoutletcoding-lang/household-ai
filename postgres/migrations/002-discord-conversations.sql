-- 002-discord-conversations.sql
--
-- Conversation memory for Bruce, the Discord-facing assistant.
-- One row per message (user or assistant), keyed by Discord message_id.
--
-- Apply this migration against the n8n database (where the workflow runs):
--   docker compose exec -T postgres psql -U household -d n8n \
--     < postgres/migrations/002-discord-conversations.sql
--
-- Idempotent: safe to re-run. Uses IF NOT EXISTS everywhere.

BEGIN;

CREATE TABLE IF NOT EXISTS discord_conversations (
    -- Discord's snowflake IDs comfortably fit in BIGINT, but we store them as
    -- TEXT for two reasons: (1) Discord's JS SDK uses strings for snowflakes
    -- because 64-bit ints don't round-trip through JS numbers, and (2) it
    -- keeps joins with logs simple. Index size is a rounding error.
    message_id        TEXT        PRIMARY KEY,
    discord_user_id   TEXT        NOT NULL,
    channel_id        TEXT        NOT NULL,
    channel_name      TEXT        NOT NULL,
    role              TEXT        NOT NULL
                                   CHECK (role IN ('user', 'assistant')),
    content           TEXT        NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Primary lookup pattern: "give me the last N messages for this user in this
-- channel, newest first." DESC on created_at lets the index serve the sort.
CREATE INDEX IF NOT EXISTS discord_conversations_user_channel_time_idx
    ON discord_conversations (discord_user_id, channel_id, created_at DESC);

-- Secondary lookup: "what's the recent history of this channel regardless of
-- speaker?" — used by shared channels (general, family) where Bruce needs
-- context from multiple humans.
CREATE INDEX IF NOT EXISTS discord_conversations_channel_time_idx
    ON discord_conversations (channel_id, created_at DESC);

-- Cheap housekeeping index for "show me everything this person ever said."
CREATE INDEX IF NOT EXISTS discord_conversations_user_time_idx
    ON discord_conversations (discord_user_id, created_at DESC);

COMMIT;

-- ---------------------------------------------------------------------------
-- Operational notes
-- ---------------------------------------------------------------------------
-- Growth estimate: ~1 KB/row (content is the bulk), 4 humans × ~100 msgs/day
-- = ~400 rows/day = ~150k rows/year. Well within what the small droplet can
-- handle without partitioning.
--
-- When you want to prune old history (e.g. keep only the last 180 days):
--   DELETE FROM discord_conversations WHERE created_at < now() - interval '180 days';
--
-- When a Discord message is edited: Discord assigns the same message_id.
-- The workflow uses INSERT ... ON CONFLICT (message_id) DO UPDATE so edits
-- overwrite the stored row. See workflows/discord-bruce.json.
