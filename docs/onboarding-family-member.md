# Onboarding a Family Member

Step-by-step guide for adding Loubi, Joce, Nana, or anyone else to Bruce's Discord server and making sure their private channels work.

This is the **admin's** checklist — you (Jake) do most of it, the new member does the pieces marked **Ask them to:**.

---

## 1. Get them a Discord account

**Ask them to:** go to https://discord.com and sign up. A free account is fine; they don't need Nitro. Have them:

- Pick a username that's fine for family use (their name, a nickname — whatever).
- Verify their email.
- Open the Discord desktop or mobile app and log in.

If they already have a Discord account, skip this step.

---

## 2. Send them the server invite

In your Discord client, open the household server. At the top of the channel list, click the dropdown next to the server name → **Invite People**. Create an invite link with these settings:

- **Expire after:** 1 day (tighten the window — you only need it once).
- **Max uses:** 1 (so it can't accidentally let anyone else in).

Copy the link and send it to them. **Ask them to:** click the link, accept the invite, and confirm they can see `#general`.

At this point they'll see the public channels (`#general`, `#family`, `#announcements`) but **not** their private category yet — that comes next.

---

## 3. Get their Discord user ID

Turn on Developer Mode in their client (one-time):

**Ask them to:** open Discord → **User Settings** (gear icon, bottom-left) → **Advanced** → toggle **Developer Mode** ON.

Then, **ask them to:** right-click their own username anywhere (a message they sent, the member list) → **Copy User ID**. Or right-click them from your side: same result.

The ID is a long numeric string, e.g. `123456789012345678`.

---

## 4. Add their ID to `.env`

SSH to the droplet (or edit your local `.env` and push):

```bash
ssh root@147.182.142.176
cd ~/household-ai
nano .env
```

Find the matching `DISCORD_*_USER_ID` line and paste in their ID:

```
DISCORD_LOUBI_USER_ID=123456789012345678
DISCORD_JOCE_USER_ID=
DISCORD_NANA_USER_ID=
```

Save and exit (`Ctrl+O`, `Enter`, `Ctrl+X` in nano).

---

## 5. Re-run the channel provisioner

This grants them explicit access to their category and child channels (private ones like `loubi-personal`, `loubi-ask`, `wis`, etc.):

```bash
cd ~/household-ai/scripts
node setup-discord-channels.js
```

You'll see output like:

```
= Category exists     LOUBI  (skipping create)
=   Channel exists      #loubi-personal
=   Channel exists      #loubi-ask
...
```

If their category didn't exist before (first time provisioning for them), it'll be created. If it already existed, the script is idempotent — it won't duplicate anything.

> The provisioner only sets permissions at **creation time**. For an existing category, the script skips the permission rewrite to avoid clobbering hand-tweaked overrides. If their category already exists but they don't have access yet, grant them manually:
> - Right-click the category in Discord → **Edit Category** → **Permissions** → add them as a member with View Channel allowed.

---

## 6. Brief them on how Bruce works

Send them a short orientation — or copy-paste the block below:

> **How Bruce works:**
>
> - Bruce is the AI in this server. He uses Claude under the hood.
> - **Your private channels** (`#<your-name>-personal`, `#<your-name>-ask`, etc.) — Bruce responds to **everything** you say. No need to @mention him.
> - **Shared channels** (`#general`, `#family`, `#travel`) — Bruce only responds when you **@mention him** or **reply to one of his messages**. He's otherwise silent so you can chat normally.
> - **`#announcements`** — read-only for Bruce; he won't post here.
> - **`#<your-name>-ask`** — your quick-question channel. Use this for fast lookups, not deep conversations. Bruce answers terse there.
> - **`/use <model>`** — switch which Claude model Bruce uses in the current channel. Shortcuts: `/use haiku` (fast), `/use sonnet` (default), `/use opus` (smart/slow). Type `/use default` to reset.
> - Conversation memory is per-channel — Bruce remembers what you said before in the same channel, but your `#<your-name>-personal` doesn't bleed into `#general`.

---

## 7. Smoke test

Watch them post something in their new `#<your-name>-personal` channel. Bruce should reply within a second or two. If he doesn't:

- Check `docker compose logs discord-relay` — should show a forwarded message.
- Check n8n → Executions — the workflow should fire. If nothing appears, the workflow isn't Active or the webhook path is wrong.
- Check that their new category permissions include the bot (the provisioner adds this at create time, but if the category existed already you may need to grant it manually).

Once they've had their first successful Bruce conversation, they're fully onboarded.
