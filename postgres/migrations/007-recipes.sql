-- Migration 007: recipes table
-- Stores user-saved recipes with title and full body content.

CREATE TABLE IF NOT EXISTS recipes (
  id              SERIAL PRIMARY KEY,
  discord_user_id TEXT        NOT NULL,
  title           TEXT        NOT NULL,
  body            TEXT        NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS recipes_user_idx ON recipes (discord_user_id);
CREATE INDEX IF NOT EXISTS recipes_title_lower_idx ON recipes (discord_user_id, LOWER(title));
