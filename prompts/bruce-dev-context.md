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

### Why memories have a visibility_scope (separate from scope)
Migration 008 adds `visibility_scope ∈ {dm, private, shared}` to `user_memories`. The existing `scope` column describes *how* a memory was written (user/channel/auto); `visibility_scope` describes *where* it's allowed to surface. Without this split, anything Jake told Bruce in #fig (work) could leak into #family.

Classification is assigned at write time based on the channel the memory was learned in:
- **dm** — learned in a DM; surfaces only in DM conversations with that user
- **private** — learned in a personal channel (jake-personal, fig, jake-ask, loubi-personal, wis, loubi-ask, joce-personal, joce-school, joce-ask, nana-personal, nana-ask); surfaces across all of that person's personal channels + their DMs, NOT in group/shared channels
- **shared** — learned in a group/shared channel (general, family, announcements, food, travel, cps); surfaces everywhere including group/shared channels

Fetch User Memories enforces the filter at read time. Both Save User Memory (/remember) and Insert Auto Memory stamp `visibility_scope` based on the Channel Router's classification.

### Why Google Calendar instead of Skylight
Skylight's API is unofficial and reverse-engineered. The OAuth PKCE flow required a pure-JS SHA-256 implementation (no Web Crypto in n8n's task-runner sandbox), and even after that, `Uint8Array` spread syntax was blocked, requiring `Array.from()` workarounds. The integration kept hitting new sandbox restrictions with each fix. Google Calendar uses an official API with a first-class n8n node — no Code node crypto gymnastics, no sandbox issues, no fragile reverse-engineered endpoints.

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
**Fix:** Pin n8n version in docker-compose.yml via N8N_VERSION env var. Currently pinned to 2.16.1.

### Watchtower silently upgraded n8n, breaking rollback
**Symptom:** After running `docker compose up -d --build discord-relay`, n8n login failed with `column User.role does not exist`.
**Cause:** Watchtower had auto-upgraded n8n from 1.84.3 → 2.16.1, which ran DB migrations that renamed `role` → `roleSlug` (with FK). The compose up re-pulled the `1.84.3` tag (which Docker Hub had updated to a new build) and reverted the container, but the DB schema was now incompatible with 1.84.3's entity model.
**Fix:** Removed watchtower entirely. Pinned N8N_VERSION=2.16.1 in .env. All service updates are now manual. `docker compose up -d --build <service>` re-pulls other service images too — always confirm version pins before running it.

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

### Skylight calendar integration — abandoned
**Symptom / history:** Multiple rounds of sandbox workarounds: URLSearchParams missing → manual encode; TextEncoder missing → charCodeAt loop; crypto.subtle missing → inline FIPS 180-4 SHA-256; `$workflow.staticData` undefined → try/catch guard; `...sha256(bytes)` Uint8Array spread blocked → Array.from() + apply(). Each fix exposed the next sandbox restriction.
**Cause:** Skylight's API is unofficial/reverse-engineered, requiring a full PKCE OAuth flow in pure JS inside n8n's restricted Code node sandbox. The sandbox blocks too many APIs needed for crypto.
**Fix:** Removed all Skylight nodes (Build Skylight Request, Authenticate Skylight, Call Skylight API, Parse Skylight Reply). Replaced with n8n's built-in Google Calendar node against johnson2016family@gmail.com. Official API, first-class n8n node, no sandbox issues.

### Build Claude Request SyntaxError — backslash escape loss in Node.js heredocs
**Symptom:** n8n execution fails with "SyntaxError: Invalid or unexpected token" at the systemPrompt assembly line in Build Claude Request.
**Cause:** When constructing a JS string via a Node.js `<< 'SCRIPT'` heredoc, writing `'\\n\\n'` in the script produces two real newline characters (charcode 10), NOT the two-char escape sequence `\n\n`. These real newlines inside a single-quoted JS string literal are a syntax error.
**Fix:** Use `String.fromCharCode(92) + 'n'` to construct `\n` unambiguously. Example: `const BS = String.fromCharCode(92); const NL = BS + 'n';`. Confirmed the chars are [92, 110] (backslash + n), not [10] (newline). This applies to ANY backslash escape you want to appear literally in generated code strings.

### n8n Template literal backslash loss
**Symptom:** `\S` or `\/` written inside a Node.js template literal that generates workflow code becomes just `S` or `/` — the backslash is dropped.
**Cause:** Unrecognized escape sequences in template literals are silently ignored (non-strict mode).
**Fix:** Use `RegExp()` constructor instead of regex literals in generated Code node strings. For URL patterns, use `new RegExp('(^|[\\\\s(])(https?://[^\\\\s<>"]+)', 'g')` — the four backslashes in the Node.js string become two in the workflow JSON, which become one each in the runtime regex.

### DM relay duplicate — both raw handler and messageCreate firing
**Symptom:** Every DM to Bruce got relayed to n8n twice, producing two replies from Bruce for every DM.
**Cause:** discord-relay listens on the raw Discord gateway `MESSAGE_CREATE` event to catch DMs reliably (discord.js's `messageCreate` sometimes skips DMs depending on intent/partials config). Once both code paths started firing, every DM went through both.
**Fix:** The raw gateway listener short-circuits in `messageCreate` via a short-lived de-dupe set keyed on Discord message ID; only one path relays per message. See commits 0542e34 and 7be860c.

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

### Adding a new Discord channel — classify it for memory scoping
Every new channel must be classified in TWO places or memory visibility breaks:
1. **Channel Router constants (`PRIVATE_CHANNELS` or `SHARED_CHANNELS`)** — determines what `visibility_scope` gets stamped on memories written from that channel.
2. **Fetch User Memories SQL `IN (...)` list** — if the new channel is *private*, add its name to the list on the `visibility_scope='private'` branch so private memories can surface there.

Skipping step 1 → memories learned in the new channel fall back to `shared` and leak into group channels.
Skipping step 2 → private memories won't surface when the user is in the new channel.

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
- DM support: discord-relay forwards DMs with channel_name='dm', is_dm=true; Channel Router routes to 'dm' persona (always-respond, sonnet); typing indicator always shown in DMs
- Channel routing with 18 channels across 7 categories + DM routing
- 14 inline personas (13 channel + 1 DM — all with explicit web-search capability notice; never claims to lack real-time data)
- Commands: /use, /remember, /forget, /memories, /clear, /image, /image --hd, /search, /help, /save-recipe, /recipes, /status, /private, /purge
- Memory visibility scoping via `visibility_scope` (dm / private / shared) — learned scope is assigned at write time based on originating channel; read-time filter in Fetch User Memories enforces it (migration 008). /memories displays 🔒 / 👤 / 👥 next to each memory.
- /private incognito mode — per-user+channel flag disables conversation + memory persistence while on. /private off deletes Bruce's messages from the session via Discord REST API.
- /purge — bulk-delete recent channel messages (server: Discord bulk-delete for msgs <14d old; DMs: Bruce's own messages only, Discord restriction).
- /calendar via n8n Google Calendar node (johnson2016family@gmail.com) — credential setup pending, sub-calendar IDs pending
- Auto-search (Detect Search Intent): URLs, sports/scores, live events, "tonight", "right now", "happening now", "today", near-me queries
- Citation URLs from /search wrapped in `<>` to suppress Discord rich embeds
- Auto-search URL hint in Build Claude Request (Claude told to wrap URLs in `<>` when citing)
- Long reply splitting: Parse Claude Reply splits replies >1900 chars into chunks, sends multiple Discord messages instead of truncating
- Recipe list splitting: Format Recipes Reply Code node splits long recipe lists across multiple messages
- /status includes last n8n error: pipeline is Query Status → Fetch Last n8n Error (HTTP GET to n8n API) → Format Status Reply (requires N8N_API_KEY in docker-compose n8n env block)
- Auto memory extraction via Haiku (post-conversation, background)
- Cross-channel memory (all memories for a user, regardless of channel)
- Duplicate memory prevention (unique index + ON CONFLICT DO NOTHING)
- Conversation history with speaker attribution in shared channels
- Date/time context in every system prompt
- Current speaker identification
- Document/image vision via Claude (attachments converted to content blocks)
- Workflow import/deploy scripts
- scripts/cleanup-channels.js: audit and delete duplicate/uncategorized Discord channels (dry run by default, --apply to execute)

### What's in progress or recently added
- Google Calendar integration — workflow nodes built, awaiting OAuth credential creation in n8n UI and sub-calendar ID population in Parse Calendar Cmd node
- DM support shipped — needs real-world testing (first DM conversation will validate routing, memory, history)

### What's pending (not started)
- Google Calendar OAuth credential setup (see runbook.md → Calendar section)
- Sub-calendar IDs in Parse Calendar Cmd node (Elliot, Henry, Joce, Loubi, Nana, Violette)
- Proactive reminders (scheduled Bruce messages — needs scheduler design)
- Email integration (iCloud → Gmail forwarding → n8n Gmail nodes)
- Nana Discord onboarding (ID: 1495888856078225528, categories exist, needs View Channel permission)
- Joce Discord onboarding (ID: 638831837245997066, same process)
- GitHub Actions CI/CD (auto-deploy on push)
- Postgres nightly backup strategy
- Tailscale for remote VPS access
- Mac Mini M5 Pro migration (expected Sept-Oct 2026)
- Rotate exposed Replicate API key
- Discord thread auto-archive configuration (script exists at scripts/set-thread-archive.js; needs Manage Channels permission granted to bot first)
- Discord channel cleanup (scripts/cleanup-channels.js exists — run `DISCORD_BOT_TOKEN=... DISCORD_SERVER_ID=... node scripts/cleanup-channels.js --apply` to remove duplicate #general)

### Larger features on the roadmap
- **Custom UI dashboard** — a web UI on top of Postgres/n8n for browsing memories by scope, inspecting conversation history, managing recipes, toggling feature flags, and viewing system status. Bruce's Discord surface is great for chatting but not for curation or bulk management. No start date yet.

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
