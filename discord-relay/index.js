// discord-relay — Discord Gateway to n8n webhook relay for Bruce.
//
// Listens for every messageCreate in the configured guild, drops bot
// messages, and POSTs a normalized JSON payload to N8N_WEBHOOK_URL so the
// n8n workflow can do the actual routing + Claude call + reply.
//
// Replaces the n8n community Discord Trigger node, which was unreliable.

const { Client, GatewayIntentBits, Events, ChannelType } = require('discord.js');

const {
  DISCORD_BOT_TOKEN,
  DISCORD_SERVER_ID,
  N8N_WEBHOOK_URL = 'http://n8n:5678/webhook/discord-bruce',
} = process.env;

if (!DISCORD_BOT_TOKEN || !DISCORD_SERVER_ID) {
  console.error('[relay] DISCORD_BOT_TOKEN and DISCORD_SERVER_ID are required');
  process.exit(1);
}

function log(...args) {
  console.log(new Date().toISOString(), '[relay]', ...args);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
});

// Channel types that represent threads (not forum/standalone channels).
const THREAD_TYPES = new Set([
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
]);

// Short-lived set of thread IDs that were just created. We drop messageCreate
// events inside these threads for the TTL window so we don't relay the
// "starter" message of a freshly created thread (Discord has no per-message
// signal for this — the message looks identical to any later message — so we
// key off the ThreadCreate event instead).
const RECENT_THREAD_TTL_MS = 5000;
const recentlyCreatedThreads = new Set();
function markThreadRecentlyCreated(threadId) {
  if (!threadId) return;
  recentlyCreatedThreads.add(threadId);
  setTimeout(() => recentlyCreatedThreads.delete(threadId), RECENT_THREAD_TTL_MS).unref?.();
}

async function buildReferencedMessage(message) {
  if (!message.reference || !message.reference.messageId) return null;
  try {
    const ref = await message.fetchReference();
    return {
      id: ref.id,
      content: ref.content,
      author: {
        id: ref.author.id,
        username: ref.author.username,
        bot: ref.author.bot === true,
      },
    };
  } catch (err) {
    // Referenced message was deleted or not accessible — still tell n8n
    // there's a reference so it can detect the reply relationship.
    return { id: message.reference.messageId };
  }
}

function buildPayload(message, referenced_message) {
  const channel = message.channel;
  const isThread = channel ? THREAD_TYPES.has(channel.type) : false;

  // For threads, the routing/persona lives on the PARENT channel (e.g. a
  // thread inside #jake-personal should use jake-personal's persona). We
  // still forward the thread's own id/name so n8n can scope memory to the
  // thread.
  const parent = isThread ? channel.parent : null;
  const routingChannelId = isThread && parent ? parent.id : message.channelId;
  const routingChannelName = isThread && parent ? parent.name : (channel?.name ?? '');

  return {
    id: message.id,
    content: message.content,
    author: {
      id: message.author.id,
      username: message.author.username,
      bot: message.author.bot === true,
    },
    channel_id: routingChannelId,
    channel_name: routingChannelName,
    guild_id: message.guildId ?? '',
    is_thread: isThread,
    thread_id: isThread ? channel.id : '',
    thread_name: isThread ? (channel.name ?? '') : '',
    mentions: [...message.mentions.users.values()].map((u) => ({ id: u.id })),
    attachments: [...message.attachments.values()].map((a) => ({
      url: a.url,
      filename: a.filename,
      content_type: a.contentType ?? 'application/octet-stream',
      size: a.size,
    })),
    referenced_message,
  };
}

async function postToWebhook(payload) {
  try {
    const res = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      log(`webhook ${res.status} for msg ${payload.id} in #${payload.channel_name}`);
    }
  } catch (err) {
    log(`webhook failed for msg ${payload.id}: ${err.message}`);
  }
}

client.once(Events.ClientReady, (c) => {
  log(`logged in as ${c.user.tag} (${c.user.id})`);
  log(`forwarding messages from guild ${DISCORD_SERVER_ID} -> ${N8N_WEBHOOK_URL}`);
});

client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author?.bot) return;
    if (message.guildId !== DISCORD_SERVER_ID) return;

    // Drop Discord system messages (thread-created notices, pin announcements,
    // member joins, etc.) — we never want to relay these to n8n.
    if (message.system) return;

    // Drop the starter message of a freshly created thread. Discord doesn't
    // mark the message itself, so we cross-reference the TTL set populated by
    // the ThreadCreate handler below.
    const channel = message.channel;
    if (
      channel &&
      THREAD_TYPES.has(channel.type) &&
      recentlyCreatedThreads.has(channel.id)
    ) {
      return;
    }

    const referenced_message = await buildReferencedMessage(message);
    const payload = buildPayload(message, referenced_message);
    await postToWebhook(payload);
  } catch (err) {
    log(`handler error for msg ${message?.id}: ${err.stack || err.message}`);
  }
});

// Auto-join any thread created in the guild — without this, the bot never
// receives messageCreate events inside private threads it wasn't added to
// (and even public threads won't deliver reliably until the bot is a member).
client.on(Events.ThreadCreate, async (thread, newlyCreated) => {
  try {
    if (thread.guildId !== DISCORD_SERVER_ID) return;

    // Mark the thread as recently created so messageCreate can suppress the
    // starter message. Always mark (even if we don't need to join), so that
    // thread-start messages are filtered consistently.
    markThreadRecentlyCreated(thread.id);

    if (thread.joined) return;
    await thread.join();
    log(
      `joined thread #${thread.name} (${thread.id}) in parent #${thread.parent?.name ?? '?'}` +
        (newlyCreated ? ' [new]' : '')
    );
  } catch (err) {
    log(`failed to join thread ${thread?.id}: ${err.message}`);
  }
});

// discord.js auto-reconnects; these are just log hooks.
client.on(Events.ShardDisconnect, (_ev, id) => log(`shard ${id} disconnected`));
client.on(Events.ShardReconnecting, (id) => log(`shard ${id} reconnecting`));
client.on(Events.ShardResume, (id) => log(`shard ${id} resumed`));
client.on(Events.Error, (err) => log(`client error: ${err.message}`));
client.rest.on('rateLimited', (info) =>
  log(`rate limited on ${info.route} (retry in ${info.timeToReset}ms)`)
);

function shutdown(signal) {
  log(`received ${signal} — shutting down`);
  client.destroy().finally(() => process.exit(0));
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

client.login(DISCORD_BOT_TOKEN).catch((err) => {
  log(`login failed: ${err.message}`);
  process.exit(1);
});
