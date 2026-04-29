#!/usr/bin/env bash
# bundle/scripts/restore.sh — extracts a backup tarball into the named
# volumes used by docker-compose.yml. DESTRUCTIVE: existing volume
# contents are wiped before the restore.
#
# Usage:
#   ./scripts/restore.sh path/to/backup.tar.gz
#
# Always run with the stack stopped:
#   docker compose down
#   ./scripts/restore.sh backups/nostrdome-...tar.gz
#   docker compose up -d
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <tarball>" >&2
  exit 2
fi
TARBALL="$1"
[[ -f "$TARBALL" ]] || { echo "no such file: $TARBALL" >&2; exit 1; }

# Refuse to run while the stack is up — a live SQLite WAL would corrupt.
if docker compose ps --quiet 2>/dev/null | grep -q .; then
  echo "compose stack is running; \`docker compose down\` first." >&2
  exit 1
fi

PROJECT="$(basename "$PWD")"
VOLUMES=(caddy_data caddy_config relay_data blossom_data spa_dist)

# Recreate empty volumes so the mount succeeds even on a fresh host.
for v in "${VOLUMES[@]}"; do
  docker volume create "${PROJECT}_${v}" >/dev/null
done

MOUNTS=()
for v in "${VOLUMES[@]}"; do
  MOUNTS+=( -v "${PROJECT}_${v}:/dst/${v}" )
done

# Wipe each volume's contents (NOT the volume itself — that would lose
# permissions baked in by the named-user containers) then untar.
docker run --rm \
  "${MOUNTS[@]}" \
  -v "$(realpath "$TARBALL"):/src/backup.tar.gz:ro" \
  alpine:3.20 \
  sh -ec '
    for v in '"${VOLUMES[*]}"'; do
      find "/dst/$v" -mindepth 1 -delete
    done
    tar -xzf /src/backup.tar.gz -C /dst
  '

printf 'restored %s into volumes: %s\n' "$TARBALL" "${VOLUMES[*]}"
echo 'next: docker compose up -d'
