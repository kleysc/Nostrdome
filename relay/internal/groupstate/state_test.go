package groupstate

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/nbd-wtf/go-nostr"
)

const (
	testGroup  = "demo-group"
	pubAlice   = "aaaa11111111111111111111111111111111111111111111111111111111aaaa"
	pubBob     = "bbbb22222222222222222222222222222222222222222222222222222222bbbb"
	pubCarol   = "cccc33333333333333333333333333333333333333333333333333333333cccc"
	pubOwner   = "ffff99999999999999999999999999999999999999999999999999999999ffff"
)

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(b)
}

func metadataEvent(t *testing.T, owner string, createdAt int64) *nostr.Event {
	return &nostr.Event{
		PubKey:    owner,
		CreatedAt: nostr.Timestamp(createdAt),
		Kind:      KindMetadata,
		Tags:      nostr.Tags{{"d", testGroup}},
		Content:   mustJSON(t, map[string]any{"name": "Demo", "owner_pubkey": owner}),
	}
}

func membersEvent(t *testing.T, signer string, createdAt int64, members ...string) *nostr.Event {
	type m struct {
		Pubkey   string   `json:"pubkey"`
		RoleIDs  []string `json:"role_ids"`
		JoinedAt int64    `json:"joined_at"`
	}
	out := make([]m, 0, len(members))
	for _, p := range members {
		out = append(out, m{Pubkey: p, RoleIDs: []string{"everyone"}, JoinedAt: createdAt})
	}
	return &nostr.Event{
		PubKey:    signer,
		CreatedAt: nostr.Timestamp(createdAt),
		Kind:      KindMembers,
		Tags:      nostr.Tags{{"d", testGroup}},
		Content:   mustJSON(t, map[string]any{"members": out}),
	}
}

func TestApply_MetadataEstablishesOwner(t *testing.T) {
	s := New()
	if err := s.Apply(metadataEvent(t, pubOwner, 100)); err != nil {
		t.Fatalf("apply: %v", err)
	}
	if !s.HasGroup(testGroup) {
		t.Fatalf("HasGroup should be true after first 39000")
	}
	if got := s.Owner(testGroup); got != pubOwner {
		t.Fatalf("owner = %s, want %s", got, pubOwner)
	}
}

func TestApply_MetadataBootstrapIsImmutable(t *testing.T) {
	s := New()
	_ = s.Apply(metadataEvent(t, pubOwner, 100))
	// A second 39000 with a different owner_pubkey must NOT rotate ownership.
	hijack := metadataEvent(t, pubAlice, 200)
	// Override the content to claim Alice as owner.
	hijack.Content = mustJSON(t, map[string]any{"name": "Demo", "owner_pubkey": pubAlice})
	_ = s.Apply(hijack)
	if got := s.Owner(testGroup); got != pubOwner {
		t.Fatalf("owner rotated to %s; bootstrap policy must hold (want %s)", got, pubOwner)
	}
}

func TestApply_MembersLastWriteWins(t *testing.T) {
	s := New()
	_ = s.Apply(metadataEvent(t, pubOwner, 100))
	_ = s.Apply(membersEvent(t, pubOwner, 110, pubAlice, pubBob))
	if !s.IsMember(testGroup, pubAlice) || !s.IsMember(testGroup, pubBob) {
		t.Fatalf("v1 not applied; alice=%v bob=%v", s.IsMember(testGroup, pubAlice), s.IsMember(testGroup, pubBob))
	}
	// Newer 39002 supersedes — bob removed, carol added.
	_ = s.Apply(membersEvent(t, pubOwner, 200, pubAlice, pubCarol))
	if !s.IsMember(testGroup, pubAlice) {
		t.Fatalf("alice should still be a member")
	}
	if s.IsMember(testGroup, pubBob) {
		t.Fatalf("bob should have been removed by v2")
	}
	if !s.IsMember(testGroup, pubCarol) {
		t.Fatalf("carol should have been added by v2")
	}
	if got := s.MemberCount(testGroup); got != 2 {
		t.Fatalf("MemberCount = %d, want 2", got)
	}
}

func TestApply_MembersIgnoresOlder(t *testing.T) {
	s := New()
	_ = s.Apply(metadataEvent(t, pubOwner, 100))
	_ = s.Apply(membersEvent(t, pubOwner, 200, pubAlice))
	// Out-of-order older event arrives — must NOT overwrite.
	_ = s.Apply(membersEvent(t, pubOwner, 110, pubBob))
	if !s.IsMember(testGroup, pubAlice) {
		t.Fatalf("alice (newer) lost to older event")
	}
	if s.IsMember(testGroup, pubBob) {
		t.Fatalf("bob (older) should not have been applied")
	}
}

func TestApply_MalformedContentNoOp(t *testing.T) {
	s := New()
	_ = s.Apply(metadataEvent(t, pubOwner, 100))
	bad := membersEvent(t, pubOwner, 200, pubAlice)
	bad.Content = "{not valid json"
	if err := s.Apply(bad); err != nil {
		t.Fatalf("malformed content should not error, got %v", err)
	}
	if s.IsMember(testGroup, pubAlice) {
		t.Fatalf("malformed payload must not mutate state")
	}
}

func rolesEvent(t *testing.T, signer string, createdAt int64, byID map[string][]string) *nostr.Event {
	t.Helper()
	type r struct {
		ID          string   `json:"id"`
		Permissions []string `json:"permissions"`
	}
	out := make([]r, 0, len(byID))
	for id, perms := range byID {
		out = append(out, r{ID: id, Permissions: perms})
	}
	return &nostr.Event{
		PubKey:    signer,
		CreatedAt: nostr.Timestamp(createdAt),
		Kind:      KindRoles,
		Tags:      nostr.Tags{{"d", testGroup}},
		Content:   mustJSON(t, map[string]any{"roles": out}),
	}
}

func TestIsPrivileged_OwnerAlwaysPrivileged(t *testing.T) {
	s := New()
	_ = s.Apply(metadataEvent(t, pubOwner, 100))
	if !s.IsPrivileged(pubOwner) {
		t.Fatalf("owner must be privileged")
	}
	if s.IsPrivileged(pubAlice) {
		t.Fatalf("non-member must not be privileged")
	}
}

func TestIsPrivileged_ManagePermissionGrantsPrivilege(t *testing.T) {
	s := New()
	_ = s.Apply(metadataEvent(t, pubOwner, 100))
	// Alice has Staff role with manage_channels, Bob has B4OS with no manage_*.
	_ = s.Apply(rolesEvent(t, pubOwner, 105, map[string][]string{
		"Staff":     {"kick", "manage_channels"},
		"B4OS_2024": {},
	}))
	type m struct {
		Pubkey   string   `json:"pubkey"`
		RoleIDs  []string `json:"role_ids"`
		JoinedAt int64    `json:"joined_at"`
	}
	evt := &nostr.Event{
		PubKey:    pubOwner,
		CreatedAt: nostr.Timestamp(110),
		Kind:      KindMembers,
		Tags:      nostr.Tags{{"d", testGroup}},
		Content: mustJSON(t, map[string]any{"members": []m{
			{Pubkey: pubAlice, RoleIDs: []string{"Staff"}, JoinedAt: 110},
			{Pubkey: pubBob, RoleIDs: []string{"B4OS_2024"}, JoinedAt: 110},
		}}),
	}
	_ = s.Apply(evt)
	if !s.IsPrivileged(pubAlice) {
		t.Fatalf("alice (Staff with manage_channels) must be privileged")
	}
	if s.IsPrivileged(pubBob) {
		t.Fatalf("bob (B4OS without manage_*) must NOT be privileged")
	}
}

func TestApply_NilAndUnknownKindNoOp(t *testing.T) {
	s := New()
	if err := s.Apply(nil); err != nil {
		t.Fatalf("nil: %v", err)
	}
	if err := s.Apply(&nostr.Event{Kind: 1}); err != nil {
		t.Fatalf("kind 1: %v", err)
	}
}

// fakeQuerier feeds a fixed slice of events to ReplayFrom in arbitrary
// order so we can assert sort-by-created_at ordering.
type fakeQuerier struct {
	events []*nostr.Event
}

func (f *fakeQuerier) QueryEvents(_ context.Context, _ nostr.Filter) (chan *nostr.Event, error) {
	ch := make(chan *nostr.Event, len(f.events))
	for _, e := range f.events {
		ch <- e
	}
	close(ch)
	return ch, nil
}

func TestReplayFrom_AppliesByCreatedAt(t *testing.T) {
	q := &fakeQuerier{events: []*nostr.Event{
		// Deliberately reverse-chronological to verify the sort.
		membersEvent(t, pubOwner, 200, pubAlice, pubCarol),
		membersEvent(t, pubOwner, 110, pubAlice, pubBob),
		metadataEvent(t, pubOwner, 100),
	}}
	s := New()
	if err := s.ReplayFrom(context.Background(), q); err != nil {
		t.Fatalf("replay: %v", err)
	}
	if got := s.Owner(testGroup); got != pubOwner {
		t.Fatalf("owner = %q after replay", got)
	}
	if !s.IsMember(testGroup, pubAlice) || !s.IsMember(testGroup, pubCarol) {
		t.Fatalf("expected v2 (alice+carol) members; got count=%d", s.MemberCount(testGroup))
	}
	if s.IsMember(testGroup, pubBob) {
		t.Fatalf("bob should not survive v2 replay")
	}
}

func TestReplayFrom_Idempotent(t *testing.T) {
	q := &fakeQuerier{events: []*nostr.Event{
		metadataEvent(t, pubOwner, 100),
		membersEvent(t, pubOwner, 200, pubAlice),
	}}
	s := New()
	if err := s.ReplayFrom(context.Background(), q); err != nil {
		t.Fatalf("first replay: %v", err)
	}
	if err := s.ReplayFrom(context.Background(), q); err != nil {
		t.Fatalf("second replay: %v", err)
	}
	if got := s.MemberCount(testGroup); got != 1 {
		t.Fatalf("MemberCount = %d, want 1 (idempotent)", got)
	}
}
