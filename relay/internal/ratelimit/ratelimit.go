// Package ratelimit enforces per-pubkey publish rate limits for the
// Nostrdome relay (§1.2.6). The limiter applies in RejectEvent AFTER auth,
// membership, and per-channel ACL: there is no point counting events that
// would have been rejected for stronger reasons anyway.
//
// The limiter is a pair of token buckets per pubkey (minute + hour). An
// event is admitted only when both buckets have budget. Buckets refill
// continuously at capacity/window so a steady-state publisher at the
// minute rate can sustain it indefinitely without bumping the hour cap.
//
// Privileged pubkeys (group owner or any role with a manage_* permission,
// per groupstate.IsPrivileged) bypass the limiter entirely — admins
// publishing role rotations or channel updates in bursts must not be
// throttled.
package ratelimit

import (
	"context"
	"sync"
	"time"

	"github.com/nbd-wtf/go-nostr"
)

// Reason is the prefix the relay returns to clients on a throttled OK.
// Per NIP-01 the prefix `rate-limited:` is well-known.
const Reason = "rate-limited: too many events, slow down"

// PrivilegeChecker is the slice of *groupstate.State the limiter needs.
// Defined as an interface to keep the package decoupled and testable.
type PrivilegeChecker interface {
	IsPrivileged(pubkey string) bool
}

// Config controls the limiter. PerMinute / PerHour are capacities; they
// must both be positive. Zero or negative values disable the corresponding
// window (useful for tests).
type Config struct {
	PerMinute int
	PerHour   int
}

type bucket struct {
	tokens   float64
	capacity float64
	rate     float64 // tokens per second
	last     time.Time
}

func newBucket(capacity float64, window time.Duration) *bucket {
	if capacity <= 0 || window <= 0 {
		return nil
	}
	return &bucket{
		tokens:   capacity,
		capacity: capacity,
		rate:     capacity / window.Seconds(),
	}
}

// take refills based on elapsed wall time and returns whether one token
// could be consumed. Caller must hold the entry mutex.
func (b *bucket) take(now time.Time) bool {
	if b == nil {
		return true
	}
	if b.last.IsZero() {
		b.last = now
	}
	elapsed := now.Sub(b.last).Seconds()
	if elapsed > 0 {
		b.tokens += elapsed * b.rate
		if b.tokens > b.capacity {
			b.tokens = b.capacity
		}
		b.last = now
	}
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

type entry struct {
	mu       sync.Mutex
	minute   *bucket
	hour     *bucket
	lastSeen time.Time
}

// Limiter holds per-pubkey buckets. The zero value is not usable; use New.
type Limiter struct {
	cfg     Config
	priv    PrivilegeChecker
	now     func() time.Time
	mu      sync.Mutex
	entries map[string]*entry
}

// New constructs a Limiter. priv may be nil (no bypass) but typically is
// the *groupstate.State.
func New(cfg Config, priv PrivilegeChecker) *Limiter {
	return &Limiter{
		cfg:     cfg,
		priv:    priv,
		now:     time.Now,
		entries: map[string]*entry{},
	}
}

// withClock is a test seam to control "now" deterministically.
func (l *Limiter) withClock(now func() time.Time) *Limiter {
	l.now = now
	return l
}

func (l *Limiter) entryFor(pubkey string) *entry {
	l.mu.Lock()
	defer l.mu.Unlock()
	e := l.entries[pubkey]
	if e == nil {
		e = &entry{
			minute: newBucket(float64(l.cfg.PerMinute), time.Minute),
			hour:   newBucket(float64(l.cfg.PerHour), time.Hour),
		}
		l.entries[pubkey] = e
	}
	return e
}

// Allow consumes a token for pubkey if both windows have budget.
// Privileged pubkeys always pass without touching their buckets.
func (l *Limiter) Allow(pubkey string) bool {
	if l.priv != nil && l.priv.IsPrivileged(pubkey) {
		return true
	}
	e := l.entryFor(pubkey)
	e.mu.Lock()
	defer e.mu.Unlock()
	now := l.now()
	e.lastSeen = now
	// Both windows must admit. Take from both atomically — if either
	// rejects we don't decrement either, so a single denial doesn't
	// slowly drain the other bucket.
	if e.minute != nil && !canTake(e.minute, now) {
		return false
	}
	if e.hour != nil && !canTake(e.hour, now) {
		return false
	}
	if e.minute != nil {
		e.minute.take(now)
	}
	if e.hour != nil {
		e.hour.take(now)
	}
	return true
}

// canTake returns whether a take would succeed at `now` WITHOUT mutating
// the bucket beyond the refill (refill is idempotent given monotonic now).
func canTake(b *bucket, now time.Time) bool {
	if b == nil {
		return true
	}
	if b.last.IsZero() {
		b.last = now
	}
	elapsed := now.Sub(b.last).Seconds()
	if elapsed > 0 {
		b.tokens += elapsed * b.rate
		if b.tokens > b.capacity {
			b.tokens = b.capacity
		}
		b.last = now
	}
	return b.tokens >= 1
}

// Reject returns a khatru-shaped RejectEvent hook backed by this limiter.
// kind 22242 (NIP-42 AUTH) is whitelisted: AUTH is the very mechanism by
// which evt.PubKey becomes trustworthy and the relay normally sees one
// per connection — no point throttling it.
//
// Order: install AFTER auth, membership, and the channel ACL hook.
func (l *Limiter) Reject() func(context.Context, *nostr.Event) (bool, string) {
	return func(_ context.Context, evt *nostr.Event) (bool, string) {
		if evt == nil {
			return false, ""
		}
		if evt.Kind == nostr.KindClientAuthentication {
			return false, ""
		}
		if l.Allow(evt.PubKey) {
			return false, ""
		}
		return true, Reason
	}
}
