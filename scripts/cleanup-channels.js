// cleanup-channels.js
// Audit Discord channels: report uncategorized channels and any duplicate
// #general channels outside the SHARED category. Prints a report and
// optionally deletes/moves with --apply flag.
//
// Usage:
//   node scripts/cleanup-channels.js           — dry run (report only)
//   node scripts/cleanup-channels.js --apply   — delete uncategorized duplicates

'use strict';

const { Client, GatewayIntentBits, ChannelType } = require('discord.js');

const {
  DISCORD_BOT_TOKEN,
  DISCORD_SERVER_ID,
} = process.env;

if (!DISCORD_BOT_TOKEN || !DISCORD_SERVER_ID) {
  console.error('Set DISCORD_BOT_TOKEN and DISCORD_SERVER_ID in .env or environment');
  process.exit(1);
}

const apply = process.argv.includes('--apply');

// Expected category names (all caps in Discord) and their expected channels.
const EXPECTED_CATEGORIES = new Set(['SHARED', 'FAM', 'CPS', 'JAKE', 'LOUBI', 'JOCE', 'NANA']);

// The canonical #general lives in SHARED. Any other #general is a duplicate.
const CANONICAL_GENERAL_CATEGORY = 'SHARED';

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    const guild = await client.guilds.fetch(DISCORD_SERVER_ID);
    await guild.channels.fetch(); // populate cache

    const categories = guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory);
    const channels   = guild.channels.cache.filter(c => c.type !== ChannelType.GuildCategory);

    console.log(`\nGuild: ${guild.name}`);
    console.log(`Categories (${categories.size}):`, [...categories.values()].map(c => c.name).join(', '));
    console.log(`Channels (${channels.size} total)\n`);

    // Find uncategorized channels
    const uncategorized = channels.filter(c => !c.parentId);
    if (uncategorized.size > 0) {
      console.log(`=== Uncategorized channels (${uncategorized.size}) ===`);
      uncategorized.forEach(c => console.log(`  #${c.name} (${c.id}) type=${c.type}`));
    } else {
      console.log('No uncategorized channels.');
    }

    // Find duplicate #general channels (any not in SHARED)
    const allGeneral = channels.filter(c => c.name === 'general');
    const sharedCat = categories.find(c => c.name.toUpperCase() === CANONICAL_GENERAL_CATEGORY);
    const duplicateGeneral = allGeneral.filter(c => c.parentId !== sharedCat?.id);

    if (duplicateGeneral.size > 0) {
      console.log(`\n=== Duplicate #general channels (${duplicateGeneral.size}) — not in ${CANONICAL_GENERAL_CATEGORY} ===`);
      duplicateGeneral.forEach(c => {
        const cat = c.parentId ? categories.get(c.parentId)?.name || c.parentId : 'none';
        console.log(`  #${c.name} (${c.id}) category=${cat}`);
      });

      if (apply) {
        for (const ch of duplicateGeneral.values()) {
          const cat = ch.parentId ? categories.get(ch.parentId)?.name || ch.parentId : 'none';
          console.log(`  Deleting #${ch.name} (${ch.id}) from category=${cat}...`);
          await ch.delete('Cleanup: duplicate #general outside SHARED');
          console.log(`  Deleted.`);
        }
      } else {
        console.log('\n  Re-run with --apply to delete the duplicates.');
      }
    } else {
      console.log('\nNo duplicate #general channels.');
    }

    // Report unexpected categories
    const unknownCats = categories.filter(c => !EXPECTED_CATEGORIES.has(c.name.toUpperCase()));
    if (unknownCats.size > 0) {
      console.log(`\n=== Unexpected categories (${unknownCats.size}) ===`);
      unknownCats.forEach(c => console.log(`  ${c.name} (${c.id})`));
    }

    console.log('\nDone.');
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    client.destroy();
  }
});

client.login(DISCORD_BOT_TOKEN).catch(err => {
  console.error('Login failed:', err.message);
  process.exit(1);
});
