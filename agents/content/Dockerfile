FROM node:20-alpine AS base

# Dependencies
FROM base AS deps
WORKDIR /app

# Copy package files for the agent
COPY agents/content/package*.json ./agents/content/

WORKDIR /app/agents/content
RUN npm install --omit=dev

# Builder
FROM base AS builder
WORKDIR /app

# Copy package files for dev dependencies
COPY agents/content/package*.json ./agents/content/
COPY core/shared ./core/shared/

WORKDIR /app/agents/content
RUN npm install

# Compile shared tools FIRST (symlink node_modules so tsc can resolve @mastra/zod)
WORKDIR /app/core/shared
RUN ln -s ../../agents/content/node_modules node_modules
WORKDIR /app
RUN agents/content/node_modules/.bin/tsc -p core/shared/tsconfig.json

# Copy agent source and build
WORKDIR /app/agents/content
COPY agents/content/ ./
RUN npm run build

# Runner
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 appuser

# Copy built files and dependencies
COPY --from=deps /app/agents/content/node_modules ./node_modules
# Copy compiled shared tools (JS, not TS)
COPY --from=builder /app/core/shared/dist ./core/shared
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/agents/content/package*.json ./

USER appuser

EXPOSE 3104
ENV PORT=3104

CMD ["node", "dist/agents/content/src/index.js"]
