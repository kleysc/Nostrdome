// Command nostrdome-relay is the productive Nostrdome relay binary.
//
// It loads a TOML config, builds a structured logger, instantiates a khatru
// relay, and registers the productive hooks in the order required by the
// platform spec:
//
//  1. NIP-42 AUTH                (internal/auth)
//  2. NIP-29 group membership    (internal/groupstate, §1.2.4)
//  3. Per-channel ACL            (internal/groupstate, §1.2.5)
//  4. Rate limiting              (internal/ratelimit, §1.2.6)
//  5. Audit pairing + delete-protection (internal/audit, §1.2.8)
//
// Order matters: every hook below AUTH assumes khatru.GetAuthed(ctx) is
// non-empty, so AUTH must reject before they run.
//
// The throwaway spike binary in cmd/relay/ stays intact for §1.4 demos. This
// binary supersedes it for §1.2 onward.
package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/fiatjaf/khatru"
	"github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/nip11"

	"github.com/nostrdome-platform/relay/internal/audit"
	"github.com/nostrdome-platform/relay/internal/auth"
	"github.com/nostrdome-platform/relay/internal/config"
	"github.com/nostrdome-platform/relay/internal/groupstate"
	"github.com/nostrdome-platform/relay/internal/logging"
	"github.com/nostrdome-platform/relay/internal/ratelimit"
	"github.com/nostrdome-platform/relay/internal/search"
	"github.com/nostrdome-platform/relay/internal/storage"
)

func main() {
	configPath := flag.String("config", "relay.toml", "path to the TOML config file")
	flag.Parse()

	cfg, err := config.Load(*configPath)
	if err != nil {
		// Logger isn't built yet; emit a minimal stderr line and exit.
		slog.New(slog.NewJSONHandler(os.Stderr, nil)).
			Error("config load failed", slog.String("err", err.Error()))
		os.Exit(2)
	}

	logger := logging.New(logging.Options{
		Level:  cfg.Logging.Level,
		Format: cfg.Logging.Format,
	})
	slog.SetDefault(logger)

	logger.Info("starting nostrdome-relay",
		slog.String("addr", cfg.Relay.Addr),
		slog.String("name", cfg.Relay.Name),
		slog.String("version", cfg.Relay.Version),
		slog.String("storage_path", cfg.Storage.Path),
	)

	store, err := storage.Open(cfg.Storage.Path)
	if err != nil {
		logger.Error("storage init failed", slog.String("err", err.Error()))
		os.Exit(2)
	}
	defer store.Close()
	logger.Info("storage ready", slog.String("file", store.Path()))

	relay := khatru.NewRelay()
	relay.Info.Name = cfg.Relay.Name
	relay.Info.Description = cfg.Relay.Description
	relay.Info.PubKey = cfg.Relay.Pubkey
	relay.Info.Contact = cfg.Relay.ContactEmail
	relay.Info.Software = cfg.Relay.SoftwareURL
	relay.Info.Version = cfg.Relay.Version
	// Supported NIPs the productive plugin actually enforces:
	//   1  base protocol; 9 deletes (with kind-39250 protection §1.2.8);
	//   11 this document; 29 closed groups (§1.2.4 membership + §1.2.5 ACL);
	//   42 AUTH (§1.2.2, mandatory pre-REQ/EVENT); 50 search on kind 39200
	//   (§1.2.7).
	relay.Info.SupportedNIPs = []any{1, 9, 11, 29, 42, 50}
	// Tags surface the relay's flavor in directory listings.
	relay.Info.Tags = []string{"nostrdome", "nip29-group", "auth-required"}
	// Limitations reflect the actual reject behavior so well-behaved clients
	// can adapt without trial-and-error: AUTH is required, writes are
	// restricted (membership + ACL gates), and rate limits cap message volume.
	relay.Info.Limitation = &nip11.RelayLimitationDocument{
		AuthRequired:     true,
		RestrictedWrites: true,
		MaxMessageLength: 256 * 1024,
		MaxSubscriptions: 32,
		MaxLimit:         1000,
		MaxEventTags:     100,
		MaxContentLength: 64 * 1024,
	}
	relay.Info.PostingPolicy = "Posting requires NIP-42 AUTH and NIP-29 group membership; per-channel ACLs apply."

	// Wire on-disk storage. Replaceable kinds (30000-39999, including the
	// group-state kinds 39000-39003 + 39100/39101) auto-route to
	// ReplaceEvent for last-write-wins; ephemeral kinds (e.g. 21000
	// presence) bypass storage entirely. The QueryEvents path is wrapped
	// with NIP-50 search so filters carrying a Search field are narrowed
	// to kind 39200 and substring-filtered (§1.2.7).
	store.Wire(relay, search.WithSearch)

	// Build the in-memory NIP-29 projection and rebuild it from the events
	// already on disk. Boot continues even on replay error — the operator
	// can inspect the SQLite file by hand — but we log loudly so it's
	// caught in monitoring.
	gstate := groupstate.New()
	{
		replayCtx, replayCancel := context.WithTimeout(context.Background(), 30*time.Second)
		if err := gstate.ReplayFrom(replayCtx, store.Backend()); err != nil {
			logger.Error("groupstate replay failed", slog.String("err", err.Error()))
		} else {
			logger.Info("groupstate ready")
		}
		replayCancel()
	}

	// ── Hook ordering: AUTH → membership → (ACL §1.2.5 → rate §1.2.6). ────
	// IssueOnConnect pushes the NIP-42 challenge proactively so well-behaved
	// clients can call r.Auth() without a fail-then-retry round trip.
	relay.OnConnect = append(relay.OnConnect, auth.IssueOnConnect)
	relay.RejectFilter = append(relay.RejectFilter, auth.RejectUnauthedFilter)
	relay.RejectEvent = append(relay.RejectEvent, auth.RejectUnauthedEvent)
	// Membership runs immediately after AUTH so subsequent hooks (ACL,
	// rate-limit) can assume the signer is at least a group member.
	relay.RejectEvent = append(relay.RejectEvent, groupstate.RequireMembership(gstate))
	// Per-channel write_roles enforcement (§1.2.5). Membership is already
	// guaranteed by the previous hook; this one only checks the signer's
	// role_ids against the channel's write_roles.
	relay.RejectEvent = append(relay.RejectEvent, groupstate.RequireChannelWritePermission(gstate))
	// Per-pubkey rate limit (§1.2.6). Privileged signers (owner / manage_*
	// roles) bypass entirely; everyone else gets a minute + hour token
	// bucket sized from cfg.RateLimit.
	limiter := ratelimit.New(ratelimit.Config{
		PerMinute: cfg.RateLimit.PerMinute,
		PerHour:   cfg.RateLimit.PerHour,
	}, gstate)
	relay.RejectEvent = append(relay.RejectEvent, limiter.Reject())
	// Audit pairing (§1.2.8). State mutations (kinds 39000-39003, 39100,
	// 39101) must be preceded by a kind 39250 from the same actor for the
	// same group within audit.RecentWindow. NIP-09 deletes targeting an
	// audit event are rejected to keep the audit trail immutable.
	relay.RejectEvent = append(relay.RejectEvent, audit.RequireAuditPair(store.Backend(), nil))
	relay.RejectEvent = append(relay.RejectEvent, audit.RejectAuditDeletes(store.Backend()))
	// Keep the projection fresh for every accepted event. Use
	// OnEventSaved (not StoreEvent) because khatru skips StoreEvent for
	// replaceable kinds when a ReplaceEvent hook is installed — all NIP-29
	// state kinds are addressable, so a StoreEvent-only hook would silently
	// stop applying after the boot replay.
	relay.OnEventSaved = append(relay.OnEventSaved, groupstate.OnSaved(gstate))

	// ── Observability hooks (non-rejecting). ──────────────────────────────
	// Run AFTER auth so the authed pubkey is already on the context.
	relay.OnConnect = append(relay.OnConnect, func(ctx context.Context) {
		slog.Info("ws connected", slog.String("ip", khatru.GetIP(ctx)))
	})
	relay.OnDisconnect = append(relay.OnDisconnect, func(ctx context.Context) {
		slog.Info("ws disconnected",
			slog.String("ip", khatru.GetIP(ctx)),
			slog.String("authed", khatru.GetAuthed(ctx)),
		)
	})
	relay.RejectFilter = append(relay.RejectFilter, func(ctx context.Context, f nostr.Filter) (bool, string) {
		slog.Debug("REQ",
			slog.String("authed", khatru.GetAuthed(ctx)),
			slog.Any("kinds", f.Kinds),
			slog.Any("tags", f.Tags),
		)
		return false, ""
	})
	relay.RejectEvent = append(relay.RejectEvent, func(ctx context.Context, e *nostr.Event) (bool, string) {
		slog.Debug("EVENT",
			slog.String("authed", khatru.GetAuthed(ctx)),
			slog.Int("kind", e.Kind),
			slog.String("id", e.ID[:12]+"…"),
		)
		return false, ""
	})

	// HTTP server with graceful shutdown — we want to drain in-flight
	// websockets when the supervisor sends SIGTERM.
	srv := &http.Server{
		Addr:              cfg.Relay.Addr,
		Handler:           relay,
		ReadHeaderTimeout: 10 * time.Second,
	}

	listenErr := make(chan error, 1)
	go func() {
		logger.Info("http listener up", slog.String("addr", cfg.Relay.Addr))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			listenErr <- err
		}
		close(listenErr)
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)

	select {
	case err := <-listenErr:
		if err != nil {
			logger.Error("listener died", slog.String("err", err.Error()))
			os.Exit(1)
		}
	case sig := <-stop:
		logger.Info("shutdown signal received", slog.String("signal", sig.String()))
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctx); err != nil {
			logger.Error("graceful shutdown failed", slog.String("err", err.Error()))
			os.Exit(1)
		}
		logger.Info("relay stopped cleanly")
	}
}
