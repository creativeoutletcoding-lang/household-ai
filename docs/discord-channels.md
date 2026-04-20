# Discord Channels — structure and access model

The Discord server is organized into categories that correspond to contexts or people. Within each category, channels group related conversations. Bruce is a member of every channel so he can be summoned anywhere he's invited.

## The map

```
SHARED                      (everyone can see)
├─ #general                 read/write — open household chat
├─ #family                  read/write — logistics, planning, group decisions
└─ #announcements           read only for most; write for Jake + Bruce

JAKE                        (Jake + Bruce only)
├─ #fig                     Foundation Insurance Group — work context
└─ #jake-personal           Jake's personal assistant

LAKE                        (Jake + Loubi + Bruce only)
└─ #lake                    joint planning, household decisions

CPS                         (Jake + Nana + Bruce only)
└─ #cps                     Capital Petsitters operations

LOUBI                       (Loubi + Bruce only — placeholder until she joins)
├─ #loubi-personal          Loubi's personal assistant
└─ #wis                     Washington International School — work context

JOCE                        (Joce + Bruce only — placeholder until she joins)
├─ #joce-personal           Joce's personal assistant
└─ #joce-school             homework + study helper

NANA                        (Nana + Bruce only — placeholder until she joins)
└─ #nana-personal           Nana's personal assistant
```

## Access model

Permissions are applied at the **category** level; individual channels inherit unless they have their own overrides.

- **Public categories** (`SHARED`): @everyone gets View, Send, Read History. Bruce gets the same plus Embed/Attach/Manage-Messages. The `#announcements` channel overrides this: @everyone loses Send; only Jake and Bruce can post.
- **Private categories** (`JAKE`, `LAKE`, `CPS`): @everyone is explicitly denied View. Specific members are granted access: Jake in `JAKE`, Jake + Loubi in `LAKE`, Jake + Nana in `CPS`. Bruce is granted in all.
- **Placeholder categories** (`LOUBI`, `JOCE`, `NANA`): @everyone denied View. Only Bruce has access initially. When the person joins the server, grant them access either by:
  - Setting their `DISCORD_<NAME>_USER_ID` in `.env` and re-running `node scripts/setup-discord-channels.js` (does nothing to existing categories — you'll need to add the permission by hand, see below).
  - Right-clicking the category in Discord → **Edit Category → Permissions → Add Member**, picking the person, and granting View, Send, Read History.

The provisioning script is idempotent but intentionally does **not** modify permissions on categories that already exist — that protects any by-hand tweaks. So permission updates to existing categories are manual.

## Shared vs private — what Bruce knows

Bruce's per-channel personas (`prompts/channel-personas/`) include explicit instructions about what context is shared and what is private. In particular:

- Bruce is told never to reference content from private channels in public channels. If you ask him about something in `#general` that he only knows from `#jake-personal`, he'll decline to discuss it rather than leak.
- Conversation memory is keyed on `(discord_user_id, channel_id)` in Postgres — so Jake's history in `#jake-personal` is distinct from his history in `#lake`, even though both are "Jake." This prevents context crossover even within the same person.
- The `#announcements` channel is `read-only` in `config/channel-routing.json`, meaning Bruce never responds there. Posting rights are a separate (Discord-level) constraint.

## Threads

Bruce supports Discord threads with a few deliberate rules:

- **Routing/persona inherits from the parent channel.** A thread inside `#jake-personal` uses the `jake-personal` persona. The `discord-relay` container rewrites the inbound payload so the workflow's Channel Router sees the parent channel's name, even though the user posted in the thread.
- **Memory is scoped to the thread.** Conversation history (`discord_conversations`) and long-term memories (`user_memories`) keyed off a thread stay inside that thread. Messages in the parent channel don't pollute thread context, and thread side-conversations don't leak back into the main channel's history.
- **Auto-join.** The relay listens for `threadCreate` and joins every new thread in the guild, so Bruce receives messages without being invited by hand. For private threads created before the relay was upgraded, add him once manually.
- **`/image` and `/search`** work inside threads too; the reply is posted to the thread it was asked in.

## Adding a new channel later

Three steps, any order:

1. **Create the Discord channel.** Either add it to `STRUCTURE` in `scripts/setup-discord-channels.js` and re-run the script, or right-click the category in Discord and create it manually.
2. **Write a persona.** Drop a new markdown file at `prompts/channel-personas/<slug>.md`. Start by copying the closest existing persona and editing.
3. **Route it.** Add an entry in `config/channel-routing.json` — pick `always`, `mention-only`, or `read-only`.
4. **Paste into the workflow.** Open the `Channel Router` Code node in n8n, add the slug to the `ROUTING` map and the persona content to the `PERSONAS` map, save.

Until step 4 is done, Bruce will treat the new channel as `read-only` (the safe default) and stay silent.

## Adding a new person later

1. They join the Discord server via your invite link.
2. Right-click their name → Copy User ID. Paste into `.env` as `DISCORD_<NAME>_USER_ID`.
3. In Discord: right-click the categories they should see (their placeholder category, and any shared ones) → Edit → Permissions → Add Member → grant View/Send/Read History.
4. `docker compose up -d n8n` so the n8n workflow picks up any env var changes.

There's no reason to re-run the provisioner for this — it only creates what's missing, doesn't touch what exists.

## Removing a channel

`setup-discord-channels.js` never deletes. Remove a channel by hand in Discord, then remove its entry from `config/channel-routing.json`, the workflow's `ROUTING` / `PERSONAS` maps, and delete the persona file. Optionally run:

```sql
DELETE FROM discord_conversations WHERE channel_name = '<slug>';
```

to drop its conversation history from Postgres.
