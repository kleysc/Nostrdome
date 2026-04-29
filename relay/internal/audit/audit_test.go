package audit

import (
	"context"
	"testing"
	"time"

	"github.com/nbd-wtf/go-nostr"
)

const (
	pubAlice = "aaaa11111111111111111111111111111111111111111111111111111111aaaa"
	pubBob   = "bbbb22222222222222222222222222222222222222222222222222222222bbbb"
	groupID  = "demo-group"
)

// fakeQuerier matches each request against an in-memory event slice using
// the same fields the audit hooks rely on (Kinds, Authors, Tags, IDs,
// Since/Until). It's intentionally narrow — we don't need a full eventstore.
type fakeQuerier struct {
	events []*nostr.Event
}

func (f *fakeQuerier) QueryEvents(_ context.Context, filter nostr.Filter) (chan *nostr.Event, error) {
	out := make(chan *nostr.Event, len(f.events))
	for _, e := range f.events {
		if !filterMatches(filter, e) {
			continue
		}
		out <- e
	}
	close(out)
	return out, nil
}

func filterMatches(f nostr.Filter, e *nostr.Event) bool {
	if len(f.IDs) > 0 {
		ok := false
		for _, id := range f.IDs {
			if id == e.ID {
				ok = true
				break
			}
		}
		if !ok {
			return false
		}
	}
	if len(f.Kinds) > 0 {
		ok := false
		for _, k := range f.Kinds {
			if k == e.Kind {
				ok = true
				break
			}
		}
		if !ok {
			return false
		}
	}
	if len(f.Authors) > 0 {
		ok := false
		for _, a := range f.Authors {
			if a == e.PubKey {
				ok = true
				break
			}
		}
		if !ok {
			return false
		}
	}
	for k, vals := range f.Tags {
		ok := false
		for _, t := range e.Tags {
			if len(t) >= 2 && t[0] == k {
				for _, v := range vals {
					if t[1] == v {
						ok = true
						break
					}
				}
			}
			if ok {
				break
			}
		}
		if !ok {
			return false
		}
	}
	if f.Since != nil && e.CreatedAt < *f.Since {
		return false
	}
	if f.Until != nil && e.CreatedAt > *f.Until {
		return false
	}
	return true
}

func auditEvent(pubkey, group string, ts int64) *nostr.Event {
	return &nostr.Event{
		ID:        "audit-" + pubkey + "-" + groupSuffix(ts),
		PubKey:    pubkey,
		CreatedAt: nostr.Timestamp(ts),
		Kind:      AuditKind,
		Tags:      nostr.Tags{{"h", group}, {"action", "kick"}},
	}
}

func mutationEvent(kind int, pubkey, group string, ts int64) *nostr.Event {
	tags := nostr.Tags{{"d", group}}
	if kind == 39100 || kind == 39101 {
		tags = nostr.Tags{{"d", "ch-1"}, {"h", group}}
	}
	return &nostr.Event{
		ID:        "mut-" + pubkey + "-" + groupSuffix(ts),
		PubKey:    pubkey,
		CreatedAt: nostr.Timestamp(ts),
		Kind:      kind,
		Tags:      tags,
	}
}

func groupSuffix(ts int64) string {
	// Tiny helper to get unique-ish IDs in tests.
	return time.Unix(ts, 0).UTC().Format("20060102T150405")
}

func clockAt(ts int64) func() time.Time {
	return func() time.Time { return time.Unix(ts, 0) }
}

func TestRequireAuditPair_NonMutationKindPasses(t *testing.T) {
	q := &fakeQuerier{}
	hook := RequireAuditPair(q, clockAt(1700_000_000))
	evt := &nostr.Event{Kind: 39200, PubKey: pubAlice, Tags: nostr.Tags{{"h", groupID}}}
	if rejected, _ := hook(context.Background(), evt); rejected {
		t.Fatalf("non-mutation kind must pass")
	}
}

func TestRequireAuditPair_MissingAuditRejects(t *testing.T) {
	q := &fakeQuerier{}
	hook := RequireAuditPair(q, clockAt(1700_000_000))
	mut := mutationEvent(39002, pubAlice, groupID, 1700_000_000)
	rejected, msg := hook(context.Background(), mut)
	if !rejected {
		t.Fatalf("mutation without prior audit must be rejected")
	}
	if msg != ReasonAuditMissing {
		t.Fatalf("reason = %q, want %q", msg, ReasonAuditMissing)
	}
}

func TestRequireAuditPair_RecentAuditAllows(t *testing.T) {
	now := int64(1700_000_000)
	q := &fakeQuerier{events: []*nostr.Event{
		auditEvent(pubAlice, groupID, now-10), // 10s before mutation
	}}
	hook := RequireAuditPair(q, clockAt(now))
	mut := mutationEvent(39002, pubAlice, groupID, now)
	if rejected, msg := hook(context.Background(), mut); rejected {
		t.Fatalf("recent audit should permit mutation; got %q", msg)
	}
}

func TestRequireAuditPair_StaleAuditRejects(t *testing.T) {
	now := int64(1700_000_000)
	q := &fakeQuerier{events: []*nostr.Event{
		auditEvent(pubAlice, groupID, now-int64(2*RecentWindow.Seconds())),
	}}
	hook := RequireAuditPair(q, clockAt(now))
	mut := mutationEvent(39002, pubAlice, groupID, now)
	if rejected, _ := hook(context.Background(), mut); !rejected {
		t.Fatalf("audit older than RecentWindow must NOT cover mutation")
	}
}

func TestRequireAuditPair_DifferentPubkeyRejects(t *testing.T) {
	now := int64(1700_000_000)
	q := &fakeQuerier{events: []*nostr.Event{
		auditEvent(pubBob, groupID, now-5), // bob's audit
	}}
	hook := RequireAuditPair(q, clockAt(now))
	mut := mutationEvent(39002, pubAlice, groupID, now) // alice's mutation
	if rejected, _ := hook(context.Background(), mut); !rejected {
		t.Fatalf("audit from different pubkey must not cover mutation")
	}
}

func TestRequireAuditPair_DifferentGroupRejects(t *testing.T) {
	now := int64(1700_000_000)
	q := &fakeQuerier{events: []*nostr.Event{
		auditEvent(pubAlice, "other-group", now-5),
	}}
	hook := RequireAuditPair(q, clockAt(now))
	mut := mutationEvent(39002, pubAlice, groupID, now)
	if rejected, _ := hook(context.Background(), mut); !rejected {
		t.Fatalf("audit for a different group must not cover mutation")
	}
}

func TestRequireAuditPair_ChannelKindUsesHTagAsGroup(t *testing.T) {
	// kind 39100 uses `h=<group>` (not `d=<group>`). The hook must look up
	// the audit by the group from `h`, not by the channel id from `d`.
	now := int64(1700_000_000)
	q := &fakeQuerier{events: []*nostr.Event{
		auditEvent(pubAlice, groupID, now-5),
	}}
	hook := RequireAuditPair(q, clockAt(now))
	mut := mutationEvent(39100, pubAlice, groupID, now)
	if rejected, msg := hook(context.Background(), mut); rejected {
		t.Fatalf("39100 with audit on h-tag group should pass; got %q", msg)
	}
}

func TestRejectAuditDeletes_KTagHint(t *testing.T) {
	q := &fakeQuerier{}
	hook := RejectAuditDeletes(q)
	del := &nostr.Event{
		Kind:   5,
		PubKey: pubAlice,
		Tags:   nostr.Tags{{"e", "abc"}, {"k", "39250"}},
	}
	if rejected, msg := hook(context.Background(), del); !rejected || msg != ReasonAuditUndelet {
		t.Fatalf("k=39250 delete must be rejected, got rejected=%v msg=%q", rejected, msg)
	}
}

func TestRejectAuditDeletes_ResolvedFromETag(t *testing.T) {
	auditID := "audit-deadbeef"
	q := &fakeQuerier{events: []*nostr.Event{
		{ID: auditID, Kind: AuditKind, PubKey: pubAlice},
	}}
	hook := RejectAuditDeletes(q)
	del := &nostr.Event{
		Kind:   5,
		PubKey: pubAlice,
		Tags:   nostr.Tags{{"e", auditID}}, // no k hint
	}
	if rejected, _ := hook(context.Background(), del); !rejected {
		t.Fatalf("delete referencing a stored 39250 must be rejected")
	}
}

func TestRejectAuditDeletes_NonAuditDeletePasses(t *testing.T) {
	q := &fakeQuerier{events: []*nostr.Event{
		{ID: "msg-1", Kind: 39200, PubKey: pubAlice},
	}}
	hook := RejectAuditDeletes(q)
	del := &nostr.Event{
		Kind:   5,
		PubKey: pubAlice,
		Tags:   nostr.Tags{{"e", "msg-1"}},
	}
	if rejected, _ := hook(context.Background(), del); rejected {
		t.Fatalf("delete of a chat message must not be rejected by audit hook")
	}
}

func TestRejectAuditDeletes_NonDeletePasses(t *testing.T) {
	q := &fakeQuerier{}
	hook := RejectAuditDeletes(q)
	if rejected, _ := hook(context.Background(), &nostr.Event{Kind: 39200}); rejected {
		t.Fatalf("non-delete events must always pass")
	}
}
