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
- Behavior modes: always-respond (Jake/family channels), mention-only (shared channels)

## Workflow Architecture

56 nodes in `workflows/discord-bruce.json`. High-level flow:

```
Webhook → Unwrap Body → Fetch User Preference → Channel Router
  → Command Switch (10 outputs):
      0: /use         → Set Model → Reply Confirmation
      1: /remember    → Insert Memory → Reply Confirmation
      2: /forget      → Delete Memory → Reply Confirmation
      3: /memories    → Fetch Memories → Reply List
      4: /clear       → Delete History → Reply Confirmation
      5: /image       → Build Image Request → Call Replicate → Reply Image
      6: /search      → Build Search Request → Call Perplexity → Reply Search
      7: /calendar    → Build Skylight Request → Authenticate Skylight → Call Skylight API → Parse Skylight Reply → Reply Calendar
      8: reply-only   → Reply on Discord (no Claude call)  [/help routes here]
      9: /save-recipe → Save Recipe (Postgres) → Reply Save Recipe
     10: /recipes     → Query Recipes (Postgres) → Reply Recipes
     11: default chat → Should Respond? → Detect Search Intent → Auto-Search IF
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

## Postgres Schema

Database: household (via credential ID `EHBRO07aceirmFzt`)

```sql
discord_conversations(id, guild_id, channel_id, user_id, role, content, created_at)
user_model_preferences(guild_id, channel_id, user_id, model, updated_at)
user_memories(id, guild_id, user_id, memory, created_at)
recipes(id, discord_user_id, title, body, created_at, updated_at)
```

## Credentials

| Service | Credential Name | ID |
|---|---|---|
| Postgres | Household Postgres | EHBRO07aceirmFzt |
| Discord | Discord Bot account | om7VabWMiA8gC2i3 |

Every Postgres node must use `EHBRO07aceirmFzt`. Every Discord node must use `om7VabWMiA8gC2i3`.

## Environment Variables (.env + docker-compose environment block)

```
ANTHROPIC_API_KEY, REPLICATE_API_TOKEN, PERPLEXITY_API_KEY
DISCORD_BOT_TOKEN, DISCORD_SERVER_ID, DISCORD_BOT_USER_ID
SKYLIGHT_EMAIL, SKYLIGHT_PASSWORD, SKYLIGHT_FRAME_ID, SKYLIGHT_TIMEZONE
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
| /search <query> | Web search via Perplexity |
| /calendar | View/manage Skylight family calendar |
| /help | Show all commands |
| /save-recipe <title>\n<content> | Save a recipe to Postgres |
| /recipes [search] | List or search saved recipes |

## Model Strings

- Haiku: `claude-haiku-4-5-20251001`
- Sonnet: `claude-sonnet-4-6`
- Opus: `claude-opus-4-7`

## Calendar (Skylight)

Direct API — no MCP sidecar. Auth flow in n8n Code node:
- Login: POST to Skylight OAuth endpoint using `SKYLIGHT_EMAIL` / `SKYLIGHT_PASSWORD`
- Token cached in `$workflow.staticData` (access is guarded with try/catch — sandbox returns undefined)
- On 401: clear cache, re-authenticate
- Frame ID from `SKYLIGHT_FRAME_ID`
- Timezone from `SKYLIGHT_TIMEZONE` (default: America/New_York)

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
