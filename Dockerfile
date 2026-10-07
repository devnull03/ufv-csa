# syntax=docker/dockerfile:1
# The CSA site (including PrintQ) as a container. Used by docker-compose.yml.
#
#   deps    → npm ci (all dependencies)
#   builder → production build
#   runner  → small image with only the standalone server. On start it applies
#             PrintQ's database migrations and runs its scheduled jobs
#             (instrumentation.ts), so no other containers are needed.

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS builder
COPY . .
# NEXT_PUBLIC_* values are baked into the build, so they are build arguments
# (docker-compose.yml passes them from .env).
ARG NEXT_PUBLIC_SANITY_PROJECT_ID=dummy000
ARG NEXT_PUBLIC_SANITY_DATASET=production
ARG NEXT_PUBLIC_PRINTQ_ENABLED=true
ARG NEXT_PUBLIC_UMAMI_ANALYTICS_SITE_ID=
ARG SITE_DOMAIN=localhost:3000
ENV NEXT_PUBLIC_SANITY_PROJECT_ID=$NEXT_PUBLIC_SANITY_PROJECT_ID \
    NEXT_PUBLIC_SANITY_DATASET=$NEXT_PUBLIC_SANITY_DATASET \
    NEXT_PUBLIC_PRINTQ_ENABLED=$NEXT_PUBLIC_PRINTQ_ENABLED \
    NEXT_PUBLIC_UMAMI_ANALYTICS_SITE_ID=$NEXT_PUBLIC_UMAMI_ANALYTICS_SITE_ID \
    SITE_DOMAIN=$SITE_DOMAIN \
    NEXT_OUTPUT=standalone
# "compile" mode skips pre-rendering, so the build never has to reach Sanity or
# Postgres: every page renders on request at runtime instead. "generate-env"
# then inlines the NEXT_PUBLIC_* values into the browser code. The Sanity write
# client refuses to load without a token, so the build gets a placeholder that
# is never used (the real token is a runtime variable).
RUN SANITY_API_WRITE_TOKEN=build-placeholder npx next build --experimental-build-mode=compile \
 && SANITY_API_WRITE_TOKEN=build-placeholder npx next build --experimental-build-mode=generate-env \
 # generate-env rewrites chunk names; give the standalone server the updated manifests
 && rm -rf .next/standalone/.next/server \
 && cp -r .next/server .next/standalone/.next/server \
 && cp .next/*.json .next/BUILD_ID .next/standalone/.next/

FROM node:${NODE_VERSION}-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    PRINTQ_UPLOAD_DIR=/data/uploads
RUN mkdir -p /data/uploads && chown -R node:node /data
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
# SQL migrations, applied by the server on start
COPY --from=builder --chown=node:node /app/drizzle ./drizzle
USER node
EXPOSE 3000
VOLUME ["/data/uploads"]
CMD ["node", "server.js"]
