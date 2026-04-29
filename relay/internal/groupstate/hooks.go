package groupstate

import (
	"context"

	"github.com/nbd-wtf/go-nostr"
)

// Reject reasons. Exported so tests match by value rather than substring;
// clients also rely on the `restricted:` prefix per NIP-01.
const (
	ReasonUnknownGroup = "restricted: unknown group"
	ReasonNotMember    = "restricted: not a group member"
)

// RequireMembership returns a RejectEvent hook enforcing NIP-29 group
// membership for events that carry an `h` tag.
//
// State-defining kinds (39000-39003) carry only a `d` tag and pass through
// untouched — the §1.2.5 ACL hook downstream is responsible for owner /
// admin permission checks on those kinds.
//
// kind 22242 (NIP-42 AUTH) is whitelisted: it predates membership and is
// the very mechanism by which `event.PubKey` becomes trusted.
//
// Order: install AFTER auth.RejectUnauthedEvent (event.PubKey is only
// trustworthy once the connection is authed) and BEFORE the §1.2.5 ACL
// hook (ACL assumes the signer is at least a member of the group).
func RequireMembership(state *State) func(context.Context, *nostr.Event) (bool, string) {
	return func(_ context.Context, evt *nostr.Event) (bool, string) {
		if evt == nil {
			return false, ""
		}
		if evt.Kind == nostr.KindClientAuthentication {
			return false, ""
		}
		h := tagValue(evt, "h")
		if h == "" {
			// Not a group-scoped operational event. Pass — §1.2.5 may still
			// reject (e.g. non-owner publishing kind 39000).
			return false, ""
		}
		if !state.HasGroup(h) {
			return true, ReasonUnknownGroup
		}
		if !state.IsMember(h, evt.PubKey) {
			return true, ReasonNotMember
		}
		return false, ""
	}
}

// AfterStoreApply returns a StoreEvent-shaped function that ingests
// accepted events into the projection.
//
// khatru calls every StoreEvent callback in slice order; install this
// AFTER storage.Wire() so the canonical SaveEvent runs first and the
// projection only mirrors what's already durable. If SaveEvent returns
// an error, khatru aborts the slice — Apply won't run on a save that
// failed.
//
// IMPORTANT: StoreEvent is skipped for addressable/replaceable kinds when
// a ReplaceEvent hook is registered (khatru's adding.go fork). All NIP-29
// state kinds (39000-39003, 39100, 39101) are addressable, so this hook
// alone does NOT keep the projection fresh in production. Use
// OnEventSaved (see OnSaved below), which fires for every accepted
// event regardless of the storage route.
func AfterStoreApply(state *State) func(context.Context, *nostr.Event) error {
	return func(_ context.Context, evt *nostr.Event) error {
		_ = state.Apply(evt)
		return nil
	}
}

// OnSaved returns an OnEventSaved-shaped function that ingests every
// accepted event into the projection. Unlike AfterStoreApply this fires
// on the replaceable path too, so the in-memory NIP-29 state stays in
// sync after kind 39000-39003 / 39100-39101 publishes.
//
// Apply errors are deliberately swallowed: malformed JSON in an already-
// persisted event is a publisher bug we can't recover from by failing the
// already-acked publish.
func OnSaved(state *State) func(context.Context, *nostr.Event) {
	return func(_ context.Context, evt *nostr.Event) {
		_ = state.Apply(evt)
	}
}
