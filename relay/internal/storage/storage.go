// Package storage wraps the canonical fiatjaf/eventstore/sqlite3 backend
// with our config + lifecycle, and wires it into khatru.
//
// Why wrap rather than use the backend directly:
//   - one place owns the on-disk path resolution + dir creation,
//   - tests can construct a Storage from a tmp dir without re-deriving
//     the file path convention,
//   - if we ever swap backends (lmdb, postgres) only this file changes.
//
// Last-write-wins semantics for the group-state kinds (39000-39003,
// 39100, 39101) come for free: those are NIP-33 addressable
// (parameterized replaceable, kind range 30000-39999), and khatru
// auto-routes them through ReplaceEvent which the eventstore lib
// implements as "query previous by (kind, author, d-tag), delete older,
// save new — skip if a newer one exists".
//
// Ephemeral kinds (20000-29999) — including 21000 (presence) — bypass
// storage entirely via khatru.handleEphemeral. We don't need to filter
// them out here.
package storage

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/fiatjaf/eventstore/sqlite3"
	"github.com/fiatjaf/khatru"
	"github.com/nbd-wtf/go-nostr"
)

// QueryFn is the shape of a khatru QueryEvents hook. Exported so wrappers
// in other packages (e.g. internal/search for NIP-50) can compose with the
// canonical backend query without depending on khatru directly.
type QueryFn = func(ctx context.Context, filter nostr.Filter) (chan *nostr.Event, error)

type Storage struct {
	backend *sqlite3.SQLite3Backend
	path    string
}

// Open initialises (or opens) the on-disk database. `dir` is a directory
// path; the SQLite file lives at <dir>/relay.db. We mkdir with 0o700
// because the file holds private group state (member lists, audit log).
func Open(dir string) (*Storage, error) {
	if dir == "" {
		return nil, fmt.Errorf("storage path must not be empty")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, fmt.Errorf("create storage dir %q: %w", dir, err)
	}
	dbFile := filepath.Join(dir, "relay.db")
	backend := &sqlite3.SQLite3Backend{DatabaseURL: dbFile}
	if err := backend.Init(); err != nil {
		return nil, fmt.Errorf("init sqlite at %s: %w", dbFile, err)
	}
	return &Storage{backend: backend, path: dbFile}, nil
}

// Wire registers the storage callbacks on the khatru relay. Hooks are
// independent slices so order doesn't matter relative to auth/membership/
// rate-limit hooks — those are RejectFilter/RejectEvent which run
// *before* StoreEvent ever fires.
//
// queryWrapper, if non-nil, lets callers compose the read path with
// extra logic (e.g. NIP-50 substring search). Pass nil for the bare
// backend behavior.
func (s *Storage) Wire(relay *khatru.Relay, queryWrapper func(QueryFn) QueryFn) {
	relay.StoreEvent = append(relay.StoreEvent, s.backend.SaveEvent)
	q := QueryFn(s.backend.QueryEvents)
	if queryWrapper != nil {
		q = queryWrapper(q)
	}
	relay.QueryEvents = append(relay.QueryEvents, q)
	relay.CountEvents = append(relay.CountEvents, s.backend.CountEvents)
	relay.DeleteEvent = append(relay.DeleteEvent, s.backend.DeleteEvent)
	relay.ReplaceEvent = append(relay.ReplaceEvent, s.backend.ReplaceEvent)
}

// Path returns the absolute path to the SQLite file. Useful for log lines
// during boot so the operator knows where their data lives.
func (s *Storage) Path() string { return s.path }

// Close flushes and releases the SQLite file lock. Safe to call from a
// SIGTERM handler.
func (s *Storage) Close() {
	if s.backend != nil {
		s.backend.Close()
	}
}

// Backend exposes the underlying eventstore for tests and future admin
// tooling (e.g. inspecting state without going through the websocket).
func (s *Storage) Backend() *sqlite3.SQLite3Backend { return s.backend }
