// Package search implements §1.2.7: NIP-50 substring search restricted to
// kind 39200 (group chat messages).
//
// We don't have a full-text index in F1 — the SQLite backend treats Content
// as opaque. Instead, when a filter carries a non-empty Search string, we:
//
//  1. Restrict the inner query to kind 39200 (any other kinds requested in
//     the same filter are dropped — search is an explicit narrowing op).
//  2. Run the resulting filter against the backend with Search cleared.
//  3. Forward only the events whose Content (lower-cased, fold space) contains
//     every whitespace-separated token of the Search string.
//
// This is O(matched events × tokens) per query, which is fine for F1's
// expected volume (one community, low thousands of messages). When that
// stops being true, swap the backend filter step for a real FTS index
// (sqlite FTS5) without changing this package's surface.
package search

import (
	"context"
	"strings"

	"github.com/nbd-wtf/go-nostr"
)

// SearchableKind is the only kind we serve search results for in F1. Other
// kinds (group state, presence, reactions) are not searchable through
// NIP-50 — clients use specific filters for those.
const SearchableKind = 39200

// QueryFn matches the storage.QueryFn shape; redeclared here to keep the
// package free of any storage import.
type QueryFn = func(ctx context.Context, filter nostr.Filter) (chan *nostr.Event, error)

// WithSearch wraps inner with NIP-50 awareness. Filters without a Search
// field are forwarded unchanged. Filters with Search are narrowed to kind
// 39200 and post-filtered by content substring match.
//
// The returned channel is owned by this function: it spawns a single
// goroutine that reads from inner's channel, applies the substring filter,
// writes matches to a new channel, and closes it when inner closes (or
// when the passed context cancels).
func WithSearch(inner QueryFn) QueryFn {
	return func(ctx context.Context, filter nostr.Filter) (chan *nostr.Event, error) {
		if filter.Search == "" {
			return inner(ctx, filter)
		}
		tokens := tokenize(filter.Search)
		// Narrow to chat. If the caller asked for other kinds and a search,
		// they implicitly opted into chat-only — clients that want broader
		// behavior should issue separate filters.
		narrowed := filter
		narrowed.Kinds = []int{SearchableKind}
		narrowed.Search = ""

		raw, err := inner(ctx, narrowed)
		if err != nil {
			return nil, err
		}
		out := make(chan *nostr.Event)
		go func() {
			defer close(out)
			for evt := range raw {
				if evt == nil {
					continue
				}
				if !matchesAll(evt.Content, tokens) {
					continue
				}
				select {
				case out <- evt:
				case <-ctx.Done():
					return
				}
			}
		}()
		return out, nil
	}
}

// tokenize splits the search query on whitespace and lowercases each
// non-empty fragment. Returning lowercase tokens lets the matcher avoid a
// per-event ToLower of the query.
func tokenize(q string) []string {
	fields := strings.Fields(q)
	if len(fields) == 0 {
		return nil
	}
	out := make([]string, 0, len(fields))
	for _, f := range fields {
		out = append(out, strings.ToLower(f))
	}
	return out
}

// matchesAll returns true when every token appears (case-insensitively) as
// a substring of content. Empty token list → match anything (defensive,
// shouldn't happen because WithSearch only takes this branch on non-empty
// filter.Search, but treating it as a no-op is safer than rejecting all).
func matchesAll(content string, tokens []string) bool {
	if len(tokens) == 0 {
		return true
	}
	lower := strings.ToLower(content)
	for _, tok := range tokens {
		if !strings.Contains(lower, tok) {
			return false
		}
	}
	return true
}
