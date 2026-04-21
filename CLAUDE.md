# household-ai — Claude Code context

## Service version management

All Docker service versions are pinned manually via `.env` and `docker-compose.yml`. There is no auto-update mechanism (watchtower was removed after it silently upgraded n8n from 1.84.3 to 2.16.1, causing a DB schema incompatibility on rollback).

To update a service:
1. Change the version pin in `.env` (e.g. `N8N_VERSION=2.17.0`) or in `docker-compose.yml`
2. On the VPS: `docker compose pull <service> && docker compose up -d <service>`
3. Smoke-test (send a Discord message, check n8n logs)
4. Commit the version bump

Current pins (as of 2026-04-21):
- n8n: `2.16.1` (set via `N8N_VERSION` in `.env`)
- Postgres: `16-alpine` (stable, fine to track minor updates)
- Open WebUI: `main` (floating — update deliberately, not automatically)

## Deploy workflow

1. Edit `workflows/discord-bruce.json` on Windows (`C:\dev\household-ai`)
2. `node validate-workflow.js` — confirm no MISSING credential values
3. `git add ... && git commit && git push`
4. On VPS: `cd ~/household-ai && git pull`
5. Reimport: `N8N_API_KEY=$(grep N8N_API_KEY .env | cut -d= -f2) N8N_BASE_URL=http://127.0.0.1:5678 node scripts/import-workflow.js`
6. If discord-relay changed: `docker compose up -d --build discord-relay`
7. Verify: send a test Discord message, check `docker compose logs -f n8n`

**Important:** `docker compose up -d --build discord-relay` also re-pulls other service images if the tag has been updated on Docker Hub. To avoid accidentally upgrading n8n, always ensure `N8N_VERSION` is pinned in `.env` before running any compose up command.

## Hardcoded IDs (never use $env for these in n8n Code nodes)

- Bot user ID: `1495252972026859520`
- Guild ID: `1495249842778148954`
- Postgres credential: `EHBRO07aceirmFzt`
- Discord credential: `om7VabWMiA8gC2i3`

## n8n Code node string literals — guardrail

**Never use unescaped backticks inside template literal strings in Channel Router or any other Code node.** Backticks terminate the template literal and produce a silent JS syntax error at runtime.

Safe alternatives:
- Use a regular double-quoted string: `"line1\nline2\n\`code\`"` — backticks are fine inside `"..."` and Discord renders them as code formatting correctly.
- If a template literal is necessary, escape inner backticks as `` \` ``.

This bit us in the `/help` command where all the Discord `` `code` `` spans were written as unescaped backticks inside a template literal, crashing Channel Router on every `/help` invocation.

## n8n task-runner sandbox limitations

The sandbox has no: `URLSearchParams`, `TextEncoder`, `crypto.getRandomValues`, `$workflow.staticData` (returns undefined). It does have: `fetch`, `URL`, `btoa`, `crypto.subtle.digest`.
