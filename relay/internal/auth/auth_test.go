package auth_test

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/fiatjaf/khatru"
	"github.com/nbd-wtf/go-nostr"

	"github.com/nostrdome-platform/relay/internal/auth"
)

// startAuthRelay wires only the auth hooks plus an in-memory backend that
// always accepts. This is the smallest relay that exercises auth.* end to
// end via go-nostr, mirroring the pattern validated by the §1.1.2 spike.
func startAuthRelay(t *testing.T) string {
	t.Helper()
	relay := khatru.NewRelay()
	relay.Info.Name = "auth-test"
	relay.Info.SupportedNIPs = []any{1, 11, 42}

	store := newMemStore()
	relay.StoreEvent = append(relay.StoreEvent, store.save)
	relay.QueryEvents = append(relay.QueryEvents, store.query)

	relay.OnConnect = append(relay.OnConnect, auth.IssueOnConnect)
	relay.RejectFilter = append(relay.RejectFilter, auth.RejectUnauthedFilter)
	relay.RejectEvent = append(relay.RejectEvent, auth.RejectUnauthedEvent)

	srv := httptest.NewServer(relay)
	t.Cleanup(srv.Close)
	return strings.Replace(srv.URL, "http://", "ws://", 1)
}

// authedClient connects and completes NIP-42 AUTH using sk. The 100ms sleep
// between connect and r.Auth() is the same workaround the spike uses: the
// challenge envelope arrives async and go-nostr does not block on it.
func authedClient(t *testing.T, url, sk string) *nostr.Relay {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	r, err := nostr.RelayConnect(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { _ = r.Close() })
	time.Sleep(100 * time.Millisecond)
	if err := r.Auth(ctx, func(e *nostr.Event) error { return e.Sign(sk) }); err != nil {
		t.Fatalf("auth: %v", err)
	}
	return r
}

func mustSign(t *testing.T, sk string, kind int, content string, tags ...nostr.Tag) *nostr.Event {
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

// REQ pre-AUTH closes with auth-required.
func TestRejectFilter_RejectsUnauthenticatedRead(t *testing.T) {
	url := startAuthRelay(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	r, err := nostr.RelayConnect(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer r.Close()

	sub, err := r.Subscribe(ctx, nostr.Filters{{Kinds: []int{1}}})
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	select {
	case reason := <-sub.ClosedReason:
		if !strings.HasPrefix(reason, "auth-required:") {
			t.Fatalf("expected auth-required prefix, got %q", reason)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("expected ClosedReason within 2s")
	}
}

// EVENT pre-AUTH is rejected with auth-required.
func TestRejectEvent_RejectsUnauthenticatedPublish(t *testing.T) {
	url := startAuthRelay(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	r, err := nostr.RelayConnect(ctx, url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer r.Close()

	sk := nostr.GeneratePrivateKey()
	evt := mustSign(t, sk, 1, "hello before auth")
	err = r.Publish(ctx, *evt)
	if err == nil {
		t.Fatal("expected publish to fail before AUTH")
	}
	if !strings.Contains(err.Error(), "auth-required:") {
		t.Fatalf("expected auth-required prefix, got: %v", err)
	}
}

// REQ post-AUTH succeeds (subscription stays open, no ClosedReason).
func TestRejectFilter_AllowsAuthenticatedRead(t *testing.T) {
	url := startAuthRelay(t)
	r := authedClient(t, url, nostr.GeneratePrivateKey())

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	sub, err := r.Subscribe(ctx, nostr.Filters{{Kinds: []int{1}}})
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	// We expect EOSE rather than a close. ClosedReason should NOT fire.
	select {
	case <-sub.EndOfStoredEvents:
		// happy path: relay finished the historical scan and the sub stays open.
	case reason := <-sub.ClosedReason:
		t.Fatalf("subscription unexpectedly closed: %q", reason)
	case <-time.After(2 * time.Second):
		t.Fatal("expected EOSE within 2s")
	}
}

// EVENT post-AUTH succeeds.
func TestRejectEvent_AllowsAuthenticatedPublish(t *testing.T) {
	url := startAuthRelay(t)
	sk := nostr.GeneratePrivateKey()
	r := authedClient(t, url, sk)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	evt := mustSign(t, sk, 1, "hello after auth")
	if err := r.Publish(ctx, *evt); err != nil {
		t.Fatalf("publish after AUTH should succeed: %v", err)
	}
}

// The kind-22242 (NIP-42 AUTH) event itself must be allowed pre-auth — it
// IS the auth handshake. We verify by exercising r.Auth(): if our hook
// rejected AUTH events, r.Auth() would fail.
func TestRejectEvent_AllowsAuthHandshakeKind22242(t *testing.T) {
	url := startAuthRelay(t)
	// authedClient calls r.Auth() and t.Fatalf's if AUTH is rejected; reaching
	// the end means the kind 22242 publish was permitted.
	_ = authedClient(t, url, nostr.GeneratePrivateKey())
}
