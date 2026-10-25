FROM oven/bun:1.4.3-alpine AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM build AS debug-deps
RUN bun install --production --frozen-lockfile

FROM build AS check
RUN apk add --no-cache nodejs && bun run typecheck && bun run lint && bun test server/debug.test.ts && bun run test --maxWorkers=2

FROM nginxinc/nginx-unprivileged:1.27.5-alpine3.21@sha256:65e3e85dbaed8ba248841d9d58a899b6197106c23cb0ff1a132b7bfe0547e4c0 AS runtime
USER root
RUN apk add --no-cache --upgrade ca-certificates libgcc libstdc++ && update-ca-certificates
WORKDIR /app
COPY --from=debug-deps /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=oven/bun:1.4.3-alpine /usr/local/bin/bun /usr/local/bin/bun
COPY server ./server
RUN mkdir -p /appdata && chown 101:101 /appdata
USER 101
ENV DEBUG_PORT=3001 DEBUG_DB_PATH=/appdata/debug-overlay.sqlite
COPY --from=build /app/dist /usr/share/nginx/html
COPY proxy/default.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=0555 proxy/entrypoint.sh /usr/local/bin/modern-ui-entrypoint
COPY --chmod=0555 proxy/start-debug.sh /usr/local/bin/start-debug
ENV NGINX_ENVSUBST_FILTER='^(ABS_UPSTREAM|PSB_UPSTREAM|ABS_UPSTREAM_HOST|PSB_UPSTREAM_HOST|EXTERNAL_SCHEME)$'
ENV ABS_UPSTREAM=https://audiobookshelf.felixfoertsch.de PSB_UPSTREAM=http://podcast-sponsorblock:3000 EXTERNAL_SCHEME=https
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/start-debug"]
CMD ["nginx", "-g", "daemon off;"]

FROM build AS e2e-mocks

FROM e2e-mocks AS e2e-abs-mock
ENV FIXTURE_PORT=4179 FIXTURE_HOST=0.0.0.0 FIXTURE_SOCKET=1
EXPOSE 4179
CMD ["bun", "e2e/fixture.ts"]

FROM e2e-mocks AS e2e-psb-mock
ENV PSB_MOCK_PORT=4181 PSB_MOCK_HOST=0.0.0.0
EXPOSE 4181
CMD ["bun", "e2e/sidecar-mock.ts"]

FROM mcr.microsoft.com/playwright:v1.64.1-noble AS e2e-runner
WORKDIR /app
COPY --from=oven/bun:1.4.3 /usr/local/bin/bun /usr/local/bin/bun
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
ENV CI=1
CMD ["bun", "x", "playwright", "test"]

FROM runtime AS final
