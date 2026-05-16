# STAGE 1: Build admin-web frontend
FROM node:22-alpine AS admin-builder
WORKDIR /app/admin-web
COPY admin-web/package*.json ./
RUN npm ci --legacy-peer-deps
COPY admin-web/ ./
RUN npm run build

# STAGE 2: Production image
FROM node:22-slim
RUN npm install -g pm2

# Puppeteer dependencies
RUN apt-get update && apt-get install -y \
    ca-certificates fonts-liberation libasound2 libatk-bridge2.0-0 \
    libatk1.0-0 libcups2 libdbus-1-3 libdrm2 libgbm1 libgtk-3-0 \
    libnspr4 libnss3 libu2f-udev libxcomposite1 libxdamage1 \
    libxfixes3 libxkbcommon0 libxrandr2 xdg-utils chromium \
    curl --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY package*.json .yarnrc.yml ./
COPY .yarn/ .yarn/
COPY yarn.lock* ./
RUN npm ci --legacy-peer-deps --production

COPY src/ ./src/
COPY models/ ./models/
COPY config/ ./config/
COPY migrations/ ./migrations/
COPY migrations-pg/ ./migrations-pg/
COPY migrations-rootdatapro/ ./migrations-rootdatapro/
COPY scripts/ ./scripts/
COPY ecosystem.config.js* ./
COPY only-api-ecosystem.config.js* ./
COPY --from=admin-builder /app/admin-web/dist ./admin-web/dist

RUN mkdir -p logs
EXPOSE 3000 3001 3002 3003

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

CMD ["pm2-runtime", "start", "ecosystem.config.js", "--env", "production"]
