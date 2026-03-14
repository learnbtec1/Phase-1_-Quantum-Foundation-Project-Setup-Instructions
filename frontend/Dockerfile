# ── Stage 1: dependency install ──────────────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
# npm ci is faster and reproducible; omit --production so devDeps are available for build
RUN npm ci --ignore-scripts

# ── Stage 2: Next.js standalone build (production) ───────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── Stage 3: slim runtime (production) ───────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# standalone output bundles everything; copy static assets separately
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static     ./.next/static
COPY --from=builder /app/public           ./public
EXPOSE 3011
CMD ["node", "server.js"]

# ══════════════════════════════════════════════════════════════════════════════
# Development override (used by docker-compose via volume mounts + npm run dev)
# ══════════════════════════════════════════════════════════════════════════════
# The docker-compose.yml mounts ./frontend over /usr/src/app and starts
# `npm run dev` from there.  For that flow the image only needs node_modules
# pre-installed.  Build directly from this stage:
#   docker build --target dev-base .
FROM node:20-alpine AS dev-base
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3011
CMD ["npm", "run", "dev"]
