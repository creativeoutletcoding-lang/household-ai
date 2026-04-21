# Bruce Build Spec — April 21, 2026 (v2)

Hand this file to Claude Code in `C:\dev\household-ai` to execute these changes.
Read the entire spec before starting. Execution order is at the bottom.

---

## CRITICAL: Pre-Flight — Fix Git State

The working tree has a stale lock and corrupted index. Fix this FIRST before any file changes.

```powershell
Remove-Item C:\dev\household-ai\.git\index.lock -Force
cd C:\dev\household-ai
git reset HEAD -- .
git status   # verify clean index, no phantom deletions
```

Verify that `skylight-mcp/package.json`, `workflows/discord-bruce.json`, and `workflows/perplexity-search.json` show as unmodified or correctly modified — NOT as staged deletions.

---

## CRITICAL: Guardrails (Non-Negotiable)

Every change to `workflows/discord-bruce.json` MUST preserve ALL of these. Violating any one will break the workflow silently:

1. Every Postgres node: `"credentials":{"postgres":{"id":"EHBRO07aceirmFzt","name":"Household Postgres"}}`
2. Every Discord node: `"credentials":{"discordBotApi":{"id":"om7VabWMiA8gC2i3","name":"Discord Bot account"}}`
3. All Discord nodes hardcode guild ID `1495249842778148954` (never `$env.DISCORD_SERVER_ID`)
4. Bot user ID `1495252972026859520` is hardcoded everywhere (never `$env.DISCORD_BOT_USER_ID`)
5. `alwaysOutputData: true` on Fetch User Preference, Fetch Conversation History, Fetch User Memories
6. Persist Assistant Message reads from `$('Parse Claude Reply').first().json`, not `$json`
7. **PERSONAS in Channel Router contain full persona content inline, not references to .md files**
8. Replicate API auth uses `Token` prefix (not `Bearer`)
9. n8n env vars require: (a) entry in `.env`, (b) mapping in docker-compose `environment:` block, (c) `N8N_BLOCK_ENV_ACCESS_IN_NODE: "false"`

---

## 1. Delete Skylight MCP Sidecar (Dead End)

The `@eaglebyte/skylight-mcp` package speaks stdio JSON-RPC, not HTTP. The container would boot, wait for stdin, and sit idle. The HTTP node would hang and time out.

**Delete entirely:**
```
C:\dev\household-ai\skylight-mcp\Dockerfile
C:\dev\household-ai\skylight-mcp\package.json
```
Remove the entire `skylight-mcp/` directory.

**docker-compose.yml:**
- Remove the entire `household-skylight-mcp:` service block (~15 lines)
- KEEP `SKYLIGHT_FRAME_ID` and `SKYLIGHT_TIMEZONE` in the n8n `environment:` block (needed for direct API calls)

---

## 2. Create Bruce Self-Context File

**File:** `prompts/bruce-self-context.md`

**Purpose:** Condensed project reference injected into Bruce's system prompt on Jake's channels so Bruce can help build/debug/extend the system.

**Contents (~1,500-2,000 tokens max, terse structured format):**

- Infrastructure: VPS at 147.182.142.176, Ubuntu 24.04, Caddy reverse proxy (host), Docker services (postgres 16, n8n 1.84.3, open-webui, discord-relay, watchtower)
- Domain: creativeoutletcoding.com (subdomains: n8n, chat)
- GitHub: creativeoutletcoding-lang/household-ai
- Discord server ID: 1495249842778148954, Bot ID: 1495252972026859520
- Channel structure: categories (SHARED, FAM, CPS, JAKE, LOUBI, JOCE, NANA), behavior modes (always-respond vs mention-only)
- Workflow: ~48 nodes. Webhook -> Unwrap -> Fetch Preference -> Channel Router -> Command Switch (10 outputs: use, remember, forget, memories, clear, image, search, calendar, reply-only, default chat)
- Chat branch: Should Respond? -> Auto-Search Detection -> Fetch History -> Fetch Memories -> Build Claude Request -> Call Claude -> Parse Reply -> Reply + Persist User + Persist Assistant
- Personas are INLINE in Channel Router node, not in separate .md files
- Postgres schema: discord_conversations, user_model_preferences, user_memories
- Key file paths: docker-compose.yml, .env, config/channel-routing.json, workflows/discord-bruce.json, prompts/
- Credential IDs: Postgres EHBRO07aceirmFzt, Discord om7VabWMiA8gC2i3
- Available commands: /use, /remember, /forget, /memories, /clear, /image, /image --hd, /search, /calendar
- Model strings: haiku=claude-haiku-4-5-20251001, sonnet=claude-sonnet-4-6, opus=claude-opus-4-7
- Gotchas: the top 10 from project instructions + guardrails list above
- Family: Jake (admin, Falls Church/Merrifield VA), Loubi/Laurianne (WIS), Joce (high school), Nana (CPS), Elliot/Henry/Violette (calendar only)

---

## 3. Update Channel Personas (INLINE in Workflow JSON)

**File:** `workflows/discord-bruce.json`
**Target:** Channel Router node — the PERSONAS object inside the Code node's JavaScript

**IMPORTANT:** Persona .md files in `prompts/channel-personas/` are NOT used by the workflow. All persona edits must happen inside the Channel Router node's inline code.

**For Jake's personas (jake-personal, fig, jake-ask), add to the persona text:**

```
Available tools — suggest these naturally when relevant:
- /search <query> — web search via Perplexity (also auto-triggers for real-time queries)
- /image <prompt> — generate image via Flux Schnell
- /image --hd <prompt> — HD image via Flux Pro
- /remember <fact> — save a long-term memory
- /memories — list saved memories
- /calendar — view/manage family calendar

User context:
- Jake lives in Falls Church / Merrifield, Virginia
- For "near me" queries, search is automatically scoped to this area
```

**For ALL personas, add a general behavior note:**

```
You are Bruce, the household AI. Your channel has a topic focus but you are not limited to it. Handle normal conversation, relay messages, and be socially aware. Never say "that's outside my lane" or "I'm just the [topic] guy." If someone tags another family member, you know who they are.
```

**User identity mapping — add to the system prompt (not persona-specific):**

```
Family member Discord IDs:
- Jake: [get user ID from discord_conversations table or relay logs]
- Laurianne/Loubi: [get user ID]
- Joce: [get user ID]
- Nana: [get user ID]

When a message contains <@USER_ID>, resolve it to the person's name. Never say "unfamiliar name" or "whoever that is" for family members.
```

**NOTE:** You'll need to look up the actual Discord user IDs. Check the `discord_conversations` table or the relay logs on the VPS. The relay passes `discord_user_id` in the webhook payload — the Build Claude Request node should map these to names.

---

## 4. Fix All Reply Nodes to Respect thread_id

**File:** `workflows/discord-bruce.json`

**Bug:** When commands (/search, /image, /remember, etc.) are used in a private thread, replies go to the parent channel instead of the thread.

**Fix:** Check EVERY Discord reply node across ALL command branches. The Channel field must use:

```
{{ $('Unwrap Body').first().json.thread_id || $('Unwrap Body').first().json.channel_id }}
```

**Branches to check:**
- Reply Confirmation (use branch)
- Reply Confirmation (remember branch)
- Reply Confirmation (forget branch)
- Reply List (memories branch)
- Reply Image (image branch)
- Reply Search (search branch)
- Reply Calendar (calendar branch)
- Reply on Discord (main chat branch) — probably already correct, use as reference

---

## 5. Add Auto-Search Detection (Perplexity)

**File:** `workflows/discord-bruce.json`

**Purpose:** Automatically detect messages needing real-time/location info, run Perplexity search, and inject results into the Claude request. No /search command needed.

**Where:** Add between "Should Respond?" and "Fetch Conversation History" (or parallel with history fetch).

**New node — "Detect Search Intent" (Code node):**

```javascript
const message = $input.first().json.content.toLowerCase();

const searchPatterns = [
  /near me|near here|near us|around here/i,
  /\b(latest|recent|current|today'?s?|this week|this month|right now)\b/i,
  /\b(news|score|price|weather|stock|update)\b/i,
  /\b(where can i|where to|best place|recommend.*restaurant|recommend.*shop)\b/i,
  /\b(who (is|are) (the current|currently))\b/i,
  /\b(is .+ (open|closed|available))\b/i,
  /\b(how much (does|is|are))\b/i,
  /\b(what('s| is) (happening|going on))\b/i,
];

const needsSearch = searchPatterns.some(p => p.test(message));

let searchQuery = $input.first().json.content;
if (/near me|near here|near us|around here/i.test(message)) {
  searchQuery += ' Falls Church Merrifield VA';
}

return [{
  json: {
    ...$input.first().json,
    needs_search: needsSearch,
    search_query: searchQuery
  }
}];
```

**New node — "Auto-Search IF" (IF node):**
- Condition: `{{ $json.needs_search }}` equals `true`
- True path: call Perplexity API (reuse the same HTTP Request pattern from the /search branch — same endpoint, same auth, same payload structure, just using `search_query` from above)
- False path: proceed directly

**Both paths converge at Build Claude Request.** Modify that node to check if auto-search results are present. If so, prepend them to the system prompt as:

```
<auto_search_results>
The following web search was automatically performed for context:
Query: [search_query]
Results: [perplexity response]
Use these results to inform your answer. Cite specific details naturally.
</auto_search_results>
```

---

## 6. Build Direct Skylight Calendar Integration

**File:** `workflows/discord-bruce.json`

**Context:** The /calendar command's Channel Router regex and Command Switch output (index 8) already exist. Reply Calendar node exists and is correctly configured. The middle nodes (Build Skylight Request, Call Skylight MCP, Parse Skylight Reply) need to be REPLACED with direct API calls.

**Source of truth for the Skylight API:** Clone or read `fergbrain/skylight-mcp` branch `auth-update`, specifically `src/api/auth.ts` and `src/api/client.ts`. These contain the OAuth flow, endpoint paths, headers, and payload shapes.

**New/replacement nodes:**

### 6a. Build Skylight Request (Code node — may already exist, replace logic)
Parse `calendarArg` from Channel Router. Detect operation:
- `/calendar` or `/calendar list` — list events for the frame
- `/calendar add <details>` — create event
- `/calendar remove <id or description>` — delete event
- `/calendar update <id> <changes>` — update event

Emit `{operation, params}` object.

### 6b. Authenticate Skylight (Code node — NEW)
- Use `$env.SKYLIGHT_EMAIL`, `$env.SKYLIGHT_PASSWORD`, `$env.SKYLIGHT_FRAME_ID`
- Perform OAuth login per the auth flow in `fergbrain/skylight-mcp` `src/api/auth.ts`
- Cache token in `$workflow.staticData` with expiry
- On 401, clear cache and re-authenticate
- Return access token for subsequent HTTP nodes

### 6c. HTTP Request node(s) — NEW
- Call Skylight calendar endpoints directly using the access token
- Endpoints and payloads per `src/api/client.ts` in the fergbrain fork
- List, create, update, delete operations

### 6d. Parse Skylight Reply (Code node — may already exist, replace logic)
- Format API response into Discord-friendly message
- Date/time formatting per `$env.SKYLIGHT_TIMEZONE` (or default America/New_York)
- Emoji-formatted event list for readability

### 6e. Reply Calendar — EXISTS, correctly configured
- Cred: `om7VabWMiA8gC2i3`, guild: `1495249842778148954`
- **Ensure thread_id support** (see item #4)

---

## 7. Wire Self-Context into Build Claude Request

**File:** `workflows/discord-bruce.json`
**Target node:** Build Claude Request (Code node)

**Change:** Read the self-context content and prepend it to the system prompt ONLY for channels: jake-personal, fig, jake-ask.

**Logic in the Code node:**

```javascript
const selfContextChannels = ['jake-personal', 'fig', 'jake-ask'];
const channelName = /* however channel_name is accessed in this node */;

let systemPrompt = '';

if (selfContextChannels.includes(channelName)) {
  const selfContext = `<bruce_system_context>
[contents of prompts/bruce-self-context.md]
</bruce_system_context>

`;
  systemPrompt = selfContext;
}

// Then append the channel persona as before
systemPrompt += existingPersonaContent;
```

**Note:** Since this is an n8n Code node, you can't read files from disk at runtime. Options:
1. Inline the self-context content directly in the Code node (simpler, but means edits require workflow reimport)
2. Store it in a Postgres table and fetch it (more complex but editable without reimport)
3. Use n8n's "Read Binary File" node before the Code node (adds a node but keeps content in a file)

Option 1 is fine for now. When the self-context changes, you update the Code node.

---

## 8. Update runbook.md

**Rewrite the `## Calendar (Skylight MCP)` section** to describe the direct-API approach:
- No sidecar container
- Auth flow via n8n Code node using Skylight OAuth
- Token caching in workflow static data
- /calendar command syntax and operations
- Env vars needed: SKYLIGHT_EMAIL, SKYLIGHT_PASSWORD, SKYLIGHT_FRAME_ID, SKYLIGHT_TIMEZONE

---

## 9. Update docker-compose.yml

- Remove entire `household-skylight-mcp:` service block
- Keep SKYLIGHT_FRAME_ID and SKYLIGHT_TIMEZONE in n8n environment block
- Verify all other services unchanged

---

## Items NOT in This Spec (Deferred)

- **Thread auto-archive configuration** — Jake wants to understand UX first
- **Category/channel expansion** (e.g., WEALTH category) — deferred until auto-archive decided
- **Auto model switching by complexity** — defer until auto-search is working
- **Rotate Replicate API key** — manual task (Bitwarden + VPS .env)
- **Open WebUI fixes** (roles, signups, memory, Perplexity) — separate workstream
- **Nana/Joce Discord onboarding** — separate workstream
- **Discord document/image reading** (relay attachment support + Claude vision) — future
- **Shared memory between Discord and Open WebUI** — future
- **Postgres backup strategy** — future
- **Tailscale remote access** — future

---

## Execution Order

### Phase 1 — Unblock and clean up
1. Fix git state (remove lock, reset index)
2. Delete `skylight-mcp/` directory
3. Remove skylight-mcp service from docker-compose.yml

### Phase 2 — Standalone files
4. Create `prompts/bruce-self-context.md`
5. Update `runbook.md` calendar section

### Phase 3 — Workflow JSON changes (discord-bruce.json)

**IMPORTANT INSTRUCTION FOR CLAUDE CODE:**
Complete each sub-phase below, then STOP and run the validation check before moving to the next sub-phase. Do not proceed if validation fails. The workflow JSON must parse cleanly and pass the specific checks after every sub-phase.

**Validation script to run after each sub-phase:**
```javascript
// Save as validate-workflow.js and run with: node validate-workflow.js
const fs = require('fs');
const workflow = JSON.parse(fs.readFileSync('workflows/discord-bruce.json', 'utf8'));
console.log(`Nodes: ${workflow.nodes.length}`);
console.log(`Connections keys: ${Object.keys(workflow.connections).length}`);

// Check all Discord nodes have hardcoded guild + cred
const discordNodes = workflow.nodes.filter(n => n.type?.includes('discord'));
discordNodes.forEach(n => {
  const guild = n.parameters?.guildId?.value || n.parameters?.guildId || 'MISSING';
  const cred = n.credentials?.discordBotApi?.id || 'MISSING';
  console.log(`Discord node "${n.name}": guild=${guild}, cred=${cred}`);
});

// Check Postgres creds
const pgNodes = workflow.nodes.filter(n => n.type?.includes('postgres'));
pgNodes.forEach(n => {
  const cred = n.credentials?.postgres?.id || 'MISSING';
  console.log(`Postgres node "${n.name}": cred=${cred}`);
});

console.log('Validation complete — review output above for MISSING values');
```

#### Phase 3a — Fix reply nodes for thread_id (item #4)
Update the Channel field on EVERY Discord reply/send node across ALL command branches to use:
```
{{ $('Unwrap Body').first().json.thread_id || $('Unwrap Body').first().json.channel_id }}
```
**Branches to check:** use, remember, forget, memories, clear, image, search, calendar, main chat reply.
**Validation:** Run validate-workflow.js. Manually confirm each reply node's Channel parameter contains the thread_id expression.

#### Phase 3b — Update inline personas in Channel Router (item #3)
Edit the Channel Router Code node's PERSONAS object:
- Add available commands and user context to Jake's channel personas (jake-personal, fig, jake-ask)
- Add general behavior note to ALL personas ("You are Bruce... never say that's outside my lane...")
- Add family member Discord user ID → name mapping to the system prompt assembly (look up IDs from discord_conversations table on VPS or ask Jake)
- Add mention resolution logic: when message contains `<@USER_ID>`, resolve to name
**Validation:** Run validate-workflow.js. Read the Channel Router node's code and confirm persona text includes the new content.

#### Phase 3c — Add auto-search detection (item #5)
Add two new nodes between "Should Respond?" and "Fetch Conversation History":
1. "Detect Search Intent" (Code node) — pattern matching logic from item #5 spec
2. "Auto-Search IF" (IF node) — routes to Perplexity call or bypasses
3. "Auto-Search Perplexity" (HTTP Request node) — same pattern as existing /search branch
Both paths must converge before Build Claude Request.
Modify Build Claude Request to check for and include auto-search results in system prompt.
**Validation:** Run validate-workflow.js. Confirm new nodes exist. Trace wiring: Should Respond → Detect Search Intent → Auto-Search IF → (true: Auto-Search Perplexity →) Build Claude Request.

#### Phase 3d — Wire self-context into Build Claude Request (item #7)
Modify Build Claude Request Code node to conditionally prepend self-context for channels: jake-personal, fig, jake-ask.
Inline the contents of `prompts/bruce-self-context.md` (created in Phase 2) as a string constant in the Code node.
Wrap in `<bruce_system_context>` XML tags.
**Validation:** Run validate-workflow.js. Read Build Claude Request code and confirm channel check + self-context block exist.

#### Phase 3e — Replace Skylight calendar nodes with direct API (item #6)
Read `fergbrain/skylight-mcp` branch `auth-update` (specifically `src/api/auth.ts` and `src/api/client.ts`) to understand the auth flow and API endpoints.
Replace the existing dead nodes (Build Skylight Request, Call Skylight MCP, Parse Skylight Reply) with:
1. Build Skylight Request (Code) — parse operation from calendarArg
2. Authenticate Skylight (Code) — OAuth login, token cached in $workflow.staticData
3. Call Skylight API (HTTP Request) — direct endpoint calls
4. Parse Skylight Reply (Code) — format for Discord
Ensure Reply Calendar node (already exists) has thread_id support (should be done in Phase 3a).
**Validation:** Run validate-workflow.js. Confirm calendar pipeline wired: Command Switch output 8 → Build Skylight Request → Authenticate → Call API → Parse → Reply Calendar. Confirm auth node references correct env vars.

### Phase 4 — Deploy

**Step 1 — Commit and push:**
```bash
cd C:\dev\household-ai
git add -A
git status  # review carefully — no phantom deletions, no unexpected changes
git diff --cached --stat  # verify file list makes sense
git commit -m "feat: self-context, auto-search, thread fixes, persona updates, direct skylight API"
git push
```

**Step 2 — Deploy on VPS:**
```bash
ssh root@147.182.142.176
cd ~/household-ai
git pull
docker compose up -d  # picks up docker-compose.yml changes (skylight-mcp removed)
# Reimport workflow via n8n UI: Settings > Import Workflow > paste discord-bruce.json
# IMPORTANT: After reimport, verify all credentials are filled (they silently revert to {})
# Check: every Postgres node has cred EHBRO07aceirmFzt, every Discord node has cred om7VabWMiA8gC2i3
```

**Step 3 — Post-deploy verification (test each in Discord):**
- [ ] Send "what's for lunch near me" in #jake-personal → auto-search triggers, response includes Falls Church area results
- [ ] Use /search in a private thread → reply lands in the thread, not parent channel
- [ ] Use /image in a private thread → reply lands in the thread
- [ ] Use /remember in a private thread → confirmation lands in the thread
- [ ] Ask Bruce "what services are you running?" in #jake-personal → references infrastructure from self-context
- [ ] Tag @Laurianne in a message to Bruce → Bruce knows who she is, responds appropriately
- [ ] Send a simple greeting in #food → Bruce responds naturally, doesn't say "I'm just the food guy"
- [ ] Run /calendar list → returns events (if Skylight auth works)
- [ ] Run /calendar in a thread → reply lands in thread
- [ ] Verify /memories, /use, /forget still work normally
