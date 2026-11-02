FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 5010
# Stay root: existing installs have a root-owned ./data volume; USER node would make their DB unwritable.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:${PORT:-5010}/healthz || exit 1
CMD ["node", "server.js"]
