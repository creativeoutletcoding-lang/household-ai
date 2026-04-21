/**
 * apply-workflow-changes.js
 * Applies all Phase 3 changes to workflows/discord-bruce.json per bruce-build-spec-2026-04-21-v2.md
 *
 * Run with: node apply-workflow-changes.js
 */

const fs = require('fs');
const path = require('path');

const WORKFLOW_PATH = path.join(__dirname, 'workflows', 'discord-bruce.json');
const workflow = JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf8'));

// ---------------------------------------------------------------------------
// Phase 3a — Fix all Discord reply nodes to use thread_id fallback
// ---------------------------------------------------------------------------
const THREAD_CHANNEL_EXPR = "={{ $('Unwrap Body').first().json.thread_id || $('Unwrap Body').first().json.channel_id }}";

const DISCORD_REPLY_NODES = [
  'Reply /use Confirmation',
  'Reply Command Confirmation',
  'Reply Memories List',
  'Reply Image Usage',
  'Reply Image',
  'Reply Search',
  'Reply on Discord',
  'Reply Calendar',
];

for (const nodeName of DISCORD_REPLY_NODES) {
  const node = workflow.nodes.find(n => n.name === nodeName);
  if (!node) { console.error(`WARN: node not found: ${nodeName}`); continue; }
  if (!node.parameters) node.parameters = {};
  node.parameters.channelId = { __rl: true, value: THREAD_CHANNEL_EXPR, mode: 'id' };
  console.log(`[3a] Fixed channel in: ${nodeName}`);
}

// ---------------------------------------------------------------------------
// Phase 3b — Update PERSONAS in Channel Router
// ---------------------------------------------------------------------------
const GENERAL_BEHAVIOR_NOTE = `

You are Bruce, the household AI. Your channel has a topic focus but you are not limited to it. Handle normal conversation, relay messages, and be socially aware. Never say "that's outside my lane" or "I'm just the [topic] guy." If someone tags another family member, you know who they are.`;

const JAKE_TOOLS_NOTE = `

Available tools — suggest these naturally when relevant:
- /search <query> — web search via Perplexity (also auto-triggers for real-time queries)
- /image <prompt> — generate image via Flux Schnell
- /image --hd <prompt> — HD image via Flux Pro
- /remember <fact> — save a long-term memory
- /memories — list saved memories
- /calendar — view/manage family calendar

User context:
- Jake lives in Falls Church / Merrifield, Virginia
- For "near me" queries, search is automatically scoped to this area`;

const JAKE_PERSONAS = ['jake-personal', 'fig', 'ask'];

const routerNode = workflow.nodes.find(n => n.name === 'Channel Router');
if (!routerNode) throw new Error('Channel Router node not found');

let routerCode = routerNode.parameters.jsCode;

// Find the PERSONAS object, parse out individual persona strings and append notes.
// Strategy: find each backtick-delimited persona string and append notes before the closing backtick.
// Personas are stored as template literals in the format: 'key': `...`

function appendToPersona(code, personaKey, appendText) {
  // Match: '<key>': `...` (the entire template literal, possibly multiline)
  // We'll find the persona start and locate its closing backtick
  const searchStr = `'${personaKey}': \``;
  const startIdx = code.indexOf(searchStr);
  if (startIdx === -1) {
    console.error(`WARN: persona '${personaKey}' not found in Channel Router`);
    return code;
  }
  const contentStart = startIdx + searchStr.length;

  // Find the closing backtick. Need to handle backticks inside the template literal.
  // The persona strings don't use nested template expressions, so find the next unescaped backtick.
  let depth = 1;
  let i = contentStart;
  while (i < code.length) {
    if (code[i] === '`') {
      depth--;
      if (depth === 0) break;
    } else if (code[i] === '\\' && code[i+1] === '`') {
      i++; // skip escaped backtick
    }
    i++;
  }

  if (depth !== 0) {
    console.error(`WARN: could not find closing backtick for persona '${personaKey}'`);
    return code;
  }

  // Insert appendText before the closing backtick at position i
  return code.slice(0, i) + appendText + code.slice(i);
}

// Get all persona keys
const personaKeyMatch = routerCode.match(/const PERSONAS = \{([\s\S]*?)\n\};/);
const allPersonaKeys = [];
if (personaKeyMatch) {
  const personaBlock = personaKeyMatch[1];
  const keyMatches = [...personaBlock.matchAll(/'([^']+)':\s*`/g)];
  keyMatches.forEach(m => allPersonaKeys.push(m[1]));
}
console.log(`[3b] Found persona keys: ${allPersonaKeys.join(', ')}`);

// Add general behavior note to ALL personas
for (const key of allPersonaKeys) {
  routerCode = appendToPersona(routerCode, key, GENERAL_BEHAVIOR_NOTE);
  console.log(`[3b] Added general behavior note to persona: ${key}`);
}

// Add Jake tools note to Jake-specific personas
for (const key of JAKE_PERSONAS) {
  if (allPersonaKeys.includes(key)) {
    routerCode = appendToPersona(routerCode, key, JAKE_TOOLS_NOTE);
    console.log(`[3b] Added Jake tools note to persona: ${key}`);
  }
}

// Add family member ID mapping note after the PERSONAS block (in the code body)
const FAMILY_ID_COMMENT = `
// ---------------------------------------------------------------------------
// Family member Discord ID → name mapping.
// Fill in actual IDs from discord_conversations table: SELECT DISTINCT discord_user_id, discord_username FROM discord_conversations;
// ---------------------------------------------------------------------------
const FAMILY_MEMBERS = {
  // 'DISCORD_USER_ID': 'Jake',
  // 'DISCORD_USER_ID': 'Laurianne',
  // 'DISCORD_USER_ID': 'Joce',
  // 'DISCORD_USER_ID': 'Nana',
};

function resolveDiscordMention(text) {
  return text.replace(/<@(\d+)>/g, (match, id) => {
    return FAMILY_MEMBERS[id] ? \`@\${FAMILY_MEMBERS[id]}\` : match;
  });
}

`;

// Insert after the PERSONAS closing '};'
const personasEndIdx = routerCode.indexOf('\n};', routerCode.indexOf('const PERSONAS')) + 3;
routerCode = routerCode.slice(0, personasEndIdx) + '\n' + FAMILY_ID_COMMENT + routerCode.slice(personasEndIdx);

// Apply mention resolution to the 'content' field before it's used in the return
// Find the line where content is set and add mention resolution after it
const contentLineMatch = routerCode.match(/const content\s*=\s*[^;]+;/);
if (contentLineMatch) {
  const contentLine = contentLineMatch[0];
  const contentIdx = routerCode.indexOf(contentLine) + contentLine.length;
  routerCode = routerCode.slice(0, contentIdx) + '\n  const contentResolved = resolveDiscordMention(content);\n' + routerCode.slice(contentIdx);
  // Replace content references in the return with contentResolved
  // Only in the return block - replace 'content,' and 'content:' patterns
  const returnIdx = routerCode.lastIndexOf('return [{');
  const beforeReturn = routerCode.slice(0, returnIdx);
  let returnBlock = routerCode.slice(returnIdx);
  returnBlock = returnBlock.replace(/\bcontent,\b/, 'content: contentResolved,');
  routerCode = beforeReturn + returnBlock;
}

routerNode.parameters.jsCode = routerCode;
console.log('[3b] Updated Channel Router PERSONAS and code');

// ---------------------------------------------------------------------------
// Phase 3c — Add auto-search detection nodes
// ---------------------------------------------------------------------------

const DETECT_SEARCH_CODE = `const message = $input.first().json.content || '';

const searchPatterns = [
  /near me|near here|near us|around here/i,
  /\\b(latest|recent|current|today'?s?|this week|this month|right now)\\b/i,
  /\\b(news|score|price|weather|stock|update)\\b/i,
  /\\b(where can i|where to|best place|recommend.*restaurant|recommend.*shop)\\b/i,
  /\\b(who (is|are) (the current|currently))\\b/i,
  /\\b(is .+ (open|closed|available))\\b/i,
  /\\b(how much (does|is|are))\\b/i,
  /\\b(what('s| is) (happening|going on))\\b/i,
];

const needsSearch = searchPatterns.some(p => p.test(message));

let searchQuery = message;
if (/near me|near here|near us|around here/i.test(message)) {
  searchQuery += ' Falls Church Merrifield VA';
}

return [{
  json: {
    ...$input.first().json,
    needs_search: needsSearch,
    search_query: searchQuery,
  }
}];`;

const AUTO_SEARCH_PERPLEXITY_BODY = `={{ JSON.stringify({ model: 'sonar', messages: [{ role: 'user', content: $json.search_query }], return_citations: true }) }}`;

// New nodes to add
const newNodes = [
  {
    parameters: { jsCode: DETECT_SEARCH_CODE },
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: [-900, 1200],
    id: 'aa000000-0000-0000-0000-000000000001',
    name: 'Detect Search Intent',
  },
  {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [
          {
            id: 'aa000000-0000-0000-0000-000000000010',
            leftValue: '={{ $json.needs_search }}',
            rightValue: true,
            operator: { type: 'boolean', operation: 'equals' },
          }
        ],
        combinator: 'and',
      },
      looseTypeValidation: true,
    },
    type: 'n8n-nodes-base.if',
    typeVersion: 2,
    position: [-672, 1200],
    id: 'aa000000-0000-0000-0000-000000000002',
    name: 'Auto-Search IF',
  },
  {
    parameters: {
      method: 'POST',
      url: 'https://api.perplexity.ai/chat/completions',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'Authorization', value: '=Bearer {{ $env.PERPLEXITY_API_KEY }}' },
          { name: 'Content-Type', value: 'application/json' },
        ],
      },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: AUTO_SEARCH_PERPLEXITY_BODY,
      options: { timeout: 30000 },
    },
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [-448, 1296],
    id: 'aa000000-0000-0000-0000-000000000003',
    name: 'Auto-Search Perplexity',
  },
];

// Add new nodes to workflow
newNodes.forEach(n => {
  if (!workflow.nodes.find(existing => existing.name === n.name)) {
    workflow.nodes.push(n);
    console.log(`[3c] Added node: ${n.name}`);
  } else {
    console.log(`[3c] Node already exists: ${n.name}`);
  }
});

// Update connections
// 1. Reroute: Should Respond? output 0 → Detect Search Intent (instead of Fetch Conversation History)
if (workflow.connections['Should Respond?']) {
  workflow.connections['Should Respond?'].main[0] = [
    { node: 'Detect Search Intent', type: 'main', index: 0 }
  ];
  console.log('[3c] Rewired Should Respond? → Detect Search Intent');
}

// 2. Detect Search Intent → Auto-Search IF
workflow.connections['Detect Search Intent'] = {
  main: [[{ node: 'Auto-Search IF', type: 'main', index: 0 }]]
};

// 3. Auto-Search IF:
//    output 0 (true)  → Auto-Search Perplexity
//    output 1 (false) → Fetch Conversation History
workflow.connections['Auto-Search IF'] = {
  main: [
    [{ node: 'Auto-Search Perplexity', type: 'main', index: 0 }],
    [{ node: 'Fetch Conversation History', type: 'main', index: 0 }],
  ]
};

// 4. Auto-Search Perplexity → Fetch Conversation History
workflow.connections['Auto-Search Perplexity'] = {
  main: [[{ node: 'Fetch Conversation History', type: 'main', index: 0 }]]
};

console.log('[3c] Wired auto-search connections');

// ---------------------------------------------------------------------------
// Phase 3d — Update Build Claude Request: self-context + auto-search injection
// ---------------------------------------------------------------------------

// Read the self-context file
const selfContextPath = path.join(__dirname, 'prompts', 'bruce-self-context.md');
const selfContextContent = fs.readFileSync(selfContextPath, 'utf8');
// Escape backticks in the content for embedding in template literal
const selfContextEscaped = selfContextContent.replace(/`/g, '\\`').replace(/\$/g, '\\$');

const buildClaudeNode = workflow.nodes.find(n => n.name === 'Build Claude Request');
if (!buildClaudeNode) throw new Error('Build Claude Request node not found');

let buildClaudeCode = buildClaudeNode.parameters.jsCode;

// Inject self-context and auto-search logic.
// Insert at the top of the code, after the opening comment.

const SELF_CONTEXT_BLOCK = `
// Self-context: injected for Jake's channels only.
const SELF_CONTEXT_CHANNELS = ['jake-personal', 'fig', 'jake-ask'];
const SELF_CONTEXT = \`<bruce_system_context>
${selfContextEscaped}
</bruce_system_context>\`;

`;

const AUTO_SEARCH_BLOCK = `
// Auto-search: inject Perplexity results if auto-search ran upstream.
let autoSearchBlock = '';
try {
  const autoSearchData = $('Detect Search Intent').first().json;
  if (autoSearchData && autoSearchData.needs_search) {
    const perplexityRes = $('Auto-Search Perplexity').first().json;
    let searchAnswer = '';
    try { searchAnswer = perplexityRes.choices[0].message.content || ''; } catch(_) {}
    if (searchAnswer) {
      autoSearchBlock = \`\\n\\n<auto_search_results>
The following web search was automatically performed for context:
Query: \${autoSearchData.search_query}
Results: \${searchAnswer}
Use these results to inform your answer. Cite specific details naturally.
</auto_search_results>\`;
    }
  }
} catch(_) {}

`;

// Find the 'const router = ' line to insert before it
const routerLineIdx = buildClaudeCode.indexOf('const router = ');
if (routerLineIdx === -1) throw new Error('Could not find "const router = " in Build Claude Request');

buildClaudeCode = buildClaudeCode.slice(0, routerLineIdx) + SELF_CONTEXT_BLOCK + AUTO_SEARCH_BLOCK + buildClaudeCode.slice(routerLineIdx);

// Now update the systemPrompt line to use self-context and auto-search.
// The current line: const systemPrompt = (router.systemPrompt || '') + ...
// We need to prepend self-context for Jake channels and append autoSearchBlock.
buildClaudeCode = buildClaudeCode.replace(
  /const systemPrompt = \(router\.systemPrompt \|\| ''\)/,
  `const selfContextPrefix = SELF_CONTEXT_CHANNELS.includes(router.channelName) ? SELF_CONTEXT + '\\n\\n' : '';
const systemPrompt = selfContextPrefix + (router.systemPrompt || '')`
);

// Append auto-search block to system prompt (before return)
// Find '+ dateBlock;' and add autoSearchBlock after it
buildClaudeCode = buildClaudeCode.replace(
  /(\+ dateBlock;)/,
  '+ dateBlock + autoSearchBlock;'
);

buildClaudeNode.parameters.jsCode = buildClaudeCode;
console.log('[3d] Updated Build Claude Request with self-context and auto-search');

// ---------------------------------------------------------------------------
// Phase 3e — Replace Skylight MCP with direct API
// ---------------------------------------------------------------------------

// 3e-1: Update Build Skylight Request to emit REST API request details
const BUILD_SKYLIGHT_CODE = `// Build Skylight Request (direct REST API)
//
// Parses the user's /calendar sub-command and emits the REST API request
// details needed by the downstream HTTP Request node.
//
// Skylight REST API base: https://app.ourskylight.com
// Events endpoint: /api/frames/{frameId}/calendar_events
//
// Supported sub-commands:
//   /calendar                          -> list next 7 days
//   /calendar list [N]                 -> list next N days (capped at 30)
//   /calendar add <title> [on <date>] [at <time>] -> create event
//   /calendar remove <id>              -> delete event
//   /calendar update <id> <changes>   -> update event

const router = $('Channel Router').first().json;
const raw    = (router.calendarArg || '').trim();
const FRAME_ID = $env.SKYLIGHT_FRAME_ID;
const TZ       = $env.SKYLIGHT_TIMEZONE || 'America/New_York';
const BASE_URL = 'https://app.ourskylight.com';
const API_VERSION = '2026-03-01';

function nowIso() { return new Date().toISOString(); }
function plusDaysIso(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function parseDateFromText(text) {
  // Try ISO date first: YYYY-MM-DD
  const isoMatch = text.match(/(\\d{4}-\\d{2}-\\d{2})/);
  if (isoMatch) return new Date(isoMatch[1] + 'T00:00:00');

  // Try weekday (Monday, Tuesday, etc.)
  const weekdays = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const lower = text.toLowerCase();
  const wdMatch = lower.match(/(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/);
  if (wdMatch) {
    const targetDay = weekdays.indexOf(wdMatch[1]);
    const d = new Date();
    const diff = (targetDay - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    return d;
  }

  // Try "today" / "tomorrow"
  if (/today/i.test(text)) return new Date();
  if (/tomorrow/i.test(text)) { const d = new Date(); d.setDate(d.getDate() + 1); return d; }

  // Try "Month Day" like "Jan 15", "January 15"
  const monthNames = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const mdMatch = lower.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\s+(\\d{1,2})/);
  if (mdMatch) {
    const month = monthNames.indexOf(mdMatch[1]);
    const day = parseInt(mdMatch[2], 10);
    const d = new Date();
    d.setMonth(month);
    d.setDate(day);
    if (d < new Date()) d.setFullYear(d.getFullYear() + 1);
    return d;
  }

  // Default to tomorrow
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d;
}

function parseTimeFromText(text) {
  const timeMatch = text.match(/(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?/i);
  if (timeMatch) {
    let hours = parseInt(timeMatch[1], 10);
    const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    const ampm = timeMatch[3] ? timeMatch[3].toLowerCase() : null;
    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;
    return { hours, minutes };
  }
  return { hours: 12, minutes: 0 }; // default noon
}

function buildEventTimes(description) {
  const date = parseDateFromText(description);
  const time = parseTimeFromText(description);
  date.setHours(time.hours, time.minutes, 0, 0);
  const starts_at = date.toISOString();
  const ends_at = new Date(date.getTime() + 60 * 60 * 1000).toISOString(); // 1-hour default
  return { starts_at, ends_at };
}

let intent = 'list';
let usageError = null;
let skylightMethod = 'GET';
let skylightPath = \`/api/frames/\${FRAME_ID}/calendar_events\`;
let skylightParams = null;
let skylightBody = null;

if (!raw || /^list(\\s|$)/i.test(raw)) {
  const m = raw.match(/^list(?:\\s+(\\d{1,2}))?$/i);
  let days = 7;
  if (m && m[1]) days = Math.max(1, Math.min(30, parseInt(m[1], 10)));
  skylightMethod = 'GET';
  skylightPath = \`/api/frames/\${FRAME_ID}/calendar_events\`;
  skylightParams = { date_min: nowIso().slice(0, 10), date_max: plusDaysIso(days).slice(0, 10), timezone: TZ };
  intent = 'list';
} else if (/^add(\\s|$)/i.test(raw)) {
  const desc = raw.replace(/^add\\s*/i, '').trim();
  if (!desc) {
    usageError = 'Usage: \`/calendar add <event title> [on <date>] [at <time>]\` — e.g. \`/calendar add Dentist on Tuesday at 3pm\`.';
  } else {
    const { starts_at, ends_at } = buildEventTimes(desc);
    // Extract summary: remove date/time tokens to get a clean title
    const summary = desc
      .replace(/(on\\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow)/gi, '')
      .replace(/(on\\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\s+\\d{1,2}/gi, '')
      .replace(/\\d{4}-\\d{2}-\\d{2}/g, '')
      .replace(/at\\s+\\d{1,2}(?::\\d{2})?\\s*(am|pm)?/gi, '')
      .replace(/\\s+/g, ' ').trim() || desc;
    skylightMethod = 'POST';
    skylightPath = \`/api/frames/\${FRAME_ID}/calendar_events\`;
    skylightBody = { summary, starts_at, ends_at, timezone: TZ };
    intent = 'add';
  }
} else if (/^(remove|delete)(\\s|$)/i.test(raw)) {
  const id = raw.replace(/^(remove|delete)\\s*/i, '').trim();
  if (!id) {
    usageError = 'Usage: \`/calendar remove <id>\` — run \`/calendar\` first to see event IDs.';
  } else {
    skylightMethod = 'DELETE';
    skylightPath = \`/api/frames/\${FRAME_ID}/calendar_events/\${id}\`;
    intent = 'remove';
  }
} else if (/^update(\\s|$)/i.test(raw)) {
  const rest = raw.replace(/^update\\s*/i, '').trim();
  const parts = rest.split(/\\s+/);
  const id = parts.shift();
  const desc = parts.join(' ').trim();
  if (!id || !desc) {
    usageError = 'Usage: \`/calendar update <id> <new title or changes>\`.';
  } else {
    const { starts_at, ends_at } = buildEventTimes(desc);
    skylightMethod = 'PUT';
    skylightPath = \`/api/frames/\${FRAME_ID}/calendar_events/\${id}\`;
    skylightBody = { summary: desc, starts_at, ends_at, timezone: TZ };
    intent = 'update';
  }
} else {
  usageError = 'Usage: \`/calendar\` (next 7 days), \`/calendar list [N]\`, \`/calendar add <desc>\`, \`/calendar remove <id>\`, \`/calendar update <id> <changes>\`.';
}

if (usageError) {
  return [{ json: { ...router, intent: 'error', commandReply: usageError, skylightMethod: null } }];
}

return [{ json: {
  ...router,
  intent,
  skylightMethod,
  skylightPath,
  skylightParams: skylightParams ? JSON.stringify(skylightParams) : null,
  skylightBody: skylightBody ? JSON.stringify(skylightBody) : null,
  skylightBaseUrl: BASE_URL,
  skylightApiVersion: API_VERSION,
} }];
`;

const AUTH_SKYLIGHT_CODE = `// Authenticate Skylight
//
// Performs the browser-style PKCE OAuth flow to obtain an access token.
// Caches the token in $workflow.staticData with a 1-hour expiry.
//
// Requires env vars: SKYLIGHT_EMAIL, SKYLIGHT_PASSWORD
// Node.js 18+ global fetch and WebCrypto APIs required.

const EMAIL    = $env.SKYLIGHT_EMAIL;
const PASSWORD = $env.SKYLIGHT_PASSWORD;
const BASE_URL = 'https://app.ourskylight.com';
const WEB_URL  = 'https://ourskylight.com';
const REDIRECT_URI = \`\${WEB_URL}/welcome\`;
const CLIENT_ID = 'skylight-mobile';
const SCOPE     = 'everything';
const UA        = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:149.0) Gecko/20100101 Firefox/149.0';

const staticData = $workflow.staticData;

// Skip auth if token is cached and not expired (1-hour window)
if (staticData.skylightToken && staticData.skylightTokenExpiry && staticData.skylightTokenExpiry > Date.now()) {
  return [{ json: { ...$input.first().json, skylightToken: staticData.skylightToken } }];
}

// --- PKCE helpers ---
function randomHex(len) {
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}
function createVerifier() { return randomHex(32) + randomHex(32); }
async function createChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=/g, '');
}
function createState() { return randomHex(5); }

// --- Cookie jar ---
class CookieJar {
  constructor() { this.cookies = {}; }
  setFromResponse(res) {
    const raw = res.headers.get('set-cookie') || '';
    const parts = raw.split(/,(?! )/);
    for (const part of parts) {
      const [pair] = part.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) {
        const name = pair.slice(0, eq).trim();
        const val  = pair.slice(eq + 1).trim();
        if (name && val) this.cookies[name] = val;
      }
    }
  }
  header() {
    return Object.entries(this.cookies).map(([k,v]) => \`\${k}=\${v}\`).join('; ');
  }
}

const jar = new CookieJar();
const state      = createState();
const verifier   = createVerifier();
const challenge  = await createChallenge(verifier);

// Step 1: GET /oauth/authorize → redirect to login form
const authUrl = new URL('/oauth/authorize', BASE_URL);
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('code_challenge', challenge);
authUrl.searchParams.set('code_challenge_method', 'S256');
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPE);
authUrl.searchParams.set('state', state);
authUrl.searchParams.set('prompt', 'login');

const r1 = await fetch(authUrl.toString(), {
  redirect: 'manual',
  headers: { Accept: 'text/html', 'User-Agent': UA, Referer: \`\${WEB_URL}/\` },
});
jar.setFromResponse(r1);
const loginUrl = r1.headers.get('location');
if (!loginUrl) throw new Error(\`Skylight auth step 1 failed: HTTP \${r1.status}\`);

// Step 2: GET login form → extract authenticity_token
const r2 = await fetch(new URL(loginUrl, BASE_URL).toString(), {
  headers: { Accept: 'text/html', 'User-Agent': UA, Cookie: jar.header() },
});
jar.setFromResponse(r2);
const html = await r2.text();
const tokenMatch = html.match(/name=["']authenticity_token["'][^>]*value=["']([^"']+)["']/i)
  || html.match(/value=["']([^"']+)["'][^>]*name=["']authenticity_token["']/i);
if (!tokenMatch) throw new Error('Could not find authenticity_token in Skylight login form');
const authenticityToken = tokenMatch[1];

// Step 3: POST credentials → redirect to authorize URL
const loginBody = new URLSearchParams({
  authenticity_token: authenticityToken,
  email: EMAIL,
  password: PASSWORD,
});
const r3 = await fetch(\`\${BASE_URL}/auth/session\`, {
  method: 'POST',
  redirect: 'manual',
  headers: {
    Accept: 'text/html',
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': UA,
    Origin: BASE_URL,
    Referer: \`\${BASE_URL}/auth/session/new\`,
    Cookie: jar.header(),
  },
  body: loginBody.toString(),
});
jar.setFromResponse(r3);
const authorizeUrl2 = r3.headers.get('location');
if (!authorizeUrl2) throw new Error(\`Skylight login failed: HTTP \${r3.status} — check SKYLIGHT_EMAIL and SKYLIGHT_PASSWORD\`);

// Step 4: GET authorize URL → redirect to callback with code
const r4 = await fetch(new URL(authorizeUrl2, BASE_URL).toString(), {
  redirect: 'manual',
  headers: {
    Accept: 'text/html',
    'User-Agent': UA,
    Referer: \`\${BASE_URL}/auth/session/new\`,
    Cookie: jar.header(),
  },
});
jar.setFromResponse(r4);
const callbackLoc = r4.headers.get('location');
if (!callbackLoc) throw new Error(\`Skylight auth step 4 failed: HTTP \${r4.status}\`);

// Step 5: Extract authorization code from callback URL
const callbackUrl = new URL(callbackLoc);
const code = callbackUrl.searchParams.get('code');
const retState = callbackUrl.searchParams.get('state');
if (!code) throw new Error('No authorization code in Skylight OAuth callback');
if (retState !== state) throw new Error('Skylight OAuth state mismatch');

// Step 6: Exchange code for access token
const tokenBody = new URLSearchParams({
  grant_type: 'authorization_code',
  client_id: CLIENT_ID,
  scope: SCOPE,
  redirect_uri: REDIRECT_URI,
  code,
  code_verifier: verifier,
  skylight_api_client_device_platform: 'web',
  skylight_api_client_device_name: 'unknown',
  skylight_api_client_device_os_version: 'unknown',
  skylight_api_client_device_app_version: 'unknown',
  skylight_api_client_device_hardware: 'unknown',
  skylight_api_client_device_fingerprint: randomHex(16),
});
const r6 = await fetch(\`\${BASE_URL}/oauth/token\`, {
  method: 'POST',
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': UA,
    Origin: WEB_URL,
    Referer: \`\${WEB_URL}/\`,
  },
  body: tokenBody.toString(),
});
if (!r6.ok) {
  const errBody = await r6.text();
  throw new Error(\`Skylight token exchange failed: HTTP \${r6.status} — \${errBody.slice(0, 200)}\`);
}
const tokenData = await r6.json();
const token = tokenData.access_token || tokenData.token;
if (!token) throw new Error('Skylight OAuth response did not contain an access token');

// Cache with 1-hour expiry
staticData.skylightToken = token;
staticData.skylightTokenExpiry = Date.now() + 3600 * 1000;

return [{ json: { ...$input.first().json, skylightToken: token } }];
`;

const PARSE_SKYLIGHT_CODE = `// Parse Skylight Reply (direct REST API)
//
// Formats the Skylight REST API response into a Discord-friendly message.

const router  = $('Build Skylight Request').first().json;
const intent  = router.intent || 'list';
const TZ      = $env.SKYLIGHT_TIMEZONE || 'America/New_York';

// Usage error — short-circuit from Build Skylight Request
if (intent === 'error') {
  return [{ json: { ...router } }];
}

const res = $input.item.json;

function formatEventDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
      timeZone: TZ,
    });
  } catch(_) { return dateStr; }
}

let reply = '';

if (res && res.error) {
  reply = \`⚠️ Skylight error: \\\`\${res.error}\\\`\`;
} else if (intent === 'list') {
  // REST API returns array (may be wrapped in data key)
  const events = Array.isArray(res) ? res : (Array.isArray(res.data) ? res.data : []);
  if (events.length === 0) {
    reply = '🗓️ No upcoming events in that window.';
  } else {
    const lines = events.slice(0, 15).map(ev => {
      const attrs = ev.attributes || ev;
      const title = attrs.summary || attrs.title || attrs.description || '(untitled)';
      const when  = attrs.starts_at || attrs.start || attrs.date || '';
      const id    = ev.id != null ? \` [id: \${ev.id}]\` : '';
      return \`• **\${title}** — \${formatEventDate(when)}\${id}\`;
    });
    reply = \`🗓️ **Upcoming events**\\n\${lines.join('\\n')}\`;
    if (events.length > 15) reply += \`\\n… and \${events.length - 15} more.\`;
  }
} else if (intent === 'add') {
  const attrs = (res.data && res.data.attributes) || res.attributes || res;
  const title = attrs.summary || attrs.title || '';
  const when  = attrs.starts_at || '';
  reply = \`✅ Event created: **\${title}**\${when ? \` — \${formatEventDate(when)}\` : ''}\`;
} else if (intent === 'remove') {
  reply = '🗑️ Event deleted.';
} else if (intent === 'update') {
  const attrs = (res.data && res.data.attributes) || res.attributes || res;
  const title = attrs.summary || attrs.title || '';
  reply = \`✏️ Event updated\${title ? \`: **\${title}**\` : '.'}\`;
} else {
  reply = \`📅 \${JSON.stringify(res).slice(0, 400)}\`;
}

if (reply.length > 1950) reply = reply.slice(0, 1950) + '…';
return [{ json: { ...router, commandReply: reply } }];
`;

// Update Build Skylight Request node code
const buildSkylightNode = workflow.nodes.find(n => n.name === 'Build Skylight Request');
if (buildSkylightNode) {
  buildSkylightNode.parameters.jsCode = BUILD_SKYLIGHT_CODE;
  console.log('[3e] Updated Build Skylight Request');
}

// Replace Call Skylight MCP with Authenticate Skylight (Code node)
const callSkylightIdx = workflow.nodes.findIndex(n => n.name === 'Call Skylight MCP');
if (callSkylightIdx !== -1) {
  const oldNode = workflow.nodes[callSkylightIdx];
  workflow.nodes[callSkylightIdx] = {
    parameters: { jsCode: AUTH_SKYLIGHT_CODE },
    type: 'n8n-nodes-base.code',
    typeVersion: 2,
    position: oldNode.position,
    id: oldNode.id,
    name: 'Authenticate Skylight',
  };
  console.log('[3e] Replaced Call Skylight MCP → Authenticate Skylight');

  // Update connections: rename Call Skylight MCP → Authenticate Skylight
  if (workflow.connections['Call Skylight MCP']) {
    workflow.connections['Authenticate Skylight'] = workflow.connections['Call Skylight MCP'];
    delete workflow.connections['Call Skylight MCP'];
  }

  // Update Build Skylight Request connections to point to Authenticate Skylight
  if (workflow.connections['Build Skylight Request']) {
    workflow.connections['Build Skylight Request'].main.forEach(outputs => {
      outputs.forEach(conn => {
        if (conn.node === 'Call Skylight MCP') conn.node = 'Authenticate Skylight';
      });
    });
  }

  // Add Call Skylight API HTTP Request node (insert between Authenticate Skylight and Parse Skylight Reply)
  // Get Authenticate Skylight's connections to find Parse Skylight Reply
  const authConn = workflow.connections['Authenticate Skylight'];
  const parseNode = authConn && authConn.main && authConn.main[0] && authConn.main[0][0];

  // Determine position for Call Skylight API node
  const authNode = workflow.nodes.find(n => n.name === 'Authenticate Skylight');
  const parseNodeInst = workflow.nodes.find(n => n.name === 'Parse Skylight Reply');
  const callApiPos = authNode && parseNodeInst
    ? [(authNode.position[0] + parseNodeInst.position[0]) / 2, authNode.position[1]]
    : [0, 1040];

  const callSkylightApiNode = {
    parameters: {
      method: '={{ $json.skylightMethod }}',
      url: '={{ $json.skylightBaseUrl + $json.skylightPath }}',
      sendHeaders: true,
      headerParameters: {
        parameters: [
          { name: 'Authorization', value: '=Bearer {{ $json.skylightToken }}' },
          { name: 'Accept', value: 'application/json' },
          { name: 'Content-Type', value: 'application/json' },
          { name: 'Skylight-Api-Version', value: '={{ $json.skylightApiVersion }}' },
          { name: 'User-Agent', value: 'SkylightMobile (web)' },
        ],
      },
      sendQuery: true,
      queryParameters: {
        parameters: [
          { name: 'query', value: '={{ $json.skylightParams ? JSON.parse($json.skylightParams) : undefined }}' },
        ],
      },
      sendBody: true,
      specifyBody: 'json',
      jsonBody: '={{ $json.skylightBody || undefined }}',
      options: { timeout: 30000, allowUnauthorizedCerts: false },
    },
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position: [-336, 1040],
    id: 'bb000000-0000-0000-0000-000000000001',
    name: 'Call Skylight API',
  };

  // Add the node
  workflow.nodes.push(callSkylightApiNode);

  // Wire: Authenticate Skylight → Call Skylight API → Parse Skylight Reply
  workflow.connections['Authenticate Skylight'] = {
    main: [[{ node: 'Call Skylight API', type: 'main', index: 0 }]]
  };
  workflow.connections['Call Skylight API'] = {
    main: [[{ node: 'Parse Skylight Reply', type: 'main', index: 0 }]]
  };

  console.log('[3e] Added Call Skylight API node and wired connections');
}

// Update Parse Skylight Reply code
const parseSkylightNode = workflow.nodes.find(n => n.name === 'Parse Skylight Reply');
if (parseSkylightNode) {
  parseSkylightNode.parameters.jsCode = PARSE_SKYLIGHT_CODE;
  console.log('[3e] Updated Parse Skylight Reply');
}

// Update connections from Parse Skylight Reply → Reply Calendar if it uses channel expression
// (This should already be correct, but verify connections remain)
console.log('[3e] Skylight calendar pipeline updated');

// ---------------------------------------------------------------------------
// Write workflow back to disk
// ---------------------------------------------------------------------------
fs.writeFileSync(WORKFLOW_PATH, JSON.stringify(workflow, null, 2), 'utf8');
console.log('\nWorkflow written successfully.');
console.log(`Total nodes: ${workflow.nodes.length}`);
console.log(`Total connection keys: ${Object.keys(workflow.connections).length}`);
