# syntax=docker/dockerfile:1

FROM node:26-alpine AS pruner
WORKDIR /app
RUN npm install -g turbo@2
COPY . .
RUN turbo prune @gheychi/api --docker

FROM node:26-alpine AS installer
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm turbo run build --filter=@gheychi/api

FROM node:26-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 --ingroup nodejs apiuser
COPY --from=installer --chown=apiuser:nodejs /app .
# Build-time facts baked into this specific image, surfaced at runtime via GET /version
# (src/version/version.service.ts) -- these never change without a rebuild, so ARG->ENV is
# the right mechanism (not a deploy-time .env value, which is why docker-compose.prod.yml's
# shared .env does NOT set these -- see the root .env.example's own comment on this).
ARG GIT_SHA=unknown
ARG APP_VERSION=dev
ARG BUILD_TIMESTAMP=
ENV GIT_SHA=${GIT_SHA}
ENV APP_VERSION=${APP_VERSION}
ENV BUILD_TIMESTAMP=${BUILD_TIMESTAMP}
USER apiuser
EXPOSE 3002
CMD ["node", "apps/api/dist/src/main.js"]
