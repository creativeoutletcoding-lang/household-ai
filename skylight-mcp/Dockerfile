# Thin wrapper around @eaglebyte/skylight-mcp.
#
# Node 20 alpine matches the discord-relay image and gives us global fetch.
# We pre-install the package at build time so the container starts fast on
# restart (no `npx` cold-start pulling from npm).
FROM node:20-alpine

WORKDIR /app

# Install @eaglebyte/skylight-mcp globally so its bin is on PATH. Keeping the
# package in a real package.json (rather than `npm i -g ...` as a one-liner)
# lets Docker cache the install layer and lets us pin the version from a
# single place.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force

USER node
ENV NODE_ENV=production

# The MCP server listens on 3000 by default and auths to Skylight using the
# SKYLIGHT_EMAIL / SKYLIGHT_PASSWORD / SKYLIGHT_FRAME_ID / SKYLIGHT_TIMEZONE
# env vars injected by docker-compose.
EXPOSE 3000
CMD ["npx", "--no-install", "@eaglebyte/skylight-mcp"]
