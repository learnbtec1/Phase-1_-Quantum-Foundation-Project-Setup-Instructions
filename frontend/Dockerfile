# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Install dependencies (production + dev)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Build Next.js (standalone)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app
# Production build so next.config.js emits `output: 'standalone'` for the runner stage
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3: Runtime (Production)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static     ./.next/static
COPY --from=builder /app/public           ./public
EXPOSE 3000
CMD ["node", "server.js"]

# ─────────────────────────────────────────────────────────────────────────────
# Stage 4: Development base (Hot Reload via compose volume)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS dev-base
WORKDIR /app
ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1
COPY package*.json ./
RUN npm install
EXPOSE 3000
# Host/port come from package.json "dev" script (avoid duplicate -H/-p flags)
CMD ["npm", "run", "dev"]