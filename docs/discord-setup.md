# Discord Setup — first-time guide

End-to-end walkthrough for getting Bruce on Discord: create the bot, invite him to your server, find the right IDs, run the channel provisioner, import the workflow.

## 1. Create the Discord application and bot

1. Go to https://discord.com/developers/applications and click **New Application**.
2. Name it `Bruce` (or whatever you want the bot's display name to be).
3. In the left sidebar, click **Bot**.
4. Click **Add Bot** if not already created. Under **Token**, click **Reset Token** and copy the token immediately. This is your `DISCORD_BOT_TOKEN`. You won't see it again.
5. While on the Bot page, scroll to **Privileged Gateway Intents** and toggle ON:
   - **Server Members Intent**
   - **Message Content Intent**

   Bruce needs message content to reason about messages, and member intent to apply per-user permission overwrites.

6. Still on the Bot page, scroll to **Bot Permissions** at the bottom and check at minimum:
   - View Channels
   - Send Messages
   - Read Message History
   - Manage Channels (only needed when running the channel provisioner; you can revoke it after)
   - Manage Messages (optional, for cleanup)
   - Embed Links / Attach Files (nice to have)

## 2. Invite Bruce to your server

1. In the same application, click **OAuth2** → **URL Generator** in the sidebar.
2. Under **Scopes**, check `bot`.
3. Under **Bot Permissions**, check the same set as step 1.6 above.
4. Copy the generated URL at the bottom and open it in your browser. Pick your server, approve.
5. You should now see `Bruce` in your server's member list (offline until the workflow is running).

## 3. Get the server (guild) ID

1. In Discord, open **User Settings → Advanced** and toggle **Developer Mode** ON.
2. Right-click your server name in the channel list → **Copy Server ID**. That's your `DISCORD_SERVER_ID`.
3. While you're there, right-click your own user name → **Copy User ID**. Save it as `DISCORD_JAKE_USER_ID`. The provisioner uses it to grant you explicit access to the private categories.

You can do the same for Loubi, Joce, and Nana once they join the server (`DISCORD_LOUBI_USER_ID`, etc.). If they haven't joined yet, leave those env vars empty — the provisioner will skip those grants and you can add them by hand in Discord later.

## 4. Get the bot's user ID

The workflow needs Bruce's own user ID to detect mentions of itself. After the bot is invited:

- Right-click `Bruce` in the member sidebar → **Copy User ID**. Save as `DISCORD_BOT_USER_ID` in `.env`.

(The bot's user ID is also visible at the top of the Discord Developer Portal application page, labeled "Application ID" — same value.)

## 5. Fill in `.env`

Open `.env` (copy from `.env.example` if you haven't) and set:

```
DISCORD_BOT_TOKEN=...           # from step 1.4
DISCORD_SERVER_ID=...           # from step 3
DISCORD_BOT_USER_ID=...         # from step 4
DISCORD_JAKE_USER_ID=...        # your own Discord user ID
# DISCORD_LOUBI_USER_ID=...     # leave commented until they join
# DISCORD_JOCE_USER_ID=...
# DISCORD_NANA_USER_ID=...
```

## 6. Provision the channel structure

From the repo root:

```bash
cd scripts
npm install
node setup-discord-channels.js
```

You'll see a log of every category and channel — created with `+`, skipped with `=`. Re-run any time; it's idempotent.

If anything fails:
- `Could not fetch guild` → the bot wasn't invited to that server, or `DISCORD_SERVER_ID` is wrong.
- `Missing Permissions` → the bot needs **Manage Channels**. Either grant it server-wide in **Server Settings → Roles → Bruce**, or temporarily give it the `Administrator` permission for the duration of the run.

After the run, you can revoke `Manage Channels` from the bot if you want — it's only needed for provisioning, not for day-to-day operation.

## 7. Apply the Postgres migration

```bash
docker compose exec -T postgres psql -U household -d n8n \
  < postgres/migrations/002-discord-conversations.sql
```

You should see `BEGIN`, `CREATE TABLE`, three `CREATE INDEX`, `COMMIT`. Re-runnable.

## 8. Import the n8n workflow

1. Open https://n8n.creativeoutletcoding.com (basic auth from `.env`).
2. **Workflows → Import from File** → pick `workflows/discord-bruce.json`.
3. The import will surface a couple of unconfigured credentials — that's expected:
   - **Discord Bot (Bruce)** — create a new "Discord Bot API" credential, paste the token from step 1.4, link the two Discord nodes to it.
   - **Postgres (n8n)** — point at host `postgres`, port `5432`, database `n8n`, user `household`, password from your `.env`. Link the three Postgres nodes to it.
4. Open the **Channel Router** Code node and paste the real persona content from each `prompts/channel-personas/<slug>.md` into the corresponding entry in the `PERSONAS` map. The skeleton ships with placeholders so the JSON stays small enough to import; you swap them in as a one-time step.
5. Click **Active** in the top-right to enable the workflow.

## 9. Smoke test

In Discord, in `#jake-personal`, type:

> Hi Bruce, are you up?

Within a couple of seconds, you should see a reply. If not, check `n8n` execution history (left sidebar → **Executions**) for the failure point. The most common first-time issues are:

- **Discord Trigger never fires** — check that "Message Content Intent" is enabled in the Developer Portal (step 1.5). Without it, the trigger receives only event metadata, not message text.
- **`401 Unauthorized` from Anthropic** — the workflow reads `ANTHROPIC_API_KEY` from the n8n container's environment. Make sure it's in `.env` and you ran `docker compose up -d n8n` after adding it.
- **Postgres errors about missing table** — the migration didn't run. Repeat step 7 against the `n8n` database (not `postgres` or `household`).

## 10. (Optional) Revoke unneeded bot permissions

After provisioning, you can pare the bot's role down to just what it needs to talk:

- View Channels
- Send Messages
- Read Message History
- Embed Links
- Attach Files

`Manage Channels` is only useful for re-running the provisioner. Re-grant it temporarily when you do.
