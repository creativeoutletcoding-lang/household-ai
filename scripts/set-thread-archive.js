#!/usr/bin/env node
// set-thread-archive.js
// Sets default_auto_archive_duration=4320 (3 days) on every text channel
// in the Discord server. Run from the repo root on the VPS.
//
// Usage: node scripts/set-thread-archive.js

const fs = require('fs');
const path = require('path');

// Parse .env from repo root
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    env[key] = val;
  }
  return env;
}

const env = loadEnv();
const TOKEN     = env.DISCORD_BOT_TOKEN;
const SERVER_ID = env.DISCORD_SERVER_ID;

if (!TOKEN || !SERVER_ID) {
  console.error('Missing DISCORD_BOT_TOKEN or DISCORD_SERVER_ID in .env');
  process.exit(1);
}

const API = 'https://discord.com/api/v10';
const HEADERS = {
  Authorization: `Bot ${TOKEN}`,
  'Content-Type': 'application/json',
  'User-Agent': 'household-ai-setup/1.0',
};

async function getChannels() {
  const res = await fetch(`${API}/guilds/${SERVER_ID}/channels`, { headers: HEADERS });
  if (!res.ok) throw new Error(`GET channels failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function setArchiveDuration(channel) {
  const res = await fetch(`${API}/channels/${channel.id}`, {
    method: 'PATCH',
    headers: HEADERS,
    body: JSON.stringify({ default_auto_archive_duration: 4320 }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.warn(`  SKIP ${channel.name}: ${res.status} ${body.slice(0, 120)}`);
    return false;
  }
  return true;
}

async function main() {
  const channels = await getChannels();

  // Type 0 = GUILD_TEXT, Type 5 = GUILD_ANNOUNCEMENT — both support default_auto_archive_duration
  const textChannels = channels.filter(c => c.type === 0 || c.type === 5);
  console.log(`Found ${textChannels.length} text/announcement channels in server ${SERVER_ID}`);

  let ok = 0, skip = 0;
  for (const ch of textChannels) {
    const current = ch.default_auto_archive_duration;
    if (current === 4320) {
      console.log(`  ALREADY SET  #${ch.name}`);
      ok++;
      continue;
    }
    const success = await setArchiveDuration(ch);
    if (success) {
      console.log(`  SET 3d       #${ch.name} (was ${current ?? 'unset'})`);
      ok++;
    } else {
      skip++;
    }
    // Respect Discord rate limit: 5 req/s per route
    await new Promise(r => setTimeout(r, 250));
  }

  console.log(`\nDone: ${ok} set/confirmed, ${skip} skipped`);
}

main().catch(err => { console.error(err); process.exit(1); });
