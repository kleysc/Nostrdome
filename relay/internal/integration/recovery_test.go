package integration_test

// §1.8.4 — Recovery test.
//
// Validates the F1 GATE promise: "if the relay restarts, the community comes
// back without loss". Concretely:
//
//   1. Open a fresh SQLite-backed storage in a temp dir.
//   2. Persist one full community's state (39000-39003 + 39101 + 39100).
//   3. Close the storage.
//   4. Reopen the same dir with a fresh State.
//   5. ReplayFrom must rebuild owner / members / roles / channels exactly,
//      AND the membership/ACL/privilege lookups must still answer correctly.
//
// We hit the productive `storage.Storage` (not the integration memStore)
// because the failure mode 1.8.4 is hunting for is a sqlite3-eventstore
// regression in ReplaceEvent / QueryEvents, not a hook bug.

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/nbd-wtf/go-nostr"

	"github.com/nostrdome-platform/relay/internal/groupstate"
	"github.com/nostrdome-platform/relay/internal/storage"
)

// signEvent is a thin wrapper that builds a signed event with the given
// kind / content / tags. Tests below seed the database directly via
// SaveEvent (not via websocket) — the recovery path under test is the
// boot-time replay, not the publish path.
func signEvent(t *testing.T, sk string, kind int, createdAt int64, content string, tags nostr.Tags) *nostr.Event {
	t.Helper()
	pk, err := nostr.GetPublicKey(sk)
	if err != nil {
		t.Fatalf("derive pubkey: %v", err)
	}
	e := &nostr.Event{
		PubKey:    pk,
		CreatedAt: nostr.Timestamp(createdAt),
		Kind:      kind,
		Tags:      tags,
		Content:   content,
	}
	if err := e.Sign(sk); err != nil {
		t.Fatalf("sign kind %d: %v", kind, err)
	}
	return e
}

// jsonContent marshals v to a JSON string, fataling on error so the test
// reads top-down without err checks.
func jsonContent(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(b)
}

func TestRecovery_GroupstateRebuildsAfterReopen(t *testing.T) {
	dir := t.TempDir()

	// Generate two real keypairs (owner + member). Generating live keeps
	// the test independent of any test-fixture pubkey constants elsewhere.
	ownerSK := nostr.GeneratePrivateKey()
	ownerPK, err := nostr.GetPublicKey(ownerSK)
	if err != nil {
		t.Fatalf("owner pubkey: %v", err)
	}
	memberSK := nostr.GeneratePrivateKey()
	memberPK, err := nostr.GetPublicKey(memberSK)
	if err != nil {
		t.Fatalf("member pubkey: %v", err)
	}

	const groupID = "recovery-group"
	const channelID = "general"
	now := time.Now().Unix()

	// ── Phase 1: open storage, persist a full community, close. ──────────
	{
		store, err := storage.Open(dir)
		if err != nil {
			t.Fatalf("storage open: %v", err)
		}

		ctx := context.Background()
		// Helper to push an event through the same path khatru would (replace
		// for addressable kinds, save otherwise). The seed runs in monotonic
		// order so created_at ties never matter.
		persist := func(e *nostr.Event) {
			t.Helper()
			// Kinds 30000-39999 are addressable per NIP-33, route through Replace.
			if e.Kind >= 30000 && e.Kind < 40000 {
				if err := store.Backend().ReplaceEvent(ctx, e); err != nil {
					t.Fatalf("replace kind %d: %v", e.Kind, err)
				}
				return
			}
			if err := store.Backend().SaveEvent(ctx, e); err != nil {
				t.Fatalf("save kind %d: %v", e.Kind, err)
			}
		}

		// kind 39000 — metadata (establishes ownership).
		persist(signEvent(t, ownerSK, 39000, now,
			jsonContent(t, map[string]any{
				"name":         "Recovery Demo",
				"about":        "Survives a restart.",
				"owner_pubkey": ownerPK,
			}),
			nostr.Tags{{"d", groupID}},
		))

		// kind 39001 — admins (owner with everything).
		persist(signEvent(t, ownerSK, 39001, now+1,
			jsonContent(t, map[string]any{
				"admins": []map[string]any{{
					"pubkey":      ownerPK,
					"permissions": []string{"manage_channels", "manage_roles", "kick", "ban"},
				}},
			}),
			nostr.Tags{{"d", groupID}},
		))

		// kind 39003 — roles (one staff role with manage_*, one everyone).
		persist(signEvent(t, ownerSK, 39003, now+2,
			jsonContent(t, map[string]any{
				"roles": []map[string]any{
					{"id": "Staff", "name": "Staff", "permissions": []string{"manage_channels", "kick"}, "priority": 100},
					{"id": "everyone", "name": "Everyone", "permissions": []string{}, "priority": 10},
				},
			}),
			nostr.Tags{{"d", groupID}},
		))

		// kind 39002 — members (owner + one regular member).
		persist(signEvent(t, ownerSK, 39002, now+3,
			jsonContent(t, map[string]any{
				"members": []map[string]any{
					{"pubkey": ownerPK, "role_ids": []string{"Staff"}, "joined_at": now},
					{"pubkey": memberPK, "role_ids": []string{"everyone"}, "joined_at": now},
				},
			}),
			nostr.Tags{{"d", groupID}},
		))

		// kind 39101 — category.
		persist(signEvent(t, ownerSK, 39101, now+4,
			jsonContent(t, map[string]any{"name": "General", "position": 0}),
			nostr.Tags{{"d", "general-cat"}, {"h", groupID}},
		))

		// kind 39100 — channel that everyone can write to.
		persist(signEvent(t, ownerSK, 39100, now+5,
			jsonContent(t, map[string]any{
				"name":        "general",
				"category_id": "general-cat",
				"type":        "text",
				"position":    0,
				"write_roles": []string{"everyone"},
				"read_roles":  []string{"everyone"},
			}),
			nostr.Tags{{"d", channelID}, {"h", groupID}},
		))

		store.Close()
		// File must actually exist on disk; otherwise reopen below would
		// silently create an empty database and the assertions would
		// false-pass.
		if _, err := storage.Open(dir); err != nil {
			t.Fatalf("sanity reopen: %v", err)
		}
		// Don't keep the sanity-check handle open — the next phase needs
		// a clean Open call so we can assert on a freshly-built State.
	}

	// ── Phase 2: reopen, replay, assert state matches what we seeded. ────
	store, err := storage.Open(dir)
	if err != nil {
		t.Fatalf("phase-2 open: %v", err)
	}
	defer store.Close()

	// Sanity: the SQLite file should be the same path we wrote to.
	if got := store.Path(); got != filepath.Join(dir, "relay.db") {
		t.Fatalf("storage path = %s, want %s", got, filepath.Join(dir, "relay.db"))
	}

	state := groupstate.New()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := state.ReplayFrom(ctx, store.Backend()); err != nil {
		t.Fatalf("replay: %v", err)
	}

	// Group existence + ownership.
	if !state.HasGroup(groupID) {
		t.Fatalf("HasGroup(%q) false after replay — projection didn't rebuild", groupID)
	}
	if got := state.Owner(groupID); got != ownerPK {
		t.Fatalf("Owner(%q) = %s, want %s", groupID, got, ownerPK)
	}

	// Membership.
	if !state.IsMember(groupID, ownerPK) {
		t.Fatalf("owner should be a member after replay")
	}
	if !state.IsMember(groupID, memberPK) {
		t.Fatalf("member should be a member after replay")
	}
	if got := state.MemberCount(groupID); got != 2 {
		t.Fatalf("MemberCount = %d, want 2", got)
	}
	stranger := nostr.GeneratePrivateKey()
	strangerPK, _ := nostr.GetPublicKey(stranger)
	if state.IsMember(groupID, strangerPK) {
		t.Fatalf("stranger should NOT be a member after replay")
	}

	// Privilege projection (kind 39003 + 39002 round-trip).
	if !state.IsPrivileged(ownerPK) {
		t.Fatalf("owner must be privileged after replay (Staff role with manage_channels)")
	}
	if state.IsPrivileged(memberPK) {
		t.Fatalf("regular member must NOT be privileged after replay")
	}

	// Channel projection.
	ch := state.Channel(groupID, channelID)
	if ch == nil {
		t.Fatalf("Channel(%q,%q) nil after replay", groupID, channelID)
	}
	if len(ch.WriteRoles) != 1 || ch.WriteRoles[0] != "everyone" {
		t.Fatalf("channel write_roles = %v, want [everyone]", ch.WriteRoles)
	}
	if len(ch.ReadRoles) != 1 || ch.ReadRoles[0] != "everyone" {
		t.Fatalf("channel read_roles = %v, want [everyone]", ch.ReadRoles)
	}
}

// TestRecovery_LWWPersistsAcrossReopen seeds two competing kind 39002
// events for the same group and verifies that after a close+reopen the
// projection still reflects the newer one. This catches a regression
// where ReplaceEvent might persist the older event last (e.g. by storing
// in insertion order rather than by created_at).
func TestRecovery_LWWPersistsAcrossReopen(t *testing.T) {
	dir := t.TempDir()
	ownerSK := nostr.GeneratePrivateKey()
	ownerPK, _ := nostr.GetPublicKey(ownerSK)
	aSK := nostr.GeneratePrivateKey()
	aPK, _ := nostr.GetPublicKey(aSK)
	bSK := nostr.GeneratePrivateKey()
	bPK, _ := nostr.GetPublicKey(bSK)
	const groupID = "lww-group"
	now := time.Now().Unix()

	{
		store, err := storage.Open(dir)
		if err != nil {
			t.Fatalf("open: %v", err)
		}
		ctx := context.Background()
		// Bootstrap: 39000 establishes the group.
		_ = store.Backend().ReplaceEvent(ctx, signEvent(t, ownerSK, 39000, now,
			jsonContent(t, map[string]any{"name": "lww", "owner_pubkey": ownerPK}),
			nostr.Tags{{"d", groupID}}))
		// Older 39002: only Alice.
		_ = store.Backend().ReplaceEvent(ctx, signEvent(t, ownerSK, 39002, now+10,
			jsonContent(t, map[string]any{"members": []map[string]any{
				{"pubkey": aPK, "role_ids": []string{"everyone"}, "joined_at": now},
			}}),
			nostr.Tags{{"d", groupID}}))
		// Newer 39002 (same signer + d-tag → ReplaceEvent drops the older).
		_ = store.Backend().ReplaceEvent(ctx, signEvent(t, ownerSK, 39002, now+20,
			jsonContent(t, map[string]any{"members": []map[string]any{
				{"pubkey": bPK, "role_ids": []string{"everyone"}, "joined_at": now},
			}}),
			nostr.Tags{{"d", groupID}}))
		store.Close()
	}

	store, err := storage.Open(dir)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer store.Close()
	state := groupstate.New()
	if err := state.ReplayFrom(context.Background(), store.Backend()); err != nil {
		t.Fatalf("replay: %v", err)
	}
	if state.IsMember(groupID, aPK) {
		t.Fatalf("Alice (older 39002) should NOT survive ReplaceEvent + replay")
	}
	if !state.IsMember(groupID, bPK) {
		t.Fatalf("Bob (newer 39002) should be the surviving member after replay")
	}
}
