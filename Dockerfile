# ─────────────────────────────────────────────────────────────────────
# Asena Peer Pong — production image
#   docker build -t asena-peer-pong .
#   docker run -p 3000:3000 asena-peer-pong
# AsenaJS 0.12 needs Bun >= 1.4.0.
# ─────────────────────────────────────────────────────────────────────

# ── 1. build: install deps (incl. the asena CLI) and bundle ──────────
FROM oven/bun:1.4.4 AS build
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY tsconfig.json asena-config.ts ./
COPY .asena ./.asena
COPY src ./src
COPY web ./web
COPY public ./public

# → dist/index.asena.js (+ dist/web and dist/src/game for the HTML page)
RUN bunx asena build

# ── 2. runtime: just Bun + the bundle, no node_modules ───────────────
FROM oven/bun:1.4.4-slim AS runtime
WORKDIR /app

# UDP broadcast does not cross Docker's bridge network. Run with
# `--network host -e DISCOVERY_ENABLED=true` to take part in LAN discovery.
ENV NODE_ENV=production \
    PORT=3000 \
    HEALTH_PORT=3001 \
    DISCOVERY_ENABLED=false \
    ALLOWED_ORIGINS=*

COPY --from=build --chown=bun:bun /app/dist ./dist
COPY --from=build --chown=bun:bun /app/public ./public

USER bun
EXPOSE 3000 3001 41234/udp

# Asena's health server: /healthz/live (process up) and /healthz/ready (accepting traffic)
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:' + (process.env.HEALTH_PORT || 3001) + '/healthz/live').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# SIGTERM → Asena graceful shutdown (@OnStop hooks, WebSocket drain)
STOPSIGNAL SIGTERM
CMD ["bun", "dist/index.asena.js"]
