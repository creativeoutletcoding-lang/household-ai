#!/usr/bin/env node
// scripts/transfer-ownership.js
//
// ─── IMPORTANT: READ BEFORE RUNNING ────────────────────────────────────────
//
// Discord API limitation — bots cannot own guilds:
//   The PATCH /guilds/{id} owner_id endpoint rejects bot accounts as the new
//   owner. Additionally, the request must come from the current owner using a
//   *user* OAuth2 token, not a bot token. There is no workaround. Transferring
//   ownership TO the Bruce bot account (1495252972026859520) is not possible
//   via the API under any circumstances.
//
//   If you want to transfer server ownership, it must be done manually:
//   Server Settings → Members → right-click current owner → Transfer Ownership
//   Note: Discord requires MFA to be enabled on your account to do this.
//
// Discord permission limitation — ADMINISTRATOR overrides everything:
//   A role with the ADMINISTRATOR bit set grants every permission, including
//   Manage Threads, regardless of other flag states. Denying Manage Threads on
//   a channel or in a role is silently ignored when ADMINISTRATOR is present.
//
//   To create an "Admin" role that genuinely cannot manage threads, this script
//   grants all permissions *except* ADMINISTRATOR and ManageThreads. Jake will
//   have full control of the server (kick, ban, manage roles, manage channels,
//   etc.) without the Manage Threads capability.
//
// ─── WHAT THIS SCRIPT DOES ──────────────────────────────────────────────────
//
//   1. Creates an "Admin" role with all server permissions except ADMINISTRATOR
//      and ManageThreads (see note above).
//   2. Assigns the Admin role to Jake (user ID 1495249206087127052).
//   3. Verifies Jake's effective permissions on the server.
//   4. Logs the current guild owner (for confirmation that manual ownership
//      transfer has/hasn't happened).
//   5. Reports the role and permission summary for all family members.
//
// ─── USAGE ──────────────────────────────────────────────────────────────────
//
//   cd scripts && node transfer-ownership.js
//   (requires discord.js and dotenv — run `npm install` in scripts/ first)
//
// ────────────────────────────────────────────────────────────────────────────

'use strict';

const fs   = require('fs');
const path = require('path');
const readline = require('readline');
const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');

// ── Config ───────────────────────────────────────────────────────────────────

const BOT_USER_ID  = '1495252972026859520'; // Bruce
const JAKE_USER_ID = '1495249206087127052';

const FAMILY_MEMBERS = {
  Jake:       '1495249206087127052',
  Laurianne:  '1495518533428314112',
  Nana:       '1495888856078225528',
  Joce:       '638831837245997066',
};

// ── Load .env from repo root ──────────────────────────────────────────────────

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  const lines   = fs.readFileSync(envPath, 'utf8').split('\n');
  const env     = {};
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 1) continue;
    env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return env;
}

const env       = loadEnv();
const TOKEN     = env.DISCORD_BOT_TOKEN;
const SERVER_ID = env.DISCORD_SERVER_ID;

if (!TOKEN || !SERVER_ID) {
  console.error('ERROR: DISCORD_BOT_TOKEN or DISCORD_SERVER_ID missing from .env');
  process.exit(1);
}

// ── Permission mask ───────────────────────────────────────────────────────────
//
// All permissions the Discord API knows about, minus:
//   - ADMINISTRATOR  (would override ManageThreads exclusion)
//   - ManageThreads  (intentionally excluded per requirements)

const ALL_PERMS = PermissionsBitField.All;
const ADMIN_ROLE_PERMS = ALL_PERMS
  & ~PermissionsBitField.Flags.Administrator
  & ~PermissionsBitField.Flags.ManageThreads;

// ── Confirmation prompt ───────────────────────────────────────────────────────

function prompt(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => { rl.close(); resolve(answer.trim()); });
  });
}

async function confirmOrAbort() {
  console.log('\n' + '─'.repeat(70));
  console.log('  HOUSEHOLD AI — Discord Admin Role Setup');
  console.log('─'.repeat(70));
  console.log('\n  SERVER : ' + SERVER_ID);
  console.log('  BOT    : ' + BOT_USER_ID + ' (Bruce — cannot receive ownership via API)');
  console.log('\n  ⚠️  OWNERSHIP TRANSFER REMINDER');
  console.log('  Discord does not allow bots to own guilds. If you want to change');
  console.log('  server ownership, do it manually first:');
  console.log('  Server Settings → Members → right-click owner → Transfer Ownership');
  console.log();
  console.log('  THIS SCRIPT WILL:');
  console.log('  1. Create role "Admin" with all permissions EXCEPT Administrator');
  console.log('     and ManageThreads');
  console.log('  2. Assign that role to Jake (' + JAKE_USER_ID + ')');
  console.log('  3. Verify Jake\'s effective permissions');
  console.log('  4. Report role summary for all family members');
  console.log('\n  ⚠️  This modifies the live Discord server immediately.');
  console.log('─'.repeat(70) + '\n');

  const answer = await prompt('  Type "yes" to proceed, anything else to abort: ');
  if (answer.toLowerCase() !== 'yes') {
    console.log('\nAborted — no changes made.\n');
    process.exit(0);
  }
  console.log();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  await confirmOrAbort();

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });

  await client.login(TOKEN);
  console.log(`Logged in as ${client.user.tag} (${client.user.id})`);

  // Fetch guild with full member cache
  const guild = await client.guilds.fetch(SERVER_ID);
  await guild.members.fetch(); // populates cache for all members

  // ── 1. Current owner ────────────────────────────────────────────────────────
  console.log(`\nCurrent guild owner ID: ${guild.ownerId}`);
  if (guild.ownerId === BOT_USER_ID) {
    console.log('  ✅ Guild is already owned by Bruce bot.');
  } else {
    console.log('  ℹ️  Guild is NOT owned by Bruce. To transfer, do it manually in Discord UI.');
    console.log('     (Bots cannot receive ownership via the API — this is a Discord limitation.)');
  }

  // ── 2. Create Admin role ─────────────────────────────────────────────────────
  const existingAdmin = guild.roles.cache.find(r => r.name === 'Admin');
  let adminRole;

  if (existingAdmin) {
    console.log(`\nAdmin role already exists (${existingAdmin.id}) — updating permissions...`);
    adminRole = await existingAdmin.edit({
      permissions: ADMIN_ROLE_PERMS,
      reason: 'household-ai setup: Admin role — all perms except Administrator and ManageThreads',
    });
    console.log('  ✅ Admin role permissions updated.');
  } else {
    console.log('\nCreating Admin role...');
    adminRole = await guild.roles.create({
      name: 'Admin',
      permissions: ADMIN_ROLE_PERMS,
      color: 0xe74c3c,   // red — visually distinct
      hoist: true,       // shown separately in member list
      mentionable: false,
      reason: 'household-ai setup: Admin role — all perms except Administrator and ManageThreads',
    });
    console.log(`  ✅ Admin role created: ${adminRole.id}`);
  }

  // Confirm ManageThreads and Administrator are excluded
  const effective = new PermissionsBitField(adminRole.permissions);
  const hasAdmin  = effective.has(PermissionsBitField.Flags.Administrator);
  const hasThreads = effective.has(PermissionsBitField.Flags.ManageThreads);
  console.log(`  Administrator bit: ${hasAdmin  ? '❌ PRESENT (unexpected)' : '✅ absent'}`);
  console.log(`  ManageThreads bit: ${hasThreads ? '❌ PRESENT (unexpected)' : '✅ absent'}`);

  if (hasAdmin || hasThreads) {
    console.error('\nERROR: Role has unexpected permissions. Aborting before assigning to Jake.');
    await client.destroy();
    process.exit(1);
  }

  // ── 3. Assign Admin role to Jake ─────────────────────────────────────────────
  console.log(`\nAssigning Admin role to Jake (${JAKE_USER_ID})...`);
  let jakeMember;
  try {
    jakeMember = await guild.members.fetch(JAKE_USER_ID);
  } catch {
    console.error(`  ERROR: Could not fetch Jake's member record. Is user ${JAKE_USER_ID} in this server?`);
    await client.destroy();
    process.exit(1);
  }

  if (jakeMember.roles.cache.has(adminRole.id)) {
    console.log('  ✅ Jake already has the Admin role.');
  } else {
    await jakeMember.roles.add(adminRole, 'household-ai setup: grant Admin role to Jake');
    console.log('  ✅ Admin role assigned to Jake.');
  }

  // ── 4. Verify Jake's effective permissions ────────────────────────────────────
  console.log('\nJake\'s effective server permissions:');
  const jakePerms = jakeMember.permissions;
  const KEY_PERMS = [
    'KickMembers', 'BanMembers', 'ManageChannels', 'ManageGuild',
    'ManageMessages', 'ManageRoles', 'ManageWebhooks', 'ManageNicknames',
    'ManageThreads', 'Administrator', 'ModerateMembers',
  ];
  for (const perm of KEY_PERMS) {
    const flag = PermissionsBitField.Flags[perm];
    const has  = flag !== undefined && jakePerms.has(flag);
    const mark = perm === 'ManageThreads' || perm === 'Administrator'
      ? (has ? '❌ HAS (should be absent)' : '✅ absent (correct)')
      : (has ? '✅ yes' : '⚠️  no');
    console.log(`  ${perm.padEnd(20)} ${mark}`);
  }

  // ── 5. Family member role summary ────────────────────────────────────────────
  console.log('\nFamily member role summary:');
  for (const [name, userId] of Object.entries(FAMILY_MEMBERS)) {
    try {
      const member = await guild.members.fetch(userId);
      const roles  = member.roles.cache
        .filter(r => r.name !== '@everyone')
        .map(r => r.name)
        .join(', ') || '(none)';
      console.log(`  ${name.padEnd(12)} ${userId}  roles: ${roles}`);
    } catch {
      console.log(`  ${name.padEnd(12)} ${userId}  ⚠️  not in server / could not fetch`);
    }
  }

  console.log('\nDone.\n');
  await client.destroy();
}

main().catch(err => {
  console.error('\nFatal error:', err.message || err);
  process.exit(1);
});
