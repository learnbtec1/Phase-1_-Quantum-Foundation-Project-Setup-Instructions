# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Install dependencies (production + dev)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20.11-bullseye-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Build Next.js (standalone)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20.11-bullseye-slim AS builder
WORKDIR /app
ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# deps استخدمت ignore-scripts — ننسخ حزمة Speech للمتصفح قبل البناء (Turbopack يخدمها من public/vendor)
RUN node scripts/copy-azure-speech-browser-bundle.mjs
RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3: Runtime (Production)
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20.11-bullseye-slim AS runner
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
FROM node:20.11-bullseye-slim AS dev-base
WORKDIR /app
ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1
COPY package*.json ./
# postinstall يشغّل scripts/copy-azure-speech-browser-bundle.mjs — يجب وجود المجلد قبل npm install
COPY scripts ./scripts
RUN npm install
EXPOSE 3000
CMD ["npm","run","dev","--","-H","0.0.0.0","-p","3000"]