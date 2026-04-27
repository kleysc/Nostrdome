#!/usr/bin/env bash
# bundle/scripts/backup.sh — produces a tarball of every named volume.
#
# Usage:
#   ./scripts/backup.sh [outdir]
#
# Default outdir is ./backups/. The tarball is named
# `nostrdome-<DOMAIN>-<UTC-timestamp>.tar.gz`.
#
# Strategy: spin up a transient alpine container that mounts every named
# volume read-only and tars the lot. Doesn't stop the running services —
# SQLite WAL is consistent enough for a hot snapshot, and Blossom blobs
# are immutable. For a guaranteed-quiescent backup, `docker compose stop
# relay` first.
set -euo pipefail
cd "$(dirname "$0")/.."

OUTDIR="${1:-./backups}"
mkdir -p "$OUTDIR"

# Source .env so we can name the tarball after the operator's domain.
[[ -f .env ]] && set -a && . .env && set +a

TS=$(date -u +%Y%m%dT%H%M%SZ)
DOMAIN_SAFE=$(printf '%s' "${DOMAIN:-nostrdome}" | tr '/.:' '_-_')
OUT="$OUTDIR/nostrdome-${DOMAIN_SAFE}-${TS}.tar.gz"

# Discover the project's volume prefix. compose names volumes
# `<projectname>_<volume>` where projectname defaults to the directory.
PROJECT="$(basename "$PWD")"
VOLUMES=(caddy_data caddy_config relay_data blossom_data spa_dist)

MOUNTS=()
for v in "${VOLUMES[@]}"; do
  MOUNTS+=( -v "${PROJECT}_${v}:/src/${v}:ro" )
done

# `tar -C /src .` writes paths relative to the volumes root so the
# restore script can swap them back in untouched.
docker run --rm \
  "${MOUNTS[@]}" \
  -v "$(pwd)/$OUTDIR:/dst" \
  alpine:3.20 \
  sh -c "cd /src && tar -czf /dst/$(basename "$OUT") ."

printf 'wrote %s (%s)\n' "$OUT" "$(du -h "$OUT" | cut -f1)"
