# Multi-stage production container for Track 3 Assistant API
FROM node:22-alpine AS build

WORKDIR /app

# Enable corepack for reproducible pnpm installation
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate

# Copy workspace package manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source trees and build configs
COPY tsconfig.base.json ./
COPY apps/api ./apps/api
COPY apps/web ./apps/web

# Build production artifacts
RUN pnpm build

# Production runtime stage
FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

# Install production dependencies for the API
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate \
    && pnpm --filter @track3/api install --prod --frozen-lockfile

# Copy compiled outputs
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist

EXPOSE 3000

USER node

CMD ["node", "apps/api/dist/server.js"]
