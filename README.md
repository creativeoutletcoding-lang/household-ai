# Household AI

A cloud-hosted family AI system. Everyone in the house (4 adults, all 17+) talks to the same shared Claude-powered assistant, either through a web chat UI or a Telegram bot. The assistant can run workflows — reminders, summaries, shopping lists, calendar coordination, document Q&A — and keeps a shared long-term memory in Postgres.

This repo is the whole stack: `docker-compose.yml`, an `install.sh` bootstrap, and runbooks. It is built to run on a cheap DigitalOcean droplet today and move to a Mac Mini M5 Pro on the home network when that hardware arrives, with minimal rework.

## Architecture

```
                 Internet
                     │
                     ▼
              ┌─────────────┐
              │    Caddy    │   :80 / :443  (auto-HTTPS, Let's Encrypt)
              │  (host net) │
              └──────┬──────┘
                     │  (reverse proxy on private docker network)
          ┌──────────┼──────────┐
          ▼          ▼          ▼
   ┌────────────┐ ┌──────────┐ ┌──────────────┐
   │ Open WebUI │ │   n8n    │ │  (optional)  │
   │   :8080    │ │  :5678   │ │  future svc  │
   └─────┬──────┘ └────┬─────┘ └──────────────┘
         │             │
         └──────┬──────┘
                ▼
         ┌────────────┐
         │  Postgres  │  (internal only, no host port)
         │    :5432   │
         └────────────┘
                │
                ▼
         ┌────────────┐
         │ Anthropic  │  (Claude API — outbound only)
         │   Claude   │
         └────────────┘
```

Subdomains (all on `creativeoutletcoding.com`):

- `chat.creativeoutletcoding.com` → Open WebUI (human chat interface)
- `n8n.creativeoutletcoding.com` → n8n editor (workflow authoring, webhook endpoints)
- `creativeoutletcoding.com` → simple landing page that redirects to `chat.`

Telegram bot runs as an n8n workflow. Incoming messages hit an n8n Telegram trigger, n8n calls the Claude API, n8n sends the reply back. User/thread state lives in Postgres so conversations are continuous across devices.

## Components

| Service    | Image                                 | Purpose                                                  | Exposed? |
|------------|---------------------------------------|----------------------------------------------------------|----------|
| Caddy      | `caddy:2-alpine`                      | Reverse proxy, automatic HTTPS                           | 80 / 443 |
| Open WebUI | `ghcr.io/open-webui/open-webui:main`  | Web chat front-end for the household                     | internal |
| n8n        | `n8nio/n8n:latest`                    | Workflow engine, Telegram bot, Claude API glue           | internal |
| Postgres   | `postgres:16-alpine`                  | Shared storage for n8n, Open WebUI, conversation memory  | internal |

Postgres is **never** exposed to the public internet. Only Caddy binds host ports. Everything else talks over an internal Docker network.

## Quick start

On a fresh DigitalOcean droplet (Ubuntu 24.04, 2 vCPU / 2 GB RAM):

```bash
# 1. SSH in as root, create a non-root user, put this repo on the box
ssh root@<droplet-ip>
adduser household && usermod -aG sudo household
su - household
git clone https://github.com/<you>/household-ai.git
cd household-ai

# 2. Fill in secrets
cp .env.example .env
nano .env           # set ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN, passwords, domain

# 3. Point DNS
#    A     creativeoutletcoding.com        -> <droplet-ip>
#    A     chat.creativeoutletcoding.com   -> <droplet-ip>
#    A     n8n.creativeoutletcoding.com    -> <droplet-ip>

# 4. Run the installer (installs Docker, UFW, Caddy, starts the stack)
sudo ./install.sh
```

When the script finishes, Caddy will fetch certificates automatically on first request. Open `https://chat.creativeoutletcoding.com` in a browser; the first account created becomes the admin.

See `runbook.md` for day-to-day operations, and `docs/migration-to-local.md` for the Mac Mini cut-over.

## Security posture

- Only ports 22 (SSH), 80, and 443 are open at the firewall. UFW blocks everything else.
- Postgres, n8n, and Open WebUI have no host-port bindings — they are reachable only inside the Docker network and through Caddy.
- All secrets live in `.env`, which is gitignored. Nothing sensitive is ever committed.
- Caddy terminates TLS and talks plain HTTP to upstreams on the private network.
- Open WebUI user signups are locked down after the first admin account (`ENABLE_SIGNUP=false` in `.env`).
- n8n uses basic auth in front of the editor, on top of the HTTPS layer.

## Repo layout

```
.
├── README.md               # this file
├── docker-compose.yml      # the stack
├── .env.example            # template — copy to .env and fill in
├── install.sh              # one-shot bootstrap for a fresh droplet
├── runbook.md              # day-to-day operations
├── Caddyfile               # written by install.sh from the template below
└── docs/
    └── migration-to-local.md   # Mac Mini cut-over playbook
```
