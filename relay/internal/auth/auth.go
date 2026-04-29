// Package auth implements the productive NIP-42 enforcement hooks.
//
// Three hooks compose to enforce "AUTH first" without monolithic checks:
//
//   - IssueOnConnect: pushes the AUTH challenge as soon as a websocket
//     connects, so well-behaved clients can call r.Auth() without waiting
//     for a reject-then-retry round trip. (See spike-findings.md §1.1.2 for
//     why lazy challenges are not enough.)
//   - RejectFilter: blocks REQ subscriptions from non-authenticated
//     connections. Returns a message prefixed with `auth-required:` so
//     clients can categorize the error.
//   - RejectEvent: blocks EVENT publishes from non-authenticated
//     connections, with the lone exception of the NIP-42 AUTH event itself
//     (kind 22242), which is the very thing that completes the handshake.
//
// Each hook is exported as a plain function so cmd/nostrdome-relay can
// register them in the order required by the spec: AUTH first, then
// membership, then ACL.
package auth

import (
	"context"

	"github.com/fiatjaf/khatru"
	"github.com/nbd-wtf/go-nostr"
)

// Reject reasons. Exported so tests can match by value rather than by
// substring; clients also rely on the `auth-required:` prefix.
const (
	ReasonAuthRequiredRead    = "auth-required: please authenticate to read events"
	ReasonAuthRequiredPublish = "auth-required: please authenticate to publish"
)

// IssueOnConnect emits a NIP-42 challenge to every new websocket. Wire it
// into khatru.Relay.OnConnect.
//
// Without this, the challenge only goes out lazily when the first hook
// rejects a request, which forces a fail-then-retry round trip on the
// client. The spike validated this; we keep the same pattern for prod.
func IssueOnConnect(ctx context.Context) {
	khatru.RequestAuth(ctx)
}

// RejectUnauthedFilter rejects REQ subscriptions whose connection has not
// completed NIP-42 AUTH. Wire it into khatru.Relay.RejectFilter as the
// first entry so subsequent hooks can assume an authenticated context.
//
// The hook re-issues a challenge on rejection so a client that subscribes
// before reading the connect-time challenge still gets a usable AUTH
// envelope on its next read.
func RejectUnauthedFilter(ctx context.Context, _ nostr.Filter) (bool, string) {
	if khatru.GetAuthed(ctx) != "" {
		return false, ""
	}
	khatru.RequestAuth(ctx)
	return true, ReasonAuthRequiredRead
}

// RejectUnauthedEvent rejects EVENT publishes from non-authenticated
// connections. Wire it into khatru.Relay.RejectEvent BEFORE membership
// or ACL hooks — those rely on event.PubKey matching the authed pubkey,
// which only holds once AUTH has succeeded.
//
// The kind 22242 (NIP-42 AUTH) event is whitelisted: it is the message
// that completes authentication, so rejecting it would deadlock the
// handshake.
func RejectUnauthedEvent(ctx context.Context, event *nostr.Event) (bool, string) {
	if event != nil && event.Kind == nostr.KindClientAuthentication {
		return false, ""
	}
	if khatru.GetAuthed(ctx) != "" {
		return false, ""
	}
	khatru.RequestAuth(ctx)
	return true, ReasonAuthRequiredPublish
}
