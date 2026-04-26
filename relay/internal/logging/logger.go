// Package logging wraps log/slog to give the rest of the relay a small,
// purpose-built API for structured logs.
//
// The wrapper does two things the stdlib doesn't on its own:
//   - Picks json vs text handler from config (so dev prints human-readable
//     lines, prod ships json to a collector).
//   - Provides domain helpers — WithEvent, WithConn — that attach the
//     structured fields every relay log line cares about. Hooks call these
//     instead of remembering the field names.
package logging

import (
	"io"
	"log/slog"
	"os"
	"strings"
)

// Options selects format and level. Format is "json" or "text"; anything
// else falls back to json. Level matches slog's text levels (debug, info,
// warn, error); unknown values default to info.
type Options struct {
	Level  string
	Format string
	Output io.Writer // optional; defaults to os.Stderr.
}

// New builds an *slog.Logger configured per opts. Callers store the result
// once and pass it down — slog loggers are concurrency-safe and cheap to
// derive from.
func New(opts Options) *slog.Logger {
	w := opts.Output
	if w == nil {
		w = os.Stderr
	}
	handlerOpts := &slog.HandlerOptions{Level: parseLevel(opts.Level)}

	var h slog.Handler
	switch strings.ToLower(opts.Format) {
	case "text":
		h = slog.NewTextHandler(w, handlerOpts)
	default: // json is the production default.
		h = slog.NewJSONHandler(w, handlerOpts)
	}
	return slog.New(h)
}

// parseLevel maps the human-readable level strings the operator writes in
// TOML to slog.Level values. Unknown strings degrade to Info rather than
// erroring — operators shouldn't lose all logging because of a typo.
func parseLevel(s string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "debug":
		return slog.LevelDebug
	case "warn", "warning":
		return slog.LevelWarn
	case "error", "err":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

// WithEvent returns a logger that already carries the standard event-level
// fields. Use this in any hook that handles a *nostr.Event so the operator
// can grep by event id, kind, or signer pubkey without each call site
// remembering the conventions.
func WithEvent(l *slog.Logger, eventID string, kind int, pubkey string) *slog.Logger {
	return l.With(
		slog.String("event_id", eventID),
		slog.Int("kind", kind),
		slog.String("pubkey", pubkey),
	)
}

// WithConn attaches per-connection metadata. connID identifies the
// websocket; ip is the remote IP (best-effort, may be a proxy).
func WithConn(l *slog.Logger, connID, ip string) *slog.Logger {
	return l.With(
		slog.String("conn_id", connID),
		slog.String("ip", ip),
	)
}
