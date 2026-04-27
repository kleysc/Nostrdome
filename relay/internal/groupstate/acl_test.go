package groupstate

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/nbd-wtf/go-nostr"
)

const testChannel = "chan-1"

func channelEvent(t *testing.T, signer string, createdAt int64, channelID string, writeRoles, readRoles []string) *nostr.Event {
	t.Helper()
	content, err := json.Marshal(map[string]any{
		"name":        "general",
		"type":        "text",
		"write_roles": writeRoles,
		"read_roles":  readRoles,
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return &nostr.Event{
		PubKey:    signer,
		CreatedAt: nostr.Timestamp(createdAt),
		Kind:      KindChannel,
		Tags:      nostr.Tags{{"d", channelID}, {"h", testGroup}},
		Content:   string(content),
	}
}

func membersWithRoles(t *testing.T, signer string, createdAt int64, byPubkey map[string][]string) *nostr.Event {
	t.Helper()
	type m struct {
		Pubkey   string   `json:"pubkey"`
		RoleIDs  []string `json:"role_ids"`
		JoinedAt int64    `json:"joined_at"`
	}
	out := make([]m, 0, len(byPubkey))
	for pk, roles := range byPubkey {
		out = append(out, m{Pubkey: pk, RoleIDs: roles, JoinedAt: createdAt})
	}
	return &nostr.Event{
		PubKey:    signer,
		CreatedAt: nostr.Timestamp(createdAt),
		Kind:      KindMembers,
		Tags:      nostr.Tags{{"d", testGroup}},
		Content:   mustJSON(t, map[string]any{"members": out}),
	}
}

func chatEventToChannel(group, signer, channelID string) *nostr.Event {
	return &nostr.Event{
		PubKey:    signer,
		CreatedAt: nostr.Timestamp(1000),
		Kind:      39200,
		Tags:      nostr.Tags{{"h", group}, {"e", channelID}},
		Content:   "hi",
	}
}

func TestACL_NonChannelKindPasses(t *testing.T) {
	s := New()
	hook := RequireChannelWritePermission(s)
	// kind 39000 has no `e` tag and isn't a channel-scoped kind.
	evt := metadataEvent(t, pubOwner, 100)
	if rejected, _ := hook(context.Background(), evt); rejected {
		t.Fatalf("non-channel-scoped kind must pass ACL hook")
	}
}

func TestACL_UnknownChannelRejected(t *testing.T) {
	s := New()
	_ = s.Apply(metadataEvent(t, pubOwner, 100))
	_ = s.Apply(membersWithRoles(t, pubOwner, 110, map[string][]string{
		pubAlice: {"everyone"},
	}))
	hook := RequireChannelWritePermission(s)
	evt := chatEventToChannel(testGroup, pubAlice, "ghost-channel")
	rejected, msg := hook(context.Background(), evt)
	if !rejected {
		t.Fatalf("event to unknown channel must be rejected")
	}
	if msg != ReasonUnknownChannel {
		t.Fatalf("reason = %q, want %q", msg, ReasonUnknownChannel)
	}
}

func TestACL_EveryoneAllowsAnyMember(t *testing.T) {
	s := New()
	_ = s.Apply(metadataEvent(t, pubOwner, 100))
	_ = s.Apply(membersWithRoles(t, pubOwner, 110, map[string][]string{
		pubAlice: {"everyone"},
	}))
	_ = s.Apply(channelEvent(t, pubOwner, 120, testChannel, []string{"everyone"}, []string{"everyone"}))
	hook := RequireChannelWritePermission(s)
	if rejected, msg := hook(context.Background(), chatEventToChannel(testGroup, pubAlice, testChannel)); rejected {
		t.Fatalf("everyone write_roles must allow member; got %q", msg)
	}
}

func TestACL_RoleIntersectionAllows(t *testing.T) {
	s := New()
	_ = s.Apply(metadataEvent(t, pubOwner, 100))
	_ = s.Apply(membersWithRoles(t, pubOwner, 110, map[string][]string{
		pubAlice: {"Staff", "B4OS_2024"},
	}))
	_ = s.Apply(channelEvent(t, pubOwner, 120, testChannel, []string{"Staff"}, []string{"everyone"}))
	hook := RequireChannelWritePermission(s)
	if rejected, msg := hook(context.Background(), chatEventToChannel(testGroup, pubAlice, testChannel)); rejected {
		t.Fatalf("staff signer must be allowed in staff-only channel; got %q", msg)
	}
}

func TestACL_NoIntersectionRejected(t *testing.T) {
	s := New()
	_ = s.Apply(metadataEvent(t, pubOwner, 100))
	_ = s.Apply(membersWithRoles(t, pubOwner, 110, map[string][]string{
		pubAlice: {"B4OS_2024"},
	}))
	_ = s.Apply(channelEvent(t, pubOwner, 120, testChannel, []string{"Staff"}, []string{"everyone"}))
	hook := RequireChannelWritePermission(s)
	rejected, msg := hook(context.Background(), chatEventToChannel(testGroup, pubAlice, testChannel))
	if !rejected {
		t.Fatalf("non-staff signer must be rejected in staff-only channel")
	}
	if msg != ReasonNoWritePerm {
		t.Fatalf("reason = %q, want %q", msg, ReasonNoWritePerm)
	}
}

func TestACL_ReactionUsesFirstETag(t *testing.T) {
	// kind 39201 has two `e` tags: channel id (first) and message id.
	// The hook must look at the first one only.
	s := New()
	_ = s.Apply(metadataEvent(t, pubOwner, 100))
	_ = s.Apply(membersWithRoles(t, pubOwner, 110, map[string][]string{
		pubAlice: {"Staff"},
	}))
	_ = s.Apply(channelEvent(t, pubOwner, 120, testChannel, []string{"Staff"}, []string{"everyone"}))
	hook := RequireChannelWritePermission(s)
	evt := &nostr.Event{
		PubKey:    pubAlice,
		CreatedAt: nostr.Timestamp(1000),
		Kind:      39201,
		Tags: nostr.Tags{
			{"h", testGroup},
			{"e", testChannel}, // channel id first
			{"e", "msg-abc"},   // target message
		},
		Content: "+",
	}
	if rejected, msg := hook(context.Background(), evt); rejected {
		t.Fatalf("reaction with channel id as first e-tag must pass; got %q", msg)
	}
}

func TestACL_ChannelLastWriteWins(t *testing.T) {
	s := New()
	_ = s.Apply(metadataEvent(t, pubOwner, 100))
	_ = s.Apply(membersWithRoles(t, pubOwner, 110, map[string][]string{
		pubAlice: {"B4OS_2024"},
	}))
	_ = s.Apply(channelEvent(t, pubOwner, 120, testChannel, []string{"Staff"}, []string{"everyone"}))
	// Re-publish channel with everyone-write — newer event must apply.
	_ = s.Apply(channelEvent(t, pubOwner, 200, testChannel, []string{"everyone"}, []string{"everyone"}))
	hook := RequireChannelWritePermission(s)
	if rejected, msg := hook(context.Background(), chatEventToChannel(testGroup, pubAlice, testChannel)); rejected {
		t.Fatalf("post-LWW channel allows everyone; got %q", msg)
	}
}

func TestACL_ChannelIgnoresOlder(t *testing.T) {
	s := New()
	_ = s.Apply(metadataEvent(t, pubOwner, 100))
	_ = s.Apply(membersWithRoles(t, pubOwner, 110, map[string][]string{
		pubAlice: {"B4OS_2024"},
	}))
	_ = s.Apply(channelEvent(t, pubOwner, 200, testChannel, []string{"Staff"}, []string{"everyone"}))
	// Older event arriving out of order must NOT downgrade to everyone.
	_ = s.Apply(channelEvent(t, pubOwner, 110, testChannel, []string{"everyone"}, []string{"everyone"}))
	hook := RequireChannelWritePermission(s)
	if rejected, _ := hook(context.Background(), chatEventToChannel(testGroup, pubAlice, testChannel)); !rejected {
		t.Fatalf("alice (no Staff) must remain rejected after older event arrives")
	}
}

func TestACL_MissingChannelTagTreatedAsUnknown(t *testing.T) {
	s := New()
	_ = s.Apply(metadataEvent(t, pubOwner, 100))
	_ = s.Apply(membersWithRoles(t, pubOwner, 110, map[string][]string{
		pubAlice: {"everyone"},
	}))
	hook := RequireChannelWritePermission(s)
	evt := &nostr.Event{
		PubKey:    pubAlice,
		CreatedAt: nostr.Timestamp(1000),
		Kind:      39200,
		Tags:      nostr.Tags{{"h", testGroup}}, // no `e`
		Content:   "hi",
	}
	rejected, msg := hook(context.Background(), evt)
	if !rejected || msg != ReasonUnknownChannel {
		t.Fatalf("missing e-tag should reject as unknown channel, got rejected=%v msg=%q", rejected, msg)
	}
}
