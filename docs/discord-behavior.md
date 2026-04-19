# How Bruce behaves on Discord

A short user-facing guide for the household. Share this with anyone who's going to use the bot so they know what to expect.

## Who Bruce is

Bruce is the household's AI assistant, running on a small server we control. He's powered by Claude (the same AI you might use in a browser) but tuned with different personas per channel, and with memory scoped to the channel you're talking in.

He lives in every channel you can see, but he doesn't chime in everywhere. His behavior depends on the channel.

## Three modes

Every channel is set to one of three modes:

### `always` — Bruce responds to every message

Used in: `#jake-personal`, `#fig`, `#loubi-personal`, `#wis`, `#joce-personal`, `#joce-school`, `#nana-personal`.

These are personal or one-on-one channels where you are the primary speaker and Bruce is effectively the only audience. Type anything and he replies. Don't worry about @mentioning him.

### `mention-only` — Bruce responds when you @mention him or reply to his messages

Used in: `#general`, `#family`, `#lake`, `#cps`.

These are shared channels where humans are talking to each other and Bruce is a tool you summon on demand. To get him involved, either:

- Type `@Bruce` somewhere in your message, or
- Click **Reply** on one of Bruce's messages and type your response.

Without either of those, he stays quiet even if the conversation is about something he could help with. That's by design — it keeps the channel feeling like a conversation between humans rather than a conversation with a bot.

### `read-only` — Bruce never responds

Used in: `#announcements`.

Bruce can see messages (and the system can log them) but he won't reply, no matter what. Use this channel for posts that don't want a bot response.

## Memory

Bruce remembers the last ~20 messages of your conversation per channel. "Per channel" is important: what you've told him in `#jake-personal` is not visible to him when you talk to him in `#fig`. Each channel has its own memory track.

His memory is:

- **Per user, per channel.** Jake's `#lake` memory is different from Loubi's `#lake` memory (even though the channel is shared) — each of you has your own thread with Bruce.
- **Rolling.** Older messages fall out of context once 20 newer ones accumulate.
- **Persistent.** It survives restarts, deploys, and updates. Stored in Postgres.

If you want Bruce to forget something specific, the runbook has cleanup commands; just ask someone with server access.

## Privacy boundaries

Bruce is told, in each channel's instructions, to treat private channels as private. He won't quote or reference content from `#jake-personal` in `#general` or any other channel. The system also enforces this at the data layer: conversation history is scoped to `(user, channel)` and never merged across channels.

That said: Bruce is an AI, and instructions can fail. If something is truly sensitive, don't put it in any chat. The safest rule of thumb is "Bruce is as discreet as you'd expect a well-briefed assistant to be, but not as discreet as silence."

## Getting better answers

A few habits that make Bruce more useful:

- **Give him the specifics up front.** "I have a 1-hour call with Acme on Friday about renewal; help me prep" will get a better answer than "help me with work."
- **Tell him what kind of response you want.** "Draft an email" vs "give me talking points" vs "just let me vent" all lead to very different replies. When in doubt, he'll ask — but you'll get there faster by saying it.
- **Push back if a response isn't useful.** He can recalibrate. Just say what was off ("too long", "too cheerful", "you missed the point, which was X").
- **Use separate channels for separate contexts.** Mixing work and personal in the same channel muddles his memory. That's why we split them.

## What Bruce can't do (today)

- **Schedule things in your real calendar.** He can talk about scheduling, but he can't create events in Google Calendar unless we wire that up.
- **Send emails or texts to outside people.** He can draft them; you send.
- **Access the internet.** He works from what's in the conversation + his training. He won't look up live info like today's weather or flight prices unless we add a tool for it.
- **Remember things across channels.** See "Memory" above — memory is per-channel on purpose.

When any of these limits matters, we can add the integration. Mention it and we'll figure it out.

## Who to tell when he's weird

If Bruce says something off, offensive, or just wrong, let Jake know which channel and roughly when. We can pull his executions out of n8n and figure out what happened. He's early — expect rough edges, and tell us about them.
