#!/usr/bin/env node
/**
 * import-workflow.js
 *
 * Pushes `workflows/discord-bruce.json` to the n8n REST API so it can be
 * updated without going through the n8n UI (which is annoying for a
 * 44-node workflow).
 *
 * ---------------------------------------------------------------------------
 * Usage
 * ---------------------------------------------------------------------------
 *   # From repo root (Node 18+ required — uses global fetch):
 *   node scripts/import-workflow.js [workflow-id]
 *
 * If you don't pass a workflow-id, the script looks up the workflow by
 * name (`.name` field in the JSON — currently "Discord — Bruce").
 *
 * ---------------------------------------------------------------------------
 * Env vars
 * ---------------------------------------------------------------------------
 *   N8N_BASE_URL    defaults to http://147.182.142.176:5678
 *                   (use https://n8n.creativeoutletcoding.com from outside
 *                   the VPS; use http://localhost:5678 from on the VPS)
 *
 *   N8N_API_KEY     PREFERRED. Generate in n8n UI: Settings → n8n API →
 *                   "Create an API key". The /api/v1/* endpoints require
 *                   this header. Basic auth only protects the editor UI.
 *
 *   N8N_BASIC_AUTH_USER / N8N_BASIC_AUTH_PASSWORD
 *                   Fallback. Unlikely to work against /api/v1 but the
 *                   script attempts it if no API key is set.
 *
 * ---------------------------------------------------------------------------
 * What it does
 * ---------------------------------------------------------------------------
 *   1. Reads workflows/discord-bruce.json from disk.
 *   2. GETs /api/v1/workflows to find the matching workflow id by name
 *      (skipped if you pass an explicit id on the command line).
 *   3. PUTs the payload to /api/v1/workflows/{id}. The PUT body is stripped
 *      to the fields n8n accepts (name, nodes, connections, settings,
 *      staticData) — extra fields like id/active/meta/versionId/pinData
 *      cause 400 errors.
 *   4. Verifies credentials on the returned workflow: every Postgres node
 *      must reference EHBRO07aceirmFzt and every Discord node must
 *      reference om7VabWMiA8gC2i3. Any mismatch is printed as a warning
 *      but does not exit non-zero (so you can see the full picture).
 *
 * Activation is NOT handled here — see scripts/sync-workflow.sh for the
 * full deploy flow with deactivate/put/activate.
 */

const fs = require('fs');
const path = require('path');

const {
  N8N_BASE_URL = 'http://147.182.142.176:5678',
  N8N_API_KEY,
  N8N_BASIC_AUTH_USER,
  N8N_BASIC_AUTH_PASSWORD,
} = process.env;

const EXPECTED_POSTGRES_CRED = 'EHBRO07aceirmFzt';
const EXPECTED_DISCORD_CRED = 'om7VabWMiA8gC2i3';

const WORKFLOW_PATH = path.resolve(__dirname, '..', 'workflows', 'discord-bruce.json');

function authHeaders() {
  if (N8N_API_KEY) return { 'X-N8N-API-KEY': N8N_API_KEY };
  if (N8N_BASIC_AUTH_USER && N8N_BASIC_AUTH_PASSWORD) {
    const creds = Buffer.from(`${N8N_BASIC_AUTH_USER}:${N8N_BASIC_AUTH_PASSWORD}`).toString('base64');
    console.warn('[warn] Using HTTP Basic auth — n8n /api/v1 usually requires N8N_API_KEY.');
    return { Authorization: `Basic ${creds}` };
  }
  throw new Error(
    'Missing auth. Set N8N_API_KEY (preferred) or N8N_BASIC_AUTH_USER + N8N_BASIC_AUTH_PASSWORD.'
  );
}

async function api(method, pathname, body) {
  const url = `${N8N_BASE_URL}${pathname}`;
  const res = await fetch(url, {
    method,
    headers: {
      ...authHeaders(),
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
  if (!res.ok) {
    const snippet = typeof parsed === 'object' ? JSON.stringify(parsed).slice(0, 500) : String(parsed).slice(0, 500);
    throw new Error(`${method} ${pathname} -> ${res.status}: ${snippet}`);
  }
  return parsed;
}

function verifyCreds(nodes) {
  const pgBad = [];
  const dcBad = [];
  for (const n of nodes) {
    if (n.type === 'n8n-nodes-base.postgres') {
      const id = n.credentials?.postgres?.id ?? '';
      if (id !== EXPECTED_POSTGRES_CRED) pgBad.push({ name: n.name, got: id });
    }
    if (n.type === 'n8n-nodes-base.discord') {
      const id = n.credentials?.discordBotApi?.id ?? '';
      if (id !== EXPECTED_DISCORD_CRED) dcBad.push({ name: n.name, got: id });
    }
  }
  return { pgBad, dcBad };
}

(async () => {
  const explicitId = process.argv[2];

  const local = JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf-8'));
  console.log(`read workflow: name="${local.name}", nodes=${local.nodes?.length ?? 0}`);

  // Sanity: creds should already be right in the local JSON before we push.
  const preCheck = verifyCreds(local.nodes || []);
  if (preCheck.pgBad.length || preCheck.dcBad.length) {
    console.warn('[warn] Local file has credential issues BEFORE upload:');
    preCheck.pgBad.forEach((x) => console.warn(`  postgres -> ${x.name} (got ${x.got || 'blank'})`));
    preCheck.dcBad.forEach((x) => console.warn(`  discord  -> ${x.name} (got ${x.got || 'blank'})`));
  }

  // --- Find workflow id ----------------------------------------------------
  let id = explicitId;
  if (!id) {
    const list = await api('GET', '/api/v1/workflows');
    const items = Array.isArray(list.data) ? list.data : Array.isArray(list) ? list : [];
    const match = items.find((w) => w.name === local.name);
    if (!match) {
      const names = items.map((w) => w.name).join(', ') || '(none)';
      throw new Error(`Workflow "${local.name}" not found. Available: ${names}`);
    }
    id = match.id;
    console.log(`found workflow id=${id} (active=${match.active})`);
  } else {
    console.log(`using explicit workflow id=${id}`);
  }

  // --- Build PUT payload ---------------------------------------------------
  // n8n rejects extra fields. Keep only the accepted shape.
  const payload = {
    name: local.name,
    nodes: local.nodes,
    connections: local.connections,
    settings: local.settings ?? {},
    staticData: local.staticData ?? null,
  };

  // --- PUT -----------------------------------------------------------------
  const updated = await api('PUT', `/api/v1/workflows/${id}`, payload);
  console.log(`PUT ok: id=${updated.id} name="${updated.name}" nodes=${updated.nodes?.length ?? '?'}`);

  // --- Verify credentials persisted ---------------------------------------
  const post = verifyCreds(updated.nodes || []);
  const okAll = post.pgBad.length === 0 && post.dcBad.length === 0;

  if (post.pgBad.length) {
    console.warn(`[warn] ${post.pgBad.length} Postgres node(s) missing/wrong cred id ${EXPECTED_POSTGRES_CRED}:`);
    post.pgBad.forEach((x) => console.warn(`    - ${x.name} (got ${x.got || 'blank'})`));
  }
  if (post.dcBad.length) {
    console.warn(`[warn] ${post.dcBad.length} Discord node(s) missing/wrong cred id ${EXPECTED_DISCORD_CRED}:`);
    post.dcBad.forEach((x) => console.warn(`    - ${x.name} (got ${x.got || 'blank'})`));
  }
  if (okAll) console.log('credentials OK on all postgres + discord nodes');

  console.log('DONE');
})().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
