# syntax=docker/dockerfile:1

FROM node:20-alpine AS pruner
WORKDIR /app
RUN npm install -g turbo@2
COPY . .
RUN turbo prune @arayeshgah/user-app --docker

FROM node:20-alpine AS installer
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm turbo run build --filter=@arayeshgah/user-app

FROM node:20-alpine AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 --ingroup nodejs nuxtuser
COPY --from=installer --chown=nuxtuser:nodejs /app/apps/user-app/.output ./.output
USER nuxtuser
ENV HOST=0.0.0.0
ENV PORT=3003
EXPOSE 3003
CMD ["node", ".output/server/index.mjs"]
