# CAIPE UI Dockerfile
# Multi-stage build for Next.js application

# Stage 1: Dependencies
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy package files
COPY package.json yarn.lock* package-lock.json* pnpm-lock.yaml* ./

# Install dependencies
RUN \
  if [ -f yarn.lock ]; then yarn --frozen-lockfile; \
  elif [ -f package-lock.json ]; then npm ci; \
  elif [ -f pnpm-lock.yaml ]; then corepack enable pnpm && pnpm i --frozen-lockfile; \
  else npm install; \
  fi

# Stage 2: Build
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build arguments for configuration
# CAIPE_URL: URL of the CAIPE supervisor A2A endpoint
# Default: http://localhost:8000 (dev) or http://caipe-supervisor:8000 (docker)
ARG CAIPE_URL=http://caipe-supervisor:8000
ENV CAIPE_URL=$CAIPE_URL
ENV NEXT_PUBLIC_CAIPE_URL=$CAIPE_URL

# Legacy support
ARG A2A_ENDPOINT
ENV A2A_ENDPOINT=${A2A_ENDPOINT:-$CAIPE_URL}

ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# Stage 3: Production
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy public folder and built assets
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Runtime environment variables can override build-time defaults
# Set CAIPE_URL or NEXT_PUBLIC_CAIPE_URL at runtime to override
CMD ["node", "server.js"]
