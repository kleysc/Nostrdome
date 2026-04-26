package auth_test

import (
	"context"
	"sync"

	"github.com/nbd-wtf/go-nostr"
)

// memStore is the smallest event sink khatru needs to accept publishes and
// answer REQs. Mirrors spike.MemEvents, but inlined here so the auth
// package has zero dependency on spike code.
type memStore struct {
	mu  sync.Mutex
	all []*nostr.Event
}

func newMemStore() *memStore { return &memStore{} }

func (m *memStore) save(_ context.Context, e *nostr.Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.all = append(m.all, e)
	return nil
}

func (m *memStore) query(_ context.Context, f nostr.Filter) (chan *nostr.Event, error) {
	m.mu.Lock()
	snap := make([]*nostr.Event, len(m.all))
	copy(snap, m.all)
	m.mu.Unlock()
	out := make(chan *nostr.Event, len(snap)+1)
	for _, e := range snap {
		if f.Matches(e) {
			out <- e
		}
	}
	close(out)
	return out, nil
}
