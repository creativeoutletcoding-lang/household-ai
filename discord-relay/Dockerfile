# Tiny Alpine Node image for the Discord -> n8n relay.
# Node 20 gives us global fetch and stable AbortController.
FROM node:20-alpine

# Run as the preinstalled unprivileged `node` user.
WORKDIR /app

# Install production deps first so the layer caches when only index.js changes.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund \
    && npm cache clean --force

COPY index.js ./

USER node
ENV NODE_ENV=production
CMD ["node", "index.js"]
