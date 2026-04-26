// Command nostrdome-relay is the productive Nostrdome relay binary.
//
// It loads a TOML config, builds a structured logger, instantiates a khatru
// relay, and registers the productive hooks in the order required by the
// platform spec:
//
//  1. NIP-42 AUTH (this commit, via internal/auth)
//  2. NIP-29 group membership (§1.2.4 — pending)
//  3. Per-channel ACL          (§1.2.5 — pending)
//  4. Rate limiting            (§1.2.6 — pending)
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

	"github.com/nostrdome-platform/relay/internal/auth"
	"github.com/nostrdome-platform/relay/internal/config"
	"github.com/nostrdome-platform/relay/internal/logging"
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

	relay := khatru.NewRelay()
	relay.Info.Name = cfg.Relay.Name
	relay.Info.Description = cfg.Relay.Description
	relay.Info.PubKey = cfg.Relay.Pubkey
	relay.Info.Contact = cfg.Relay.ContactEmail
	relay.Info.Software = cfg.Relay.SoftwareURL
	relay.Info.Version = cfg.Relay.Version
	// NIPs we plan to support; storage hooks land in §1.2.3, NIP-50 in §1.2.7.
	relay.Info.SupportedNIPs = []any{1, 11, 29, 42}

	// ── Hook ordering: AUTH first, then everything else. ──────────────────
	// IssueOnConnect pushes the NIP-42 challenge proactively so well-behaved
	// clients can call r.Auth() without a fail-then-retry round trip.
	relay.OnConnect = append(relay.OnConnect, auth.IssueOnConnect)
	relay.RejectFilter = append(relay.RejectFilter, auth.RejectUnauthedFilter)
	relay.RejectEvent = append(relay.RejectEvent, auth.RejectUnauthedEvent)
	// TODO §1.2.3: storage hooks (StoreEvent, QueryEvents, DeleteEvent).
	// TODO §1.2.4: membership hook in RejectEvent (after auth).
	// TODO §1.2.5: per-channel ACL hook in RejectEvent (after membership).
	// TODO §1.2.6: rate-limit hook in RejectEvent (after ACL).

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
