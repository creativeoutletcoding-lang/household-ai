-- 006-auto-memory-scope.sql
--
-- Expands user_memories.scope to include 'auto' (Haiku-extracted memories
-- written by the Insert Auto Memory branch after each conversation) and
-- adds a case-insensitive uniqueness guarantee on (discord_user_id,
-- content) so we never accumulate near-duplicate facts across runs.
--
-- Why this change:
--   - 004 shipped scope IN ('user', 'channel') and required channel_id
--     only when scope='channel'. Auto-memory writes one row per extracted
--     fact with scope='auto' AND a channel_id (the channel the exchange
--     took place in, useful for "where did Bruce learn this?" debugging).
--     Old constraint rejected the insert entirely.
--   - Haiku sometimes re-emits the same fact on subsequent conversations
--     ("Jake is allergic to shellfish" extracted again a day later). A
--     case-insensitive unique index collapses these at write time instead
--     of relying on the prompt to filter them out. /forget does a hard
--     delete so re-extraction can happen naturally after intentional
--     removal — the uniqueness guarantee has no memory of deleted rows.
--
-- Scopes after this migration:
--   'user'    — applies across every channel (NULL channel_id)
--   'channel' — applies only in that channel (channel_id NOT NULL)
--   'auto'    — extracted by the memory-curation branch;
--               channel_id carries where it was learned but the fact is
--               treated as applying across every channel at read time
--               (see Fetch User Memories query: no scope filter anymore)
--
-- Apply against the n8n database:
--   docker compose exec -T postgres psql -U household -d n8n \
--     < postgres/migrations/006-auto-memory-scope.sql
--
-- Idempotent: safe to re-run. DROP CONSTRAINT IF EXISTS + CREATE UNIQUE
-- INDEX IF NOT EXISTS handle the second-run case cleanly.
--
-- ---------------------------------------------------------------------------
-- Pre-flight check (RUN THIS FIRST on an existing DB)
-- ---------------------------------------------------------------------------
-- The unique index will FAIL if duplicates already exist. Check with:
--
--   SELECT discord_user_id, LOWER(content) AS content_lower, COUNT(*) AS n
--     FROM user_memories
--     GROUP BY discord_user_id, LOWER(content)
--     HAVING COUNT(*) > 1
--     ORDER BY n DESC;
--
-- If that returns rows, dedupe first (keeps the oldest row per group):
--
--   DELETE FROM user_memories
--     WHERE id NOT IN (
--       SELECT MIN(id)
--         FROM user_memories
--         GROUP BY discord_user_id, LOWER(content)
--     );
--
-- Then run this migration.
-- ---------------------------------------------------------------------------

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Replace the scope CHECK constraint
-- ---------------------------------------------------------------------------
-- The original constraint was defined inline on the `scope` column in
-- 004-thread-and-memory.sql; Postgres auto-named it user_memories_scope_check.
ALTER TABLE user_memories
    DROP CONSTRAINT IF EXISTS user_memories_scope_check;

ALTER TABLE user_memories
    ADD  CONSTRAINT user_memories_scope_check
         CHECK (scope IN ('user', 'channel', 'auto'));

-- ---------------------------------------------------------------------------
-- 2. Replace the channel_id presence constraint to cover 'auto'
-- ---------------------------------------------------------------------------
-- channel_id required for both 'channel' AND 'auto' — auto-memories carry
-- the originating channel for provenance. Only scope='user' can have
-- NULL channel_id.
ALTER TABLE user_memories
    DROP CONSTRAINT IF EXISTS user_memories_channel_scope_ck;

ALTER TABLE user_memories
    ADD  CONSTRAINT user_memories_channel_scope_ck
         CHECK (
             (scope = 'user'                        AND channel_id IS NULL)
          OR (scope IN ('channel', 'auto')          AND channel_id IS NOT NULL)
         );

-- ---------------------------------------------------------------------------
-- 3. Case-insensitive uniqueness on (user, content)
-- ---------------------------------------------------------------------------
-- One fact per user, regardless of capitalization or which branch wrote it.
-- No scope column in the index — Haiku extracting "Jake is allergic to
-- shellfish" as scope='auto' should collide with a user-written `/remember
-- I'm allergic to shellfish` (scope='channel'), because it's the same
-- fact. Deletions (/forget) are hard DELETEs so subsequent re-extraction
-- can happen naturally.
CREATE UNIQUE INDEX IF NOT EXISTS user_memories_user_content_lower_unq
    ON user_memories (discord_user_id, LOWER(content));

COMMIT;

-- ---------------------------------------------------------------------------
-- Rollback (run manually if this migration needs to be reverted)
-- ---------------------------------------------------------------------------
-- BEGIN;
--
--   DROP INDEX IF EXISTS user_memories_user_content_lower_unq;
--
--   ALTER TABLE user_memories
--       DROP CONSTRAINT IF EXISTS user_memories_channel_scope_ck;
--   ALTER TABLE user_memories
--       ADD  CONSTRAINT user_memories_channel_scope_ck
--            CHECK (
--                (scope = 'user'    AND channel_id IS NULL) OR
--                (scope = 'channel' AND channel_id IS NOT NULL)
--            );
--
--   ALTER TABLE user_memories
--       DROP CONSTRAINT IF EXISTS user_memories_scope_check;
--   ALTER TABLE user_memories
--       ADD  CONSTRAINT user_memories_scope_check
--            CHECK (scope IN ('user', 'channel'));
--
--   -- NB: rolling back will leave any scope='auto' rows violating the
--   -- restored scope check. Before running the rollback, delete or
--   -- re-scope them first:
--   --   UPDATE user_memories SET scope = 'channel' WHERE scope = 'auto';
--   --   -- or:
--   --   DELETE FROM user_memories WHERE scope = 'auto';
--
-- COMMIT;

-- ---------------------------------------------------------------------------
-- Operational notes
-- ---------------------------------------------------------------------------
-- Count memories by scope for a user:
--   SELECT scope, COUNT(*) FROM user_memories
--     WHERE discord_user_id = '<id>' GROUP BY scope;
--
-- Spot-check duplicates the unique index would now reject:
--   SELECT discord_user_id, LOWER(content), COUNT(*)
--     FROM user_memories
--     GROUP BY discord_user_id, LOWER(content)
--     HAVING COUNT(*) > 1;
--
-- Hard-delete one memory (what /forget does):
--   DELETE FROM user_memories WHERE id = <id>;
