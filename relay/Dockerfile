# syntax=docker/dockerfile:1.7
#
# Multi-stage build for the nostrdome-relay binary.
#
# Stage 1 (builder): pulls the Go toolchain matching go.mod, copies the
# module sources, and produces a statically-linked binary in /out/relay.
# We compile with CGO_ENABLED=1 because the SQLite eventstore links
# against go-sqlite3, which needs cgo. To keep the runtime image small we
# still avoid glibc by targeting Alpine on both stages.
#
# Stage 2 (runtime): minimal Alpine with ca-certs + sqlite shared lib.
# The relay reads its TOML config from /etc/nostrdome/relay.toml (mount
# this from the bundle's compose file) and writes events to /var/lib/
# nostrdome (a named volume so backups can grab it).

ARG GO_VERSION=1.26.2
ARG ALPINE_VERSION=3.20

FROM golang:${GO_VERSION}-alpine${ALPINE_VERSION} AS builder

RUN apk add --no-cache build-base sqlite-dev git

WORKDIR /src

# Cache deps separately from sources so a .go change doesn't bust the
# (much heavier) module download layer.
COPY go.mod go.sum ./
RUN go mod download

COPY . .

ENV CGO_ENABLED=1 \
    GOOS=linux

# Build all three relay binaries; the bundle uses cmd/nostrdome-relay,
# the seed util is handy for ops, the legacy spike stays for parity tests.
RUN go build -trimpath -ldflags="-s -w" -o /out/nostrdome-relay ./cmd/nostrdome-relay \
 && go build -trimpath -ldflags="-s -w" -o /out/nostrdome-seed  ./cmd/nostrdome-seed

FROM alpine:${ALPINE_VERSION} AS runtime

RUN apk add --no-cache ca-certificates sqlite-libs tzdata \
 && addgroup -S nostrdome \
 && adduser  -S -G nostrdome -h /var/lib/nostrdome -s /sbin/nologin nostrdome \
 && mkdir -p /var/lib/nostrdome /etc/nostrdome \
 && chown -R nostrdome:nostrdome /var/lib/nostrdome /etc/nostrdome

COPY --from=builder /out/nostrdome-relay /usr/local/bin/nostrdome-relay
COPY --from=builder /out/nostrdome-seed  /usr/local/bin/nostrdome-seed

USER nostrdome
WORKDIR /var/lib/nostrdome

EXPOSE 7777

# Default entrypoint reads /etc/nostrdome/relay.toml. The bundle mounts
# that path from a templated config produced by install.sh.
ENTRYPOINT ["/usr/local/bin/nostrdome-relay"]
CMD ["--config", "/etc/nostrdome/relay.toml"]
