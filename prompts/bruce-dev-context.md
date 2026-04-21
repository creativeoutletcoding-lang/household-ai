# Bruce Development Context

Injected into Jake's channels (jake-personal, fig, jake-ask) so Bruce can help plan, debug, and extend himself. This is institutional memory, not just facts.

---

## Architecture Decisions and Rationale

### Why custom discord-relay instead of n8n Discord Trigger
The n8n community Discord Trigger node was unreliable — dropped messages, missed events, no thread support. A custom discord.js Gateway relay (discord-relay/index.js) was built instead. It normalizes payloads, handles threads, shows typing indicators, and POSTs to n8n's webhook. This is load-bearing infrastructure — do not suggest replacing it with native n8n nodes.

### Why personas are inline in Channel Router, not .md files
n8n Code nodes cannot read files from disk at runtime. Early attempts to reference prompts/channel-personas/*.md files failed silently. All persona content lives inside the Channel Router node's PERSONAS object in the workflow JSON. The .md files in prompts/channel-personas/ exist for documentation only — they are NOT read by the workflow. Any persona edit must happen in the Channel Router Code node inside discord-bruce.json.

### Why Haiku for auto memory extraction
Cost. Memory extraction runs on every conversation turn as a background call after the main reply is sent. Using Sonnet or Opus for this would double the API cost with no meaningful quality improvement — Haiku reliably extracts structured facts from conversation context. The extraction prompt is tuned to err on the side of capturing rather than skipping.

### Why cross-scope dedup on memories
The unique index is on (discord_user_id, LOWER(content)) with no scope column. A fact is a fact regardless of whether it came from /remember (scope='channel') or auto extraction (scope='auto'). If Jake /forgets a memory (hard DELETE), the auto extractor can re-learn it naturally in a future conversation — the index no longer blocks after the row is gone.

### Why direct Skylight API instead of MCP container
The @eaglebyte/skylight-mcp package uses stdio JSON-RPC transport, not HTTP. When containerized, it boots, authenticates, then waits on stdin — no HTTP server to call from n8n. The container would restart in a loop. The fix is calling Skylight's API directly from n8n Code nodes using the OAuth flow from fergbrain's auth-update fork (PR #39 on TheEagleByte/skylight-mcp).

### Why Google Calendar was deferred
Skylight is the family's source of truth for calendar data. Google Calendar was empty and Skylight's two-way sync doesn't retroactively push existing events. Rather than fight the sync or manually re-enter events, Bruce connects to Skylight directly. Google Calendar may be revisited if Skylight's API becomes unstable (it's unofficial and reverse-engineered).

### Why workflow import via script instead of UI
The n8n UI import requires manual credential verification on every node after import — credentials silently revert to {}. The import script (scripts/import-workflow.js) pushes via the n8n REST API and validates credential IDs programmatically. Always use N8N_BASE_URL=http://127.0.0.1:5678 on the VPS — Node 18's fetch implementation fails with localhost.

---

## Failure Log — Things That Broke and How They Were Fixed

### Credential revert on workflow reimport
**Symptom:** Workflow imported cleanly but all API calls fail silently.
**Cause:** n8n clears credential bindings on import. Every Postgres and Discord node reverts to {}.
**Fix:** After every reimport, verify credentials on all nodes. The import script checks this automatically. Credential IDs: Postgres=EHBRO07aceirmFzt, Discord=om7VabWMiA8gC2i3.

### Empty content poisoning conversation history
**Symptom:** Claude API rejects requests with "messages.N: user messages must have non-empty content."
**Cause:** Image-only messages were stored with content='' in discord_conversations. When replayed as history, the empty row broke the next Claude call.
**Fix:** Channel Router now substitutes '[shared an image or file]' via contentForPersist. Build Claude Request filters out any remaining empty rows with a defensive filter.

### Bot mention detection failing silently
**Symptom:** Bruce doesn't respond in mention-only channels even when @mentioned.
**Cause:** Using $env.DISCORD_BOT_USER_ID which silently returns undefined in n8n expressions.
**Fix:** Hardcode bot user ID 1495252972026859520 everywhere. Same for guild ID 1495249842778148954. Never use $env for these.

### Persist Assistant Message reading wrong data
**Symptom:** Assistant replies stored as {success: true} instead of actual content.
**Cause:** Node was reading $json (output of Persist User Message = {success: true}) instead of reaching back to Parse Claude Reply.
**Fix:** Always use $('Parse Claude Reply').first().json for the assistant content.

### Auto memory extraction not saving (scope='auto' rejected)
**Symptom:** Memory extraction pipeline runs end-to-end but INSERT fails silently.
**Cause:** Postgres CHECK constraint only allowed scope='user' and scope='channel'. The 'auto' value was rejected.
**Fix:** Migration 006 drops and recreates both check constraints to allow 'user', 'channel', and 'auto'. Insert Auto Memory node now has ON CONFLICT (discord_user_id, LOWER(content)) DO NOTHING.

### n8n dbTime.getTime log spam
**Symptom:** Container logs flooded with "TypeError: dbTime.getTime is not a function" from WaitTracker.
**Cause:** n8n :latest pulled a version with a Postgres timestamp compatibility bug.
**Fix:** Pin n8n version in docker-compose.yml via N8N_VERSION env var. Currently pinned to 1.84.3 (may be stale — check Docker Hub for current stable).

### Node 18 fetch fails with localhost on VPS
**Symptom:** Scripts using fetch('http://localhost:5678/...') fail with "fetch failed".
**Cause:** Ubuntu's Node 18 package has a known issue resolving localhost.
**Fix:** Always use 127.0.0.1 instead of localhost. Example: N8N_BASE_URL=http://127.0.0.1:5678.

### Replicate API auth failure
**Symptom:** /image command returns 401.
**Cause:** Replicate uses Token prefix, not Bearer.
**Fix:** Auth header in Call Replicate node must be "Token {{ $env.REPLICATE_API_TOKEN }}", not "Bearer".

### Thread replies going to parent channel
**Symptom:** Command responses (/search, /image, etc.) appear in the parent channel when used inside a thread.
**Cause:** Reply nodes were using Channel Router's channelId which points to the parent. Thread replies need to go to threadId.
**Fix:** All Discord reply nodes must use: {{ thread_id || channelId }} pattern.

---

## Build Patterns

### Adding a new slash command
1. Add detection in Channel Router's CMD_RE regex and command parsing block
2. Add a new output on Command Switch (increment the output index)
3. Wire: Command Switch output → action nodes → Reply node
4. Reply node must use thread_id || channelId for the Channel field
5. Hardcode guild ID 1495249842778148954 and Discord credential om7VabWMiA8gC2i3
6. If it touches Postgres, use credential EHBRO07aceirmFzt
7. Run validate-workflow.js after changes
8. Import with: N8N_API_KEY=... N8N_BASE_URL=http://127.0.0.1:5678 node scripts/import-workflow.js

### Adding a new Postgres table
1. Create migration file: postgres/migrations/NNN-description.sql
2. Apply manually: docker exec household-postgres psql -U household -d n8n -c "..."
3. Migration file is for tracking/redeployment — apply live SQL first, commit file after

### Editing personas
1. Edit the PERSONAS object inside Channel Router's Code node in discord-bruce.json
2. Do NOT edit prompts/channel-personas/*.md — those are documentation only
3. Reimport the workflow after changes

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
   ssh root@147.182.142.176 "cd ~/household-ai && git pull"
   ```
5. Import on VPS:
   ```bash
   ssh root@147.182.142.176 "cd ~/household-ai && N8N_API_KEY=\$(grep N8N_API_KEY .env | cut -d= -f2) N8N_BASE_URL=http://127.0.0.1:5678 node scripts/import-workflow.js"
   ```
6. Verify: send a test message in Discord, check `docker compose logs -f n8n`

### Env var access in n8n
Three things must be true for $env.VAR_NAME to work in n8n:
1. Variable exists in .env file
2. Variable is mapped in docker-compose.yml under the n8n service's environment: block
3. N8N_BLOCK_ENV_ACCESS_IN_NODE is set to "false"
Missing any one of these causes silent failure — $env returns undefined with no error.

---

## Project State

### What's shipped and working
- Discord relay with typing indicators, thread support, attachment handling
- Channel routing with 18 channels across 7 categories
- 13 inline personas (general, family, fig, jake-personal, ask, travel, food, cps, loubi-personal, wis, joce-personal, joce-school, nana-personal)
- Commands: /use, /remember, /forget, /memories, /clear, /image, /image --hd, /search
- Auto memory extraction via Haiku (post-conversation, background)
- Cross-channel memory (all memories for a user, regardless of channel)
- Duplicate memory prevention (unique index + ON CONFLICT DO NOTHING)
- Conversation history with speaker attribution in shared channels
- Date/time context in every system prompt
- Current speaker identification
- Document/image vision via Claude (attachments converted to content blocks)
- Workflow import/deploy scripts

### What's in progress or recently added
- Skylight calendar direct API integration (replacing failed MCP approach)
- Auto-search detection (Perplexity triggered by real-time queries)
- Bruce self-context injection for Jake's channels
- Thread_id fix across all command reply nodes

### What's pending (not started)
- /save-recipe and /recipes commands (new Postgres table + workflow branches)
- Proactive reminders (scheduled Bruce messages — needs scheduler design)
- Email integration (iCloud → Gmail forwarding → n8n Gmail nodes)
- Nana Discord onboarding (ID: 1495888856078225528, categories exist, needs View Channel permission)
- Joce Discord onboarding (ID: 638831837245997066, same process)
- GitHub Actions CI/CD (auto-deploy on push)
- Postgres nightly backup strategy
- Tailscale for remote VPS access
- Mac Mini M5 Pro migration (expected Sept-Oct 2026)
- Rotate exposed Replicate API key
- Discord thread auto-archive configuration

### Key people
- Jake (1495249206087127052) — server admin, Account Executive at FIG, runs CPS with Nana, primary builder
- Loubi/Laurianne — works at Washington International School, onboarded to Discord
- Joce (638831837245997066) — high school student, Open WebUI account created, Discord placeholder channels ready
- Nana (1495888856078225528) — runs CPS with Jake, needs Discord onboarding
- Elliot, Henry, Violette — younger kids, calendar profiles only

---

## Tool Delegation

- **Claude Code (primary execution tool):** All file editing, git operations, SSH to VPS, workflow JSON changes, script writing and execution, deploy. Claude Code is the primary tool for building and changing the system — not just a helper.
- **Claude.ai Project ("Household AI"):** Architecture decisions, debugging strategy, planning, reviewing output, project state tracking. Use for thinking through problems; use Claude Code to execute.
- **n8n UI (https://n8n.creativeoutletcoding.com):** Credential management, workflow visualization, manual testing, API key generation
- **Discord:** Testing Bruce's responses, onboarding family members, permission management
