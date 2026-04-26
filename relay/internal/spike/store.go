package spike

import (
	"context"
	"sync"

	"github.com/nbd-wtf/go-nostr"
)

// MemEvents is a 30-line in-memory event store sufficient for the spike's
// integration test. F1 §1.2 replaces this with a real backend (lmdb / sqlite).
type MemEvents struct {
	mu  sync.Mutex
	all []*nostr.Event
}

func NewMemEvents() *MemEvents { return &MemEvents{} }

func (m *MemEvents) Save(_ context.Context, e *nostr.Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.all = append(m.all, e)
	return nil
}

func (m *MemEvents) Query(_ context.Context, f nostr.Filter) (chan *nostr.Event, error) {
	m.mu.Lock()
	snapshot := make([]*nostr.Event, len(m.all))
	copy(snapshot, m.all)
	m.mu.Unlock()

	out := make(chan *nostr.Event, len(snapshot))
	for _, e := range snapshot {
		if f.Matches(e) {
			out <- e
		}
	}
	close(out)
	return out, nil
}

func (m *MemEvents) Delete(_ context.Context, e *nostr.Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i, x := range m.all {
		if x.ID == e.ID {
			m.all = append(m.all[:i], m.all[i+1:]...)
			break
		}
	}
	return nil
}
