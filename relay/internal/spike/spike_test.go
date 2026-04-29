package spike_test

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/fiatjaf/khatru"
	"github.com/nbd-wtf/go-nostr"

	"github.com/nostrdome-platform/relay/internal/spike"
)

// startSpikeRelay wires up khatru with the spike hooks and an in-memory store,
// returns the wss:// URL plus a cleanup func.
func startSpikeRelay(t *testing.T, ownerSK string, members []string) string {
	t.Helper()

	relay := khatru.NewRelay()
	relay.Info.Name = "nostrdome-spike-test"
	relay.Info.SupportedNIPs = []any{1, 11, 29, 42, 50}

	events := spike.NewMemEvents()
	relay.StoreEvent = append(relay.StoreEvent, events.Save)
	relay.QueryEvents = append(relay.QueryEvents, events.Query)
	relay.DeleteEvent = append(relay.DeleteEvent, events.Delete)

	state := spike.NewGroupState("spike-group")
	ownerPK, err := nostr.GetPublicKey(ownerSK)
	if err != nil {
		t.Fatalf("derive owner pubkey: %v", err)
	}
	state.SetOwner(ownerPK)
	state.AddMember(ownerPK, []string{"Staff"})
	for _, sk := range members {
		pk, err := nostr.GetPublicKey(sk)
		if err != nil {
			t.Fatalf("derive member pubkey: %v", err)
		}
		state.AddMember(pk, []string{"everyone"})
	}
	state.AddChannel("chat-general", []string{"everyone"}, []string{"everyone"})
	state.AddChannel("staff-only", []string{"Staff"}, []string{"Staff"})

	relay.OnConnect = append(relay.OnConnect, spike.IssueAuthOnConnect)
	relay.RejectFilter = append(relay.RejectFilter, spike.RequireAuth)
	relay.RejectEvent = append(relay.RejectEvent,
		spike.RequireAuth4Event,
		spike.RequireHTag,
		spike.RequireMembership(state),
		spike.RequireChannelWriteRole(state),
	)

	srv := httptest.NewServer(relay)
	t.Cleanup(srv.Close)

	return strings.Replace(srv.URL, "http://", "ws://", 1)
}

func authedRelay(t *testing.T, url, sk string) *nostr.Relay {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	r, err := nostr.RelayConnect(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })
	// The OnConnect hook emits AUTH asynchronously; give go-nostr a moment to
	// receive the challenge envelope before we sign. A real client would loop
	// on subscription failures; for a spike, a tiny sleep is fine.
	time.Sleep(100 * time.Millisecond)
	if err := r.Auth(ctx, func(e *nostr.Event) error { return e.Sign(sk) }); err != nil {
		t.Fatalf("auth: %v", err)
	}
	return r
}

func mustSignEvent(t *testing.T, sk string, kind int, content string, tags ...nostr.Tag) *nostr.Event {
	t.Helper()
	pk, err := nostr.GetPublicKey(sk)
	if err != nil {
		t.Fatalf("pubkey: %v", err)
	}
	e := &nostr.Event{
		PubKey:    pk,
		CreatedAt: nostr.Now(),
		Kind:      kind,
		Tags:      tags,
		Content:   content,
	}
	if err := e.Sign(sk); err != nil {
		t.Fatalf("sign: %v", err)
	}
	return e
}

// ── Tests ────────────────────────────────────────────────────────────────────

// Hello-world from §1.1.1: any non-AUTH event without `h` tag is rejected.
func TestRequireHTag_RejectsEventWithoutHTag(t *testing.T) {
	memberSK := nostr.GeneratePrivateKey()
	url := startSpikeRelay(t, nostr.GeneratePrivateKey(), []string{memberSK})
	r := authedRelay(t, url, memberSK)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	evt := mustSignEvent(t, memberSK, 1, "no h tag here")
	err := r.Publish(ctx, *evt)
	if err == nil {
		t.Fatal("expected publish to fail without h tag")
	}
	if !strings.Contains(err.Error(), "missing h tag") {
		t.Fatalf("expected 'missing h tag' rejection, got: %v", err)
	}
}

// §1.1.2: REQ before AUTH gets auth-required.
func TestRequireAuth_RejectsAnonymousRead(t *testing.T) {
	url := startSpikeRelay(t, nostr.GeneratePrivateKey(), nil)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	r, err := nostr.RelayConnect(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer r.Close()

	// No AUTH performed. Subscribe and expect closed/auth-required.
	sub, err := r.Subscribe(ctx, nostr.Filters{{Kinds: []int{39200}}})
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	select {
	case reason := <-sub.ClosedReason:
		if !strings.Contains(reason, "auth-required") {
			t.Fatalf("expected auth-required, got: %s", reason)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("expected ClosedReason within 2s; got nothing")
	}
}

// §1.1.2: a non-member who is AUTH'd cannot publish to the group.
func TestRequireMembership_RejectsNonMemberWrite(t *testing.T) {
	memberSK := nostr.GeneratePrivateKey()
	outsiderSK := nostr.GeneratePrivateKey()
	url := startSpikeRelay(t, nostr.GeneratePrivateKey(), []string{memberSK})

	r := authedRelay(t, url, outsiderSK)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	evt := mustSignEvent(t, outsiderSK, 39200, "outsider write",
		nostr.Tag{"h", "spike-group"},
		nostr.Tag{"e", "chat-general"},
	)
	err := r.Publish(ctx, *evt)
	if err == nil {
		t.Fatal("expected non-member publish to fail")
	}
	if !strings.Contains(err.Error(), "not a group member") {
		t.Fatalf("expected 'not a group member', got: %v", err)
	}
}

// §1.1.2: a member with role `everyone` cannot post to a channel whose
// write_roles is `[Staff]`.
func TestRequireChannelWriteRole_RejectsInsufficientRole(t *testing.T) {
	memberSK := nostr.GeneratePrivateKey()
	url := startSpikeRelay(t, nostr.GeneratePrivateKey(), []string{memberSK})

	r := authedRelay(t, url, memberSK)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	evt := mustSignEvent(t, memberSK, 39200, "tries to post in staff-only",
		nostr.Tag{"h", "spike-group"},
		nostr.Tag{"e", "staff-only"},
	)
	err := r.Publish(ctx, *evt)
	if err == nil {
		t.Fatal("expected non-staff publish to staff-only to fail")
	}
	if !strings.Contains(err.Error(), "insufficient role") {
		t.Fatalf("expected 'insufficient role', got: %v", err)
	}
}

// §1.1.2 happy path: a member posts to chat-general, AUTH'd member reads it.
func TestHappyPath_MemberPostsAndOtherMemberReads(t *testing.T) {
	aliceSK := nostr.GeneratePrivateKey()
	bobSK := nostr.GeneratePrivateKey()
	url := startSpikeRelay(t, nostr.GeneratePrivateKey(), []string{aliceSK, bobSK})

	// Alice publishes
	rA := authedRelay(t, url, aliceSK)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	evt := mustSignEvent(t, aliceSK, 39200, "hello from alice",
		nostr.Tag{"h", "spike-group"},
		nostr.Tag{"e", "chat-general"},
	)
	if err := rA.Publish(ctx, *evt); err != nil {
		t.Fatalf("alice publish: %v", err)
	}

	// Bob reads
	rB := authedRelay(t, url, bobSK)
	sub, err := rB.Subscribe(ctx, nostr.Filters{{Kinds: []int{39200}, Tags: nostr.TagMap{"h": []string{"spike-group"}}}})
	if err != nil {
		t.Fatalf("bob subscribe: %v", err)
	}

	select {
	case e := <-sub.Events:
		if e.Content != "hello from alice" {
			t.Fatalf("unexpected content: %q", e.Content)
		}
	case reason := <-sub.ClosedReason:
		t.Fatalf("subscription closed: %s", reason)
	case <-time.After(3 * time.Second):
		t.Fatal("bob did not receive the event in time")
	}
}
