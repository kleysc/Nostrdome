# syntax=docker/dockerfile:1.7
#
# SPA build → static assets served by Caddy.
#
# Stage 1 (builder): compiles the React SPA via the existing `npm run
# build` (tsc + vite). Vite outputs hashed assets to /app/dist.
#
# Stage 2 (runtime): produces a tiny image whose only job is to expose the
# build artifacts on a volume that Caddy mounts read-only. We do NOT ship
# nginx here — Caddy already terminates TLS and serves static files; this
# container exists so the bundle can ship one image per service and so
# operators can `docker pull` the SPA without rebuilding from source.

ARG NODE_VERSION=20

FROM node:${NODE_VERSION}-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .

# `npm run build` is `tsc -b && vite build` — fails the image if types break.
RUN npm run build

# Stage 2: a minimal busybox image whose only purpose is to copy the dist
# tree onto a shared volume at container start. The compose file uses
# `command: ["sh","-c","cp -r /dist/. /share/"]` to populate the Caddy
# document root, then exits — Caddy keeps serving from the populated vol.
FROM busybox:stable-musl AS runtime
COPY --from=builder /app/dist /dist
ENTRYPOINT ["sh", "-c", "cp -r /dist/. /share/ && echo 'spa published to /share' && tail -f /dev/null"]
