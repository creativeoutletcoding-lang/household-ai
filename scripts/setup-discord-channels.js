#!/usr/bin/env node
/**
 * setup-discord-channels.js
 *
 * Idempotent provisioner for the Household AI Discord server.
 * Run this whenever you add a new channel/category to the config below — it
 * skips anything that already exists and only creates what's missing.
 *
 * Usage:
 *   cd scripts
 *   npm install
 *   node setup-discord-channels.js
 *
 * Required env (from the root .env, which we load via dotenv):
 *   DISCORD_BOT_TOKEN   - the bot's token from the Developer Portal
 *   DISCORD_SERVER_ID   - the guild (server) ID to provision
 *
 * Optional env — if set, the listed family members get explicit access to
 * their own/shared categories. If not set, those overrides are skipped with
 * a warning and you can add the users manually in Discord when they join.
 *   DISCORD_JAKE_USER_ID
 *   DISCORD_LOUBI_USER_ID
 *   DISCORD_JOCE_USER_ID
 *   DISCORD_NANA_USER_ID
 */

'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionFlagsBits,
  OverwriteType,
} = require('discord.js');

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------
const TOKEN     = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID  = process.env.DISCORD_SERVER_ID;
const JAKE_ID   = process.env.DISCORD_JAKE_USER_ID  || null;
const LOUBI_ID  = process.env.DISCORD_LOUBI_USER_ID || null;
const JOCE_ID   = process.env.DISCORD_JOCE_USER_ID  || null;
const NANA_ID   = process.env.DISCORD_NANA_USER_ID  || null;

if (!TOKEN || !GUILD_ID) {
  console.error('ERROR: DISCORD_BOT_TOKEN and DISCORD_SERVER_ID must be set in .env');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Desired structure
//
// For each category:
//   name            - the visible category name (UPPERCASE convention)
//   visibility      - "public" | "private-jake" | "private-lake" | "private-cps"
//                   | "placeholder-loubi" | "placeholder-joce" | "placeholder-nana"
//   channels        - array of { name, announcements?: true }
//
// visibility decides the permission overwrites applied on the category; child
// channels inherit them unless they have their own overrides (only the
// `announcements` flag triggers a per-channel override today).
// ---------------------------------------------------------------------------
const STRUCTURE = [
  {
    name: 'SHARED',
    visibility: 'public',
    channels: [
      { name: 'general' },
      { name: 'family' },
      { name: 'announcements', announcements: true },
    ],
  },
  {
    name: 'JAKE',
    visibility: 'private-jake',
    channels: [
      { name: 'fig' },
      { name: 'jake-personal' },
    ],
  },
  {
    name: 'LAKE',
    visibility: 'private-lake',
    channels: [
      { name: 'lake' },
    ],
  },
  {
    name: 'CPS',
    visibility: 'private-cps',
    channels: [
      { name: 'cps' },
    ],
  },
  {
    name: 'LOUBI',
    visibility: 'placeholder-loubi',
    channels: [
      { name: 'loubi-personal' },
      { name: 'wis' },
    ],
  },
  {
    name: 'JOCE',
    visibility: 'placeholder-joce',
    channels: [
      { name: 'joce-personal' },
      { name: 'joce-school' },
    ],
  },
  {
    name: 'NANA',
    visibility: 'placeholder-nana',
    channels: [
      { name: 'nana-personal' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Permission helpers
// ---------------------------------------------------------------------------
const P = PermissionFlagsBits;
const BASE_MEMBER_ALLOW = P.ViewChannel | P.SendMessages | P.ReadMessageHistory;
const BOT_ALLOW = BASE_MEMBER_ALLOW | P.ManageMessages | P.EmbedLinks | P.AttachFiles;

/**
 * Build the list of permission overwrites for a category, given the guild
 * (needed for @everyone role id) and the bot's own user id.
 */
function overwritesFor(visibility, { everyoneRoleId, botUserId }) {
  const overwrites = [];

  // Bot always has access.
  overwrites.push({
    id: botUserId,
    type: OverwriteType.Member,
    allow: BOT_ALLOW,
  });

  switch (visibility) {
    case 'public':
      // @everyone: read + write. No special denies here — announcements is
      // handled per-channel below.
      overwrites.push({
        id: everyoneRoleId,
        type: OverwriteType.Role,
        allow: BASE_MEMBER_ALLOW,
      });
      break;

    case 'private-jake':
      overwrites.push({
        id: everyoneRoleId,
        type: OverwriteType.Role,
        deny:  P.ViewChannel,
      });
      if (JAKE_ID) {
        overwrites.push({ id: JAKE_ID, type: OverwriteType.Member, allow: BASE_MEMBER_ALLOW });
      }
      break;

    case 'private-lake':
      overwrites.push({
        id: everyoneRoleId,
        type: OverwriteType.Role,
        deny:  P.ViewChannel,
      });
      if (JAKE_ID)  overwrites.push({ id: JAKE_ID,  type: OverwriteType.Member, allow: BASE_MEMBER_ALLOW });
      if (LOUBI_ID) overwrites.push({ id: LOUBI_ID, type: OverwriteType.Member, allow: BASE_MEMBER_ALLOW });
      break;

    case 'private-cps':
      overwrites.push({
        id: everyoneRoleId,
        type: OverwriteType.Role,
        deny:  P.ViewChannel,
      });
      if (JAKE_ID) overwrites.push({ id: JAKE_ID, type: OverwriteType.Member, allow: BASE_MEMBER_ALLOW });
      if (NANA_ID) overwrites.push({ id: NANA_ID, type: OverwriteType.Member, allow: BASE_MEMBER_ALLOW });
      break;

    case 'placeholder-loubi':
      overwrites.push({ id: everyoneRoleId, type: OverwriteType.Role, deny: P.ViewChannel });
      if (LOUBI_ID) overwrites.push({ id: LOUBI_ID, type: OverwriteType.Member, allow: BASE_MEMBER_ALLOW });
      break;

    case 'placeholder-joce':
      overwrites.push({ id: everyoneRoleId, type: OverwriteType.Role, deny: P.ViewChannel });
      if (JOCE_ID) overwrites.push({ id: JOCE_ID, type: OverwriteType.Member, allow: BASE_MEMBER_ALLOW });
      break;

    case 'placeholder-nana':
      overwrites.push({ id: everyoneRoleId, type: OverwriteType.Role, deny: P.ViewChannel });
      if (NANA_ID) overwrites.push({ id: NANA_ID, type: OverwriteType.Member, allow: BASE_MEMBER_ALLOW });
      break;

    default:
      throw new Error(`Unknown visibility: ${visibility}`);
  }

  return overwrites;
}

/**
 * Per-channel overrides for announcement channels:
 * everyone can read, but only bot + Jake can send.
 */
function announcementOverwrites({ everyoneRoleId, botUserId }) {
  const ow = [
    {
      id: everyoneRoleId,
      type: OverwriteType.Role,
      allow: P.ViewChannel | P.ReadMessageHistory,
      deny:  P.SendMessages,
    },
    {
      id: botUserId,
      type: OverwriteType.Member,
      allow: BOT_ALLOW,
    },
  ];
  if (JAKE_ID) {
    ow.push({ id: JAKE_ID, type: OverwriteType.Member, allow: BASE_MEMBER_ALLOW });
  }
  return ow;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  const guild = await client.guilds.fetch(GUILD_ID).catch((e) => {
    console.error(`Could not fetch guild ${GUILD_ID}: ${e.message}`);
    console.error('Make sure the bot has been invited to the server.');
    process.exit(1);
  });

  // Warn (but don't fail) for missing optional user IDs.
  for (const [k, v] of Object.entries({ JAKE_ID, LOUBI_ID, JOCE_ID, NANA_ID })) {
    if (!v) console.log(`  - ${k} not set — will skip explicit grant; add the user manually when ready`);
  }

  const everyoneRoleId = guild.roles.everyone.id;
  const botUserId      = client.user.id;
  const ctx            = { everyoneRoleId, botUserId };

  // Prime caches so we see every existing channel.
  await guild.channels.fetch();

  const existingCategories = new Map(); // name -> channel
  const existingChannels   = new Map(); // `${parentId}:${name}` -> channel

  for (const ch of guild.channels.cache.values()) {
    if (ch.type === ChannelType.GuildCategory) {
      existingCategories.set(ch.name, ch);
    } else if (ch.type === ChannelType.GuildText) {
      const key = `${ch.parentId || 'none'}:${ch.name}`;
      existingChannels.set(key, ch);
    }
  }

  let created = 0, skipped = 0;

  for (const cat of STRUCTURE) {
    let category = existingCategories.get(cat.name);

    if (!category) {
      console.log(`+ Creating category   ${cat.name}  (visibility: ${cat.visibility})`);
      category = await guild.channels.create({
        name: cat.name,
        type: ChannelType.GuildCategory,
        permissionOverwrites: overwritesFor(cat.visibility, ctx),
      });
      created++;
    } else {
      console.log(`= Category exists     ${cat.name}  (skipping create)`);
      skipped++;
      // NOTE: we intentionally do NOT overwrite permissions on an existing
      // category — the user may have tweaked them by hand. Handle by-hand
      // fixes in Discord, not here.
    }

    for (const chDef of cat.channels) {
      const key = `${category.id}:${chDef.name}`;
      if (existingChannels.has(key)) {
        console.log(`=   Channel exists      #${chDef.name}`);
        skipped++;
        continue;
      }

      console.log(`+   Creating channel    #${chDef.name}`);
      const overrides = chDef.announcements
        ? announcementOverwrites(ctx)
        : undefined; // inherit from parent
      await guild.channels.create({
        name: chDef.name,
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites: overrides,
      });
      created++;
    }
  }

  console.log('');
  console.log(`Done. Created ${created}, skipped ${skipped}.`);
  client.destroy();
  process.exit(0);
});

client.on('error', (e) => {
  console.error('Discord client error:', e);
  process.exit(1);
});

client.login(TOKEN);
