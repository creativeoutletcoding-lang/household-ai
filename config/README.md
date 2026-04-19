# config/ — Bruce's behavior configuration

JSON does not support comments, so this file documents the shape and semantics of [`channel-routing.json`](./channel-routing.json).

## channel-routing.json

A flat map from **Discord channel name** (no `#`) to a behavior object.

```jsonc
{
  "channel-name": {
    "behavior": "always" | "mention-only" | "read-only",
    "persona":  "<filename in prompts/channel-personas/>.md" | null
  }
}
```

### Fields

**`behavior`** — how Bruce responds in this channel:

- `"always"` — Bruce replies to every non-bot message. Use for private/personal channels where the bot is basically the only audience.
- `"mention-only"` — Bruce replies only when `@Bruce` is mentioned OR someone replies directly to one of his messages. Use for shared channels where humans are the primary audience and Bruce is a helper that people summon on demand.
- `"read-only"` — Bruce never replies. He can still read the channel (and the n8n workflow can log it to Postgres for searchability), but he produces no output. Use for announcements-style channels.

**`persona`** — path to a markdown file under `prompts/channel-personas/` whose contents become the system prompt for Claude when Bruce responds in this channel. Set to `null` for `read-only` channels since no prompt is ever loaded.

## Adding a new channel

1. Create the Discord channel (either by hand or by adding it to `scripts/setup-discord-channels.js` and re-running).
2. Write the persona file at `prompts/channel-personas/<slug>.md`.
3. Add an entry to `channel-routing.json`:

   ```json
   "<channel-slug>": { "behavior": "always", "persona": "<slug>.md" }
   ```

4. Commit and push. In n8n, the "Channel Router" node reads this file on every execution, so the new entry takes effect as soon as the repo is updated on the droplet and the n8n container sees it (the file is bind-mounted read-only).

## Editing a persona

Just edit the markdown file under `prompts/channel-personas/` and commit. Bruce will pick up the change on the next message in that channel. No workflow restart needed.

## Unknown channels

If a message arrives from a channel name that isn't in `channel-routing.json`, the router treats it as `read-only` with `persona: null` — i.e. Bruce silently ignores it. That is the fail-safe default; if you want Bruce to respond in a new channel, add an explicit entry.
