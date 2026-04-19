# Discord Relay

The `discord-relay` container is a ~100-line Node.js service that holds the Discord Gateway connection for Bruce and forwards every incoming message to n8n over HTTP. It replaces the `n8n-nodes-discord-trigger` community node, which was unreliable and dragged n8n down with it every time it crashed.

## What it does

On start, the container:

1. Connects to the Discord Gateway using `discord.js` v14 with the `Guilds`, `GuildMessages`, and `MessageContent` intents.
2. Waits for `messageCreate` events from the configured guild (`DISCORD_SERVER_ID`). Anything from another guild or from a bot is dropped immediately.
3. Normalizes the payload into the shape the n8n Channel Router expects (see below) and POSTs it to `N8N_WEBHOOK_URL`.
4. Keeps the connection alive; discord.js auto-reconnects on disconnect and the relay logs each reconnect event.
5. On `SIGTERM` (i.e. `docker compose down`), disconnects cleanly.

n8n does everything else: route by channel, fetch conversation history, call Claude, persist to Postgres, reply on Discord.

## What it does NOT do

- It does **not** send messages back to Discord — that's the n8n workflow's job (the "Reply on Discord" node uses n8n's built-in Discord node).
- It does **not** filter by channel — everything is forwarded and routing lives in n8n's `Channel Router` Code node, so you can add/remove channels without redeploying the relay.
- It does **not** persist anything. It's stateless; if it restarts, no data is lost.

## Payload shape

```json
{
  "id": "1234567890",
  "content": "hey Bruce, how's it going?",
  "author": { "id": "999", "username": "jake", "bot": false },
  "channel_id": "111",
  "channel_name": "jake-personal",
  "guild_id": "222",
  "mentions": [ { "id": "botId" } ],
  "referenced_message": null
}
```

`referenced_message` is populated (with `id`, `content`, and `author`) when the message is a reply to another message — so the Channel Router can detect replies to Bruce. If the referenced message was deleted, only `id` is present.

## Operations

### Check status

```bash
docker compose ps discord-relay
```

Should show `Up` and `unless-stopped`. There are no exposed ports and no healthcheck — liveness is inferred from the logs.

### Watch logs

```bash
docker compose logs -f discord-relay
```

Healthy startup looks like:

```
2026-04-19T01:02:03.456Z [relay] logged in as Bruce#1234 (998877...)
2026-04-19T01:02:03.457Z [relay] forwarding messages from guild 111 -> http://n8n:5678/webhook/discord-bruce
```

Every forwarded message is silent (we only log problems). You'll see lines like:

- `webhook 404 for msg ... in #jake-personal` — the n8n workflow isn't active, or the webhook path doesn't match. Go activate the workflow.
- `webhook 500 for msg ...` — the workflow errored. Check n8n executions.
- `webhook failed for msg ...: fetch failed` — n8n container is down or unreachable.
- `shard 0 disconnected` / `reconnecting` / `resumed` — transient Gateway blips; usually clears in seconds.

### Restart

```bash
docker compose restart discord-relay
```

Safe to do any time. Messages sent while it's down are lost (the Gateway doesn't replay them) — this is the same tradeoff the community node had.

### Update after code changes

```bash
# Pull from git, then:
docker compose build discord-relay
docker compose up -d discord-relay
```

## Debugging — messages aren't flowing

Walk through this top to bottom:

1. **Is the relay logged in?** `docker compose logs discord-relay | head -50`. You want to see `logged in as Bruce#...`. If you see `login failed: ...`, the token is wrong or was reset.
2. **Are intents enabled?** In the Discord Developer Portal under Bot → Privileged Gateway Intents, both **Server Members** and **Message Content** must be ON. Without Message Content, `messageCreate` fires but `content` is empty and nothing routes.
3. **Is the n8n workflow active?** Open n8n, go to the `Discord — Bruce` workflow, confirm the toggle in the top-right is green. The Webhook node's "Production URL" should be `https://n8n.<domain>/webhook/discord-bruce` — but the relay hits the internal DNS name `http://n8n:5678/...`, which works as long as the workflow is active.
4. **Can the relay reach n8n?** `docker compose exec discord-relay wget -qO- --post-data='{}' --header=content-type:application/json http://n8n:5678/webhook/discord-bruce` should return something (a 404 means wrong path; a 200/204 means good; connection-refused means n8n is down).
5. **Is the bot actually in the channel?** The relay forwards whatever it hears on the Gateway. If the bot role doesn't have `View Channel` on a private category, Gateway won't send those events.
6. **Is a bot's own message being bounced?** The relay filters `author.bot === true`. If Bruce's own replies were getting re-fed, we'd loop. Verify by grepping logs for Bruce's user ID — there should be none inbound.

## Why relay instead of trigger-in-n8n?

The n8n Discord Trigger node runs inside the n8n process and holds the Gateway connection from there. That coupling meant that:

- Gateway hiccups blocked the n8n event loop.
- The community node lagged n8n releases and occasionally broke on upgrade.
- Restarting n8n (for any reason) dropped the Gateway connection.

A separate, single-purpose container cleanly isolates the Gateway I/O. n8n can restart, update, or crash without affecting message capture beyond the brief window the webhook is unreachable, and the relay itself is ~100 lines of code that's trivial to audit.
