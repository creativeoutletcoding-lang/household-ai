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

// ---------------------------------------------------------------------------
// Typing indicator tracking
//
// When a human message passes all filters and we POST to n8n, we call
// channel.sendTyping() so the speaker sees "Bruce is typing…" right away —
// long operations (image gen, Claude latency, Perplexity) would otherwise
// leave the channel silent. Discord's typing signal auto-expires after ~10s,
// so we repeat every 8s until either:
//   (a) Bruce's own reply arrives — handled by clearing on the bot's own
//       messageCreate event in this same channel.
//   (b) 2 minutes elapse — safety timeout in case n8n crashes mid-flight.
//
// Keyed by the delivery channel id (i.e. the thread id when the message was
// posted inside a thread), matching how Bruce's reply is delivered — a
// reply inside a thread fires messageCreate on the thread, so using the
// thread id makes the clear-on-bot-message path straightforward.
// ---------------------------------------------------------------------------
const activeTyping = new Map();

function startTyping(channel) {
  if (!channel || typeof channel.sendTyping !== 'function') return;
  const key = channel.id;
  stopTyping(key); // clear any stale entry in case the last run didn't finish
  channel.sendTyping().catch(() => {});
  const interval = setInterval(() => {
    channel.sendTyping().catch(() => {});
  }, 8000);
  const timeout = setTimeout(() => {
    log(`typing timeout for channel ${key} — 2 min elapsed without bot reply`);
    stopTyping(key);
  }, 120000);
  activeTyping.set(key, { interval, timeout });
}

function stopTyping(key) {
  if (!key) return;
  const entry = activeTyping.get(key);
  if (!entry) return;
  clearInterval(entry.interval);
  clearTimeout(entry.timeout);
  activeTyping.delete(key);
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

  // Prefer the guild nickname, then the user's chosen global display name,
  // then the handle-style username. Bruce uses this name in system prompts
  // and as the speaker prefix in shared-channel history, so the best-looking
  // name the person has already picked for themselves is what we want.
  // Overwriting `author.username` keeps one source of truth downstream — the
  // raw handle isn't used for anything else.
  const displayName =
    message.member?.displayName
    || message.author?.globalName
    || message.author?.username
    || '';

  return {
    id: message.id,
    content: message.content,
    author: {
      id: message.author.id,
      username: displayName,
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
    // Bot messages: we don't relay them. But if the message is from US,
    // that means n8n just replied — clear any typing indicator we started
    // for this channel/thread so "Bruce is typing…" goes away immediately.
    if (message.author?.bot) {
      if (message.author.id === client.user?.id) {
        stopTyping(message.channel?.id);
      }
      return;
    }
    if (message.guildId !== DISCORD_SERVER_ID) return;

    // Drop Discord system messages (thread-created notices, pin announcements,
    // member joins, etc.) — we never want to relay these to n8n. In
    // particular this is what suppresses the "X started a thread: …" notice
    // that appears in the parent channel when a thread is created. The
    // thread's own starter message fires a separate messageCreate inside the
    // thread itself and should flow through normally so Bruce can reply to
    // it there.
    if (message.system) return;

    const referenced_message = await buildReferencedMessage(message);
    const payload = buildPayload(message, referenced_message);

    // Show "Bruce is typing…" immediately. The n8n workflow decides whether
    // Bruce should actually reply (read-only channels, mention-only without
    // a mention, etc.) — in those cases no reply will arrive and the 2-min
    // safety timeout clears the indicator. That's an acceptable trade for
    // not duplicating routing logic here.
    startTyping(message.channel);

    await postToWebhook(payload);
  } catch (err) {
    // If anything threw before/during the POST, stop typing so it doesn't
    // dangle for 2 minutes.
    stopTyping(message?.channel?.id);
    log(`handler error for msg ${message?.id}: ${err.stack || err.message}`);
  }
});

// Auto-join any thread created in the guild — without this, the bot never
// receives messageCreate events inside private threads it wasn't added to
// (and even public threads won't deliver reliably until the bot is a member).
client.on(Events.ThreadCreate, async (thread, newlyCreated) => {
  try {
    if (thread.guildId !== DISCORD_SERVER_ID) return;

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
  // Stop any outstanding typing intervals so the process can exit cleanly.
  for (const key of [...activeTyping.keys()]) stopTyping(key);
  client.destroy().finally(() => process.exit(0));
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

client.login(DISCORD_BOT_TOKEN).catch((err) => {
  log(`login failed: ${err.message}`);
  process.exit(1);
});
