// apply-batch-6-hotfix.js
// Fix 1: Add 'dm' persona to Channel Router PERSONAS (was skipped in batch-6 due to
//         false match — 'dm': in ROUTING was found before PERSONAS was checked)
// Fix 2: Update Fetch Last n8n Error URL to include &includeData=true
// Fix 3: Fix Format Status Reply to read resultData.error + runData from response
// Run: node apply-batch-6-hotfix.js

'use strict';
const fs = require('fs');
const d = JSON.parse(fs.readFileSync('./workflows/discord-bruce.json', 'utf8'));

// ── Fix 1: Add 'dm' persona to Channel Router PERSONAS ────────────────────────
{
  const crNode = d.nodes.find(n => n.name === 'Channel Router');
  let code = crNode.parameters.jsCode;

  // Find PERSONAS block (starts AFTER ROUTING ends)
  const personasStart = code.indexOf('const PERSONAS');
  if (personasStart === -1) {
    console.error('[Fix 1] PERSONAS block not found');
    process.exit(1);
  }

  // Check if 'dm' is already in PERSONAS (not just in ROUTING)
  const dmInPersonas = code.indexOf("'dm':", personasStart);
  if (dmInPersonas !== -1) {
    console.log('[Fix 1] dm persona already in PERSONAS — skipping');
  } else {
    // Find the closing }; of PERSONAS
    const PERSONAS_END_PATTERN = "and do search automatically.\`,\n};";
    if (!code.includes(PERSONAS_END_PATTERN)) {
      console.error('[Fix 1] PERSONAS closing pattern not found');
      process.exit(1);
    }

    const DM_PERSONA =
      "  'dm': `You are Bruce, the household AI. This is a private DM conversation. " +
      "Be helpful, warm, and conversational — this is a one-on-one space, so you can be more personal than in shared channels. " +
      "Address the person directly and match their energy.\n\n" +
      "You have web search capabilities via Perplexity that trigger automatically for real-time queries, URLs, and current events. " +
      "Never say you lack real-time data, cannot access the internet, or cannot check current information — you can and do search automatically.\n\n" +
      "You are Bruce, the household AI. Your channel has a topic focus but you are not limited to it. " +
      "Handle normal conversation, relay messages, and be socially aware. " +
      "Never say \"that's outside my lane\" or \"I'm just the [topic] guy.\" " +
      "If someone tags another family member, you know who they are.\n\n" +
      "You have web search capabilities via Perplexity that trigger automatically for real-time queries, URLs, and current events. " +
      "Never say you lack real-time data, cannot access the internet, or cannot check current information — you can and do search automatically.\`,";

    const NEW_END = DM_PERSONA + "\n};";
    code = code.replace(PERSONAS_END_PATTERN, "and do search automatically.\`,\n" + NEW_END);
    console.log('[Fix 1] dm persona added to PERSONAS');

    // Verify
    const checkIdx = code.indexOf("'dm':", code.indexOf('const PERSONAS'));
    console.log('[Fix 1] Verify dm in PERSONAS at:', checkIdx, checkIdx > code.indexOf('const PERSONAS') ? 'OK' : 'MISSING');
  }

  crNode.parameters.jsCode = code;
}

// ── Fix 2: Update Fetch Last n8n Error URL to include includeData=true ────────
{
  const node = d.nodes.find(n => n.name === 'Fetch Last n8n Error');
  if (!node) {
    console.error('[Fix 2] Fetch Last n8n Error node not found');
    process.exit(1);
  }
  const OLD_URL = 'http://127.0.0.1:5678/api/v1/executions?status=error&limit=1';
  const NEW_URL = 'http://127.0.0.1:5678/api/v1/executions?status=error&limit=1&includeData=true';
  if (node.parameters.url === NEW_URL) {
    console.log('[Fix 2] URL already has includeData=true — skipping');
  } else if (node.parameters.url === OLD_URL) {
    node.parameters.url = NEW_URL;
    console.log('[Fix 2] Fetch Last n8n Error URL updated with includeData=true');
  } else {
    console.warn('[Fix 2] WARNING: unexpected URL:', node.parameters.url);
  }
}

// ── Fix 3: Update Format Status Reply to read from correct response fields ────
{
  const node = d.nodes.find(n => n.name === 'Format Status Reply');
  node.parameters.jsCode = [
    "// Stats come from Query Status (Postgres). Last-error comes from Fetch Last n8n Error (HTTP).",
    "// The HTTP node calls /api/v1/executions?status=error&limit=1&includeData=true",
    "// Response structure: { data: [{ id, startedAt, data: { resultData: { error: {...}, runData: {...} } } }] }",
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
    "    // resultData.runData keys = nodes that ran before the error",
    "    const runData = (ex.data && ex.data.resultData && ex.data.resultData.runData) || {};",
    "    const ran = Object.keys(runData);",
    "    const lastNode = ran.length ? ran[ran.length - 1] : 'unknown';",
    "    // resultData.error has the error message",
    "    const errObj = (ex.data && ex.data.resultData && ex.data.resultData.error) || {};",
    "    const errType = errObj.description || errObj.name || '';",
    "    const errMsg = errObj.message ? errObj.message.slice(0, 100) : '';",
    "    const errDetail = errType ? errType + ': ' + errMsg : errMsg;",
    "    errorBlock = '\\n\\n**Last Error** (' + errTime + ')' +",
    "      '\\n  Last OK node: ' + lastNode +",
    "      (errDetail ? ('\\n  Error: ' + errDetail) : '');",
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
  console.log('[Fix 3] Format Status Reply updated with correct field paths');
}

// ── Verify ────────────────────────────────────────────────────────────────────
const crCode = d.nodes.find(n => n.name === 'Channel Router').parameters.jsCode;
const personasStart = crCode.indexOf('const PERSONAS');
const dmInPersonas = crCode.indexOf("'dm':", personasStart);
console.log('\ndm persona in PERSONAS:', dmInPersonas > personasStart ? 'OK' : 'MISSING');
const fetchNode = d.nodes.find(n => n.name === 'Fetch Last n8n Error');
console.log('Fetch Last n8n Error URL includeData:', fetchNode.parameters.url.includes('includeData') ? 'OK' : 'MISSING');
const fsr = d.nodes.find(n => n.name === 'Format Status Reply');
console.log('Format Status Reply resultData:', fsr.parameters.jsCode.includes('resultData') ? 'OK' : 'MISSING');
console.log('Format Status Reply runData:', fsr.parameters.jsCode.includes('runData') ? 'OK' : 'MISSING');

// ── Write & validate ──────────────────────────────────────────────────────────
fs.writeFileSync('./workflows/discord-bruce.json', JSON.stringify(d, null, 2));
JSON.parse(fs.readFileSync('./workflows/discord-bruce.json', 'utf8'));
console.log('\nWorkflow JSON valid. Done.');
