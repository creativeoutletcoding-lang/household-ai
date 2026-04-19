-- 003-model-preferences.sql
--
-- Per-user, per-channel model overrides for Bruce. Written when someone
-- runs `/use <model>` in a channel; read by the Channel Router node to
-- decide which Claude model to call for the next message.
--
-- Apply against the n8n database (where the Bruce workflow reads/writes):
--   docker compose exec -T postgres psql -U household -d n8n \
--     < postgres/migrations/003-model-preferences.sql
--
-- Idempotent: safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS user_model_preferences (
  discord_user_id TEXT NOT NULL,
  channel_id      TEXT NOT NULL,
  model           TEXT NOT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (discord_user_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_model_prefs_user
  ON user_model_preferences (discord_user_id);

COMMIT;

-- To reset a single user's override in a channel:
--   DELETE FROM user_model_preferences
--    WHERE discord_user_id = '<id>' AND channel_id = '<id>';
--
-- To see who's overridden what:
--   SELECT * FROM user_model_preferences ORDER BY updated_at DESC;
