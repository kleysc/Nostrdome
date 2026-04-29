// Package spike contains the throwaway plugin used by §1.1.1 + §1.1.2 spikes.
//
// In F1 §1.2 this is replaced by `internal/plugin/` + `internal/groupstate/`.
// The point here is empirical validation that khatru's hook API is enough
// to express enforcement; no persistence, no concurrency-safety claims
// beyond a basic mutex, no replaceable-event semantics.
package spike

import (
	"sync"
)

// Channel is a minimal stand-in for kind 39100 metadata.
type Channel struct {
	ID         string
	WriteRoles []string
	ReadRoles  []string
}

// Member is a minimal stand-in for an entry in kind 39002.
type Member struct {
	Pubkey  string
	RoleIDs []string
}

// GroupState mimics what the real plugin will reconstruct from kind 39000-39101
// events. For the spike we just hold it in memory and seed it at boot.
type GroupState struct {
	mu       sync.RWMutex
	GroupID  string
	Owner    string
	Members  map[string]*Member  // pubkey → member
	Channels map[string]*Channel // channel id → channel
}

func NewGroupState(groupID string) *GroupState {
	return &GroupState{
		GroupID:  groupID,
		Members:  map[string]*Member{},
		Channels: map[string]*Channel{},
	}
}

func (s *GroupState) SetOwner(pubkey string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Owner = pubkey
}

func (s *GroupState) AddMember(pubkey string, roleIDs []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Members[pubkey] = &Member{Pubkey: pubkey, RoleIDs: roleIDs}
}

func (s *GroupState) RemoveMember(pubkey string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.Members, pubkey)
}

func (s *GroupState) IsMember(pubkey string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, ok := s.Members[pubkey]
	return ok
}

func (s *GroupState) MemberRoles(pubkey string) []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if m, ok := s.Members[pubkey]; ok {
		return append([]string{}, m.RoleIDs...)
	}
	return nil
}

func (s *GroupState) AddChannel(id string, write, read []string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Channels[id] = &Channel{ID: id, WriteRoles: write, ReadRoles: read}
}

func (s *GroupState) Channel(id string) *Channel {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if ch, ok := s.Channels[id]; ok {
		// return a copy to avoid races on slices
		return &Channel{
			ID:         ch.ID,
			WriteRoles: append([]string{}, ch.WriteRoles...),
			ReadRoles:  append([]string{}, ch.ReadRoles...),
		}
	}
	return nil
}

// hasIntersection reports whether any element of a appears in b.
func hasIntersection(a, b []string) bool {
	set := make(map[string]struct{}, len(b))
	for _, x := range b {
		set[x] = struct{}{}
	}
	for _, x := range a {
		if _, ok := set[x]; ok {
			return true
		}
	}
	return false
}
