# syntax=docker/dockerfile:1

FROM node:26-alpine AS pruner
WORKDIR /app
RUN npm install -g turbo@2
COPY . .
RUN turbo prune @gheychi/provider-panel --docker

FROM node:26-alpine AS installer
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY --from=pruner /app/out/json/ .
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
ARG VITE_API_BASE=http://localhost:3002/api
ENV VITE_API_BASE=$VITE_API_BASE
RUN pnpm turbo run build --filter=@gheychi/provider-panel

FROM nginx:1.27-alpine AS runner
COPY docker/nginx-spa.conf /etc/nginx/conf.d/default.conf
COPY --from=installer /app/apps/provider-panel/dist /usr/share/nginx/html
EXPOSE 80
