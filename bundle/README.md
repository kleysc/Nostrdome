# bundle/

> Self-host bundle for a sovereign Nostrdome community. One `docker
> compose up -d --build` brings up: relay (built from `../relay/`),
> Blossom (file storage), Caddy (reverse proxy + auto-TLS), and the
> Nostrdome SPA (built from `../`). LiveKit (voice/video) lands in F4.

## Quick start

```sh
git clone <this-repo> nostrdome-mycommunity
cd nostrdome-mycommunity/bundle
./scripts/install.sh        # interactive: domain, owner npub, admins, etc.
docker compose up -d --build
```

After ~90 seconds:

| URL                              | Purpose                                  |
|----------------------------------|------------------------------------------|
| `https://<domain>/`              | Nostrdome SPA                            |
| `wss://relay.<domain>/`          | NIP-29 relay (NIP-42 AUTH required)      |
| `https://relay.<domain>/`        | NIP-11 relay info document               |
| `https://blossom.<domain>/`      | Blossom blob server                      |

## Pre-flight checklist

Before running `install.sh`:

- [ ] **DNS** — `A`/`AAAA` records for `<domain>`, `relay.<domain>`,
      `blossom.<domain>` pointing at this host.
- [ ] **Firewall** — TCP/80, TCP/443, UDP/443 inbound. The relay's 7777
      is *not* exposed publicly; Caddy proxies it.
- [ ] **Owner npub** — the `npub1…` you'll use as community owner. The
      installer derives the hex pubkey automatically.
- [ ] **Docker + Docker Compose v2** — `docker compose version` should
      print v2.x.

## Layout

```
bundle/
├── docker-compose.yml          # main compose file
├── Caddyfile.tpl               # template — install.sh renders Caddyfile
├── relay.toml.tpl              # template — install.sh renders relay.toml
├── runtime-config.js.tpl       # template — install.sh renders runtime-config.js
├── .env.example                # canonical list of vars
├── scripts/
│   ├── install.sh              # interactive first-run setup
│   ├── backup.sh               # tarball every named volume
│   └── restore.sh              # extract tarball + recreate volumes
└── (generated, gitignored)
    ├── .env
    ├── Caddyfile
    ├── relay.toml
    ├── runtime-config.js
    └── backups/
```

## Sizing

| Voice | Min RAM | Recommended RAM | Disk (initial) |
|-------|---------|-----------------|----------------|
| Off (F1)  | 2 GB | 4 GB | 20 GB |
| On (F4)   | 4 GB | 8 GB | 40 GB |

Disk grows roughly with chat volume: ~1 KB per message in SQLite plus the
size of any uploaded blobs in Blossom.

## Operations

### Backup

```sh
./scripts/backup.sh                 # writes ./backups/nostrdome-<domain>-<UTC>.tar.gz
./scripts/backup.sh /mnt/external   # custom outdir
```

The tarball captures every named volume (relay DB, Blossom blobs, Caddy
ACME state, the published SPA dist). The backup is taken *hot* — SQLite's
WAL is consistent enough for a snapshot. For a guaranteed-quiescent
backup, `docker compose stop relay` first.

### Restore

```sh
docker compose down
./scripts/restore.sh backups/nostrdome-...tar.gz
docker compose up -d
```

Restore is destructive: existing volume contents are wiped before
extraction. The script refuses to run while the stack is up.

### Update

```sh
git pull
docker compose build              # rebuild relay + spa images
docker compose up -d               # rolling restart, ACME state is preserved
```

The compose file pins images by tag (`RELAY_IMAGE_TAG`, `SPA_IMAGE_TAG`)
so you can canary a build by setting a tag in `.env` and re-running
`docker compose up -d`.

### Re-configure

Re-running `./scripts/install.sh` is safe — your existing `.env` answers
are offered as defaults. After it finishes:

```sh
docker compose up -d              # picks up new Caddyfile / relay.toml / runtime-config
```

If you only edited `runtime-config.js` (e.g. added a public relay), restart
just Caddy so the no-cache header is reissued:

```sh
docker compose restart caddy
```

## Troubleshooting

### Caddy never gets a cert

- Confirm DNS resolves to *this* host: `dig +short <domain>`.
- Caddy logs: `docker compose logs caddy | tail -50`. Look for
  `obtain certificate failed` — usually port 80/443 isn't reachable from
  Let's Encrypt. Check firewall + cloud security groups.
- ACME rate limits: 5 failed orders per hour per (account, hostname).
  Wait or use staging by editing `Caddyfile` to add
  `acme_ca https://acme-staging-v02.api.letsencrypt.org/directory`.

### SPA loads but `wss://` fails

- Open the browser console: a `restricted: ` or `auth-required: ` close
  reason means the relay is healthy and the SPA needs to AUTH (expected
  on first connect).
- A timeout means the proxy isn't routing — check `docker compose logs
  caddy` for the `relay.<domain>` virtual host.
- Hit `https://relay.<domain>/` with `Accept: application/nostr+json` —
  you should see the NIP-11 document. If you see Caddy's default page,
  the Caddyfile didn't render correctly; re-run `install.sh`.

### Relay rejects every event with `auth-required:`

That's the productive behaviour: NIP-42 AUTH is mandatory before any
REQ/EVENT. Make sure the SPA finished its handshake before publishing —
the live-relay connector waits ~100 ms after connect for the challenge.

### Disk filling up

```sh
docker system df                                     # what's eating space
docker compose exec relay sqlite3 /var/lib/nostrdome/relay.db 'PRAGMA page_count;'
du -sh $(docker volume inspect bundle_blossom_data -f '{{.Mountpoint}}')
```

Blossom prune lands in F4; for now `docker compose exec blossom rm -rf
/data/<sha>` works for one-off purges.

## Security notes

- The relay container runs as an unprivileged user (`nostrdome`) and
  writes only to `/var/lib/nostrdome` (a named volume).
- Caddy auto-renews certs; ACME state lives in a dedicated volume so a
  full host re-image plus `restore.sh` brings the stack back without a
  fresh ACME order.
- The owner's nsec **never lives on the server**. The relay only knows
  the hex pubkey; signing happens entirely client-side.
- Rate-limit defaults (30/min, 600/h per pubkey) bypass for any role
  with a `manage_*` permission. See `relay.toml`.

## License

TBD — propose MIT.
