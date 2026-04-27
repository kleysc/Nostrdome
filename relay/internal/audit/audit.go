// Package audit enforces §1.2.8: every state-defining mutation must be
// accompanied by a kind 39250 (group_audit) signed by the same actor for
// the same group, and 39250 events must not be deletable.
//
// Enforcement model
//
// We don't bind a mutation to a specific audit event by id — the
// chicken-and-egg of cross-referencing two events that don't exist yet
// makes that brittle. Instead, the actor publishes the audit event first
// (describing what they're about to do), then the mutation. The relay,
// when it sees the mutation, queries the store for a 39250 from the same
// pubkey + same `h` group within RecentWindow. If none → reject.
//
// This is loose by design: a generous 60-second window survives network
// jitter and client retries, and the audit tags (`action`, `target`)
// already carry the operator-readable record of intent.
//
// Non-deletable: kind 5 (NIP-09) events that reference a stored 39250 by
// `e` tag, or that announce intent via `["k","39250"]`, are rejected
// outright.
//
// Order: install AFTER auth, membership, ACL — those gates are cheaper
// and stricter, no point doing the (DB-bound) audit lookup on events that
// would have been rejected anyway.
package audit

import (
	"context"
	"strconv"
	"time"

	"github.com/nbd-wtf/go-nostr"
)

const (
	// RecentWindow is how far back we look for an accompanying 39250 when
	// validating a state mutation. Wide enough to absorb client retries +
	// relay round-trips; narrow enough that an audit event from an
	// unrelated past action doesn't accidentally cover a new mutation.
	RecentWindow = 60 * time.Second

	// AuditKind is kind 39250 (group_audit). Exported so call sites avoid
	// magic numbers.
	AuditKind = 39250

	ReasonAuditMissing = "restricted: state mutation requires a recent kind 39250 audit event"
	ReasonAuditUndelet = "restricted: kind 39250 audit events are non-deletable"
)

// stateMutationKinds enumerates the kinds whose acceptance requires a
// paired audit event. Mirrors docs/event-schema.md "Quién firma" for
// admin-only kinds.
var stateMutationKinds = map[int]struct{}{
	39000: {}, // group_metadata
	39001: {}, // group_admins
	39002: {}, // group_members
	39003: {}, // group_roles
	39100: {}, // group_channel
	39101: {}, // group_category
}

// Querier is the slice of the storage backend the audit hooks need. The
// production wire passes *sqlite3.SQLite3Backend, which already satisfies
// it; tests can pass a fake.
type Querier interface {
	QueryEvents(ctx context.Context, filter nostr.Filter) (chan *nostr.Event, error)
}

// RequireAuditPair returns a RejectEvent hook enforcing the
// "mutation paired with audit" rule. now is a clock seam (use time.Now in
// production); the window is RecentWindow.
func RequireAuditPair(q Querier, now func() time.Time) func(context.Context, *nostr.Event) (bool, string) {
	if now == nil {
		now = time.Now
	}
	return func(ctx context.Context, evt *nostr.Event) (bool, string) {
		if evt == nil {
			return false, ""
		}
		if _, ok := stateMutationKinds[evt.Kind]; !ok {
			return false, ""
		}
		groupID := groupTag(evt)
		if groupID == "" {
			// Mutations without a group reference cannot be audited.
			// Reject defensively; the legitimate flow always has either
			// `h` (39100/39101) or `d=group_id` (39000-39003).
			return true, ReasonAuditMissing
		}
		// Bootstrap exemption: the very first kind 39000 for a group has
		// no prior audit because the group itself doesn't exist yet (and
		// thus no actor is yet authoritative). Subsequent metadata
		// updates fall back to the normal audit-pair rule.
		if evt.Kind == 39000 && !hasPriorMetadata(ctx, q, groupID) {
			return false, ""
		}
		since := nostr.Timestamp(now().Add(-RecentWindow).Unix())
		until := nostr.Timestamp(now().Add(RecentWindow).Unix()) // tolerate small forward clock skew
		ch, err := q.QueryEvents(ctx, nostr.Filter{
			Kinds:   []int{AuditKind},
			Authors: []string{evt.PubKey},
			Tags:    nostr.TagMap{"h": []string{groupID}},
			Since:   &since,
			Until:   &until,
		})
		if err != nil {
			return true, ReasonAuditMissing
		}
		var found bool
		for a := range ch {
			if a == nil {
				continue
			}
			found = true
			// Drain so the goroutine in the backend can complete.
		}
		if !found {
			return true, ReasonAuditMissing
		}
		return false, ""
	}
}

// RejectAuditDeletes returns a RejectEvent hook that drops NIP-09 deletion
// events targeting kind 39250 audit entries. We check both the explicit
// hint (`["k","39250"]`) and any `e`-tagged event by looking it up.
func RejectAuditDeletes(q Querier) func(context.Context, *nostr.Event) (bool, string) {
	return func(ctx context.Context, evt *nostr.Event) (bool, string) {
		if evt == nil || evt.Kind != 5 {
			return false, ""
		}
		// Cheap path: explicit `k` hint per NIP-09.
		for _, t := range evt.Tags {
			if len(t) >= 2 && t[0] == "k" {
				if k, err := strconv.Atoi(t[1]); err == nil && k == AuditKind {
					return true, ReasonAuditUndelet
				}
			}
		}
		// Expensive path: resolve each `e` tag and check kind. Bounded by
		// the number of e-tags on the delete (typically 1).
		for _, t := range evt.Tags {
			if len(t) < 2 || t[0] != "e" {
				continue
			}
			ch, err := q.QueryEvents(ctx, nostr.Filter{IDs: []string{t[1]}})
			if err != nil {
				continue
			}
			for found := range ch {
				if found != nil && found.Kind == AuditKind {
					// Drain remainder before returning to avoid leaking
					// the backend goroutine.
					go func() {
						for range ch {
						}
					}()
					return true, ReasonAuditUndelet
				}
			}
		}
		return false, ""
	}
}

// hasPriorMetadata reports whether storage already holds a kind 39000 for
// groupID. Used to distinguish bootstrap (allowed without audit) from
// normal updates (require audit). Failures fall back to "yes" so a flaky
// query doesn't accidentally widen the bootstrap window.
func hasPriorMetadata(ctx context.Context, q Querier, groupID string) bool {
	ch, err := q.QueryEvents(ctx, nostr.Filter{
		Kinds: []int{39000},
		Tags:  nostr.TagMap{"d": []string{groupID}},
	})
	if err != nil {
		return true
	}
	for ev := range ch {
		if ev != nil {
			return true
		}
	}
	return false
}

// groupTag returns the group id for a state mutation. NIP-29 admin kinds
// (39000-39003) carry only `d=<group_id>`; channel/category kinds
// (39100/39101) carry `h=<group_id>` plus `d=<channel_id>`.
func groupTag(evt *nostr.Event) string {
	switch evt.Kind {
	case 39100, 39101:
		return tagValue(evt, "h")
	default:
		return tagValue(evt, "d")
	}
}

func tagValue(evt *nostr.Event, name string) string {
	for _, t := range evt.Tags {
		if len(t) >= 2 && t[0] == name {
			return t[1]
		}
	}
	return ""
}
