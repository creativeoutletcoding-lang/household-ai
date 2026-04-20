# Bruce — a quick guide for the family

Bruce is the household's AI assistant, living on our family Discord server. Each channel has its own personality and rules — so Bruce in `#food` acts differently than Bruce in `#joce-school`. This page is a tour of what you can do with him.

## The basics

- **In most shared channels** (`#general`, `#family`, `#travel`), Bruce only replies when you @mention him or reply to one of his messages.
- **In your personal channels** (`#jake-personal`, `#loubi-personal`, `#joce-personal`, `#nana-personal`) and your work/school channels, Bruce replies to every message — no need to @ him.
- **In your `-ask` channel** (`#jake-ask`, `#loubi-ask`, etc.), Bruce answers fast and short. Use it when you just want a quick answer, not a conversation.
- **Threads.** Start a thread (right-click a message → *Create Thread*) when you want to explore a tangent without cluttering the main channel. Bruce follows you in; his memory of that conversation stays in the thread.

## Commands

These work in any channel. Type them exactly as shown.

### Model switching

- `/use haiku` — fast and cheap; use for quick lookups.
- `/use sonnet` — the default; balanced quality and speed.
- `/use opus` — our strongest model; use for hard thinking, drafts, analysis.
- `/use opus6` — a second strong model option; try it if `opus` gives you something weird.
- `/use default` — go back to the channel's default model.
- `/use <anything else>` — pass a full Anthropic model string if you know what you want.

The override is per-person, per-channel. Your `/use opus` in `#fig` doesn't affect anyone else, and it doesn't affect your own replies in `#family`.

### Memory

Bruce has short-term memory (the last ~20 messages in this channel with you) baked in automatically. For long-term memory — things Bruce should remember *forever* — use:

- `/remember <text>` — add a memory scoped to this channel (or thread). Examples:
  - `/remember I prefer chicken over beef` (in `#food`)
  - `/remember I'm preparing for a sales certification by April` (in `#fig`)
- `/memories` — list what Bruce is holding onto for you.
- `/forget <id>` — drop one memory. Get the id from `/memories`.

Memories are private to you. Loubi's memories in `#loubi-personal` never show up in Jake's conversations, even in the same channel.

### Images

- `/image <prompt>` — generate an image (fast, ~10 seconds). Powered by Flux Schnell.
- `/image --hd <prompt>` — higher-quality version, slower (~60 seconds). Powered by Flux Pro.

Examples: `/image a cozy kitchen in afternoon light` • `/image --hd a vintage travel poster for Kyoto`

### Web search

- `/search <query>` — Bruce searches the web (via Perplexity) and replies with a short answer plus citations. Good for "what's the weather in Reykjavik this weekend" or "what's the going rate for dog-walkers in Georgetown."

## Which channel for what?

- **Working on something personal and multi-step** → your own `#<name>-personal`.
- **Quick factual question** → your own `#<name>-ask`.
- **Planning something as a household** (travel, finances, logistics) → `#family`.
- **Meal/recipe help** → `#food` (@mention Bruce to kick off a planning session).
- **Trip planning** → `#travel` (@mention Bruce).
- **Joce's schoolwork** → `#joce-school`. Bruce is set up to tutor — he'll walk you through problems, not hand over answers.
- **Jake's FIG work** → `#fig`.
- **Loubi's WIS work** → `#wis`.
- **CPS operations** → `#cps` (Jake + Nana).

## Things Bruce won't do

- **Leak information across channels.** What you say in `#jake-personal` stays in `#jake-personal`. Bruce won't repeat or reference it in `#family` or anywhere else.
- **Write your essay for you** (Joce). He'll help you outline, brainstorm, and give feedback on drafts, but he won't write the final submission.
- **Give medical or legal advice.** He'll share what he knows but always steer you to a real professional.

## Things Bruce might get wrong

Bruce is a language model. He can:

- **Confidently say something that isn't true** (especially for recent events or specific numbers). For anything that matters, double-check.
- **Miss sarcasm or tone** more than a human would.
- **Forget context** if a conversation gets very long. If he seems lost, start fresh or summarize what you were talking about.

If Bruce is being weird, try `/use opus` (stronger model), or open a thread to give him a cleaner context to work in.

## Heads up

- The Discord server is **private** — only people with an invite can see it. But remember: messages are stored so Bruce can recall them. Don't put anything in here you wouldn't want Jake to be able to retrieve later if he had to administer the system.
- If you want something truly ephemeral, say it out loud instead.
