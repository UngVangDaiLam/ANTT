# Một Dockerfile, hai image (chọn bằng --target, xem docker-compose.prod.yml):
#   server : Fastify + Prisma, chạy bằng user thường, không có mã mật mã phía client.
#   web    : giao diện đã build, phục vụ bởi Caddy (HTTPS, header bảo mật, reverse proxy /api).
# Build context là thư mục gốc của repo vì đây là monorepo pnpm.

ARG NODE_IMAGE=node:24-bookworm-slim

# ---------------------------------------------------------------- cài thư viện
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# Bật pnpm đúng phiên bản ghi trong package.json (trường packageManager).
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared/package.json shared/
COPY crypto/package.json crypto/
COPY client-sdk/package.json client-sdk/
COPY server/package.json server/
COPY web/package.json web/
COPY integration/package.json integration/
# --frozen-lockfile: đúng phiên bản đã khóa, không tự nâng (chuỗi cung ứng).
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------- server
FROM ${NODE_IMAGE} AS server
# Prisma cần OpenSSL để chạy engine truy vấn.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/shared/node_modules ./shared/node_modules
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY package.json pnpm-workspace.yaml ./
COPY shared ./shared
COPY server ./server
RUN cd server && npx prisma generate
USER node
WORKDIR /app/server
EXPOSE 3000
# Gọi node trực tiếp (không qua pnpm) để tín hiệu dừng tới thẳng tiến trình.
CMD ["node", "--disable-proto=throw", "src/server.js"]

# ---------------------------------------------------------------- build giao diện
FROM deps AS web-build
COPY shared ./shared
COPY crypto ./crypto
COPY client-sdk ./client-sdk
COPY web ./web
RUN pnpm --filter @secure-notes/web build

# ---------------------------------------------------------------- Caddy + giao diện
FROM caddy:2-alpine AS web
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=web-build /app/web/dist /srv/web
