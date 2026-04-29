#!/usr/bin/env bash
# bundle/scripts/install.sh — interactive first-run setup.
#
# Reads .env.example, prompts the operator for any missing values, writes
# .env, then materialises Caddyfile, relay.toml and runtime-config.js
# from their .tpl siblings. Idempotent: re-running picks up edits without
# clobbering existing answers — operators answer "" to keep current.
#
# Stays in pure bash so it runs on a fresh VPS without extra deps.
set -euo pipefail

cd "$(dirname "$0")/.."
BUNDLE_DIR="$(pwd)"

err()  { printf 'error: %s\n' "$*" >&2; exit 1; }
info() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*" >&2; }

require() {
  command -v "$1" >/dev/null 2>&1 || err "missing dependency: $1"
}

# Required tools. We don't assume bech32-decode is available; npub→hex is
# done with a small bundled python helper.
require docker
require sed
require awk

# --- 1. Load existing .env if present -----------------------------------
declare -A env_existing=()
if [[ -f .env ]]; then
  info "found existing .env — values will be offered as defaults"
  while IFS='=' read -r k v; do
    [[ -z "$k" || "$k" =~ ^# ]] && continue
    env_existing["$k"]="${v}"
  done < .env
fi

# --- 2. Prompt for each key in .env.example -----------------------------
ask() {
  local key="$1" prompt="$2" default="${3-}"
  local current="${env_existing[$key]-$default}"
  local val
  if [[ -n "$current" ]]; then
    read -rp "$prompt [$current]: " val
    val="${val:-$current}"
  else
    read -rp "$prompt: " val
  fi
  printf '%s' "$val"
}

info "configuring nostrdome bundle"
DOMAIN=$(ask DOMAIN "public domain (e.g. community.example.com)")
[[ -z "$DOMAIN" ]] && err "DOMAIN is required"

ACME_EMAIL=$(ask ACME_EMAIL "ACME contact email")
[[ -z "$ACME_EMAIL" ]] && err "ACME_EMAIL is required"

OWNER_NPUB=$(ask OWNER_NPUB "owner npub (NIP-19, starts with npub1...)")
[[ -z "$OWNER_NPUB" ]] && err "OWNER_NPUB is required"

# Convert npub → hex via python's stdlib bech32 (most distros). If python
# is missing, ask the operator for the hex form directly.
OWNER_PUBKEY_HEX=""
if command -v python3 >/dev/null 2>&1; then
  OWNER_PUBKEY_HEX=$(python3 - "$OWNER_NPUB" <<'PY' || true
import sys

CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'

def bech32_decode(bech):
    pos = bech.rfind('1')
    if pos < 1 or pos + 7 > len(bech):
        return None, None
    hrp = bech[:pos]
    data = []
    for c in bech[pos+1:]:
        if c not in CHARSET: return None, None
        data.append(CHARSET.index(c))
    return hrp, data[:-6]

def from5to8(data):
    out, acc, bits = [], 0, 0
    for v in data:
        acc = (acc << 5) | v
        bits += 5
        while bits >= 8:
            bits -= 8
            out.append((acc >> bits) & 0xff)
    return bytes(out)

hrp, data = bech32_decode(sys.argv[1])
if hrp != 'npub' or data is None:
    sys.exit(1)
print(from5to8(data).hex())
PY
)
fi
if [[ -z "$OWNER_PUBKEY_HEX" ]]; then
  warn "couldn't auto-decode npub; please enter hex pubkey manually"
  OWNER_PUBKEY_HEX=$(ask OWNER_PUBKEY_HEX "owner pubkey (64 hex chars)")
fi
[[ ${#OWNER_PUBKEY_HEX} -ne 64 ]] && err "OWNER_PUBKEY_HEX must be 64 hex chars (got ${#OWNER_PUBKEY_HEX})"

GROUP_ID=$(ask GROUP_ID "group id (e.g. mycommunity)" "mycommunity")
COMMUNITY_NAME=$(ask COMMUNITY_NAME "community display name" "My Community")
ADMIN_NPUBS=$(ask ADMIN_NPUBS "admin npubs (comma-separated, optional)")
PUBLIC_RELAYS=$(ask PUBLIC_RELAYS "public fallback relays (comma-separated)" "wss://relay.damus.io,wss://relay.nostr.net")
RELAY_PER_MINUTE=$(ask RELAY_PER_MINUTE "relay rate limit per minute" "30")
RELAY_PER_HOUR=$(ask RELAY_PER_HOUR "relay rate limit per hour" "600")

# --- 3. Write .env ------------------------------------------------------
cat > .env <<EOF
DOMAIN=${DOMAIN}
ACME_EMAIL=${ACME_EMAIL}
OWNER_NPUB=${OWNER_NPUB}
OWNER_PUBKEY_HEX=${OWNER_PUBKEY_HEX}
GROUP_ID=${GROUP_ID}
COMMUNITY_NAME=${COMMUNITY_NAME}
ADMIN_NPUBS=${ADMIN_NPUBS}
PUBLIC_RELAYS=${PUBLIC_RELAYS}
RELAY_PER_MINUTE=${RELAY_PER_MINUTE}
RELAY_PER_HOUR=${RELAY_PER_HOUR}
RELAY_IMAGE_TAG=latest
SPA_IMAGE_TAG=latest
BLOSSOM_IMAGE_TAG=latest
EOF
info "wrote .env"

# --- 4. Render templates -------------------------------------------------
# Convert PUBLIC_RELAYS=a,b,c to the JSON array form runtime-config.js needs.
PUBLIC_RELAYS_JSON=$(awk -v in_="$PUBLIC_RELAYS" 'BEGIN{
  n=split(in_,arr,",")
  for(i=1;i<=n;i++){
    gsub(/^[ \t]+|[ \t]+$/,"",arr[i])
    if(length(arr[i])==0) continue
    if(out!="") out=out","
    out=out "\"" arr[i] "\""
  }
  print out
}')

render() {
  local tpl="$1" out="$2"
  [[ -f "$tpl" ]] || err "missing template: $tpl"
  sed \
    -e "s#\${DOMAIN}#${DOMAIN}#g" \
    -e "s#\${ACME_EMAIL}#${ACME_EMAIL}#g" \
    -e "s#\${OWNER_PUBKEY_HEX}#${OWNER_PUBKEY_HEX}#g" \
    -e "s#\${GROUP_ID}#${GROUP_ID}#g" \
    -e "s#\${COMMUNITY_NAME}#${COMMUNITY_NAME}#g" \
    -e "s#\${RELAY_PER_MINUTE}#${RELAY_PER_MINUTE}#g" \
    -e "s#\${RELAY_PER_HOUR}#${RELAY_PER_HOUR}#g" \
    -e "s#\${PUBLIC_RELAYS_JSON}#${PUBLIC_RELAYS_JSON}#g" \
    "$tpl" > "$out"
  info "rendered $out"
}

render Caddyfile.tpl         Caddyfile
render relay.toml.tpl        relay.toml
render runtime-config.js.tpl runtime-config.js

# --- 5. Final summary ---------------------------------------------------
cat <<EOF

$(info "install complete")

Next steps:
  1. Point DNS A/AAAA records at this host:
       ${DOMAIN}, relay.${DOMAIN}, blossom.${DOMAIN}
  2. Bring the stack up:
       docker compose up -d --build
  3. Wait ~90s for Caddy to mint TLS certs, then visit:
       https://${DOMAIN}/

To re-run with edits, run \`./scripts/install.sh\` again — your existing
.env answers will be offered as defaults.
EOF
