# syntax=docker/dockerfile:1

FROM node:20-alpine AS pruner
WORKDIR /app
RUN npm install -g turbo@2
COPY . .
RUN turbo prune @gheychi/user-app --docker

FROM node:20-alpine AS installer
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
# `postinstall` (above) already tried this and silently skipped: `turbo prune --docker`'s
# `out/json/` stage only has package.json files, not this script, so it couldn't run there.
# Now that the full source is in place, run it for real -- see the script's own doc comment
# for why user-app needs it (a pnpm shared-fallback vue instance mismatch that breaks
# vue-multiselect/@nuxt-image at runtime, not just in tests).
RUN node apps/user-app/scripts/fix-shared-vue-instance.cjs
RUN pnpm turbo run build --filter=@gheychi/user-app

FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 --ingroup nodejs nuxtuser
COPY --from=installer --chown=nuxtuser:nodejs /app/apps/user-app/.output ./.output
USER nuxtuser
ENV HOST=0.0.0.0
ENV PORT=3003
EXPOSE 3003
CMD ["node", ".output/server/index.mjs"]
