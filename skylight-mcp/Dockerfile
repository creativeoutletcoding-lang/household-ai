# Builds @eaglebyte/skylight-mcp from source using the unmerged auth-update
# branch at fergbrain/skylight-mcp. Upstream PR:
#   https://github.com/TheEagleByte/skylight-mcp/pull/39
#
# When the PR lands on TheEagleByte:main we can switch back to installing
# @eaglebyte/skylight-mcp from npm (see git history for the old Dockerfile).
#
# Node 20 alpine matches discord-relay and gives us global fetch.
FROM node:20-alpine AS build

# Override at build time if the fork gets updated:
#   docker compose build --build-arg SKYLIGHT_MCP_REPO=... --build-arg SKYLIGHT_MCP_REF=... skylight-mcp
ARG SKYLIGHT_MCP_REPO=https://github.com/fergbrain/skylight-mcp.git
ARG SKYLIGHT_MCP_REF=auth-update

RUN apk add --no-cache git

WORKDIR /src

# Shallow-clone just the target branch so we don't drag the whole history.
RUN git clone --depth 1 --branch "${SKYLIGHT_MCP_REF}" "${SKYLIGHT_MCP_REPO}" .

# Install everything (dev deps needed to run the build), compile TypeScript,
# then prune to production-only deps for the runtime stage.
RUN npm ci --no-audit --no-fund \
    && npm run build \
    && npm prune --omit=dev

# --- runtime stage -------------------------------------------------------
FROM node:20-alpine

WORKDIR /app

# Copy the built package plus its pruned node_modules out of the build stage.
COPY --from=build /src /app

USER node
ENV NODE_ENV=production

# The MCP server listens on 3000 by default and auths to Skylight using the
# SKYLIGHT_EMAIL / SKYLIGHT_PASSWORD / SKYLIGHT_FRAME_ID / SKYLIGHT_TIMEZONE
# env vars injected by docker-compose.
EXPOSE 3000

# Most MCP packages publish their entrypoint at dist/index.js. If the PR
# branch uses a different output path, update this CMD (or use
# `CMD ["npm", "start"]` if the package.json's "start" script already points
# at the right file).
CMD ["node", "dist/index.js"]
