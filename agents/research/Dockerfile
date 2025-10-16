FROM node:20-alpine AS base

# Dependencies
FROM base AS deps
WORKDIR /app

# Copy package files for the agent
COPY agents/research/package*.json ./agents/research/

WORKDIR /app/agents/research
RUN npm ci --omit=dev

# Builder
FROM base AS builder
WORKDIR /app

# Copy package files for dev dependencies
COPY agents/research/package*.json ./agents/research/
COPY core/shared ./core/shared/

WORKDIR /app/agents/research
RUN npm ci

# Compile shared tools FIRST (symlink node_modules so tsc can resolve @mastra/zod)
WORKDIR /app/core/shared
RUN ln -s ../../agents/research/node_modules node_modules
WORKDIR /app
RUN agents/research/node_modules/.bin/tsc -p core/shared/tsconfig.json

# Copy agent source and build
WORKDIR /app/agents/research
COPY agents/research/ ./
RUN npm run build

# Runner
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 appuser

# Copy built files and dependencies
COPY --from=deps /app/agents/research/node_modules ./node_modules
# Copy compiled shared tools (JS, not TS)
COPY --from=builder /app/core/shared/dist ./core/shared
COPY --from=builder /app/agents/research/dist ./dist
COPY --from=builder /app/agents/research/package*.json ./

USER appuser

EXPOSE 3001
ENV PORT=3001

CMD ["node", "dist/agents/research/src/index.js"]
