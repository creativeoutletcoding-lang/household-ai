-- 008-memory-scoping.sql
--
-- Adds `visibility_scope` to user_memories so that memories surface only in
-- contexts appropriate to where they were learned:
--   'dm'      → DM conversations with that user only
--   'private' → any of that person's personal channels + their DMs, not
--               group/shared channels
--   'shared'  → everywhere including group/shared channels
--
-- Also adds the user_session_flags table used by /private (incognito mode)
-- to track per-user+channel flags (private_mode, private_started_at).
--
-- Apply against the n8n database:
--   docker compose exec -T postgres psql -U household -d n8n \
--     < postgres/migrations/008-memory-scoping.sql
--
-- Idempotent: safe to re-run.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Add visibility_scope to user_memories
-- ---------------------------------------------------------------------------
ALTER TABLE user_memories
    ADD COLUMN IF NOT EXISTS visibility_scope text NOT NULL DEFAULT 'private';

ALTER TABLE user_memories
    DROP CONSTRAINT IF EXISTS visibility_scope_check;

ALTER TABLE user_memories
    ADD  CONSTRAINT visibility_scope_check
         CHECK (visibility_scope IN ('dm', 'private', 'shared'));

UPDATE user_memories SET visibility_scope = 'private'
    WHERE visibility_scope IS NULL OR visibility_scope = '';

CREATE INDEX IF NOT EXISTS user_memories_visibility_scope_idx
    ON user_memories (discord_user_id, visibility_scope);

-- ---------------------------------------------------------------------------
-- 2. user_session_flags — per-user+channel ephemeral flags
-- ---------------------------------------------------------------------------
-- Used by /private to track incognito mode state and the timestamp it was
-- enabled (so /private off can clean up bot messages sent during the
-- session). Composite PK so upserts are natural.

CREATE TABLE IF NOT EXISTS user_session_flags (
    discord_user_id text        NOT NULL,
    channel_id      text        NOT NULL,
    flag_name       text        NOT NULL,
    flag_value      text        NOT NULL,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (discord_user_id, channel_id, flag_name)
);

CREATE INDEX IF NOT EXISTS user_session_flags_user_channel_idx
    ON user_session_flags (discord_user_id, channel_id);

COMMIT;

-- ---------------------------------------------------------------------------
-- Operational notes
-- ---------------------------------------------------------------------------
-- Reclassify scope for a memory:
--   UPDATE user_memories SET visibility_scope = 'shared' WHERE id = <id>;
--
-- Inspect a user's session flags:
--   SELECT * FROM user_session_flags
--     WHERE discord_user_id = '<id>' ORDER BY updated_at DESC;
--
-- Clear private mode for a user in a channel (admin override):
--   DELETE FROM user_session_flags
--     WHERE discord_user_id = '<id>' AND channel_id = '<id>'
--       AND flag_name IN ('private_mode', 'private_started_at');
