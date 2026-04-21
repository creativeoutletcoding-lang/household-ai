-- 005-username.sql
--
-- Add discord_username to discord_conversations so Build Claude Request can
-- attribute speakers in shared channels (#food, #family, #travel, #cps,
-- #general, #announcements) where history is channel-scoped across multiple
-- people.
--
-- Previously the Fetch Conversation History query filtered by
-- discord_user_id, so Bruce only ever saw one speaker's turns in a shared
-- channel. We're switching to channel-scoped history for those channels and
-- prefixing each user turn with the speaker's name. To do that we need the
-- speaker's name on the row.
--
-- Existing rows keep NULL username — Build Claude Request falls back to
-- "user-<lastFour>" for those. New rows get the Discord username from the
-- relay payload via Persist User Message.
--
-- For assistant rows, Persist Assistant Message stores 'Bruce'. Not used
-- for display (assistant turns are never prefixed) but kept for consistency.

ALTER TABLE discord_conversations
  ADD COLUMN IF NOT EXISTS discord_username TEXT;

-- Optional index for future per-speaker queries (e.g. "what did Jake say in
-- #food last week?"). Cheap insurance; drop if write volume ever becomes a
-- concern.
CREATE INDEX IF NOT EXISTS discord_conversations_username_idx
  ON discord_conversations (discord_username);
