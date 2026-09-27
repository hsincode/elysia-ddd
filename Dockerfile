# Bun の実行時ごと 1 つのバイナリにして、distroless（シェル無し・非 root）で動かす
FROM oven/bun:1.4 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM gcr.io/distroless/cc-debian12:nonroot
WORKDIR /app
COPY --from=build /app/dist/server ./server
# MIGRATE_ON_START=true（デフォルト）のとき起動時に流す SQL
COPY --from=build /app/drizzle ./drizzle
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
ENTRYPOINT ["./server"]
