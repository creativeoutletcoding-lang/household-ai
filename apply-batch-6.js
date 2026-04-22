// apply-batch-6.js
// Task 1: /status — add last n8n error details (new HTTP node + updated Format Status Reply)
// Task 2: Discord 2000-char limit — split long replies in Parse Claude Reply + Format Recipes Reply node
// Task 3: Channel Router — DM persona + routing
// Run: node apply-batch-6.js

'use strict';
const fs = require('fs');
const d = JSON.parse(fs.readFileSync('./workflows/discord-bruce.json', 'utf8'));

// ── Task 1a: Add "Fetch Last n8n Error" HTTP Request node ─────────────────────
{
  const existing = d.nodes.find(n => n.name === 'Fetch Last n8n Error');
  if (existing) {
    console.log('[Task 1a] Fetch Last n8n Error already exists — skipping add');
  } else {
    const fetchErrNode = {
      parameters: {
        method: 'GET',
        url: 'http://127.0.0.1:5678/api/v1/executions?status=error&limit=1',
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'X-N8N-API-KEY', value: '={{ $env.N8N_API_KEY }}' },
          ],
        },
        options: {},
      },
      id: '73000000-0000-0000-0000-000000000001',
      name: 'Fetch Last n8n Error',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [-672, 1744],
      alwaysOutputData: true,
      onError: 'continueRegularOutput',
    };
    d.nodes.push(fetchErrNode);
    console.log('[Task 1a] Fetch Last n8n Error node added');
  }
}

// ── Task 1b: Rewire /status pipeline: Query Status → Fetch Last n8n Error → Format Status Reply ──
{
  // Was: Query Status → Format Status Reply
  // Now: Query Status → Fetch Last n8n Error → Format Status Reply
  const qs = d.connections['Query Status'];
  if (qs && qs.main && qs.main[0] && qs.main[0][0] && qs.main[0][0].node === 'Format Status Reply') {
    qs.main[0][0].node = 'Fetch Last n8n Error';
    d.connections['Fetch Last n8n Error'] = {
      main: [[{ node: 'Format Status Reply', type: 'main', index: 0 }]],
    };
    console.log('[Task 1b] /status pipeline rewired: Query Status → Fetch Last n8n Error → Format Status Reply');
  } else if (qs && qs.main && qs.main[0] && qs.main[0][0] && qs.main[0][0].node === 'Fetch Last n8n Error') {
    console.log('[Task 1b] Already rewired — skipping');
    if (!d.connections['Fetch Last n8n Error']) {
      d.connections['Fetch Last n8n Error'] = {
        main: [[{ node: 'Format Status Reply', type: 'main', index: 0 }]],
      };
    }
  } else {
    console.warn('[Task 1b] WARNING: Query Status connection not in expected state:', JSON.stringify(qs));
  }
}

// ── Task 1c: Update Format Status Reply to include last error block ───────────
{
  const node = d.nodes.find(n => n.name === 'Format Status Reply');
  node.parameters.jsCode = [
    "// Stats come from Query Status (Postgres). Last-error comes from Fetch Last n8n Error (HTTP).",
    "const rows = $('Query Status').all();",
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
    "let errorBlock = '';",
    "try {",
    "  const errData = $input.first().json;",
    "  const execs = errData && errData.data;",
    "  if (Array.isArray(execs) && execs.length > 0) {",
    "    const ex = execs[0];",
    "    const errTime = new Date(ex.startedAt).toLocaleString('en-US', {",
    "      timeZone: 'America/New_York',",
    "      month: 'short', day: 'numeric',",
    "      hour: 'numeric', minute: '2-digit',",
    "    }) + ' ET';",
    "    const lastNode = (ex.data && ex.data.lastNodeExecuted) ? ex.data.lastNodeExecuted : 'unknown node';",
    "    const errMsg = (ex.data && ex.data.resultData && ex.data.resultData.error && ex.data.resultData.error.message)",
    "      ? ex.data.resultData.error.message.slice(0, 120)",
    "      : '';",
    "    errorBlock = '\\n\\n**Last Error**\\n  When: ' + errTime + '\\n  Node: ' + lastNode + (errMsg ? ('\\n  Msg: ' + errMsg) : '');",
    "  }",
    "} catch(_) {}",
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
    "return [{ json: { commandReply: lines.join('\\n') + errorBlock } }];",
  ].join('\n');
  console.log('[Task 1c] Format Status Reply updated with last-error block');
}

// ── Task 2a: Parse Claude Reply — replace truncation with proper chunk splitting ──
{
  const node = d.nodes.find(n => n.name === 'Parse Claude Reply');
  node.parameters.jsCode = [
    "// Extract Claude's reply text. Split into ≤1900-char chunks so Discord's",
    "// 2000-char limit is never hit. Multiple items → Discord node sends N messages.",
    "const router = $('Channel Router').first().json;",
    "const apiRes = $input.item.json;",
    "",
    "const reply = (apiRes.content || [])",
    "  .filter(function(c) { return c.type === 'text'; })",
    "  .map(function(c) { return c.text; })",
    "  .join('\\n\\n')",
    "  .trim();",
    "",
    "if (!reply) {",
    "  throw new Error('Empty reply from Claude — check response shape: ' + JSON.stringify(apiRes).slice(0, 500));",
    "}",
    "",
    "function splitChunks(text, maxLen) {",
    "  if (text.length <= maxLen) return [text];",
    "  const chunks = [];",
    "  let rest = text;",
    "  while (rest.length > maxLen) {",
    "    let cut = rest.lastIndexOf('\\n\\n', maxLen);",
    "    if (cut < maxLen * 0.6) cut = rest.lastIndexOf('\\n', maxLen);",
    "    if (cut < maxLen * 0.6) cut = rest.lastIndexOf('. ', maxLen);",
    "    if (cut < 0 || cut < maxLen * 0.3) cut = maxLen;",
    "    chunks.push(rest.slice(0, cut).trimEnd());",
    "    rest = rest.slice(cut).trimStart();",
    "  }",
    "  if (rest.length) chunks.push(rest);",
    "  return chunks;",
    "}",
    "",
    "const chunks = splitChunks(reply, 1900);",
    "return chunks.map(function(chunk) {",
    "  return { json: { ...router, reply: reply, replyTruncated: chunk } };",
    "});",
  ].join('\n');
  console.log('[Task 2a] Parse Claude Reply updated with chunk splitter');
}

// ── Task 2b: Add Format Recipes Reply Code node + rewire ──────────────────────
{
  const existing = d.nodes.find(n => n.name === 'Format Recipes Reply');
  if (existing) {
    console.log('[Task 2b] Format Recipes Reply already exists — skipping add');
  } else {
    const rrNode = d.nodes.find(n => n.name === 'Reply Recipes');
    const formatNode = {
      parameters: {
        jsCode: [
          "// Format the recipes list for Discord. Split into ≤1900-char chunks.",
          "const rows = $input.all();",
          "const router = $('Channel Router').first().json;",
          "",
          "if (!rows.length || (rows.length === 1 && !rows[0].json.id)) {",
          "  const msg = router.recipesQuery",
          "    ? 'No recipes match that search.'",
          "    : 'No recipes saved yet. Use `/save-recipe Title` then Shift+Enter and type the body.';",
          "  return [{ json: { ...router, commandReply: msg } }];",
          "}",
          "",
          "const lines = rows.map(function(r) {",
          "  const title   = r.json.title   || '(untitled)';",
          "  const preview = r.json.preview || '';",
          "  const id      = r.json.id;",
          "  return '**' + id + '. ' + title + '**' + (preview ? ('\\n' + preview) : '');",
          "});",
          "",
          "const MAX = 1900;",
          "const chunks = [];",
          "let cur = '';",
          "lines.forEach(function(line) {",
          "  const sep = cur ? '\\n\\n' : '';",
          "  if ((cur + sep + line).length > MAX) {",
          "    if (cur) chunks.push(cur);",
          "    cur = line;",
          "  } else {",
          "    cur += sep + line;",
          "  }",
          "});",
          "if (cur) chunks.push(cur);",
          "",
          "return chunks.map(function(chunk) {",
          "  return { json: { ...router, commandReply: chunk } };",
          "});",
        ].join('\n'),
      },
      id: '74000000-0000-0000-0000-000000000001',
      name: 'Format Recipes Reply',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [rrNode.position[0] - 224, rrNode.position[1]],
    };
    d.nodes.push(formatNode);
    console.log('[Task 2b] Format Recipes Reply Code node added');
  }
}

// ── Task 2c: Rewire Query Recipes → Format Recipes Reply → Reply Recipes ──────
{
  const qrConn = d.connections['Query Recipes'];
  if (qrConn && qrConn.main && qrConn.main[0] && qrConn.main[0][0]) {
    const cur = qrConn.main[0][0].node;
    if (cur === 'Reply Recipes') {
      qrConn.main[0][0].node = 'Format Recipes Reply';
      d.connections['Format Recipes Reply'] = {
        main: [[{ node: 'Reply Recipes', type: 'main', index: 0 }]],
      };
      console.log('[Task 2c] Rewired: Query Recipes → Format Recipes Reply → Reply Recipes');
    } else if (cur === 'Format Recipes Reply') {
      console.log('[Task 2c] Already rewired — skipping');
    } else {
      console.warn('[Task 2c] WARNING: unexpected connection from Query Recipes to:', cur);
    }
  } else {
    console.warn('[Task 2c] WARNING: Query Recipes connection not found');
  }
}

// ── Task 2d: Update Reply Recipes content field to use $json.commandReply ─────
{
  const rrNode = d.nodes.find(n => n.name === 'Reply Recipes');
  const curContent = String(rrNode.parameters.content || '');
  if (curContent.includes('commandReply') && !curContent.includes('rows = $input.all')) {
    console.log('[Task 2d] Reply Recipes content already uses commandReply — skipping');
  } else {
    rrNode.parameters.content = '={{ $json.commandReply }}';
    console.log('[Task 2d] Reply Recipes content updated to {{ $json.commandReply }}');
  }
}

// ── Task 3a: Add 'dm' to Channel Router ROUTING ───────────────────────────────
{
  const crNode = d.nodes.find(n => n.name === 'Channel Router');
  let code = crNode.parameters.jsCode;

  const OLD_ROUTING_END = "  'nana-ask':       { behavior: 'always',       persona: 'ask',            model: 'claude-haiku-4-5-20251001', historyScope: 'user' },\n};";
  const NEW_ROUTING_END = "  'nana-ask':       { behavior: 'always',       persona: 'ask',            model: 'claude-haiku-4-5-20251001', historyScope: 'user' },\n  'dm':             { behavior: 'always',       persona: 'dm',             model: 'claude-sonnet-4-6',         historyScope: 'user' },\n};";

  if (code.includes(NEW_ROUTING_END)) {
    console.log('[Task 3a] DM routing already present — skipping');
  } else if (code.includes(OLD_ROUTING_END)) {
    code = code.replace(OLD_ROUTING_END, NEW_ROUTING_END);
    console.log('[Task 3a] DM routing added to ROUTING object');
  } else {
    console.warn('[Task 3a] WARNING: nana-ask routing end pattern not found');
  }

  crNode.parameters.jsCode = code;
}

// ── Task 3b: Add 'dm' persona to Channel Router PERSONAS ─────────────────────
{
  const crNode = d.nodes.find(n => n.name === 'Channel Router');
  let code = crNode.parameters.jsCode;

  const PERSONAS_END = "and do search automatically.\`,\n};";

  const DM_PERSONA_TEXT =
    "You are Bruce, the household AI. This is a private DM conversation. " +
    "Be helpful, warm, and conversational — this is a one-on-one space, so you can be more personal than in shared channels. " +
    "Address the person directly and match their energy.\n\n" +
    "You have web search capabilities via Perplexity that trigger automatically for real-time queries, URLs, and current events. " +
    "Never say you lack real-time data, cannot access the internet, or cannot check current information — you can and do search automatically.\n\n" +
    "You are Bruce, the household AI. Your channel has a topic focus but you are not limited to it. " +
    "Handle normal conversation, relay messages, and be socially aware. " +
    "Never say \"that's outside my lane\" or \"I'm just the [topic] guy.\" " +
    "If someone tags another family member, you know who they are.\n\n" +
    "You have web search capabilities via Perplexity that trigger automatically for real-time queries, URLs, and current events. " +
    "Never say you lack real-time data, cannot access the internet, or cannot check current information — you can and do search automatically.";

  if (code.includes("'dm':")) {
    console.log('[Task 3b] DM persona already present — skipping');
  } else if (code.includes(PERSONAS_END)) {
    const NEW_END =
      "and do search automatically.\`,\n" +
      "  'dm': `" + DM_PERSONA_TEXT + "`,\n};";
    code = code.replace(PERSONAS_END, NEW_END);
    console.log('[Task 3b] DM persona added to PERSONAS object');
  } else {
    console.warn('[Task 3b] WARNING: PERSONAS end pattern not found');
  }

  crNode.parameters.jsCode = code;
}

// ── Task 3c: Add isDm check and update route lookup ───────────────────────────
{
  const crNode = d.nodes.find(n => n.name === 'Channel Router');
  let code = crNode.parameters.jsCode;

  const OLD_ROUTE = "const route = ROUTING[channelName] || { behavior: 'read-only', persona: null, model: null, historyScope: 'user' };";
  const NEW_ROUTE =
    "const isDm = msg.is_dm === true;\n" +
    "const route = isDm ? ROUTING['dm'] : (ROUTING[channelName] || { behavior: 'read-only', persona: null, model: null, historyScope: 'user' });";

  if (code.includes(NEW_ROUTE)) {
    console.log('[Task 3c] isDm check already present — skipping');
  } else if (code.includes(OLD_ROUTE)) {
    code = code.replace(OLD_ROUTE, NEW_ROUTE);
    console.log('[Task 3c] isDm check + DM route lookup added');
  } else {
    console.warn('[Task 3c] WARNING: route lookup pattern not found');
  }

  crNode.parameters.jsCode = code;
}

// ── Task 3d: Update guildId in Channel Router return to be empty for DMs ──────
{
  const crNode = d.nodes.find(n => n.name === 'Channel Router');
  let code = crNode.parameters.jsCode;

  const OLD_GUILD = "    guildId: GUILD_ID,";
  const NEW_GUILD = "    guildId: isDm ? '' : GUILD_ID,";

  if (code.includes(NEW_GUILD)) {
    console.log('[Task 3d] guildId DM check already present — skipping');
  } else if (code.includes(OLD_GUILD)) {
    code = code.replace(OLD_GUILD, NEW_GUILD);
    console.log('[Task 3d] guildId updated to empty string for DMs');
  } else {
    console.warn('[Task 3d] WARNING: guildId pattern not found');
  }

  crNode.parameters.jsCode = code;
}

// ── Verify ────────────────────────────────────────────────────────────────────
const checks = [
  ['Fetch Last n8n Error', d.nodes.find(n => n.name === 'Fetch Last n8n Error') ? 'EXISTS' : 'MISSING'],
  ['Format Recipes Reply', d.nodes.find(n => n.name === 'Format Recipes Reply') ? 'EXISTS' : 'MISSING'],
  ['Query Status → Fetch Last n8n Error', (d.connections['Query Status']?.main?.[0]?.[0]?.node === 'Fetch Last n8n Error') ? 'OK' : 'MISSING'],
  ['Fetch Last n8n Error → Format Status Reply', (d.connections['Fetch Last n8n Error']?.main?.[0]?.[0]?.node === 'Format Status Reply') ? 'OK' : 'MISSING'],
  ['Query Recipes → Format Recipes Reply', (d.connections['Query Recipes']?.main?.[0]?.[0]?.node === 'Format Recipes Reply') ? 'OK' : 'MISSING'],
  ['Format Recipes Reply → Reply Recipes', (d.connections['Format Recipes Reply']?.main?.[0]?.[0]?.node === 'Reply Recipes') ? 'OK' : 'MISSING'],
];
const crCode = d.nodes.find(n => n.name === 'Channel Router').parameters.jsCode;
checks.push(["Channel Router 'dm' routing", crCode.includes("'dm':             {") ? 'OK' : 'MISSING']);
checks.push(["Channel Router isDm", crCode.includes('isDm') ? 'OK' : 'MISSING']);
checks.push(['Parse Claude Reply splitChunks', d.nodes.find(n => n.name === 'Parse Claude Reply').parameters.jsCode.includes('splitChunks') ? 'OK' : 'MISSING']);
checks.push(['Format Status Reply errorBlock', d.nodes.find(n => n.name === 'Format Status Reply').parameters.jsCode.includes('errorBlock') ? 'OK' : 'MISSING']);

checks.forEach(([label, val]) => console.log(label + ': ' + val));

// ── Write & validate ──────────────────────────────────────────────────────────
fs.writeFileSync('./workflows/discord-bruce.json', JSON.stringify(d, null, 2));
JSON.parse(fs.readFileSync('./workflows/discord-bruce.json', 'utf8'));
console.log('\nWorkflow JSON valid. Done.');
