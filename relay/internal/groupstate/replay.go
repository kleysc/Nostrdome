package groupstate

import (
	"context"
	"fmt"
	"sort"

	"github.com/nbd-wtf/go-nostr"
)

// EventQuerier is the slice of the eventstore API ReplayFrom needs. The
// production backend (storage.Storage.Backend()) satisfies it; tests can
// pass an in-memory implementation without pulling in sqlite3.
type EventQuerier interface {
	QueryEvents(ctx context.Context, filter nostr.Filter) (chan *nostr.Event, error)
}

// stateKinds enumerates every kind that ReplayFrom must pull. Kept as a
// package-level slice so it stays in sync with the Apply switch.
var stateKinds = []int{
	KindMetadata,
	KindAdmins,
	KindMembers,
	KindRoles,
	KindChannel,
	KindCategory,
}

// ReplayFrom rebuilds the in-memory projection from the persistent store.
// Idempotent — running it twice yields the same final state because Apply
// short-circuits on stale created_at.
//
// Events are buffered and sorted by created_at ascending before Apply so
// the bootstrap-ownership rule (first 39000 wins) and the last-write-wins
// member rule both observe a deterministic ordering even when the store
// returns events out of order.
//
// If the store contains millions of state events this is O(n log n) at
// boot. For F1's expected scale (one community, dozens of state events
// over its lifetime) this is irrelevant; we'll revisit if a multi-tenant
// relay (F2 §2) ships.
func (s *State) ReplayFrom(ctx context.Context, q EventQuerier) error {
	ch, err := q.QueryEvents(ctx, nostr.Filter{Kinds: stateKinds})
	if err != nil {
		return fmt.Errorf("groupstate: query state events: %w", err)
	}
	var buf []*nostr.Event
	for evt := range ch {
		if evt != nil {
			buf = append(buf, evt)
		}
	}
	sort.SliceStable(buf, func(i, j int) bool {
		return buf[i].CreatedAt < buf[j].CreatedAt
	})
	for _, evt := range buf {
		if err := s.Apply(evt); err != nil {
			return fmt.Errorf("groupstate: apply kind %d id=%s: %w", evt.Kind, evt.ID, err)
		}
	}
	return nil
}
