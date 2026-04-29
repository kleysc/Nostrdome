package groupstate

import (
	"context"

	"github.com/nbd-wtf/go-nostr"
)

// ACL reject reasons for §1.2.5 per-channel write enforcement.
const (
	ReasonUnknownChannel = "restricted: unknown channel"
	ReasonNoWritePerm    = "restricted: no write permission for channel"
)

// channelScopedKinds enumerates the operational kinds whose write access
// is gated by a channel's `write_roles`. Membership is enforced upstream;
// this hook only checks the role intersection.
//
// 39200 channel_message, 39201 channel_reaction, 39400 encrypted_envelope.
// 39300 voice_room_state is intentionally NOT here — voice ACL has its own
// shape (speaker_roles vs membership) handled in F4.
var channelScopedKinds = map[int]struct{}{
	39200: {},
	39201: {},
	39400: {},
}

// RequireChannelWritePermission returns a RejectEvent hook enforcing the
// per-channel `write_roles` ACL declared in kind 39100 against the signer's
// `role_ids` from kind 39002.
//
// Resolution rules (matches docs/event-schema.md):
//  - Only kinds in channelScopedKinds are inspected; everything else passes.
//  - The channel id is the FIRST `e` tag (reactions carry a second `e`
//    pointing at the message — that one is irrelevant here).
//  - "everyone" in write_roles means any group member can write; since
//    membership is enforced upstream this short-circuits to allow.
//  - Otherwise the signer must have at least one role id in common with
//    write_roles. Empty intersection → reject.
//
// Order: install AFTER RequireMembership (we trust evt.PubKey is a member)
// and BEFORE the rate-limit hook (no point counting events we'll reject).
func RequireChannelWritePermission(state *State) func(context.Context, *nostr.Event) (bool, string) {
	return func(_ context.Context, evt *nostr.Event) (bool, string) {
		if evt == nil {
			return false, ""
		}
		if _, ok := channelScopedKinds[evt.Kind]; !ok {
			return false, ""
		}
		groupID := tagValue(evt, "h")
		channelID := tagValue(evt, "e")
		if groupID == "" || channelID == "" {
			// Missing required scoping tags. Membership hook would have
			// already passed it (no `h` → not group-scoped) or rejected
			// (`h` present but unknown). For these specific kinds we
			// require both: treat as unknown channel.
			return true, ReasonUnknownChannel
		}
		ch := state.Channel(groupID, channelID)
		if ch == nil {
			return true, ReasonUnknownChannel
		}
		if hasEveryone(ch.WriteRoles) {
			return false, ""
		}
		signerRoles := state.MemberRoles(groupID, evt.PubKey)
		if intersects(signerRoles, ch.WriteRoles) {
			return false, ""
		}
		return true, ReasonNoWritePerm
	}
}

func hasEveryone(roles []string) bool {
	for _, r := range roles {
		if r == "everyone" {
			return true
		}
	}
	return false
}

func intersects(a, b []string) bool {
	if len(a) == 0 || len(b) == 0 {
		return false
	}
	set := make(map[string]struct{}, len(a))
	for _, r := range a {
		set[r] = struct{}{}
	}
	for _, r := range b {
		if _, ok := set[r]; ok {
			return true
		}
	}
	return false
}
