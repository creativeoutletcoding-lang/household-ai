// discord-relay — Discord Gateway to n8n webhook relay for Bruce.
//
// Listens for every messageCreate in the configured guild, drops bot
// messages, and POSTs a normalized JSON payload to N8N_WEBHOOK_URL so the
// n8n workflow can do the actual routing + Claude call + reply.
//
// Replaces the n8n community Discord Trigger node, which was unreliable.

const { Client, GatewayIntentBits, Partials, Events, ChannelType } = require('discord.js');

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
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageTyping,
    GatewayIntentBits.DirectMessageReactions,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User],
});

// Channel types that represent threads (not forum/standalone channels).
const THREAD_TYPES = new Set([
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
]);

// Channels where Bruce responds to every message (no @mention required).
// In all other channels Bruce only responds when @mentioned, so we only
// show the typing indicator when the bot is actually mentioned.
const ALWAYS_RESPOND_CHANNELS = new Set([
  'jake-personal', 'fig', 'jake-ask',
  'loubi-personal', 'wis', 'loubi-ask',
  'joce-personal', 'joce-school', 'joce-ask',
  'nana-personal', 'nana-ask',
]);

const BOT_USER_ID = '1495252972026859520';

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
  // guildId is null for DMs, a string for guild messages.
  const isDm = message.guildId === null;
  const isThread = !isDm && channel ? THREAD_TYPES.has(channel.type) : false;

  // For DMs: route using the literal channel name 'dm'.
  // For threads: routing/persona comes from the parent channel.
  const parent = isThread ? channel.parent : null;
  const routingChannelId = isDm ? (channel?.id ?? '') : (isThread && parent ? parent.id : message.channelId);
  const routingChannelName = isDm ? 'dm' : (isThread && parent ? parent.name : (channel?.name ?? ''));

  // Prefer the guild nickname, then the user's chosen global display name,
  // then the handle-style username.
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
    is_dm: isDm,
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
  log(`relay active — guild ${DISCORD_SERVER_ID} + DMs -> ${N8N_WEBHOOK_URL}`);
});

client.on(Events.MessageCreate, async (message) => {
  try {
    // DMs are handled exclusively by client.ws.on('MESSAGE_CREATE') above.
    // Guard here so that if discord.js starts emitting messageCreate for a DM
    // channel after it gets cached, we don't relay the same message twice.
    if (message.guildId === null) return;

    // Bot messages: we don't relay them. But if the message is from US,
    // that means n8n just replied — clear any typing indicator we started
    // for this channel/thread so "Bruce is typing…" goes away immediately.
    if (message.author?.bot) {
      if (message.author.id === client.user?.id) {
        stopTyping(message.channel?.id);
      }
      return;
    }

    // guildId is null for DMs, a string for guild messages.
    // Must check this BEFORE any channel access — partial DM channels may
    // not have their properties populated until fetch() is called.
    const isDm = message.guildId === null;

    if (!isDm && message.guildId !== DISCORD_SERVER_ID) return;

    // Drop Discord system messages (thread-created notices, pin announcements,
    // member joins, etc.) — we never want to relay these to n8n.
    if (message.system) return;

    // Fetch the channel if it's partial so properties like .id and .type are set.
    if (isDm && message.channel?.partial) {
      try { await message.channel.fetch(); } catch (_) {}
    }

    if (isDm) {
      log(`DM from ${message.author?.username ?? message.author?.id} (${message.author?.id})`);
    }

    const referenced_message = isDm ? null : await buildReferencedMessage(message);
    const payload = buildPayload(message, referenced_message);

    // Show "Bruce is typing…" when Bruce will actually respond:
    // DMs always get a response; guild channels only in always-respond
    // channels or when @mentioned.
    const routingName = payload.channel_name;
    const isMentioned = payload.mentions.some((u) => u.id === BOT_USER_ID);
    if (isDm || ALWAYS_RESPOND_CHANNELS.has(routingName) || isMentioned) {
      startTyping(message.channel);
    }

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

// Raw gateway handler for DMs — discord.js silently drops MESSAGE_CREATE for
// DM channels even with correct intents + partials, so we bypass it entirely.
// Guild messages still go through the normal messageCreate handler below.
client.ws.on('MESSAGE_CREATE', async (data) => {
  if (data.guild_id) return; // guild messages handled by messageCreate

  // Bot's own reply in the DM — clear typing indicator and stop.
  if (data.author?.bot) {
    if (data.author.id === client.user?.id) stopTyping(data.channel_id);
    return;
  }

  log(`DM from ${data.author?.username} (${data.author?.id}): ${String(data.content || '').slice(0, 60)}`);

  const payload = {
    id:           data.id,
    content:      data.content || '',
    author: {
      id:       data.author.id,
      username: data.author.global_name || data.author.username || '',
      bot:      data.author.bot === true,
    },
    channel_id:   data.channel_id,
    channel_name: 'dm',
    guild_id:     '',
    is_dm:        true,
    is_thread:    false,
    thread_id:    '',
    thread_name:  '',
    mentions:     (data.mentions || []).map((u) => ({ id: u.id })),
    attachments:  (data.attachments || []).map((a) => ({
      url:          a.url,
      filename:     a.filename,
      content_type: a.content_type || 'application/octet-stream',
      size:         a.size,
    })),
    referenced_message: null,
  };

  // Show typing indicator in the DM channel.
  try {
    const dmChannel = await client.channels.fetch(data.channel_id).catch(() => null);
    if (dmChannel) startTyping(dmChannel);
  } catch (_) {}

  await postToWebhook(payload);
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
