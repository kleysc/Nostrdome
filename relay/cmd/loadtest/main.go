// Command loadtest seeds N synthetic members into a NIP-29 group and
// drives chat traffic against a running nostrdome-relay.
//
// Use this for §1.8.3 (sidebar virtualization at 500 members + chat
// throughput sustained 1 msg/s/client). It's not a benchmark — there's
// no comparison against a baseline — it's a regression smoke before the
// staging gate.
//
// Usage:
//
//	loadtest \
//	  --relay wss://staging.example.com/relay \
//	  --owner-sk <hex> \
//	  --group mycommunity \
//	  --members 500 \
//	  --duration 5m \
//	  --rate 1
//
// The owner-sk MUST already have published kind 39000 (group bootstrap).
// loadtest then publishes 39250 audit + 39002 members in batches, opens
// a connection per synthetic key, AUTHs, and starts driving chat.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math/rand"
	"os"
	"os/signal"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/nbd-wtf/go-nostr"
)

type member struct {
	sk string
	pk string
}

func main() {
	relayURL := flag.String("relay", "ws://localhost:7777", "relay websocket URL")
	ownerSK := flag.String("owner-sk", "", "owner secret key (hex)")
	groupID := flag.String("group", "loadtest", "group id (must be bootstrapped already)")
	channelID := flag.String("channel", "general", "channel id (must already exist)")
	members := flag.Int("members", 500, "number of synthetic members to create")
	batch := flag.Int("batch", 100, "members per kind 39002 publish")
	duration := flag.Duration("duration", 5*time.Minute, "chat phase duration")
	rate := flag.Float64("rate", 1.0, "messages per second per client")
	flag.Parse()

	if *ownerSK == "" {
		log.Fatal("--owner-sk is required")
	}
	if *members < 1 {
		log.Fatal("--members must be > 0")
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	ownerPK, err := nostr.GetPublicKey(*ownerSK)
	if err != nil {
		log.Fatalf("owner pubkey: %v", err)
	}
	log.Printf("owner pubkey: %s", ownerPK)

	// 1. Generate synthetic members.
	log.Printf("generating %d synthetic keypairs", *members)
	mems := make([]member, *members)
	for i := range mems {
		sk := nostr.GeneratePrivateKey()
		pk, err := nostr.GetPublicKey(sk)
		if err != nil {
			log.Fatalf("derive pk %d: %v", i, err)
		}
		mems[i] = member{sk: sk, pk: pk}
	}

	// 2. Connect as owner, AUTH, and seed members in batches. Each batch
	//    is a 39250 audit + 39002 publish to satisfy §1.2.8.
	owner := connectAndAuth(ctx, *relayURL, *ownerSK)
	defer owner.Close()
	log.Printf("seeding %d members in batches of %d", *members, *batch)
	for start := 0; start < *members; start += *batch {
		end := min(start+*batch, *members)
		seedBatch(ctx, owner, *ownerSK, ownerPK, *groupID, mems[start:end], start, end)
	}
	log.Printf("seeded all members")

	// 3. Connect each synthetic member, AUTH, and drive chat.
	chatPhase(ctx, *relayURL, *groupID, *channelID, mems, *duration, *rate)
}

func connectAndAuth(ctx context.Context, url, sk string) *nostr.Relay {
	r, err := nostr.RelayConnect(ctx, url)
	if err != nil {
		log.Fatalf("connect %s: %v", url, err)
	}
	// Wait for the AUTH challenge envelope to land before calling r.Auth —
	// same workaround the spike + integration tests use.
	time.Sleep(150 * time.Millisecond)
	authCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := r.Auth(authCtx, func(e *nostr.Event) error { return e.Sign(sk) }); err != nil {
		log.Fatalf("auth: %v", err)
	}
	return r
}

func seedBatch(ctx context.Context, owner *nostr.Relay, ownerSK, ownerPK, groupID string, batch []member, start, end int) {
	// Audit first per §1.2.8.
	publishOrDie(ctx, owner, mustSign(ownerSK, &nostr.Event{
		Kind:      39250,
		CreatedAt: nostr.Now(),
		Content:   `{"action":"role_assign","note":"loadtest seed"}`,
		Tags: nostr.Tags{
			{"h", groupID},
			{"action", "role_assign"},
		},
	}))

	type m struct {
		Pubkey   string   `json:"pubkey"`
		RoleIDs  []string `json:"role_ids"`
		JoinedAt int64    `json:"joined_at"`
	}
	out := make([]m, 0, len(batch)+1)
	// Owner first so it stays in the membership; kind 39002 is replace-
	// the-whole-list semantics.
	out = append(out, m{Pubkey: ownerPK, RoleIDs: []string{"Staff"}, JoinedAt: 1})
	for i, b := range batch {
		out = append(out, m{Pubkey: b.pk, RoleIDs: []string{"everyone"}, JoinedAt: int64(start + i + 2)})
	}
	body, _ := json.Marshal(map[string]any{"members": out})
	publishOrDie(ctx, owner, mustSign(ownerSK, &nostr.Event{
		Kind:      39002,
		CreatedAt: nostr.Now(),
		Content:   string(body),
		Tags:      nostr.Tags{{"d", groupID}},
	}))
	log.Printf("seeded members [%d, %d)", start, end)
}

func chatPhase(parent context.Context, url, groupID, channelID string, mems []member, duration time.Duration, ratePerSec float64) {
	ctx, cancel := context.WithTimeout(parent, duration)
	defer cancel()

	var wg sync.WaitGroup
	var sent atomic.Int64
	var failed atomic.Int64

	for i := range mems {
		wg.Add(1)
		go func(idx int, sk, pk string) {
			defer wg.Done()
			r, err := nostr.RelayConnect(ctx, url)
			if err != nil {
				failed.Add(1)
				return
			}
			defer r.Close()
			time.Sleep(150 * time.Millisecond)
			authCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
			err = r.Auth(authCtx, func(e *nostr.Event) error { return e.Sign(sk) })
			cancel()
			if err != nil {
				failed.Add(1)
				return
			}
			interval := time.Duration(float64(time.Second) / ratePerSec)
			// Stagger start within the first second to avoid a thundering herd.
			time.Sleep(time.Duration(rand.Int63n(int64(time.Second))))
			tick := time.NewTicker(interval)
			defer tick.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-tick.C:
					evt := mustSign(sk, &nostr.Event{
						Kind:      39200,
						CreatedAt: nostr.Now(),
						Content:   fmt.Sprintf("synthetic message from %d-%s", idx, pk[:8]),
						Tags: nostr.Tags{
							{"h", groupID},
							{"e", channelID},
						},
					})
					pubCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
					if err := r.Publish(pubCtx, *evt); err != nil {
						failed.Add(1)
					} else {
						sent.Add(1)
					}
					cancel()
				}
			}
		}(i, mems[i].sk, mems[i].pk)
	}

	// Reporter every 5s.
	repTick := time.NewTicker(5 * time.Second)
	defer repTick.Stop()
	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case <-repTick.C:
				log.Printf("[chat] sent=%d failed=%d", sent.Load(), failed.Load())
			}
		}
	}()

	wg.Wait()
	log.Printf("[chat] FINAL sent=%d failed=%d", sent.Load(), failed.Load())
}

func mustSign(sk string, e *nostr.Event) *nostr.Event {
	pk, err := nostr.GetPublicKey(sk)
	if err != nil {
		log.Fatalf("derive pk: %v", err)
	}
	e.PubKey = pk
	if err := e.Sign(sk); err != nil {
		log.Fatalf("sign kind %d: %v", e.Kind, err)
	}
	return e
}

func publishOrDie(ctx context.Context, r *nostr.Relay, e *nostr.Event) {
	pubCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := r.Publish(pubCtx, *e); err != nil {
		log.Fatalf("publish kind %d: %v", e.Kind, err)
	}
}
