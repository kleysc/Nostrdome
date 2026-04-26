# relay/

> Khatru-based Nostr relay with Nostrdome plugin (NIP-29 groups + per-channel ACL + NIP-42 AUTH + rate limiting + NIP-50 search).

## Status

🚧 **Scaffold only — no code yet.**

Implementation begins with task §1.2 (F1 — Foundation: relay plugin) of the platform plan in `../openspec/changes/nostrdome-sovereign-platform/tasks.md`.

Event schema this plugin must enforce: `../docs/event-schema.md`.

## Planned structure

```
relay/
├── cmd/
│   └── relay/                # main entrypoint (khatru wired up with plugin)
├── internal/
│   ├── plugin/               # Nostrdome plugin (auth, membership, ACL, rate limit)
│   ├── groupstate/           # last-write-wins state for kinds 39000-39003/39100/39101
│   ├── voice/                # /voice/token endpoint (LiveKit JWT minting)
│   └── metrics/              # /admin/metrics endpoint (telemetry)
├── pkg/
│   └── eventschema/          # types and validators for kinds 39000-39400
├── tests/
│   ├── adversarial/          # adversarial tests (non-member writes, AUTH bypass)
│   └── integration/          # end-to-end tests against a running relay
├── go.mod
├── Dockerfile
└── relay.toml.example        # config example
```

## Next steps (per platform plan)

- [ ] §1.1.1 Spike: levantar khatru, plugin "hello world"
- [ ] §1.1.2 Spike: NIP-29 invite/expulse, NIP-42 AUTH validation
- [ ] §1.2.1 Plugin bootstrap: config loader (toml), structured logging
- [ ] §1.2.2 NIP-42 AUTH handler enforced
- [ ] §1.2.3 Group state storage (kinds 39000-39003)
- [ ] §1.2.4 Membership enforcement
- [ ] §1.2.5 Per-channel ACL
- [ ] §1.2.6 Rate limiting per pubkey
- [ ] §1.2.7 NIP-50 search
- [ ] §1.2.8 Audit log enforcement
- [ ] §1.2.9 Adversarial test suite
- [ ] §1.2.10 NIP-11 document

## License

TBD — propose MIT or Apache-2.0 to align with khatru upstream.
