package search

import (
	"context"
	"testing"

	"github.com/nbd-wtf/go-nostr"
)

// fakeBackend is a recordable inner QueryFn. It captures the last filter
// it received and returns a fixed slice of events on the channel.
type fakeBackend struct {
	lastFilter nostr.Filter
	events     []*nostr.Event
	err        error
}

func (f *fakeBackend) Query(ctx context.Context, filter nostr.Filter) (chan *nostr.Event, error) {
	f.lastFilter = filter
	if f.err != nil {
		return nil, f.err
	}
	ch := make(chan *nostr.Event, len(f.events))
	for _, e := range f.events {
		ch <- e
	}
	close(ch)
	return ch, nil
}

func chatMsg(content string) *nostr.Event {
	return &nostr.Event{Kind: 39200, Content: content}
}

func drain(ch chan *nostr.Event) []*nostr.Event {
	var out []*nostr.Event
	for e := range ch {
		out = append(out, e)
	}
	return out
}

func TestWithSearch_NoSearchPassesThrough(t *testing.T) {
	fb := &fakeBackend{events: []*nostr.Event{chatMsg("hola"), chatMsg("chau")}}
	wrapped := WithSearch(fb.Query)
	ch, err := wrapped(context.Background(), nostr.Filter{Kinds: []int{39200}})
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	got := drain(ch)
	if len(got) != 2 {
		t.Fatalf("expected 2 events forwarded, got %d", len(got))
	}
	// Filter must be unchanged when Search is empty.
	if fb.lastFilter.Search != "" {
		t.Fatalf("inner filter Search must remain empty, got %q", fb.lastFilter.Search)
	}
}

func TestWithSearch_NarrowsToKind39200AndClearsSearch(t *testing.T) {
	fb := &fakeBackend{events: []*nostr.Event{chatMsg("bitcoin rocks")}}
	wrapped := WithSearch(fb.Query)
	_, err := wrapped(context.Background(), nostr.Filter{
		Kinds:  []int{1, 39200, 39201}, // mixed; should be narrowed
		Search: "bitcoin",
	})
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if got := fb.lastFilter.Kinds; len(got) != 1 || got[0] != 39200 {
		t.Fatalf("kinds narrowed wrong: %v", got)
	}
	if fb.lastFilter.Search != "" {
		t.Fatalf("inner Search must be cleared, got %q", fb.lastFilter.Search)
	}
}

func TestWithSearch_SubstringFiltersResults(t *testing.T) {
	fb := &fakeBackend{events: []*nostr.Event{
		chatMsg("Bitcoin is sound money"),
		chatMsg("ethereum is meh"),
		chatMsg("BITCOIN to the moon"),
	}}
	wrapped := WithSearch(fb.Query)
	ch, err := wrapped(context.Background(), nostr.Filter{Search: "bitcoin"})
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	got := drain(ch)
	if len(got) != 2 {
		t.Fatalf("expected 2 matches, got %d", len(got))
	}
	for _, e := range got {
		if !contains(e.Content, "Bitcoin") && !contains(e.Content, "BITCOIN") {
			t.Fatalf("unexpected match: %q", e.Content)
		}
	}
}

func TestWithSearch_AllTokensRequired(t *testing.T) {
	fb := &fakeBackend{events: []*nostr.Event{
		chatMsg("bitcoin lightning rocks"),
		chatMsg("just bitcoin"),
		chatMsg("just lightning"),
	}}
	wrapped := WithSearch(fb.Query)
	ch, err := wrapped(context.Background(), nostr.Filter{Search: "bitcoin lightning"})
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	got := drain(ch)
	if len(got) != 1 {
		t.Fatalf("expected only the event with both tokens; got %d", len(got))
	}
	if got[0].Content != "bitcoin lightning rocks" {
		t.Fatalf("wrong match: %q", got[0].Content)
	}
}

func TestWithSearch_CaseInsensitive(t *testing.T) {
	fb := &fakeBackend{events: []*nostr.Event{chatMsg("HODL is the way")}}
	wrapped := WithSearch(fb.Query)
	ch, err := wrapped(context.Background(), nostr.Filter{Search: "hodl"})
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if len(drain(ch)) != 1 {
		t.Fatalf("expected case-insensitive match")
	}
}

func TestWithSearch_PropagatesInnerError(t *testing.T) {
	fb := &fakeBackend{err: errBoom{}}
	wrapped := WithSearch(fb.Query)
	if _, err := wrapped(context.Background(), nostr.Filter{Search: "x"}); err == nil {
		t.Fatalf("expected error to propagate")
	}
}

type errBoom struct{}

func (errBoom) Error() string { return "boom" }

func contains(haystack, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
