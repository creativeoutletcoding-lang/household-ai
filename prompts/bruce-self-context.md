# Bruce System Context

Use this when helping Jake build, debug, or extend the household AI system.

## Infrastructure

- VPS: 147.182.142.176, Ubuntu 24.04
- Reverse proxy: Caddy (host, not Docker)
- Docker services: postgres 16, n8n 2.16.1, open-webui, discord-relay (no watchtower — updates are manual)
- Domain: creativeoutletcoding.com — subdomains: n8n.creativeoutletcoding.com, chat.creativeoutletcoding.com
- GitHub: creativeoutletcoding-lang/household-ai (main branch)

## Discord

- Server ID: 1495249842778148954
- Bot ID: 1495252972026859520
- Categories: SHARED, FAM, CPS, JAKE, LOUBI, JOCE, NANA
- Behavior modes: always-respond (Jake/family channels), mention-only (shared channels), always-respond (DMs)
- DMs: discord-relay forwards with `channel_name='dm'`, `is_dm=true`, `guild_id=''`. Channel Router routes to the 'dm' persona. A raw gateway `MESSAGE_CREATE` listener backs up discord.js's `messageCreate` for DMs, with a de-dupe set to prevent double relay.

## Workflow Architecture

60 nodes in `workflows/discord-bruce.json`. High-level flow:

```
Webhook → Unwrap Body → Fetch User Preference → Channel Router
  → Command Switch (12 rules + fallback):
      0: /use         → Set Model → Reply Confirmation
      1: /remember    → Insert Memory → Reply Confirmation
      2: /forget      → Delete Memory → Reply Confirmation
      3: /memories    → Fetch Memories → Reply List
      4: /clear       → Delete History → Reply Confirmation
      5: /image       → Build Image Request → Call Replicate → Reply Image
      6: /search      → Build Search Request → Call Perplexity → Reply Search
      7: reply-only   → Reply on Discord (no Claude call)  [/help routes here]
      8: /calendar    → Parse Calendar Cmd → Get Calendar Events → Format Calendar Reply → Reply Calendar
      9: /save-recipe → Save Recipe (Postgres) → Reply Save Recipe
     10: /recipes     → Query Recipes (Postgres) → Reply Recipes
     11: /status      → Query Status (Postgres) → Format Status Reply → Reply Status  [jake channels only]
     DM:  channel_name='dm', is_dm=true → always-respond, 'dm' persona
     12: default chat → Should Respond? → Detect Search Intent → Auto-Search IF
                          → (true) Auto-Search Perplexity ↘
                          → (false) ─────────────────────→ Fetch Conversation History
                                                         → Fetch Memories
                                                         → Build Claude Request
                                                         → Call Claude
                                                         → Parse Claude Reply
                                                         → Reply on Discord
                                                         → Persist User Message
                                                         → Persist Assistant Message
```

## Key Implementation Details

- Personas are INLINE in the Channel Router Code node (not loaded from .md files)
- `alwaysOutputData: true` on Fetch User Preference, Fetch Conversation History, Fetch Memories
- Persist Assistant Message reads from `$('Parse Claude Reply').first().json`
- All reply nodes use: `{{ $('Unwrap Body').first().json.thread_id || $('Unwrap Body').first().json.channel_id }}`
- Replicate auth uses `Token` prefix (not `Bearer`)
- Build Claude Request conditionally prepends self-context for jake-personal, fig, jake-ask channels
- Parse Claude Reply returns multiple items when reply >1900 chars (splitChunks); Discord node sends one message per item
- /status pipeline: Query Status → Fetch Last n8n Error (HTTP) → Format Status Reply → Reply Status
- DM messages: discord-relay forwards with channel_name='dm', is_dm=true; Channel Router routes to 'dm' persona

## Postgres Schema

Database: household (via credential ID `EHBRO07aceirmFzt`)

```sql
discord_conversations(id, message_id, guild_id, channel_id, channel_name, thread_id, thread_name, discord_user_id, discord_username, role, content, created_at)
user_model_preferences(guild_id, channel_id, user_id, model, updated_at)
user_memories(id, discord_user_id, scope, visibility_scope, channel_id, channel_name, content, created_at)
  -- scope           ∈ {'user','channel','auto'}   — how the memory was written
  -- visibility_scope ∈ {'dm','private','shared'}  — where it's allowed to surface (migration 008)
recipes(id, discord_user_id, title, body, created_at, updated_at)
user_session_flags(discord_user_id, channel_id, flag_name, flag_value, updated_at)
  -- ephemeral per-user+channel flags: private_mode='true'|'false', private_started_at=ISO ts

Note: DMs use guild_id='' and channel_id=Discord DM channel ID; channel_name='dm'; is_dm=true.
```

## Memory visibility scoping (migration 008)

Every memory has a `visibility_scope` that controls where it surfaces:

- **dm** — DM conversations only
- **private** — surfaces in the owner's personal channels (jake-personal, fig, jake-ask, loubi-personal, wis, loubi-ask, joce-personal, joce-school, joce-ask, nana-personal, nana-ask) and their DMs — never in group/shared channels
- **shared** — surfaces everywhere including group/shared channels (general, family, announcements, food, travel, cps)

Assigned at write time based on the channel the conversation happened in. Enforced at read time by `Fetch User Memories`.

## Credentials

| Service | Credential Name | ID |
|---|---|---|
| Postgres | Household Postgres | EHBRO07aceirmFzt |
| Discord | Discord Bot account | om7VabWMiA8gC2i3 |
| Google Calendar | Google Calendar (johnson2016family) | GOOGLE_CALENDAR_CRED_ID (placeholder — create in n8n UI) |

Every Postgres node must use `EHBRO07aceirmFzt`. Every Discord node must use `om7VabWMiA8gC2i3`. Google Calendar credential must be created via OAuth in n8n UI — see runbook.md → Calendar section.

## Environment Variables (.env + docker-compose environment block)

```
ANTHROPIC_API_KEY, REPLICATE_API_TOKEN, PERPLEXITY_API_KEY
DISCORD_BOT_TOKEN, DISCORD_SERVER_ID, DISCORD_BOT_USER_ID
N8N_BLOCK_ENV_ACCESS_IN_NODE=false
```

n8n env vars require: (a) entry in `.env`, (b) mapping in docker-compose `environment:` block, (c) `N8N_BLOCK_ENV_ACCESS_IN_NODE: "false"`.

## Key File Paths

```
docker-compose.yml          — service definitions
.env                        — secrets (not in git)
config/channel-routing.json — channel → persona/behavior mapping
workflows/discord-bruce.json — main n8n workflow (import via UI)
prompts/                    — persona/context files (reference only; not runtime-loaded)
runbook.md                  — operational runbook
```

## Commands

| Command | Description |
|---|---|
| /use [model] | Switch model: haiku, sonnet, opus |
| /remember <fact> | Save long-term memory |
| /forget <fact> | Delete a memory |
| /memories | List saved memories |
| /clear | Clear conversation history |
| /image <prompt> | Generate image via Flux Schnell |
| /image --hd <prompt> | HD image via Flux Pro |
| /search <query> | Web search via Perplexity (also auto-triggers for URLs, live scores, current events) |
| /calendar | Show today's family calendar events (Google Calendar) |
| /calendar week | Show events for the next 7 days |
| /calendar <person> | Show a person's calendar (jake, loubi, joce, nana, elliot, henry, violette) |
| /status | System health: message counts, memory counts, recipe count, last n8n error (jake channels only) |
| /private [on\|off] | Toggle incognito mode for this channel — no conversation or memory persistence while on; /private off also deletes Bruce's messages sent during the session |
| /purge [N\|all] | Delete recent messages in this channel (server: bulk-delete for anything <14 days old; DMs: only Bruce's own messages — Discord restriction) |
| /help | Show all commands |
| /save-recipe <title>\n<content> | Save a recipe to Postgres |
| /recipes [search] | List or search saved recipes |

## Model Strings

- Haiku: `claude-haiku-4-5-20251001`
- Sonnet: `claude-sonnet-4-6`
- Opus: `claude-opus-4-7`

## Calendar (Google Calendar)

Uses n8n's built-in Google Calendar node against `johnson2016family@gmail.com`. No env vars needed — credential is OAuth2 stored in n8n.

- Credential: `Google Calendar (johnson2016family)` — ID placeholder `GOOGLE_CALENDAR_CRED_ID`, must be created in n8n UI
- Per-person sub-calendars: Elliot, Henry, Jake, Joce, Loubi, Nana, Violette
- Sub-calendar IDs configured in `Parse Calendar Cmd` Code node — currently placeholders, need to be filled in
- Jake defaults to `primary`; all others need real calendar IDs from Google Calendar settings
- See runbook.md → Calendar section for full setup steps

## Family

| Name | Role | Location |
|---|---|---|
| Jake | Admin / builder | Falls Church / Merrifield, VA |
| Laurianne (Loubi) | Partner | WIS (Wisconsin) |
| Joce | Daughter, high school | — |
| Nana | Grandma (CPS category) | — |
| Elliot, Henry, Violette | Calendar only | — |

## Top Gotchas

1. Credential IDs must be hardcoded — they silently revert to `{}` after workflow reimport
2. Guild ID and Bot ID must be hardcoded strings, never env var references
3. `alwaysOutputData: true` required on Fetch nodes (prevents branch abort on empty result)
4. Persist Assistant Message must reference `$('Parse Claude Reply').first().json`, not `$json`
5. Replicate API uses `Token` prefix, not `Bearer`
6. Personas are inline in Channel Router — editing .md files has no runtime effect
7. n8n env vars need 3-step setup (.env + compose + N8N_BLOCK_ENV_ACCESS_IN_NODE)
8. Reply nodes must use thread_id fallback expression for private thread support
9. Workflow changes require manual reimport via n8n UI (no hot-reload)
10. After reimport, always verify all credentials are filled — they silently revert
