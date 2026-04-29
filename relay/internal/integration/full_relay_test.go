// Package integration_test wires the productive stack (AUTH → membership
// → ACL → rate-limit → audit + memstore) against an httptest websocket
// and exercises §1.2.9 adversarial scenarios end-to-end. Each scenario
// gets a fresh relay so a state mutation in one test cannot leak into
// another.
package integration_test

import (
	"context"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/fiatjaf/khatru"
	"github.com/nbd-wtf/go-nostr"

	"github.com/nostrdome-platform/relay/internal/audit"
	"github.com/nostrdome-platform/relay/internal/auth"
	"github.com/nostrdome-platform/relay/internal/groupstate"
	"github.com/nostrdome-platform/relay/internal/ratelimit"
	"github.com/nostrdome-platform/relay/internal/search"
)

// memStore is the smallest event sink khatru needs. Replicated here so
// the integration tests have zero dep on the auth package's private store.
// Implements ReplaceEvent for addressable kinds (30000-39999) by deleting
// older (kind, author, d-tag) rows so groupstate's LWW projection lines up
// with what the SQLite-backed productive backend would persist.
type memStore struct {
	mu  sync.Mutex
	all []*nostr.Event
}

func (m *memStore) save(_ context.Context, e *nostr.Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.all = append(m.all, e)
	return nil
}

func (m *memStore) replace(_ context.Context, e *nostr.Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	d := tag(e, "d")
	out := m.all[:0]
	for _, ev := range m.all {
		if ev.Kind == e.Kind && ev.PubKey == e.PubKey && tag(ev, "d") == d {
			continue // drop older
		}
		out = append(out, ev)
	}
	m.all = append(out, e)
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

func tag(e *nostr.Event, name string) string {
	for _, t := range e.Tags {
		if len(t) >= 2 && t[0] == name {
			return t[1]
		}
	}
	return ""
}

// fakeQuerier satisfies groupstate.EventQuerier from a memStore. We use it
// only at boot — once the relay is running, the StoreEvent callback feeds
// the projection live.
type fakeQuerier struct{ s *memStore }

func (q *fakeQuerier) QueryEvents(ctx context.Context, f nostr.Filter) (chan *nostr.Event, error) {
	return q.s.query(ctx, f)
}

// fullRelay wraps a running httptest server backed by the productive hook
// chain. Tests close it via t.Cleanup automatically.
type fullRelay struct {
	url    string
	store  *memStore
	state  *groupstate.State
}

// startFullRelay builds the same hook chain main.go assembles. The order
// must match production exactly so adversarial scenarios exercise real
// gates, not a test-only shortcut.
func startFullRelay(t *testing.T) *fullRelay {
	t.Helper()
	relay := khatru.NewRelay()
	relay.Info.Name = "integration"
	relay.Info.SupportedNIPs = []any{1, 11, 29, 42, 50}

	store := &memStore{}
	state := groupstate.New()

	// Storage callbacks. We wrap query with NIP-50 search just like
	// production. ReplaceEvent handles addressable kinds (NIP-29 state).
	relay.StoreEvent = append(relay.StoreEvent, store.save)
	relay.QueryEvents = append(relay.QueryEvents, search.WithSearch(store.query))
	relay.ReplaceEvent = append(relay.ReplaceEvent, store.replace)

	// Reject chain: AUTH → membership → ACL → ratelimit → audit. Audit
	// reads from the same memStore that just persisted the audit event.
	relay.OnConnect = append(relay.OnConnect, auth.IssueOnConnect)
	relay.RejectFilter = append(relay.RejectFilter, auth.RejectUnauthedFilter)
	relay.RejectEvent = append(relay.RejectEvent, auth.RejectUnauthedEvent)
	relay.RejectEvent = append(relay.RejectEvent, groupstate.RequireMembership(state))
	relay.RejectEvent = append(relay.RejectEvent, groupstate.RequireChannelWritePermission(state))
	limiter := ratelimit.New(ratelimit.Config{PerMinute: 1000, PerHour: 10000}, state)
	relay.RejectEvent = append(relay.RejectEvent, limiter.Reject())
	relay.RejectEvent = append(relay.RejectEvent, audit.RequireAuditPair(&fakeQuerier{store}, nil))
	relay.RejectEvent = append(relay.RejectEvent, audit.RejectAuditDeletes(&fakeQuerier{store}))

	// Keep the projection fresh on every accepted save (replaceable kinds
	// included — see groupstate.OnSaved comment).
	relay.OnEventSaved = append(relay.OnEventSaved, groupstate.OnSaved(state))

	srv := httptest.NewServer(relay)
	t.Cleanup(srv.Close)
	return &fullRelay{
		url:   strings.Replace(srv.URL, "http://", "ws://", 1),
		store: store,
		state: state,
	}
}

// authedClient does the NIP-42 handshake using sk. The 100ms warmup is the
// same workaround the spike validated: the challenge envelope arrives async.
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

// publish is mustSign + r.Publish, fataling on error. For tests where we
// expect rejection use rawPublish.
func publish(t *testing.T, r *nostr.Relay, sk string, kind int, content string, tags ...nostr.Tag) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	evt := mustSign(t, sk, kind, content, tags...)
	if err := r.Publish(ctx, *evt); err != nil {
		t.Fatalf("publish kind %d: %v", kind, err)
	}
}

// rawPublish returns the publish error verbatim so tests can assert on the
// reject prefix (auth-required, restricted, rate-limited).
func rawPublish(r *nostr.Relay, sk string, kind int, content string, tags ...nostr.Tag) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	pk, err := nostr.GetPublicKey(sk)
	if err != nil {
		return err
	}
	evt := &nostr.Event{
		PubKey:    pk,
		CreatedAt: nostr.Now(),
		Kind:      kind,
		Tags:      tags,
		Content:   content,
	}
	if err := evt.Sign(sk); err != nil {
		return err
	}
	return r.Publish(ctx, *evt)
}

// publishAuditAndMutation is the canonical pairing the relay enforces in
// §1.2.8: audit event first, then the state mutation. Failing either fails
// the whole helper so test bodies stay focused on the assertion.
func publishAuditAndMutation(
	t *testing.T,
	r *nostr.Relay,
	sk string,
	groupID, action string,
	mutKind int,
	mutContent string,
	mutTags []nostr.Tag,
) {
	t.Helper()
	publish(t, r, sk,
		audit.AuditKind,
		`{"action":"`+action+`"}`,
		nostr.Tag{"h", groupID}, nostr.Tag{"action", action},
	)
	publish(t, r, sk, mutKind, mutContent, mutTags...)
}

// seedCommunity bootstraps a minimal community: owner publishes metadata,
// roles (Staff with manage_channels, B4OS with no manage_*), members
// (alice=B4OS, bob=B4OS), and one staff-only channel "general" with
// write_roles=[Staff]. Used by adversarial scenarios that need a real
// group to attack.
func seedCommunity(t *testing.T, fr *fullRelay, ownerSK, aliceSK, bobSK string) (groupID, channelID string) {
	t.Helper()
	groupID = "demo-group"
	channelID = "general"
	owner := authedClient(t, fr.url, ownerSK)
	alicePK, _ := nostr.GetPublicKey(aliceSK)
	bobPK, _ := nostr.GetPublicKey(bobSK)
	ownerPK, _ := nostr.GetPublicKey(ownerSK)

	// Bootstrap: the very first 39000 doesn't need a paired audit (there's
	// no group yet to audit against). Membership skips it because it
	// carries only a `d` tag, no `h`.
	publish(t, owner, ownerSK, 39000,
		`{"name":"demo","owner_pubkey":"`+ownerPK+`"}`,
		nostr.Tag{"d", groupID},
	)
	publishAuditAndMutation(t, owner, ownerSK, groupID, "role_change",
		39003,
		`{"roles":[{"id":"Staff","permissions":["manage_channels","kick"]},{"id":"B4OS","permissions":[]}]}`,
		[]nostr.Tag{{"d", groupID}},
	)
	// Owner is in members so its own subsequent state events pass the
	// membership hook (membership applies to events with `h` tag — owner
	// also publishes 39250 audit which has `h`).
	publishAuditAndMutation(t, owner, ownerSK, groupID, "role_assign",
		39002,
		`{"members":[`+
			`{"pubkey":"`+ownerPK+`","role_ids":["Staff"],"joined_at":1},`+
			`{"pubkey":"`+alicePK+`","role_ids":["B4OS"],"joined_at":2},`+
			`{"pubkey":"`+bobPK+`","role_ids":["B4OS"],"joined_at":3}`+
			`]}`,
		[]nostr.Tag{{"d", groupID}},
	)
	publishAuditAndMutation(t, owner, ownerSK, groupID, "channel_create",
		39100,
		`{"name":"general","type":"text","write_roles":["Staff"],"read_roles":["everyone"]}`,
		[]nostr.Tag{{"d", channelID}, {"h", groupID}},
	)
	// Hook should reflect every accepted save into groupstate; sanity.
	if !fr.state.HasGroup(groupID) {
		t.Fatalf("seed: groupstate did not register group")
	}
	if !fr.state.IsMember(groupID, alicePK) {
		t.Fatalf("seed: alice missing from members projection")
	}
	return groupID, channelID
}

func contains(s, substr string) bool { return strings.Contains(s, substr) }
