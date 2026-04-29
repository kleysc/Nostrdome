package groupstate

import (
	"context"
	"testing"

	"github.com/nbd-wtf/go-nostr"
)

func chatEvent(group, signer string) *nostr.Event {
	return &nostr.Event{
		PubKey:    signer,
		CreatedAt: nostr.Timestamp(1000),
		Kind:      39200,
		Tags:      nostr.Tags{{"h", group}, {"e", "chan-1"}},
		Content:   "hi",
	}
}

func TestRequireMembership_AuthEventPasses(t *testing.T) {
	s := New()
	hook := RequireMembership(s)
	evt := &nostr.Event{Kind: nostr.KindClientAuthentication, PubKey: pubAlice}
	rejected, _ := hook(context.Background(), evt)
	if rejected {
		t.Fatalf("AUTH event must always pass")
	}
}

func TestRequireMembership_NoHTagPasses(t *testing.T) {
	s := New()
	hook := RequireMembership(s)
	// Kind 39000 has no h tag (only d). Must defer to the §1.2.5 hook.
	evt := metadataEvent(t, pubOwner, 100)
	rejected, _ := hook(context.Background(), evt)
	if rejected {
		t.Fatalf("event without h tag must pass membership hook")
	}
}

func TestRequireMembership_UnknownGroupRejected(t *testing.T) {
	s := New()
	hook := RequireMembership(s)
	evt := chatEvent("ghost-group", pubAlice)
	rejected, msg := hook(context.Background(), evt)
	if !rejected {
		t.Fatalf("event for unknown group must be rejected")
	}
	if msg != ReasonUnknownGroup {
		t.Fatalf("reason = %q, want %q", msg, ReasonUnknownGroup)
	}
}

func TestRequireMembership_NonMemberRejected(t *testing.T) {
	s := New()
	_ = s.Apply(metadataEvent(t, pubOwner, 100))
	_ = s.Apply(membersEvent(t, pubOwner, 110, pubAlice))
	hook := RequireMembership(s)
	evt := chatEvent(testGroup, pubBob)
	rejected, msg := hook(context.Background(), evt)
	if !rejected {
		t.Fatalf("non-member must be rejected")
	}
	if msg != ReasonNotMember {
		t.Fatalf("reason = %q, want %q", msg, ReasonNotMember)
	}
}

func TestRequireMembership_MemberPasses(t *testing.T) {
	s := New()
	_ = s.Apply(metadataEvent(t, pubOwner, 100))
	_ = s.Apply(membersEvent(t, pubOwner, 110, pubAlice))
	hook := RequireMembership(s)
	evt := chatEvent(testGroup, pubAlice)
	rejected, msg := hook(context.Background(), evt)
	if rejected {
		t.Fatalf("member should pass; got reject %q", msg)
	}
}

func TestRequireMembership_MembershipChangesAreReflected(t *testing.T) {
	// Smoke test: a member becomes ex-member after a new 39002 lands.
	s := New()
	_ = s.Apply(metadataEvent(t, pubOwner, 100))
	_ = s.Apply(membersEvent(t, pubOwner, 110, pubAlice, pubBob))
	hook := RequireMembership(s)
	if rejected, _ := hook(context.Background(), chatEvent(testGroup, pubBob)); rejected {
		t.Fatalf("bob should be a member at v1")
	}
	_ = s.Apply(membersEvent(t, pubOwner, 200, pubAlice)) // bob removed
	if rejected, _ := hook(context.Background(), chatEvent(testGroup, pubBob)); !rejected {
		t.Fatalf("bob should be rejected after v2 removes him")
	}
}

func TestAfterStoreApply_FeedsState(t *testing.T) {
	s := New()
	store := AfterStoreApply(s)
	if err := store(context.Background(), metadataEvent(t, pubOwner, 100)); err != nil {
		t.Fatalf("store metadata: %v", err)
	}
	if err := store(context.Background(), membersEvent(t, pubOwner, 110, pubAlice)); err != nil {
		t.Fatalf("store members: %v", err)
	}
	if !s.IsMember(testGroup, pubAlice) {
		t.Fatalf("AfterStoreApply did not feed Apply correctly")
	}
}

func TestAfterStoreApply_NeverErrors(t *testing.T) {
	// Even malformed payloads must not propagate errors out of the store
	// hook — they'd roll back the publish ack on khatru's slice.
	s := New()
	store := AfterStoreApply(s)
	bad := membersEvent(t, pubOwner, 200, pubAlice)
	bad.Content = "{not valid"
	if err := store(context.Background(), bad); err != nil {
		t.Fatalf("AfterStoreApply must swallow Apply errors, got %v", err)
	}
}
