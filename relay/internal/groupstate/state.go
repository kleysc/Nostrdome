// Package groupstate maintains an in-memory projection of the NIP-29 group
// state needed for membership and ACL enforcement.
//
// Inputs are signed events of kinds 39000-39003 (state-defining, NIP-33
// addressable, scoped by `d` tag) and kinds 39100/39101 (channels and
// categories, scoped by both `d` and `h` tags).
//
// The projection is rebuilt at boot from the persistent store via
// ReplayFrom, then kept fresh as new events arrive by hooking Apply into
// the relay's StoreEvent slice.
//
// Membership semantics for §1.2.4 are intentionally narrow: track owner
// (kind 39000.owner_pubkey) and the member set (kind 39002.members[].pubkey).
// Roles, channels, admins are added when §1.2.5 ACL needs them — the package
// shape leaves room for that without a refactor.
//
// Concurrency: all read paths take an RLock; writes take a full Lock. The
// hook layer reads on every EVENT publish, so the lock matters under load.
package groupstate

import (
	"encoding/json"
	"sync"

	"github.com/nbd-wtf/go-nostr"
)

// Event kinds we care about. Exported so callers (replay, hook tests) can
// reference them without a magic-number trail.
const (
	KindMetadata = 39000
	KindAdmins   = 39001
	KindMembers  = 39002
	KindRoles    = 39003
	KindChannel  = 39100
	KindCategory = 39101
)

// Member is the projection of one entry inside kind 39002.members[].
// JoinedAt is unix-seconds (the value of `joined_at` in the JSON content).
type Member struct {
	Pubkey   string
	RoleIDs  []string
	JoinedAt int64
}

// Role is the projection of one entry inside kind 39003.roles[]. Only
// Permissions is used by the projection today (rate-limit bypass for
// manage_* perms in §1.2.6); other fields are added when the UI / mod
// dashboard needs them.
type Role struct {
	ID          string
	Permissions []string
}

// Channel is the projection of one kind 39100 event. WriteRoles/ReadRoles
// are the role IDs allowed to write/read; the literal "everyone" means any
// group member. At is the created_at of the latest 39100 we applied for
// this (group, channel) pair so out-of-order older events can be dropped.
type Channel struct {
	ID         string
	GroupID    string
	WriteRoles []string
	ReadRoles  []string
	At         int64
}

// Group is the per-group slice of state. Fields with an `…At` suffix track
// the created_at of the latest event we applied to that field, so we can
// drop out-of-order older events on Apply.
type Group struct {
	ID        string
	Owner     string
	OwnerAt   int64
	members   map[string]*Member
	membersAt int64
	channels  map[string]*Channel
	roles     map[string]*Role
	rolesAt   int64
}

// State is the top-level container. Use New() to construct.
type State struct {
	mu     sync.RWMutex
	groups map[string]*Group
}

// New returns an empty State ready for ReplayFrom + Apply.
func New() *State {
	return &State{groups: map[string]*Group{}}
}

// HasGroup reports whether at least one valid kind 39000 has been applied
// for the given group ID. Used by the membership hook to distinguish
// "unknown group" from "known group but signer not a member".
func (s *State) HasGroup(groupID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	g, ok := s.groups[groupID]
	return ok && g.Owner != ""
}

// Owner returns the owner pubkey for a group, or "" if unknown.
func (s *State) Owner(groupID string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if g := s.groups[groupID]; g != nil {
		return g.Owner
	}
	return ""
}

// IsMember reports whether pubkey appears in the latest applied kind 39002
// for the group. The bootstrap owner is always an implicit member — at
// the very first kind 39000 publish there's no 39002 yet, but the owner
// must still be allowed to publish further state events (audit, roles,
// members) without being rejected for "not a member of their own group".
// Unknown group → false (not "permission denied"; callers distinguish via
// HasGroup).
func (s *State) IsMember(groupID, pubkey string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	g := s.groups[groupID]
	if g == nil {
		return false
	}
	if g.Owner == pubkey {
		return true
	}
	_, ok := g.members[pubkey]
	return ok
}

// MemberCount returns the size of the latest member set, useful for tests
// and future telemetry. Unknown group → 0.
func (s *State) MemberCount(groupID string) int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if g := s.groups[groupID]; g != nil {
		return len(g.members)
	}
	return 0
}

// MemberRoles returns a defensive copy of the role IDs of pubkey in groupID.
// Unknown group / non-member → nil. Used by the §1.2.5 ACL hook to compare
// against a channel's write_roles.
func (s *State) MemberRoles(groupID, pubkey string) []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	g := s.groups[groupID]
	if g == nil {
		return nil
	}
	m := g.members[pubkey]
	if m == nil {
		return nil
	}
	out := make([]string, len(m.RoleIDs))
	copy(out, m.RoleIDs)
	return out
}

// Channel returns the projection of channelID inside groupID, or nil if
// either is unknown.
func (s *State) Channel(groupID, channelID string) *Channel {
	s.mu.RLock()
	defer s.mu.RUnlock()
	g := s.groups[groupID]
	if g == nil {
		return nil
	}
	c := g.channels[channelID]
	if c == nil {
		return nil
	}
	// Defensive copy; callers should not mutate state.
	return &Channel{
		ID:         c.ID,
		GroupID:    c.GroupID,
		WriteRoles: append([]string(nil), c.WriteRoles...),
		ReadRoles:  append([]string(nil), c.ReadRoles...),
		At:         c.At,
	}
}

// Apply ingests an event into the projection. Returns nil for events that
// don't affect tracked state (unknown kind, missing tags, malformed JSON).
// Caller is responsible for invoking this AFTER the event passes auth +
// membership/ACL gates and is durably persisted — typically from a
// StoreEvent hook installed after the storage backend's SaveEvent.
func (s *State) Apply(evt *nostr.Event) error {
	if evt == nil {
		return nil
	}
	switch evt.Kind {
	case KindMetadata:
		return s.applyMetadata(evt)
	case KindMembers:
		return s.applyMembers(evt)
	case KindRoles:
		return s.applyRoles(evt)
	case KindChannel:
		return s.applyChannel(evt)
	}
	// Kinds 39001/39101 are accepted no-ops; admin-perm enforcement for
	// those lives in a future hook.
	return nil
}

func (s *State) applyMetadata(evt *nostr.Event) error {
	groupID := tagValue(evt, "d")
	if groupID == "" {
		return nil
	}
	var c struct {
		OwnerPubkey string `json:"owner_pubkey"`
	}
	if err := json.Unmarshal([]byte(evt.Content), &c); err != nil {
		return nil //nolint:nilerr // malformed publishers shouldn't crash boot.
	}
	if c.OwnerPubkey == "" {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	g := s.ensureGroup(groupID)
	createdAt := int64(evt.CreatedAt)
	// Bootstrap policy: the FIRST 39000 establishes ownership; later 39000
	// events with a different owner cannot rotate it (the §1.2.5 hook also
	// rejects them, this is defence-in-depth at the state layer).
	if g.Owner == "" {
		g.Owner = c.OwnerPubkey
		g.OwnerAt = createdAt
		return nil
	}
	// Same owner re-publishing metadata is fine; just keep the freshest ts.
	if c.OwnerPubkey == g.Owner && createdAt > g.OwnerAt {
		g.OwnerAt = createdAt
	}
	return nil
}

func (s *State) applyMembers(evt *nostr.Event) error {
	groupID := tagValue(evt, "d")
	if groupID == "" {
		return nil
	}
	var c struct {
		Members []struct {
			Pubkey   string   `json:"pubkey"`
			RoleIDs  []string `json:"role_ids"`
			JoinedAt int64    `json:"joined_at"`
		} `json:"members"`
	}
	if err := json.Unmarshal([]byte(evt.Content), &c); err != nil {
		return nil //nolint:nilerr // malformed publishers shouldn't crash boot.
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	g := s.ensureGroup(groupID)
	createdAt := int64(evt.CreatedAt)
	// Last-write-wins by created_at across signers. NIP-33 replaceable
	// semantics in storage are per (kind, signer, d), but at the group
	// level we want one canonical member list — newest wins.
	if createdAt <= g.membersAt {
		return nil
	}
	nm := make(map[string]*Member, len(c.Members))
	for _, m := range c.Members {
		// Defensive copy; m.RoleIDs is a slice into the decoder's buffer.
		roles := append([]string(nil), m.RoleIDs...)
		nm[m.Pubkey] = &Member{Pubkey: m.Pubkey, RoleIDs: roles, JoinedAt: m.JoinedAt}
	}
	g.members = nm
	g.membersAt = createdAt
	return nil
}

// applyRoles ingests a kind 39003 (group_roles) event. We only project the
// fields needed by the §1.2.6 rate-limit bypass: each role's id and
// permissions list. LWW by created_at across signers (last admin wins).
func (s *State) applyRoles(evt *nostr.Event) error {
	groupID := tagValue(evt, "d")
	if groupID == "" {
		return nil
	}
	var c struct {
		Roles []struct {
			ID          string   `json:"id"`
			Permissions []string `json:"permissions"`
		} `json:"roles"`
	}
	if err := json.Unmarshal([]byte(evt.Content), &c); err != nil {
		return nil //nolint:nilerr // malformed publishers shouldn't crash boot.
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	g := s.ensureGroup(groupID)
	createdAt := int64(evt.CreatedAt)
	if createdAt <= g.rolesAt {
		return nil
	}
	nr := make(map[string]*Role, len(c.Roles))
	for _, r := range c.Roles {
		nr[r.ID] = &Role{
			ID:          r.ID,
			Permissions: append([]string(nil), r.Permissions...),
		}
	}
	g.roles = nr
	g.rolesAt = createdAt
	return nil
}

// IsPrivileged reports whether pubkey is the owner of any tracked group OR
// a member of any group with at least one role whose permissions include
// any "manage_*" entry. Used by the §1.2.6 rate-limit hook to bypass
// admins. Unknown pubkey → false.
//
// Note: scoping is global across groups (an admin in group A is bypassed
// even when posting to group B). For F1 a relay hosts a single community
// so the distinction doesn't matter; revisit when multi-tenant lands.
func (s *State) IsPrivileged(pubkey string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, g := range s.groups {
		if g.Owner == pubkey {
			return true
		}
		m := g.members[pubkey]
		if m == nil {
			continue
		}
		for _, rid := range m.RoleIDs {
			r := g.roles[rid]
			if r == nil {
				continue
			}
			for _, p := range r.Permissions {
				if len(p) >= 7 && p[:7] == "manage_" {
					return true
				}
			}
		}
	}
	return false
}

// applyChannel ingests a kind 39100 (group_channel) event. The channel id
// lives in the `d` tag (per NIP-33 addressable semantics) and the group id
// in the `h` tag. We reject events without both. Last-write-wins by
// created_at per (group, channel) pair.
func (s *State) applyChannel(evt *nostr.Event) error {
	channelID := tagValue(evt, "d")
	groupID := tagValue(evt, "h")
	if channelID == "" || groupID == "" {
		return nil
	}
	var c struct {
		WriteRoles []string `json:"write_roles"`
		ReadRoles  []string `json:"read_roles"`
	}
	if err := json.Unmarshal([]byte(evt.Content), &c); err != nil {
		return nil //nolint:nilerr // malformed publishers shouldn't crash boot.
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	g := s.ensureGroup(groupID)
	createdAt := int64(evt.CreatedAt)
	if existing := g.channels[channelID]; existing != nil && createdAt <= existing.At {
		return nil
	}
	g.channels[channelID] = &Channel{
		ID:         channelID,
		GroupID:    groupID,
		WriteRoles: append([]string(nil), c.WriteRoles...),
		ReadRoles:  append([]string(nil), c.ReadRoles...),
		At:         createdAt,
	}
	return nil
}

// ensureGroup must be called with s.mu held.
func (s *State) ensureGroup(id string) *Group {
	g := s.groups[id]
	if g == nil {
		g = &Group{
			ID:       id,
			members:  map[string]*Member{},
			channels: map[string]*Channel{},
			roles:    map[string]*Role{},
		}
		s.groups[id] = g
	}
	return g
}

// tagValue returns the first value of the named tag, or "" if absent.
func tagValue(evt *nostr.Event, name string) string {
	for _, t := range evt.Tags {
		if len(t) >= 2 && t[0] == name {
			return t[1]
		}
	}
	return ""
}
