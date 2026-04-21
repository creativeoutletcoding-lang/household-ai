# Bruce Dev Context

Architecture, failure patterns, and build conventions for extending the household AI system.
Injected into Bruce's system prompt in `#jake-personal` for dev conversations.

---

## Architecture Deep-Dive

### Webhook → n8n pipeline

Discord messages arrive via `discord-relay` (Node.js container). The relay:
1. Receives a Discord gateway event
2. POSTs a normalized payload to `http://household-n8n:5678/webhook/discord-bruce`
3. Payload shape: `{ channel_id, channel_name, guild_id, user_id, username, content, id, is_thread, thread_id, thread_name, attachments[] }`

The webhook node in n8n is set to respond immediately (async). All processing is fire-and-forget from the relay's perspective.

### Channel Router internals

Runs on every message. Does:
- Unwrap Body → read raw payload
- Fetch user Preference → get per-user model override (Postgres query, `alwaysOutputData: true` so it doesn't abort on empty result)
- Channel Router (Code node) → map channel_name to ROUTING entry, detect command type, build PERSONAS inline, output a unified `router` object

The `router` object is the source of truth for all downstream nodes. Every node reads from `$('Channel Router').first().json`.

### Command Switch outputs (0-indexed)

| Index | commandType | Branch |
|---|---|---|
| 0 | use | Is /use reset? → Reset/Save User Preference → Reply /use Confirmation |
| 1 | remember | Save User Memory → Reply Command Confirmation |
| 2 | forget | Delete User Memory → Reply Command Confirmation |
| 3 | memories | List User Memories → Format Memories List → Reply Memories List |
| 4 | clear | Clear Conversation History → Reply Command Confirmation |
| 5 | image | Build Replicate Input → Need Prompt? → Call Replicate → Parse Replicate Reply → Reply Image |
| 6 | search | Call Perplexity → Parse Perplexity Reply → Reply Search |
| 7 | reply-only | Reply Command Confirmation (no Claude call) |
| 8 | calendar | Build Skylight Request → Authenticate Skylight → Call Skylight API → Parse Skylight Reply → Reply Calendar |
| 9 | none (chat) | Should Respond? → Detect Search Intent → Auto-Search IF → [Perplexity] → Fetch Conversation History → Fetch User Memories → Build Claude Request → Call Claude → Parse Claude Reply → Reply on Discord → Persist User Message → Persist Assistant Message → [memory extraction chain] |

### Memory extraction chain

After every Claude reply: Persist User Message → Persist Assistant Message → Build Memory Extraction Request → Call Claude (Memory) → Parse Memory Extract → Insert Auto Memory.

Memory extraction calls Claude with a short prompt asking if any long-term facts worth remembering appear in the exchange. If yes, inserts them into `user_memories`. Model used: haiku (cheap, fast).

### Auto-search detection

`Detect Search Intent` (Code node) pattern-matches the user's message against regex for real-time/location queries. If matched, sets `needs_search: true` and appends `Falls Church Merrifield VA` for near-me queries.

`Auto-Search IF` routes true → `Auto-Search Perplexity` → `Fetch Conversation History`. False → `Fetch Conversation History` directly.

`Build Claude Request` wraps Perplexity results in `<auto_search_results>` tags via try/catch on `$('Auto-Search Perplexity').first().json`. Safe to fail if auto-search didn't run.

### Attachment handling

`Has Attachments` branches before the main pipeline. If attachments exist: `Split Attachments` → `Fetch Attachment` (download binary) → `Convert to Content Blocks` (build Anthropic image/document blocks). Else: `Inject Empty Content Blocks` (set `content_blocks: []`). Both merge at `Merge Attachment Branches`.

`Build Claude Request` reads `content_blocks` from `Merge Attachment Branches` and builds the multi-modal messages array.

---

## Failure Patterns & Gotchas

### Silent credential revert
After every workflow reimport via n8n UI, all credential fields revert to `{}`. Run `validate-workflow.js` after every reimport. Always check: Postgres cred = `EHBRO07aceirmFzt`, Discord cred = `om7VabWMiA8gC2i3`.

### alwaysOutputData is load-bearing
`Fetch user Preference`, `Fetch Conversation History`, and `Fetch User Memories` must have `alwaysOutputData: true`. Without it, n8n aborts the branch when the Postgres query returns 0 rows (new user, no history, no memories). Silent fail — Bruce stops responding with no error.

### Persist Assistant Message source
Must read `$('Parse Claude Reply').first().json`, NOT `$json`. If the node reads `$json` it gets the last item from the previous node in the merge chain, which may be a memory row or empty.

### Thread replies
All Discord send nodes must use:
`={{ $('Unwrap Body').first().json.thread_id || $('Unwrap Body').first().json.channel_id }}`
Using `$json.channelId` or `$('Channel Router').first().json.channelId` misses threads.

### Personas are inline
Persona text lives in the Channel Router Code node's `PERSONAS` object. The `.md` files in `prompts/channel-personas/` are reference copies only — not loaded at runtime. Editing the .md files has no effect until the Code node is also updated.

### n8n env var triple requirement
To use an env var in a Code or HTTP node: (1) add to `.env`, (2) add to docker-compose n8n `environment:` block, (3) confirm `N8N_BLOCK_ENV_ACCESS_IN_NODE: "false"`. Missing any one step means `$env.VAR_NAME` returns `undefined` silently.

### Replicate auth prefix
Replicate API uses `Token` prefix: `Authorization: Token ${apiKey}`. Not `Bearer`. Using `Bearer` returns 401 with no explanation.

### Skylight OAuth token caching
Skylight access token is cached in `$workflow.staticData.skylightToken` with a 1-hour expiry. If the calendar stops working, deactivate and reactivate the workflow to clear static data (resets the cache, forces re-login).

### docker-compose.yml comment on skylight-mcp service removed
The `household-skylight-mcp` service was removed (sidecar used stdio JSON-RPC, not HTTP — couldn't be called from n8n HTTP node). Calendar now uses direct Skylight REST API calls from n8n Code/HTTP nodes.

### Self-context channels
`SELF_CONTEXT_CHANNELS = ['jake-personal', 'fig', 'jake-ask']` in Build Claude Request — self-context injected here.
`DEV_CONTEXT_CHANNELS = ['jake-personal']` — dev-context injected here only (token budget).

---

## Build Patterns

### Adding a new command

1. Add regex detection in Channel Router (`commandType = 'newcmd'`)
2. Add a new output to Command Switch (increment output count)
3. Add command branch nodes
4. Wire Command Switch new output → first branch node
5. Ensure final branch node connects to a Discord reply node with the thread_id expression
6. Update Channel Router's `calendarArg`-style arg extraction if needed
7. Validate with `validate-workflow.js`
8. Reimport workflow; re-check all credentials

### Adding a new channel/persona

1. Add entry to `ROUTING` in Channel Router Code node
2. Add persona string to `PERSONAS` in Channel Router Code node
3. Add corresponding entry to `config/channel-routing.json` (documentation/reference)
4. Create matching `.md` file in `prompts/channel-personas/` as a human-readable copy
5. Update `channel_routing` Postgres table if it's used anywhere
6. Reimport workflow

### Deploying workflow changes

1. Edit `workflows/discord-bruce.json` locally (Windows dev machine at `C:\dev\household-ai`)
2. Run `node validate-workflow.js` — confirm no MISSING values
3. Commit and push from Windows:
   ```bash
   git add workflows/discord-bruce.json
   git commit -m "..."
   git push
   ```
4. Pull on VPS:
   ```bash
   ssh root@147.182.142.176
   cd ~/household-ai
   git pull
   ```
5. Reimport workflow via n8n API (from VPS):
   ```bash
   N8N_API_KEY=$(grep N8N_API_KEY .env | cut -d= -f2) \
   N8N_BASE_URL=http://127.0.0.1:5678 \
   node scripts/import-workflow.js
   ```
6. **After reimport:** verify all credentials are filled (they silently revert to `{}`). Run the validation check or manually inspect each Postgres and Discord node in the n8n UI.

### Modifying Build Claude Request

The Code node is long (~120 lines). Key sections in order:
1. Self-context constants + auto-search block (top)
2. `const router = $('Channel Router').first().json`
3. History + memory fetch
4. Memory block assembly
5. `selfContextPrefix` conditional + `systemPrompt` construction
6. Speaker prefix helper
7. Messages array build + attachment merge
8. Return block

When adding new system prompt injections: add a new block variable and append it to the `systemPrompt` line. Keep try/catch around any node reference that may not have run (auto-search, attachments).

### Running the import script

```bash
# From VPS, in ~/household-ai directory:
N8N_API_KEY=$(grep N8N_API_KEY .env | cut -d= -f2) N8N_BASE_URL=http://127.0.0.1:5678 node scripts/import-workflow.js
# Script finds discord-bruce.json, PUTs to /api/v1/workflows/{id}, activates it.
# Watch for "credentials reverted" — always check after import.
```

---

## Tool Delegation

| Task | Primary Tool | Notes |
|---|---|---|
| Edit workflow JSON | **Claude Code** | Reads/edits files directly; runs validation script |
| Bulk workflow changes | **Claude Code** | Writes transformation scripts (apply-workflow-changes.js pattern) |
| Deploy to VPS | **Claude Code** | git push from Windows; SSH command for git pull + import on VPS |
| Validate workflow | **Claude Code** | `node validate-workflow.js` |
| Explore codebase | **Claude Code** | Glob/Grep across repo |
| n8n UI edits (one-off) | n8n browser UI | Fine for quick persona tweaks; always reimport the JSON after |
| Postgres queries (debug) | SSH + psql | `docker compose exec postgres psql -U n8n household` |
| Docker ops | SSH | `docker compose up/down/logs/ps` |
| Inspect relay logs | SSH | `docker compose logs -f discord-relay` |

Claude Code is the primary execution environment for all code and workflow changes. All edits go through the repo (`C:\dev\household-ai` on Windows, `~/household-ai` on VPS) — never edit files directly on the VPS outside of git.

---

## Postgres Quick Reference

```sql
-- Recent conversations (last 20 across all channels)
SELECT channel_name, discord_username, role, LEFT(content,80), created_at
FROM discord_conversations ORDER BY created_at DESC LIMIT 20;

-- User memories
SELECT u.discord_username, m.content, m.created_at
FROM user_memories m JOIN discord_conversations u ON m.user_id = u.discord_user_id
GROUP BY u.discord_username, m.content, m.created_at ORDER BY m.created_at DESC;

-- Model preferences
SELECT * FROM user_model_preferences ORDER BY updated_at DESC;

-- Get family Discord IDs
SELECT DISTINCT discord_user_id, discord_username FROM discord_conversations
WHERE discord_username IS NOT NULL ORDER BY discord_username;
```

Connect: `docker compose exec postgres psql -U n8n household`
