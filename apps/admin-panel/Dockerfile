# syntax=docker/dockerfile:1

FROM node:20-alpine AS pruner
WORKDIR /app
RUN npm install -g turbo@2
COPY . .
RUN turbo prune @gheychi/admin-panel --docker

FROM node:20-alpine AS installer
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
ARG VITE_API_BASE=http://localhost:3002/api
ENV VITE_API_BASE=$VITE_API_BASE
# Browser crash reporting (src/utils/error-reporting.ts). Vite inlines import.meta.env at
# BUILD time, so unlike the api's runtime .env this has to be baked into the image -- which
# is fine: a Sentry DSN only authorizes event ingestion into one project and is designed to
# ship inside a public browser bundle, so it is not a secret (same reasoning as
# VITE_API_BASE above). Left empty by default, and an empty DSN means Sentry is never
# initialized at all, so a build with no DSN behaves exactly as it did before this existed.
ARG VITE_SENTRY_DSN=
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
RUN pnpm turbo run build --filter=@gheychi/admin-panel

FROM nginx:1.27-alpine AS runner
COPY docker/nginx-spa.conf /etc/nginx/conf.d/default.conf
COPY --from=installer /app/apps/admin-panel/dist /usr/share/nginx/html
EXPOSE 80
