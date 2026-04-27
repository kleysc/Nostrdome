# Caddy template. install.sh substitutes ${DOMAIN} and ${ACME_EMAIL} and
# writes the result to ./Caddyfile, which docker-compose mounts read-only
# inside the caddy container.
#
# Layout:
#   https://${DOMAIN}/             → SPA (static, served from /srv).
#                                    /runtime-config.js is mounted from
#                                    the host so the operator can edit it
#                                    without rebuilding the image.
#   wss://relay.${DOMAIN}/         → nostrdome-relay (websocket).
#   https://relay.${DOMAIN}/       → NIP-11 relay info (same upstream;
#                                    khatru serves it on GET / with
#                                    Accept: application/nostr+json).
#   https://blossom.${DOMAIN}/     → blossom blob server.

{
    email ${ACME_EMAIL}
    # HTTP/3 lives on UDP/443 — make sure docker-compose maps it.
    servers {
        protocols h1 h2 h3
    }
}

# === SPA ===
${DOMAIN} {
    encode zstd gzip
    root * /srv
    # SPA routing: serve index.html for any unmatched path so /c/<group>
    # client-side routes don't 404 on hard refresh.
    try_files {path} /index.html
    file_server

    # Cache static assets aggressively (vite produces hashed filenames);
    # never cache index.html so deploys propagate immediately.
    @hashed path_regexp ^/assets/.*\.[a-f0-9]{8,}\.(js|css|woff2?|png|jpg|svg|webp)$
    header @hashed Cache-Control "public, max-age=31536000, immutable"
    header /index.html Cache-Control "no-cache"
    header /runtime-config.js Cache-Control "no-cache"
}

# === Relay (websocket + NIP-11) ===
relay.${DOMAIN} {
    encode zstd gzip
    reverse_proxy relay:7777 {
        # khatru upgrades to websocket on the same path; Caddy's reverse_proxy
        # auto-handles the Upgrade/Connection headers.
        header_up X-Forwarded-Proto {scheme}
        header_up Host {host}
    }
}

# === Blossom ===
blossom.${DOMAIN} {
    encode zstd gzip
    reverse_proxy blossom:3000 {
        header_up X-Forwarded-Proto {scheme}
        header_up Host {host}
    }
}
