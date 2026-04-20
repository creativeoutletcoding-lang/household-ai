-- 004-thread-and-memory.sql
--
-- Adds thread support to discord_conversations and introduces a long-term
-- "memories" table keyed by (discord_user_id, scope). The Channel Router
-- writes memories when a user runs `/remember <text>` and the Build Claude
-- Request node injects them into the system prompt.
--
-- Apply against the n8n database:
--   docker compose exec -T postgres psql -U household -d n8n \
--     < postgres/migrations/004-thread-and-memory.sql
--
-- Idempotent: safe to re-run.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Thread support for discord_conversations
-- ---------------------------------------------------------------------------
--
-- Bruce can now be talked to inside Discord threads. Memory scoping is
-- thread-aware: a message inside a thread is scoped to (user, channel, thread)
-- so a user's side-conversation in a thread doesn't pollute the main-channel
-- history — and vice versa.

ALTER TABLE discord_conversations
    ADD COLUMN IF NOT EXISTS thread_id   TEXT,
    ADD COLUMN IF NOT EXISTS thread_name TEXT;

-- Primary lookup pattern for threaded messages: last N messages for this user
-- in this specific thread, newest first. Partial index — only rows that are
-- actually in a thread pay the index-size cost.
CREATE INDEX IF NOT EXISTS discord_conversations_user_thread_time_idx
    ON discord_conversations (discord_user_id, thread_id, created_at DESC)
    WHERE thread_id IS NOT NULL;

-- Channel-wide thread lookup: "everything said in this thread, any speaker."
CREATE INDEX IF NOT EXISTS discord_conversations_thread_time_idx
    ON discord_conversations (thread_id, created_at DESC)
    WHERE thread_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Long-term memories
-- ---------------------------------------------------------------------------
--
-- User-authored "remember this" facts Bruce can inject into the system prompt
-- on every turn. Scoped per user + per channel so that e.g. Loubi's preferred
-- tone in #loubi-personal doesn't leak into #family.
--
-- Scopes:
--   'user'    — applies across every channel for this user (their voice,
--               standing preferences)
--   'channel' — applies only in the specific (user, channel) pair
--
-- channel_id is NULL for scope='user'; NOT NULL for scope='channel'. The
-- partial unique indexes below enforce "one (user, scope='user', content)"
-- and "one (user, channel, scope='channel', content)" rather than a plain
-- PK so we can look things up quickly without a composite natural key.

CREATE TABLE IF NOT EXISTS user_memories (
    id              BIGSERIAL   PRIMARY KEY,
    discord_user_id TEXT        NOT NULL,
    scope           TEXT        NOT NULL
                                 CHECK (scope IN ('user', 'channel')),
    channel_id      TEXT,                       -- NULL when scope = 'user'
    channel_name    TEXT,                       -- for operator readability
    content         TEXT        NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT user_memories_channel_scope_ck
        CHECK (
            (scope = 'user'    AND channel_id IS NULL) OR
            (scope = 'channel' AND channel_id IS NOT NULL)
        )
);

-- Fast read: "give me every memory that applies to this user in this channel."
-- The router fetches with: WHERE discord_user_id = $1 AND (scope = 'user' OR channel_id = $2).
CREATE INDEX IF NOT EXISTS user_memories_user_scope_idx
    ON user_memories (discord_user_id, scope, channel_id);

-- Housekeeping index for "show me all of X's memories, newest first."
CREATE INDEX IF NOT EXISTS user_memories_user_time_idx
    ON user_memories (discord_user_id, created_at DESC);

COMMIT;

-- ---------------------------------------------------------------------------
-- Operational notes
-- ---------------------------------------------------------------------------
-- List a user's memories:
--   SELECT id, scope, channel_name, content, created_at
--     FROM user_memories
--    WHERE discord_user_id = '<id>'
--    ORDER BY created_at DESC;
--
-- Delete one memory by id (shown by `/memories` in Discord):
--   DELETE FROM user_memories WHERE id = <id>;
--
-- Wipe all memories for a user:
--   DELETE FROM user_memories WHERE discord_user_id = '<id>';
--
-- Wipe all memories scoped to one channel (if the channel is removed):
--   DELETE FROM user_memories WHERE channel_id = '<id>';
