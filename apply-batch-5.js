// apply-batch-5.js
// Fix 1: Detect Search Intent — URL detection + sports/live-event patterns
// Fix 2: Parse Perplexity Reply — wrap citation URLs in <> to suppress Discord embeds
// Fix 3: Build Claude Request — tell Claude to wrap URLs in <> when citing auto-search results
// Fix 4: Channel Router — CMD_RE update, /status block, web-search capability in all personas
// Fix 5: Command Switch — add 'status' rule (shifts Should Respond? to output 12)
// Fix 6: Add Query Status, Format Status Reply, Reply Status nodes + wire them
// Run: node apply-batch-5.js

'use strict';
const fs = require('fs');
const d  = JSON.parse(fs.readFileSync('./workflows/discord-bruce.json', 'utf8'));

// ── Fix 1: Detect Search Intent ───────────────────────────────────────────────
{
  const node = d.nodes.find(n => n.name === 'Detect Search Intent');
  node.parameters.jsCode = [
    "const message = $input.first().json.content || '';",
    "",
    "// URL detection — any message containing a link should auto-search so Bruce can summarise it",
    "const hasUrl = /https?:\\/\\//.test(message);",
    "",
    "const searchPatterns = [",
    "  /near me|near here|near us|around here/i,",
    "  /\\b(latest|recent|current|right now|happening now|today'?s?)\\b/i,",
    "  /\\b(this week|this month|this morning|this evening|this afternoon)\\b/i,",
    "  /\\b(tonight|on tonight|what'?s on tonight)\\b/i,",
    "  /\\b(breaking|just (happened|announced|released|dropped))\\b/i,",
    "  /\\b(news|weather|stock|price|update)\\b/i,",
    "  /\\b(score|scores|game|games|match|matchup|standings|stats)\\b/i,",
    "  /\\b(nfl|nba|mlb|nhl|mls|espn|playoffs|tournament|bracket)\\b/i,",
    "  /\\b(who (is|are) (the current|currently|playing|winning))\\b/i,",
    "  /\\b(where can i|where to|best place|recommend.*restaurant|recommend.*shop)\\b/i,",
    "  /\\b(is .+ (open|closed|available|playing|on))\\b/i,",
    "  /\\b(how much (does|is|are))\\b/i,",
    "  /\\b(what'?s? (happening|going on|the score|the latest))\\b/i,",
    "  /\\b(live (score|game|match|event|stream|updates?))\\b/i,",
    "];",
    "",
    "const needsSearch = hasUrl || searchPatterns.some(function(p) { return p.test(message); });",
    "",
    "// For URL messages: search the URL directly; else use the full message",
    "let searchQuery = message;",
    "if (hasUrl) {",
    "  const urlMatch = message.match(/https?:\\/\\/\\S+/);",
    "  searchQuery = urlMatch ? urlMatch[0] : message;",
    "}",
    "if (/near me|near here|near us|around here/i.test(message)) {",
    "  searchQuery = message + ' Falls Church Merrifield VA';",
    "}",
    "",
    "return [{",
    "  json: {",
    "    ...$input.first().json,",
    "    needs_search: needsSearch,",
    "    search_query: searchQuery,",
    "  }",
    "}];",
  ].join('\n');
  console.log('[Fix 1] Detect Search Intent updated');
}

// ── Fix 2: Parse Perplexity Reply — wrap citation URLs in <> ─────────────────
{
  const node = d.nodes.find(n => n.name === 'Parse Perplexity Reply');
  const OLD = "const cited = citations.slice(0, 5).map((u, i) => `${i + 1}. ${u}`).join('\\n');";
  const NEW = "const cited = citations.slice(0, 5).map(function(u, i) { return (i + 1) + '. <' + u + '>'; }).join('\\n');";
  if (!node.parameters.jsCode.includes('citations.slice(0, 5).map')) {
    console.warn('[Fix 2] WARNING: citation map pattern not found');
  } else {
    node.parameters.jsCode = node.parameters.jsCode.replace(
      /citations\.slice\(0, 5\)\.map\(\(u, i\) => `\$\{i \+ 1\}\. \$\{u\}`\)\.join\('\\\\n'\)/,
      "citations.slice(0, 5).map(function(u, i) { return (i + 1) + '. <' + u + '>'; }).join('\\n')"
    );
    console.log('[Fix 2] Parse Perplexity Reply citation URLs wrapped in <>');
  }
}

// ── Fix 3: Build Claude Request — URL wrapping hint in auto-search block ─────
{
  const node = d.nodes.find(n => n.name === 'Build Claude Request');
  const OLD_CITE = 'Use these results to inform your answer. Cite specific details naturally.';
  const NEW_CITE = 'Use these results to inform your answer. Cite specific details naturally. When including any URLs in your reply, wrap them in angle brackets like <https://example.com> to prevent Discord from embedding them as rich previews.';
  if (!node.parameters.jsCode.includes(OLD_CITE)) {
    console.warn('[Fix 3] WARNING: auto-search cite instruction not found');
  } else {
    node.parameters.jsCode = node.parameters.jsCode.replace(OLD_CITE, NEW_CITE);
    console.log('[Fix 3] Build Claude Request auto-search URL hint added');
  }
}

// ── Fix 4a: Channel Router — CMD_RE ──────────────────────────────────────────
{
  const node = d.nodes.find(n => n.name === 'Channel Router');
  let code = node.parameters.jsCode;

  const OLD_RE = 'const CMD_RE = /^\\/(use|remember|forget|memories|clear|image|search|calendar|help|save-recipe|recipes)(?:\\s+([\\s\\S]*))?$/i;';
  const NEW_RE = 'const CMD_RE = /^\\/(use|remember|forget|memories|clear|image|search|calendar|help|save-recipe|recipes|status)(?:\\s+([\\s\\S]*))?$/i;';
  if (!code.includes(OLD_RE)) {
    console.warn('[Fix 4a] WARNING: CMD_RE pattern not found');
  } else {
    code = code.replace(OLD_RE, NEW_RE);
    console.log('[Fix 4a] CMD_RE updated with |status');
  }

  // ── Fix 4b: /status command block after /recipes block ────────────────────
  const RECIPES_BLOCK_END = "if (cmd === 'recipes') {\n    commandType  = 'recipes';\n    recipesQuery = arg || null;\n  }\n}";
  const STATUS_BLOCK = [
    "if (cmd === 'recipes') {",
    "    commandType  = 'recipes';",
    "    recipesQuery = arg || null;",
    "  }",
    "",
    "  if (cmd === 'status') {",
    "    const JAKE_CHANNELS = new Set(['jake-personal', 'fig', 'jake-ask']);",
    "    if (!JAKE_CHANNELS.has(channelName)) {",
    "      commandType  = 'reply-only';",
    "      commandReply = '/status is only available in Jake\\'s channels (jake-personal, fig, jake-ask).';",
    "    } else {",
    "      commandType = 'status';",
    "    }",
    "  }",
    "}",
  ].join('\n');

  if (!code.includes(RECIPES_BLOCK_END)) {
    console.warn('[Fix 4b] WARNING: recipes block end pattern not found');
  } else {
    code = code.replace(RECIPES_BLOCK_END, STATUS_BLOCK);
    console.log('[Fix 4b] /status command block added');
  }

  // ── Fix 4c: Persona tail — add web-search capability notice ──────────────
  // The common tail appears in all 13 personas. We append the capability note.
  const OLD_TAIL = 'You are Bruce, the household AI. Your channel has a topic focus but you are not limited to it. Handle normal conversation, relay messages, and be socially aware. Never say "that\'s outside my lane" or "I\'m just the [topic] guy." If someone tags another family member, you know who they are.';
  const NEW_TAIL = OLD_TAIL + '\n\nYou have web search capabilities via Perplexity that trigger automatically for real-time queries, URLs, and current events. Never say you lack real-time data, cannot access the internet, or cannot check current information — you can and do search automatically.';

  const countBefore = (code.match(new RegExp(OLD_TAIL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  if (countBefore === 0) {
    console.warn('[Fix 4c] WARNING: persona common tail not found');
  } else {
    code = code.split(OLD_TAIL).join(NEW_TAIL);
    const countAfter = (code.match(new RegExp(NEW_TAIL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 40), 'g')) || []).length;
    console.log('[Fix 4c] Persona web-search capability added to', countBefore, 'personas');
  }

  // ── Fix 4d: Update /search tool description in Available tools sections ───
  const OLD_SEARCH_DESC = '/search <query> \u2014 web search via Perplexity (also auto-triggers for real-time queries)';
  const NEW_SEARCH_DESC = '/search <query> \u2014 web search via Perplexity (auto-triggers for real-time queries, URLs, live scores, current events)';
  if (code.includes(OLD_SEARCH_DESC)) {
    code = code.split(OLD_SEARCH_DESC).join(NEW_SEARCH_DESC);
    console.log('[Fix 4d] /search tool description updated in Available tools sections');
  } else {
    console.warn('[Fix 4d] WARNING: /search tool description not found');
  }

  // ── Fix 4e: Update /help text to include /status ────────────────────────
  const OLD_HELP_END = '`/help` \u2014 show this message"';
  const NEW_HELP_END = '`/status` \u2014 system health (jake channels only)\\n`/help` \u2014 show this message"';
  if (code.includes(OLD_HELP_END)) {
    code = code.replace(OLD_HELP_END, NEW_HELP_END);
    console.log('[Fix 4e] /status added to /help text');
  } else {
    console.warn('[Fix 4e] WARNING: /help end pattern not found');
  }

  node.parameters.jsCode = code;
}

// ── Fix 5: Command Switch — add 'status' rule ─────────────────────────────────
{
  const sw = d.nodes.find(n => n.name === 'Command Switch');
  sw.parameters.rules.values.push({
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
      conditions: [{
        id:         'sw-status',
        leftValue:  '={{ $json.commandType }}',
        rightValue: 'status',
        operator:   { type: 'string', operation: 'equals' },
      }],
      combinator: 'and',
    },
    renameOutput: true,
    outputKey:   'status',
  });
  console.log('[Fix 5] Command Switch "status" rule added (now', sw.parameters.rules.values.length, 'rules)');

  // Move the Should Respond? connection from output 11 → output 12
  const csMain = d.connections['Command Switch'].main;
  csMain[12] = csMain[11]; // Should Respond? now at output 12
  csMain[11] = [{ node: 'Query Status', type: 'main', index: 0 }];
  console.log('[Fix 5] Command Switch connections updated: output 11 → Query Status, output 12 → Should Respond?');
}

// ── Fix 6: Add status nodes ───────────────────────────────────────────────────
const queryStatus = {
  parameters: {
    operation: 'executeQuery',
    query: [
      "SELECT 'messages_24h' AS metric, COUNT(*)::text AS value",
      "  FROM discord_conversations WHERE created_at > NOW() - INTERVAL '24 hours'",
      "UNION ALL",
      "SELECT 'messages_7d', COUNT(*)::text",
      "  FROM discord_conversations WHERE created_at > NOW() - INTERVAL '7 days'",
      "UNION ALL",
      "SELECT 'last_message', COALESCE(MAX(created_at)::text, 'none')",
      "  FROM discord_conversations",
      "UNION ALL",
      "SELECT 'memories_total', COUNT(*)::text FROM user_memories",
      "UNION ALL",
      "SELECT 'memories_auto', COUNT(*)::text FROM user_memories WHERE scope = 'auto'",
      "UNION ALL",
      "SELECT 'memories_manual', COUNT(*)::text FROM user_memories WHERE scope IN ('user', 'channel')",
      "UNION ALL",
      "SELECT 'recipes_total', COUNT(*)::text FROM recipes",
    ].join('\n'),
  },
  id:          '70000000-0000-0000-0000-000000000001',
  name:        'Query Status',
  type:        'n8n-nodes-base.postgres',
  typeVersion: 2,
  position:    [-672, 1600],
  credentials: {
    postgres: {
      id:   'EHBRO07aceirmFzt',
      name: 'Household Postgres',
    },
  },
};

const formatStatusReply = {
  parameters: {
    jsCode: [
      "const rows  = $input.all();",
      "const stats = {};",
      "rows.forEach(function(r) { stats[r.json.metric] = r.json.value; });",
      "",
      "let lastStr = 'none';",
      "if (stats.last_message && stats.last_message !== 'none') {",
      "  try {",
      "    const d = new Date(stats.last_message);",
      "    lastStr = d.toLocaleString('en-US', {",
      "      timeZone: 'America/New_York',",
      "      month: 'short', day: 'numeric',",
      "      hour: 'numeric', minute: '2-digit',",
      "    }) + ' ET';",
      "  } catch(_) { lastStr = stats.last_message; }",
      "}",
      "",
      "const lines = [",
      "  '**Bruce Status**',",
      "  '',",
      "  '**Messages**',",
      "  '  Last activity: ' + lastStr,",
      "  '  Past 24h: ' + (stats.messages_24h || '0'),",
      "  '  Past 7d:  ' + (stats.messages_7d  || '0'),",
      "  '',",
      "  '**Memories**',",
      "  '  Total: ' + (stats.memories_total  || '0'),",
      "  '  Auto-extracted: ' + (stats.memories_auto   || '0'),",
      "  '  Manual: ' + (stats.memories_manual || '0'),",
      "  '',",
      "  '**Recipes**',",
      "  '  Total: ' + (stats.recipes_total || '0'),",
      "];",
      "",
      "return [{ json: { commandReply: lines.join('\\n') } }];",
    ].join('\n'),
  },
  id:          '71000000-0000-0000-0000-000000000001',
  name:        'Format Status Reply',
  type:        'n8n-nodes-base.code',
  typeVersion: 2,
  position:    [-448, 1600],
};

const replyStatus = {
  parameters: {
    resource: 'message',
    guildId: {
      __rl:  true,
      value: '1495249842778148954',
      mode:  'id',
    },
    channelId: {
      __rl:  true,
      value: "={{ $('Unwrap Body').first().json.thread_id || $('Unwrap Body').first().json.channel_id }}",
      mode:  'id',
    },
    content: '={{ $json.commandReply }}',
    options: {},
  },
  id:          '72000000-0000-0000-0000-000000000001',
  name:        'Reply Status',
  type:        'n8n-nodes-base.discord',
  typeVersion: 2,
  position:    [-224, 1600],
  webhookId:   'c3a9b842-7211-4c9d-9a21-8e2d3f7b1003',
  credentials: {
    discordBotApi: {
      id:   'om7VabWMiA8gC2i3',
      name: 'Discord Bot account',
    },
  },
};

d.nodes.push(queryStatus, formatStatusReply, replyStatus);
console.log('[Fix 6] Added Query Status, Format Status Reply, Reply Status nodes (' + d.nodes.length + ' total)');

d.connections['Query Status']       = { main: [[{ node: 'Format Status Reply', type: 'main', index: 0 }]] };
d.connections['Format Status Reply'] = { main: [[{ node: 'Reply Status',        type: 'main', index: 0 }]] };
console.log('[Fix 6] Wired Query Status → Format Status Reply → Reply Status');

// ── Write & validate ──────────────────────────────────────────────────────────
fs.writeFileSync('./workflows/discord-bruce.json', JSON.stringify(d, null, 2));
JSON.parse(fs.readFileSync('./workflows/discord-bruce.json', 'utf8'));
console.log('\nWorkflow JSON valid. Done.');
