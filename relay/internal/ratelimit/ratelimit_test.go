package ratelimit

import (
	"context"
	"testing"
	"time"

	"github.com/nbd-wtf/go-nostr"
)

const (
	pubAlice = "aaaa11111111111111111111111111111111111111111111111111111111aaaa"
	pubBob   = "bbbb22222222222222222222222222222222222222222222222222222222bbbb"
)

type fakePriv struct {
	privileged map[string]bool
}

func (f *fakePriv) IsPrivileged(pk string) bool { return f.privileged[pk] }

func newClock(t time.Time) (func() time.Time, *time.Time) {
	cur := t
	return func() time.Time { return cur }, &cur
}

func TestAllow_WithinMinuteCap(t *testing.T) {
	t0 := time.Unix(1700_000_000, 0)
	clock, _ := newClock(t0)
	l := New(Config{PerMinute: 3, PerHour: 100}, nil).withClock(clock)
	for i := 0; i < 3; i++ {
		if !l.Allow(pubAlice) {
			t.Fatalf("call %d should pass under cap", i)
		}
	}
	if l.Allow(pubAlice) {
		t.Fatalf("4th call within same minute should be rate-limited")
	}
}

func TestAllow_RefillsOverTime(t *testing.T) {
	t0 := time.Unix(1700_000_000, 0)
	cur := t0
	l := New(Config{PerMinute: 3, PerHour: 100}, nil).withClock(func() time.Time { return cur })
	for i := 0; i < 3; i++ {
		if !l.Allow(pubAlice) {
			t.Fatalf("burst call %d should pass", i)
		}
	}
	if l.Allow(pubAlice) {
		t.Fatalf("burst exhaust should reject before refill")
	}
	// 30s later: at 3/min refill rate (0.05/s) we get +1.5 tokens → 1 floor.
	cur = t0.Add(30 * time.Second)
	if !l.Allow(pubAlice) {
		t.Fatalf("after refill, 1 token should be available")
	}
}

func TestAllow_PerHourBlocksEvenWithMinuteBudget(t *testing.T) {
	// Hour cap is the binding constraint: a generous minute budget must
	// not bypass an exhausted hour bucket.
	t0 := time.Unix(1700_000_000, 0)
	cur := t0
	l := New(Config{PerMinute: 1000, PerHour: 2}, nil).withClock(func() time.Time { return cur })
	if !l.Allow(pubAlice) {
		t.Fatalf("1st call must pass")
	}
	if !l.Allow(pubAlice) {
		t.Fatalf("2nd call must pass")
	}
	if l.Allow(pubAlice) {
		t.Fatalf("3rd call must hit hour cap")
	}
}

func TestAllow_DisabledWindowMeansUnboundedThatWindow(t *testing.T) {
	// PerHour=0 disables the hour window so only the minute cap applies.
	// Useful for tests and for operators who want a single-window limiter.
	t0 := time.Unix(1700_000_000, 0)
	clock, _ := newClock(t0)
	l := New(Config{PerMinute: 2, PerHour: 0}, nil).withClock(clock)
	if !l.Allow(pubAlice) || !l.Allow(pubAlice) {
		t.Fatalf("first 2 calls must pass")
	}
	if l.Allow(pubAlice) {
		t.Fatalf("3rd call must hit minute cap even with hour disabled")
	}
}

func TestAllow_PerPubkeyIsolation(t *testing.T) {
	t0 := time.Unix(1700_000_000, 0)
	clock, _ := newClock(t0)
	l := New(Config{PerMinute: 1, PerHour: 100}, nil).withClock(clock)
	if !l.Allow(pubAlice) || l.Allow(pubAlice) {
		t.Fatalf("alice burst sequence broken")
	}
	if !l.Allow(pubBob) {
		t.Fatalf("bob must not be affected by alice's quota")
	}
}

func TestAllow_PrivilegedBypass(t *testing.T) {
	t0 := time.Unix(1700_000_000, 0)
	clock, _ := newClock(t0)
	priv := &fakePriv{privileged: map[string]bool{pubAlice: true}}
	l := New(Config{PerMinute: 1, PerHour: 1}, priv).withClock(clock)
	for i := 0; i < 50; i++ {
		if !l.Allow(pubAlice) {
			t.Fatalf("privileged signer must never be throttled (call %d)", i)
		}
	}
	if !l.Allow(pubBob) {
		t.Fatalf("bob's first call must pass")
	}
	if l.Allow(pubBob) {
		t.Fatalf("bob's second call must reject — bypass is per pubkey, not global")
	}
}

func TestReject_AuthEventAlwaysAllowed(t *testing.T) {
	t0 := time.Unix(1700_000_000, 0)
	clock, _ := newClock(t0)
	l := New(Config{PerMinute: 1, PerHour: 1}, nil).withClock(clock)
	hook := l.Reject()
	// Burn the budget.
	if rejected, _ := hook(context.Background(), &nostr.Event{Kind: 39200, PubKey: pubAlice}); rejected {
		t.Fatalf("first call must pass")
	}
	// Subsequent kind 22242 must always pass.
	for i := 0; i < 5; i++ {
		evt := &nostr.Event{Kind: nostr.KindClientAuthentication, PubKey: pubAlice}
		if rejected, _ := hook(context.Background(), evt); rejected {
			t.Fatalf("AUTH event %d must never be rate-limited", i)
		}
	}
}

func TestReject_ReturnsKnownReason(t *testing.T) {
	t0 := time.Unix(1700_000_000, 0)
	clock, _ := newClock(t0)
	l := New(Config{PerMinute: 1, PerHour: 100}, nil).withClock(clock)
	hook := l.Reject()
	_, _ = hook(context.Background(), &nostr.Event{Kind: 39200, PubKey: pubAlice})
	rejected, reason := hook(context.Background(), &nostr.Event{Kind: 39200, PubKey: pubAlice})
	if !rejected {
		t.Fatalf("2nd call expected to be rejected")
	}
	if reason != Reason {
		t.Fatalf("reason = %q, want %q", reason, Reason)
	}
}
