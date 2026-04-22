/**
 * apply-batch-7.js
 *
 * Applies memory-scoping + /private + /purge workflow changes to
 * workflows/discord-bruce.json. One script covers all workflow-side work
 * for migration 008 so we can deploy as one batch.
 *
 * Run with: node apply-batch-7.js
 */

const fs = require('fs');
const path = require('path');

const WORKFLOW_PATH = path.join(__dirname, 'workflows', 'discord-bruce.json');
const workflow = JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf8'));

const GUILD_ID       = '1495249842778148954';
const DISCORD_CRED   = 'om7VabWMiA8gC2i3';
const POSTGRES_CRED  = 'EHBRO07aceirmFzt';
const THREAD_CHANNEL_EXPR =
  "={{ $('Unwrap Body').first().json.thread_id || $('Unwrap Body').first().json.channel_id }}";

// Channel classification lists used by both Channel Router logic and by the
// Fetch User Memories SQL guard. Keep these in sync.
const PRIVATE_CHANNELS = [
  'jake-personal','fig','jake-ask',
  'loubi-personal','wis','loubi-ask',
  'joce-personal','joce-school','joce-ask',
  'nana-personal','nana-ask',
];
const SHARED_CHANNELS = [
  'general','family','announcements','food','travel','cps',
];

function nodeByName(name) {
  return workflow.nodes.find(n => n.name === name);
}
function upsertNode(name, build) {
  const existing = workflow.nodes.find(n => n.name === name);
  if (existing) {
    const built = build(existing.position);
    Object.assign(existing.parameters = existing.parameters || {}, built.parameters || {});
    if (built.credentials) existing.credentials = built.credentials;
    if (built.type) existing.type = built.type;
    if (built.typeVersion) existing.typeVersion = built.typeVersion;
    if (built.webhookId) existing.webhookId = built.webhookId;
    if (typeof built.alwaysOutputData === 'boolean') existing.alwaysOutputData = built.alwaysOutputData;
    if (built.onError) existing.onError = built.onError;
    return existing;
  }
  const node = build(null);
  workflow.nodes.push(node);
  return node;
}

// ---------------------------------------------------------------------------
// 1. Channel Router — add visibilityScope, /private + /purge parsing,
//    session flags lookup, skipPersist propagation
// ---------------------------------------------------------------------------
const routerNode = nodeByName('Channel Router');
if (!routerNode) throw new Error('Channel Router node not found');
let code = routerNode.parameters.jsCode;

// -- 1a. Extend CMD_RE to include private + purge
code = code.replace(
  /const CMD_RE = \/\^\\\/\(use\|remember\|forget\|memories\|clear\|image\|search\|calendar\|help\|save-recipe\|recipes\|status\)\(\?:\\s\+\(\[\\s\\S\]\*\)\)\?\$\/i;/,
  "const CMD_RE = /^\\/(use|remember|forget|memories|clear|image|search|calendar|help|save-recipe|recipes|status|private|purge)(?:\\s+([\\s\\S]*))?$/i;"
);

// -- 1b. Add PRIVATE_CHANNELS / SHARED_CHANNELS constants + visibilityScope
//        computation + session-flag read near the top, just above `const msg`
const SCOPE_BLOCK = `
// Visibility-scope classification for user_memories (migration 008).
// Private channels: memories from here surface only in the owner's personal
// channels/DMs. Shared channels: surface everywhere. DMs: DM-only.
const PRIVATE_CHANNELS = ${JSON.stringify(PRIVATE_CHANNELS)};
const SHARED_CHANNELS  = ${JSON.stringify(SHARED_CHANNELS)};

`;
code = code.replace(
  /\/\/ ----+\n\/\/ Parse incoming message\./,
  SCOPE_BLOCK + '// ----------------------------------------------------------------------------\n// Parse incoming message.'
);

// -- 1c. After isDm is computed, compute visibilityScope + skipPersist
//        from session flags
const VISIBILITY_BLOCK = `
// visibilityScope: where memories written here are allowed to surface.
let visibilityScope = 'shared';
if (isDm) visibilityScope = 'dm';
else if (PRIVATE_CHANNELS.includes(channelName)) visibilityScope = 'private';
else if (SHARED_CHANNELS.includes(channelName)) visibilityScope = 'shared';

// skipPersist: set true while the user is in /private mode in this channel.
// Populated by upstream Query Session Flags node (alwaysOutputData=true).
let skipPersist = false;
let privateStartedAt = null;
try {
  const flagRows = $('Query Session Flags').all().map(i => i.json).filter(r => r && r.flag_name);
  const pm = flagRows.find(r => r.flag_name === 'private_mode');
  if (pm && String(pm.flag_value).toLowerCase() === 'true') skipPersist = true;
  const ps = flagRows.find(r => r.flag_name === 'private_started_at');
  if (ps) privateStartedAt = ps.flag_value;
} catch (_) { /* node absent — default to not-private */ }

`;
code = code.replace(
  /const isDm = msg\.is_dm === true;\nconst route = /,
  `const isDm = msg.is_dm === true;\n${VISIBILITY_BLOCK}const route = `
);

// -- 1d. Add variable declarations for new command outputs
code = code.replace(
  /let recipesQuery = null;/,
  `let recipesQuery = null;
let privateArg   = null;        // 'on' | 'off' | null (toggle)
let purgeArg     = null;        // parsed purge count/mode: number or 'all'`
);

// -- 1e. Add /private and /purge parsing — inject before "// Response gating"
const PRIVATE_PURGE_PARSE = `
  if (cmd === 'private') {
    commandType = 'private';
    const lower = arg.toLowerCase();
    if (lower === 'on' || lower === 'off') {
      privateArg = lower;
    } else if (!arg) {
      privateArg = null;           // toggle (read current state downstream)
    } else {
      commandType  = 'reply-only';
      commandReply = 'Usage: \\\`/private on\\\` | \\\`/private off\\\` | \\\`/private\\\` (toggle).';
    }
  }

  if (cmd === 'purge') {
    commandType = 'purge';
    const lower = arg.toLowerCase();
    if (!arg) {
      purgeArg = 50;
    } else if (lower === 'all') {
      purgeArg = 'all';
    } else {
      const n = parseInt(arg, 10);
      if (Number.isNaN(n) || n <= 0) {
        commandType  = 'reply-only';
        commandReply = 'Usage: \\\`/purge\\\` (last 50) | \\\`/purge <N>\\\` (max 100) | \\\`/purge all\\\` (all <14 days old).';
      } else {
        purgeArg = Math.min(n, 100);
      }
    }
  }

`;
code = code.replace(
  /\/\/ ----+\n\/\/ Response gating \(only applied when no command matched\)/,
  PRIVATE_PURGE_PARSE +
    '// ----------------------------------------------------------------------------\n' +
    '// Response gating (only applied when no command matched)'
);

// -- 1f. Add fields to the return json
code = code.replace(
  /recipesQuery,\n    commandReply,/,
  `recipesQuery,
    commandReply,
    visibilityScope,
    skipPersist,
    privateArg,
    privateStartedAt,
    purgeArg,
    isDm,`
);

routerNode.parameters.jsCode = code;
console.log('[1] Channel Router updated (scope classification, /private, /purge, skipPersist)');

// ---------------------------------------------------------------------------
// 2. Add Query Session Flags node between Fetch user Preference and
//    Channel Router, so Channel Router can read session state.
// ---------------------------------------------------------------------------
upsertNode('Query Session Flags', (pos) => ({
  parameters: {
    operation: 'executeQuery',
    query: "SELECT flag_name, flag_value, updated_at\nFROM user_session_flags\nWHERE discord_user_id = '{{ $('Unwrap Body').first().json.author.id }}'\n  AND channel_id = '{{ $('Unwrap Body').first().json.channel_id }}';",
    options: {},
  },
  type: 'n8n-nodes-base.postgres',
  typeVersion: 2.6,
  position: pos || [-1280, 80],
  id: '80000000-0000-0000-0000-000000000001',
  name: 'Query Session Flags',
  alwaysOutputData: true,
  credentials: { postgres: { id: POSTGRES_CRED, name: 'Household Postgres' } },
}));

// Rewire: Fetch user Preference → Query Session Flags → Channel Router
workflow.connections['Fetch user Preference'] = {
  main: [[{ node: 'Query Session Flags', type: 'main', index: 0 }]]
};
workflow.connections['Query Session Flags'] = {
  main: [[{ node: 'Channel Router', type: 'main', index: 0 }]]
};
console.log('[2] Query Session Flags wired before Channel Router');

// ---------------------------------------------------------------------------
// 3. Fetch User Memories — scope-aware filter
// ---------------------------------------------------------------------------
const fetchMem = nodeByName('Fetch User Memories');
if (!fetchMem) throw new Error('Fetch User Memories node not found');
fetchMem.parameters.query =
  "SELECT id, scope, visibility_scope, channel_name, content\n" +
  "FROM user_memories\n" +
  "WHERE discord_user_id = '{{ $('Channel Router').first().json.userId }}'\n" +
  "  AND (\n" +
  "    channel_name = '{{ $('Channel Router').first().json.channelName }}'\n" +
  "    OR visibility_scope = 'shared'\n" +
  "    OR (visibility_scope = 'private' AND '{{ $('Channel Router').first().json.channelName }}' IN ('jake-personal','fig','jake-ask','loubi-personal','wis','loubi-ask','joce-personal','joce-school','joce-ask','nana-personal','nana-ask'))\n" +
  "    OR (visibility_scope = 'dm' AND '{{ $('Channel Router').first().json.isDm }}' = 'true')\n" +
  "  )\n" +
  "ORDER BY created_at DESC\n" +
  "LIMIT 50;";
console.log('[3] Fetch User Memories query scope-filtered');

// ---------------------------------------------------------------------------
// 4. Save User Memory (/remember) — include visibility_scope
// ---------------------------------------------------------------------------
const saveMem = nodeByName('Save User Memory');
if (!saveMem) throw new Error('Save User Memory node not found');
saveMem.parameters.query =
  "INSERT INTO user_memories\n" +
  "  (discord_user_id, scope, visibility_scope, channel_id, channel_name, content)\n" +
  "VALUES\n" +
  "  ('{{ $json.userId }}', 'channel', '{{ $json.visibilityScope }}',\n" +
  "   '{{ $json.memoryScopeId }}',\n" +
  "   '{{ $json.memoryScopeName }}',\n" +
  "   '{{ $json.rememberText.replace(/'/g, \"''\") }}');";
console.log('[4] Save User Memory carries visibility_scope');

// ---------------------------------------------------------------------------
// 5. Insert Auto Memory — include visibility_scope, honor skipPersist
// ---------------------------------------------------------------------------
const insertAuto = nodeByName('Insert Auto Memory');
if (!insertAuto) throw new Error('Insert Auto Memory node not found');
insertAuto.parameters.query =
  "INSERT INTO user_memories\n" +
  "  (discord_user_id, scope, visibility_scope, channel_id, channel_name, content)\n" +
  "SELECT\n" +
  "  '{{ $json.userId }}',\n" +
  "  'auto',\n" +
  "  '{{ $('Channel Router').first().json.visibilityScope }}',\n" +
  "  '{{ $json.memoryScopeId }}',\n" +
  "  '{{ ($json.memoryScopeName || '').replace(/'/g, \"''\") }}',\n" +
  "  '{{ ($json.memoryContent || '').replace(/'/g, \"''\") }}'\n" +
  "WHERE length(trim('{{ ($json.memoryContent || '').replace(/'/g, \"''\") }}')) > 0\n" +
  "  AND '{{ $('Channel Router').first().json.skipPersist }}' != 'true'\n" +
  "ON CONFLICT (discord_user_id, LOWER(content)) DO NOTHING;";
console.log('[5] Insert Auto Memory carries visibility_scope + skipPersist guard');

// ---------------------------------------------------------------------------
// 6. Persist User Message — honor skipPersist
// ---------------------------------------------------------------------------
const persistUser = nodeByName('Persist User Message');
if (!persistUser) throw new Error('Persist User Message node not found');
persistUser.parameters.query =
  "INSERT INTO discord_conversations\n" +
  "  (message_id, discord_user_id, discord_username, channel_id, channel_name, thread_id, thread_name, role, content)\n" +
  "SELECT\n" +
  "  '{{ $json.messageId }}',\n" +
  "  '{{ $json.userId }}',\n" +
  "  '{{ ($json.userName || '').replace(/'/g, \"''\") }}',\n" +
  "  '{{ $json.channelId }}',\n" +
  "  '{{ $json.channelName }}',\n" +
  "  {{ $json.isThread ? \"'\" + $json.threadId + \"'\"     : 'NULL' }},\n" +
  "  {{ $json.isThread ? \"'\" + $json.threadName + \"'\"   : 'NULL' }},\n" +
  "  'user',\n" +
  "  '{{ ($json.contentForPersist || '').replace(/'/g, \"''\") }}'\n" +
  "WHERE length(trim('{{ ($json.contentForPersist || '').replace(/'/g, \"''\") }}')) > 0\n" +
  "  AND '{{ $('Channel Router').first().json.skipPersist }}' != 'true'\n" +
  "ON CONFLICT (message_id) DO UPDATE\n" +
  "  SET content = EXCLUDED.content,\n" +
  "      discord_username = EXCLUDED.discord_username\n" +
  "  WHERE length(trim(EXCLUDED.content)) > 0;";
console.log('[6] Persist User Message honors skipPersist');

// ---------------------------------------------------------------------------
// 7. Persist Assistant Message — honor skipPersist (convert VALUES → SELECT)
// ---------------------------------------------------------------------------
const persistAsst = nodeByName('Persist Assistant Message');
if (!persistAsst) throw new Error('Persist Assistant Message node not found');
persistAsst.parameters.query =
  "INSERT INTO discord_conversations\n" +
  "  (message_id, discord_user_id, discord_username, channel_id, channel_name, thread_id, thread_name, role, content)\n" +
  "SELECT\n" +
  "  '{{ $('Parse Claude Reply').first().json.messageId }}_reply',\n" +
  "  '{{ $('Parse Claude Reply').first().json.userId }}',\n" +
  "  'Bruce',\n" +
  "  '{{ $('Parse Claude Reply').first().json.channelId }}',\n" +
  "  '{{ $('Parse Claude Reply').first().json.channelName }}',\n" +
  "  {{ $('Parse Claude Reply').first().json.isThread ? \"'\" + $('Parse Claude Reply').first().json.threadId + \"'\"     : 'NULL' }},\n" +
  "  {{ $('Parse Claude Reply').first().json.isThread ? \"'\" + $('Parse Claude Reply').first().json.threadName + \"'\" : 'NULL' }},\n" +
  "  'assistant',\n" +
  "  '{{ $('Parse Claude Reply').first().json.reply.replace(/'/g, \"''\") }}'\n" +
  "WHERE '{{ $('Channel Router').first().json.skipPersist }}' != 'true'\n" +
  "ON CONFLICT (message_id) DO UPDATE\n" +
  "  SET content = EXCLUDED.content,\n" +
  "      discord_username = EXCLUDED.discord_username;";
console.log('[7] Persist Assistant Message honors skipPersist');

// ---------------------------------------------------------------------------
// 8. List User Memories + Format Memories List — show scope icon
// ---------------------------------------------------------------------------
const listMem = nodeByName('List User Memories');
if (!listMem) throw new Error('List User Memories node not found');
listMem.parameters.query =
  "SELECT id, scope, visibility_scope, channel_name, content, created_at\n" +
  "FROM user_memories\n" +
  "WHERE discord_user_id = '{{ $json.userId }}'\n" +
  "ORDER BY created_at DESC\n" +
  "LIMIT 50;";

const fmtMem = nodeByName('Format Memories List');
if (!fmtMem) throw new Error('Format Memories List node not found');
fmtMem.parameters.jsCode =
  "// Format the user's memory list for a Discord reply. Empty list gets a\n" +
  "// friendly note instead of a blank message. Prefixes each memory with a\n" +
  "// visibility-scope icon (migration 008): dm=lock, private=head, shared=people.\n" +
  "const rows   = $input.all().map(i => i.json);\n" +
  "const router = $('Channel Router').first().json;\n" +
  "\n" +
  "if (!rows.length || (rows.length === 1 && !rows[0].id)) {\n" +
  "  return [{ json: { ...router, commandReply: 'You don\\'t have any saved memories yet. Use `/remember <text>` to add one.' } }];\n" +
  "}\n" +
  "\n" +
  "const ICONS = { dm: '\\uD83D\\uDD12', private: '\\uD83D\\uDC64', shared: '\\uD83D\\uDC65' };\n" +
  "const lines = rows.map(r => {\n" +
  "  const icon = ICONS[r.visibility_scope] || ICONS.private;\n" +
  "  const where = r.channel_name ? `(${r.channel_name})` : '';\n" +
  "  return `${icon} \\`#${r.id}\\` ${where} — ${r.content}`;\n" +
  "});\n" +
  "\n" +
  "let out = '**Your memories:**\\n' + lines.join('\\n');\n" +
  "if (out.length > 1900) out = out.slice(0, 1900) + '\\n… (truncated — run `/memories` after pruning with `/forget`)';\n" +
  "\n" +
  "return [{ json: { ...router, commandReply: out } }];";
console.log('[8] /memories shows visibility scope icon');

// ---------------------------------------------------------------------------
// 9. Command Switch — add rules for 'private' and 'purge'
// ---------------------------------------------------------------------------
const cmdSwitch = nodeByName('Command Switch');
if (!cmdSwitch) throw new Error('Command Switch node not found');
const rules = cmdSwitch.parameters.rules.values;

function addRule(outputKey) {
  const exists = rules.some(r =>
    r.conditions && r.conditions.conditions &&
    r.conditions.conditions.some(c => c.rightValue === outputKey)
  );
  if (exists) return;
  rules.push({
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [
        {
          id: `sw-${outputKey}`,
          leftValue: '={{ $json.commandType }}',
          rightValue: outputKey,
          operator: { type: 'string', operation: 'equals' },
        },
      ],
      combinator: 'and',
    },
    renameOutput: true,
    outputKey,
  });
}
addRule('private');
addRule('purge');
console.log('[9] Command Switch rules added for private + purge');

// ---------------------------------------------------------------------------
// 10. /private pipeline — Parse Private Cmd → Save Private Flag →
//     Cleanup Bot Messages (pass-through) → Reply Private
// ---------------------------------------------------------------------------
const PARSE_PRIVATE_CODE =
  "// Parse /private — decide desired new mode (on/off), build commandReply.\n" +
  "// Upstream Channel Router has already read current flag state via Query\n" +
  "// Session Flags and surfaced it as router.skipPersist (true if currently\n" +
  "// private). privateArg is 'on' | 'off' | null (toggle).\n" +
  "const router = $('Channel Router').first().json;\n" +
  "const wasPrivate = router.skipPersist === true;\n" +
  "const arg = router.privateArg;  // null means toggle\n" +
  "\n" +
  "let newValue;\n" +
  "if (arg === 'on') newValue = true;\n" +
  "else if (arg === 'off') newValue = false;\n" +
  "else newValue = !wasPrivate;\n" +
  "\n" +
  "const turnedOff = wasPrivate && !newValue;\n" +
  "const nowIso = new Date().toISOString();\n" +
  "\n" +
  "let commandReply;\n" +
  "if (newValue) {\n" +
  "  commandReply = '\\uD83D\\uDD12 Private mode on — this conversation won\\'t be saved or remembered.';\n" +
  "} else if (turnedOff) {\n" +
  "  commandReply = '\\uD83D\\uDD13 Private mode off — my messages from this session have been deleted. Back to normal.';\n" +
  "} else {\n" +
  "  commandReply = '\\uD83D\\uDD13 Private mode off — back to normal.';\n" +
  "}\n" +
  "\n" +
  "return [{ json: {\n" +
  "  ...router,\n" +
  "  privateNewValue: newValue ? 'true' : 'false',\n" +
  "  privateNewValueBool: newValue,\n" +
  "  privateTurnedOff: turnedOff,\n" +
  "  privateStartedAtNew: newValue ? (router.privateStartedAt || nowIso) : nowIso,\n" +
  "  commandReply,\n" +
  "} }];";

upsertNode('Parse Private Cmd', (pos) => ({
  parameters: { jsCode: PARSE_PRIVATE_CODE },
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: pos || [-672, 1760],
  id: '81000000-0000-0000-0000-000000000001',
  name: 'Parse Private Cmd',
}));

// Save Private Flag — UPSERT private_mode and private_started_at in one call.
upsertNode('Save Private Flag', (pos) => ({
  parameters: {
    operation: 'executeQuery',
    query:
      "INSERT INTO user_session_flags (discord_user_id, channel_id, flag_name, flag_value, updated_at)\n" +
      "VALUES\n" +
      "  ('{{ $json.userId }}', '{{ $json.channelId }}', 'private_mode',       '{{ $json.privateNewValue }}', NOW()),\n" +
      "  ('{{ $json.userId }}', '{{ $json.channelId }}', 'private_started_at', '{{ $json.privateStartedAtNew }}', NOW())\n" +
      "ON CONFLICT (discord_user_id, channel_id, flag_name) DO UPDATE\n" +
      "  SET flag_value = EXCLUDED.flag_value,\n" +
      "      updated_at = NOW();",
    options: {},
  },
  type: 'n8n-nodes-base.postgres',
  typeVersion: 2.6,
  position: pos || [-448, 1760],
  id: '81000000-0000-0000-0000-000000000002',
  name: 'Save Private Flag',
  credentials: { postgres: { id: POSTGRES_CRED, name: 'Household Postgres' } },
}));

// Cleanup Bot Messages — pass-through Code node that deletes the bot's
// messages posted during the private session if the user just turned it off.
// Uses Discord REST API directly via fetch (n8n task-runner sandbox supports
// fetch per CLAUDE.md). Bot token read from env (DISCORD_BOT_TOKEN).
const CLEANUP_BOT_CODE =
  "// Cleanup Bot Messages — delete the bot's messages sent during a /private\n" +
  "// session, triggered on /private off. Pass-through when privateTurnedOff\n" +
  "// is false so the reply still goes out.\n" +
  "const router = $('Parse Private Cmd').first().json;\n" +
  "const passthrough = [{ json: router }];\n" +
  "\n" +
  "if (!router.privateTurnedOff) return passthrough;\n" +
  "\n" +
  "const BOT_TOKEN   = $env.DISCORD_BOT_TOKEN;\n" +
  "const BOT_USER_ID = '1495252972026859520';\n" +
  "const channelId   = router.channelId;\n" +
  "const sinceIso    = router.privateStartedAt;  // original session start\n" +
  "if (!BOT_TOKEN || !channelId || !sinceIso) return passthrough;\n" +
  "\n" +
  "const headers = {\n" +
  "  Authorization: 'Bot ' + BOT_TOKEN,\n" +
  "  'User-Agent': 'household-ai (bruce, 1.0)',\n" +
  "};\n" +
  "\n" +
  "try {\n" +
  "  const listRes = await fetch('https://discord.com/api/v10/channels/' + channelId + '/messages?limit=100', { headers });\n" +
  "  if (!listRes.ok) return passthrough;\n" +
  "  const messages = await listRes.json();\n" +
  "  const sinceMs = Date.parse(sinceIso);\n" +
  "  const targets = (messages || []).filter(m =>\n" +
  "    m && m.author && m.author.id === BOT_USER_ID &&\n" +
  "    Date.parse(m.timestamp) >= sinceMs\n" +
  "  );\n" +
  "  for (const m of targets) {\n" +
  "    try {\n" +
  "      await fetch('https://discord.com/api/v10/channels/' + channelId + '/messages/' + m.id, { method: 'DELETE', headers });\n" +
  "    } catch (_) { /* swallow per-message failures */ }\n" +
  "  }\n" +
  "} catch (_) { /* swallow list failures */ }\n" +
  "\n" +
  "return passthrough;";

upsertNode('Cleanup Bot Messages', (pos) => ({
  parameters: { jsCode: CLEANUP_BOT_CODE },
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: pos || [-224, 1760],
  id: '81000000-0000-0000-0000-000000000003',
  name: 'Cleanup Bot Messages',
}));

// Reply Private
upsertNode('Reply Private', (pos) => ({
  parameters: {
    resource: 'message',
    guildId: { __rl: true, value: GUILD_ID, mode: 'id' },
    channelId: { __rl: true, value: THREAD_CHANNEL_EXPR, mode: 'id' },
    content: '={{ $json.commandReply }}',
    options: {},
  },
  type: 'n8n-nodes-base.discord',
  typeVersion: 2,
  position: pos || [0, 1760],
  id: '81000000-0000-0000-0000-000000000004',
  name: 'Reply Private',
  webhookId: 'c3a9b842-7211-4c9d-9a21-8e2d3f7b1010',
  credentials: { discordBotApi: { id: DISCORD_CRED, name: 'Discord Bot account' } },
}));

// Wire /private pipeline
workflow.connections['Parse Private Cmd'] = {
  main: [[{ node: 'Save Private Flag', type: 'main', index: 0 }]]
};
workflow.connections['Save Private Flag'] = {
  main: [[{ node: 'Cleanup Bot Messages', type: 'main', index: 0 }]]
};
workflow.connections['Cleanup Bot Messages'] = {
  main: [[{ node: 'Reply Private', type: 'main', index: 0 }]]
};
console.log('[10] /private pipeline built');

// ---------------------------------------------------------------------------
// 11. /purge pipeline — Purge Messages → Reply Purge
// ---------------------------------------------------------------------------
const PURGE_CODE =
  "// Purge Messages — delete recent messages in the current channel via\n" +
  "// Discord REST API. Server channels use bulk-delete (messages <14d old);\n" +
  "// DMs fall back to deleting only the bot's own messages (Discord does\n" +
  "// not allow bots to delete other users' DM messages).\n" +
  "const router  = $('Channel Router').first().json;\n" +
  "const arg     = router.purgeArg;            // number | 'all'\n" +
  "const isDm    = router.isDm === true;\n" +
  "const BOT_TOKEN   = $env.DISCORD_BOT_TOKEN;\n" +
  "const BOT_USER_ID = '1495252972026859520';\n" +
  "const channelId   = router.channelId;\n" +
  "\n" +
  "if (!BOT_TOKEN || !channelId) {\n" +
  "  return [{ json: { ...router, commandReply: '\\u274C Could not reach Discord — missing bot token or channel.' } }];\n" +
  "}\n" +
  "\n" +
  "const headers = {\n" +
  "  Authorization: 'Bot ' + BOT_TOKEN,\n" +
  "  'Content-Type': 'application/json',\n" +
  "  'User-Agent': 'household-ai (bruce, 1.0)',\n" +
  "};\n" +
  "\n" +
  "const limitToFetch = arg === 'all' ? 100 : Math.min(arg, 100);\n" +
  "const cutoffMs     = Date.now() - 14 * 24 * 3600 * 1000;\n" +
  "\n" +
  "async function listMessages() {\n" +
  "  const r = await fetch('https://discord.com/api/v10/channels/' + channelId + '/messages?limit=' + limitToFetch, { headers });\n" +
  "  if (!r.ok) return [];\n" +
  "  return await r.json();\n" +
  "}\n" +
  "\n" +
  "async function deleteOne(id) {\n" +
  "  try {\n" +
  "    await fetch('https://discord.com/api/v10/channels/' + channelId + '/messages/' + id, { method: 'DELETE', headers });\n" +
  "    return true;\n" +
  "  } catch (_) { return false; }\n" +
  "}\n" +
  "\n" +
  "async function bulkDelete(ids) {\n" +
  "  if (ids.length === 0) return 0;\n" +
  "  if (ids.length === 1) return (await deleteOne(ids[0])) ? 1 : 0;\n" +
  "  try {\n" +
  "    const r = await fetch('https://discord.com/api/v10/channels/' + channelId + '/messages/bulk-delete', {\n" +
  "      method: 'POST', headers, body: JSON.stringify({ messages: ids }),\n" +
  "    });\n" +
  "    return r.ok ? ids.length : 0;\n" +
  "  } catch (_) { return 0; }\n" +
  "}\n" +
  "\n" +
  "let deleted = 0;\n" +
  "let dmNote  = '';\n" +
  "\n" +
  "try {\n" +
  "  const messages = await listMessages();\n" +
  "  if (isDm) {\n" +
  "    const mine = messages.filter(m => m.author && m.author.id === BOT_USER_ID);\n" +
  "    for (const m of mine) { if (await deleteOne(m.id)) deleted++; }\n" +
  "    dmNote = '\\nDiscord doesn\\'t allow bots to delete your messages in DMs — you can delete yours by right-clicking them (they disappear from both sides).';\n" +
  "  } else {\n" +
  "    const recent = messages.filter(m => Date.parse(m.timestamp) >= cutoffMs);\n" +
  "    const bulkable = recent.filter(m => Date.parse(m.timestamp) >= cutoffMs).map(m => m.id);\n" +
  "    // bulk-delete only supports 2..100 messages <14d old\n" +
  "    const chunks = [];\n" +
  "    for (let i = 0; i < bulkable.length; i += 100) chunks.push(bulkable.slice(i, i + 100));\n" +
  "    for (const chunk of chunks) deleted += await bulkDelete(chunk);\n" +
  "  }\n" +
  "} catch (_) { /* swallow */ }\n" +
  "\n" +
  "const body = '\\uD83D\\uDDD1\\uFE0F Deleted ' + deleted + ' message' + (deleted === 1 ? '' : 's') + '.' + dmNote +\n" +
  "  '\\n\\n_History in Postgres is untouched — run \\\\`/clear\\\\` to also wipe conversation history._';\n" +
  "\n" +
  "return [{ json: { ...router, commandReply: body } }];";

upsertNode('Purge Messages', (pos) => ({
  parameters: { jsCode: PURGE_CODE },
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position: pos || [-672, 1920],
  id: '82000000-0000-0000-0000-000000000001',
  name: 'Purge Messages',
}));

upsertNode('Reply Purge', (pos) => ({
  parameters: {
    resource: 'message',
    guildId: { __rl: true, value: GUILD_ID, mode: 'id' },
    channelId: { __rl: true, value: THREAD_CHANNEL_EXPR, mode: 'id' },
    content: '={{ $json.commandReply }}',
    options: {},
  },
  type: 'n8n-nodes-base.discord',
  typeVersion: 2,
  position: pos || [-448, 1920],
  id: '82000000-0000-0000-0000-000000000002',
  name: 'Reply Purge',
  webhookId: 'c3a9b842-7211-4c9d-9a21-8e2d3f7b1011',
  credentials: { discordBotApi: { id: DISCORD_CRED, name: 'Discord Bot account' } },
}));

workflow.connections['Purge Messages'] = {
  main: [[{ node: 'Reply Purge', type: 'main', index: 0 }]]
};
console.log('[11] /purge pipeline built');

// ---------------------------------------------------------------------------
// 12. Rewire Command Switch outputs to include private + purge
// ---------------------------------------------------------------------------
// Switch has 12 pre-existing rules (indices 0..11). New rules we just added
// are private (12) and purge (13). The existing fallback (Should Respond?)
// stays as the final main array. Rebuild the whole main array to insert
// before the existing fallback.
const csConns = workflow.connections['Command Switch'];
if (!csConns) throw new Error('Command Switch connections missing');
// Existing main shape: [use, remember, forget, memories, clear, image,
//   search, reply-only, calendar, save-recipe, recipes, status, fallback]
// Desired: [..., status, private, purge, fallback]
const main = csConns.main;
const fallback = main[main.length - 1];
const newMain = main.slice(0, 12).concat([
  [{ node: 'Parse Private Cmd', type: 'main', index: 0 }],
  [{ node: 'Purge Messages',    type: 'main', index: 0 }],
  fallback,
]);
csConns.main = newMain;
console.log('[12] Command Switch outputs: private→Parse Private Cmd, purge→Purge Messages');

// ---------------------------------------------------------------------------
// 13. Update /help reply to include /private and /purge
// ---------------------------------------------------------------------------
let routerCode = routerNode.parameters.jsCode;
routerCode = routerCode.replace(
  /`\/status` — system health \(jake channels only\)\\n`\/help` — show this message/,
  "`/status` — system health (jake channels only)\\n`/private on` / `/private off` / `/private` — toggle incognito mode (no history, no memory; bot messages are deleted on /private off)\\n`/purge [N]` / `/purge all` — delete recent messages in this channel (server: bulk-delete; DMs: only my own)\\n`/help` — show this message"
);
routerNode.parameters.jsCode = routerCode;
console.log('[13] /help updated with /private + /purge');

// ---------------------------------------------------------------------------
// Write workflow back
// ---------------------------------------------------------------------------
fs.writeFileSync(WORKFLOW_PATH, JSON.stringify(workflow, null, 2), 'utf8');
console.log(`\nDone. Nodes=${workflow.nodes.length}, connection-keys=${Object.keys(workflow.connections).length}`);
