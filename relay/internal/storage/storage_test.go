package storage

import (
	"context"
	"path/filepath"
	"testing"

	"github.com/nbd-wtf/go-nostr"
)

// helper: deterministic keypair so test events have stable signatures.
const testPriv = "0000000000000000000000000000000000000000000000000000000000000001"

func mustSign(t *testing.T, evt *nostr.Event) {
	t.Helper()
	if err := evt.Sign(testPriv); err != nil {
		t.Fatalf("sign event: %v", err)
	}
}

// drain pulls all events from a QueryEvents channel into a slice. Bounded
// loops only — tests never push more than a handful of events.
func drain(ctx context.Context, t *testing.T, ch <-chan *nostr.Event) []*nostr.Event {
	t.Helper()
	var out []*nostr.Event
	for evt := range ch {
		out = append(out, evt)
	}
	return out
}

func newStorage(t *testing.T) *Storage {
	t.Helper()
	dir := filepath.Join(t.TempDir(), "data")
	s, err := Open(dir)
	if err != nil {
		t.Fatalf("open storage: %v", err)
	}
	t.Cleanup(s.Close)
	return s
}

// Non-replaceable kinds (39200 chat) accumulate — every Save inserts a row.
func TestSaveAndQuery_NonReplaceable(t *testing.T) {
	s := newStorage(t)
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		evt := &nostr.Event{
			Kind:      39200,
			CreatedAt: nostr.Timestamp(1700000000 + i),
			Tags:      nostr.Tags{{"h", "g1"}, {"e", "ch1"}},
			Content:   "hi",
		}
		mustSign(t, evt)
		if err := s.Backend().SaveEvent(ctx, evt); err != nil {
			t.Fatalf("save kind 39200 #%d: %v", i, err)
		}
	}

	ch, err := s.Backend().QueryEvents(ctx, nostr.Filter{
		Kinds: []int{39200},
		Tags:  nostr.TagMap{"h": []string{"g1"}},
	})
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	got := drain(ctx, t, ch)
	if len(got) != 3 {
		t.Fatalf("expected 3 chat events, got %d", len(got))
	}
}

// Addressable kinds (39000 group_metadata) get LWW: only the latest
// (kind, author, d-tag) tuple survives. Tests:
//   - newer publish replaces older
//   - older publish is ignored when a newer one exists
func TestReplaceEvent_LastWriteWins(t *testing.T) {
	s := newStorage(t)
	ctx := context.Background()

	build := func(content string, ts int64) *nostr.Event {
		evt := &nostr.Event{
			Kind:      39000,
			CreatedAt: nostr.Timestamp(ts),
			Tags:      nostr.Tags{{"d", "g-lww"}},
			Content:   content,
		}
		mustSign(t, evt)
		return evt
	}

	v1 := build(`{"name":"v1"}`, 1700000000)
	v2 := build(`{"name":"v2"}`, 1700000100) // newer
	vOld := build(`{"name":"vOLD"}`, 1699999000) // older than both

	if err := s.Backend().ReplaceEvent(ctx, v1); err != nil {
		t.Fatalf("replace v1: %v", err)
	}
	if err := s.Backend().ReplaceEvent(ctx, v2); err != nil {
		t.Fatalf("replace v2: %v", err)
	}
	if err := s.Backend().ReplaceEvent(ctx, vOld); err != nil {
		t.Fatalf("replace vOld: %v", err)
	}

	ch, err := s.Backend().QueryEvents(ctx, nostr.Filter{
		Kinds: []int{39000},
		Tags:  nostr.TagMap{"d": []string{"g-lww"}},
	})
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	got := drain(ctx, t, ch)

	if len(got) != 1 {
		t.Fatalf("expected 1 surviving 39000 row, got %d", len(got))
	}
	if got[0].Content != `{"name":"v2"}` {
		t.Fatalf("expected v2 content to survive, got %q", got[0].Content)
	}
}

// Different d-tags within the same kind/author are independent rows. Two
// channels (39100) under the same group must coexist after ReplaceEvent.
func TestReplaceEvent_DifferentDTagsCoexist(t *testing.T) {
	s := newStorage(t)
	ctx := context.Background()

	for _, d := range []string{"general", "random"} {
		evt := &nostr.Event{
			Kind:      39100,
			CreatedAt: nostr.Timestamp(1700000000),
			Tags:      nostr.Tags{{"d", d}, {"h", "g2"}},
			Content:   `{"name":"` + d + `"}`,
		}
		mustSign(t, evt)
		if err := s.Backend().ReplaceEvent(ctx, evt); err != nil {
			t.Fatalf("replace %s: %v", d, err)
		}
	}

	ch, err := s.Backend().QueryEvents(ctx, nostr.Filter{
		Kinds: []int{39100},
		Tags:  nostr.TagMap{"h": []string{"g2"}},
	})
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	got := drain(ctx, t, ch)
	if len(got) != 2 {
		t.Fatalf("expected 2 channels, got %d", len(got))
	}
}

// Persistence across reopens: write, close, reopen the same dir, verify
// the row is still there. Catches regressions where the DB file path
// resolution drifts between Open() invocations.
func TestPersistenceAcrossReopen(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "data")
	ctx := context.Background()

	s1, err := Open(dir)
	if err != nil {
		t.Fatalf("open1: %v", err)
	}
	evt := &nostr.Event{
		Kind:      39000,
		CreatedAt: nostr.Timestamp(1700000000),
		Tags:      nostr.Tags{{"d", "persist"}},
		Content:   `{"name":"persisted"}`,
	}
	mustSign(t, evt)
	if err := s1.Backend().ReplaceEvent(ctx, evt); err != nil {
		t.Fatalf("save: %v", err)
	}
	s1.Close()

	s2, err := Open(dir)
	if err != nil {
		t.Fatalf("open2: %v", err)
	}
	defer s2.Close()

	ch, err := s2.Backend().QueryEvents(ctx, nostr.Filter{
		Kinds: []int{39000},
		Tags:  nostr.TagMap{"d": []string{"persist"}},
	})
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	got := drain(ctx, t, ch)
	if len(got) != 1 || got[0].Content != `{"name":"persisted"}` {
		t.Fatalf("expected persisted row, got %+v", got)
	}
}

func TestOpen_RejectsEmptyPath(t *testing.T) {
	if _, err := Open(""); err == nil {
		t.Fatal("expected error for empty path, got nil")
	}
}
