package spike

import (
	"context"

	"github.com/fiatjaf/khatru"
	"github.com/nbd-wtf/go-nostr"
)

// IssueAuthOnConnect pushes the NIP-42 challenge as soon as a websocket
// connects. Without this, the challenge only goes out lazily when a hook
// calls RequestAuth, which forces clients to fail-then-retry. Issuing on
// connect lets clients call r.Auth() proactively.
func IssueAuthOnConnect(ctx context.Context) {
	khatru.RequestAuth(ctx)
}

// RequireAuth blocks REQ subscriptions from non-authenticated clients.
//
// When the client hasn't completed NIP-42 AUTH, khatru.RequestAuth issues
// a challenge and we reject this REQ until the client retries after auth.
//
// This validates the §1.1.2 question: "can we enforce AUTH for reads via
// the plugin API?" — yes, RejectFilter is the seam.
func RequireAuth(ctx context.Context, filter nostr.Filter) (bool, string) {
	if khatru.GetAuthed(ctx) == "" {
		khatru.RequestAuth(ctx)
		return true, "auth-required: NIP-42 challenge issued"
	}
	return false, ""
}

// RequireAuth4Event mirrors RequireAuth on the write side. khatru's AUTH
// flow already does this for non-AUTH events, but having it explicit keeps
// the policy obvious.
func RequireAuth4Event(ctx context.Context, event *nostr.Event) (bool, string) {
	if event.Kind == nostr.KindClientAuthentication { // AUTH event itself, kind 22242
		return false, ""
	}
	if khatru.GetAuthed(ctx) == "" {
		khatru.RequestAuth(ctx)
		return true, "auth-required: NIP-42 challenge issued"
	}
	return false, ""
}

// RequireHTag is the §1.1.1 hello-world: rejects any non-AUTH event missing
// the `h` tag that scopes it to a group.
//
// Real plugin (§1.2.4) extends this: validate that the h tag value matches
// a known group AND that the signer is a member of that group.
func RequireHTag(_ context.Context, event *nostr.Event) (bool, string) {
	if event.Kind == nostr.KindClientAuthentication {
		return false, ""
	}
	for _, tag := range event.Tags {
		if len(tag) >= 2 && tag[0] == "h" {
			return false, ""
		}
	}
	return true, "restricted: missing h tag (group scope)"
}

// RequireMembership checks that the AUTH'd signer is in the in-memory
// member list of the group named by the event's `h` tag.
//
// Validates the §1.1.2 question: "can we enforce NIP-29 membership at the
// plugin layer?" — yes, RejectEvent receives the signed event and we have
// state to check against.
func RequireMembership(state *GroupState) func(context.Context, *nostr.Event) (bool, string) {
	return func(_ context.Context, event *nostr.Event) (bool, string) {
		if event.Kind == nostr.KindClientAuthentication {
			return false, ""
		}
		var hValue string
		for _, tag := range event.Tags {
			if len(tag) >= 2 && tag[0] == "h" {
				hValue = tag[1]
				break
			}
		}
		if hValue == "" {
			// RequireHTag already rejected; nothing to check.
			return false, ""
		}
		if hValue != state.GroupID {
			return true, "restricted: unknown group"
		}
		if !state.IsMember(event.PubKey) {
			return true, "restricted: not a group member"
		}
		return false, ""
	}
}

// RequireChannelWriteRole enforces per-channel ACL: the event's first `e`
// tag identifies the channel; the signer must hold a role intersecting the
// channel's write_roles.
//
// Validates the §1.1.2 question: "can we enforce per-channel ACL above
// NIP-29's group-level membership?" — yes, the same RejectEvent slot
// composes naturally.
func RequireChannelWriteRole(state *GroupState) func(context.Context, *nostr.Event) (bool, string) {
	return func(_ context.Context, event *nostr.Event) (bool, string) {
		if event.Kind == nostr.KindClientAuthentication {
			return false, ""
		}
		// Only chat-message kinds in the spike (39200). Other kinds don't carry
		// a channel reference.
		if event.Kind != 39200 {
			return false, ""
		}
		var channelID string
		for _, tag := range event.Tags {
			if len(tag) >= 2 && tag[0] == "e" {
				channelID = tag[1]
				break
			}
		}
		if channelID == "" {
			return true, "restricted: kind 39200 missing channel e tag"
		}
		ch := state.Channel(channelID)
		if ch == nil {
			return true, "restricted: unknown channel"
		}
		roles := state.MemberRoles(event.PubKey)
		// "everyone" is implicit for any member.
		roles = append(roles, "everyone")
		if !hasIntersection(ch.WriteRoles, roles) {
			return true, "restricted: insufficient role for channel"
		}
		return false, ""
	}
}

