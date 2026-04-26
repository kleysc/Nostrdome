// Spike binary for §1.1 + §1.4 demo.
//
// Runs a khatru relay with the Nostrdome plugin enabled. Bootstraps a sample
// community ("spike-group") with seeded categories, channels, and members,
// publishing kind 39000-39101 events so a client can subscribe and render
// the structure. Prints the keys involved so you can paste a member nsec
// into the client login.
//
// Not production. State is in-memory.
package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/fiatjaf/khatru"
	"github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/nip19"

	"github.com/nostrdome-platform/relay/internal/spike"
)

func main() {
	relay := khatru.NewRelay()
	relay.Info.Name = "nostrdome-spike"
	relay.Info.Description = "Spike binary — seeded community for §1.4 testing"
	relay.Info.SupportedNIPs = []any{1, 11, 29, 42, 50}

	events := spike.NewMemEvents()
	relay.StoreEvent = append(relay.StoreEvent, events.Save)
	relay.QueryEvents = append(relay.QueryEvents, events.Query)
	relay.DeleteEvent = append(relay.DeleteEvent, events.Delete)

	// Resolve owner key (provide via env or auto-generate so the binary
	// is one-shot runnable).
	ownerSK := os.Getenv("SPIKE_OWNER_NSEC")
	if ownerSK == "" {
		ownerSK = randomHex32()
		log.Printf("SPIKE_OWNER_NSEC not set, generated: %s", mustNsec(ownerSK))
	} else if strings.HasPrefix(ownerSK, "nsec1") {
		_, decoded, err := nip19.Decode(ownerSK)
		if err != nil {
			log.Fatalf("invalid SPIKE_OWNER_NSEC: %v", err)
		}
		ownerSK = decoded.(string)
	}
	ownerPK, err := nostr.GetPublicKey(ownerSK)
	if err != nil {
		log.Fatalf("derive owner pubkey: %v", err)
	}

	// Generate two sample member keys — printed for copy-paste into the client.
	aliceSK := randomHex32()
	alicePK, _ := nostr.GetPublicKey(aliceSK)
	bobSK := randomHex32()
	bobPK, _ := nostr.GetPublicKey(bobSK)

	// In-memory enforcement state mirrors what the seeded events publish.
	state := spike.NewGroupState("spike-group")
	state.SetOwner(ownerPK)
	state.AddMember(ownerPK, []string{"Staff"})
	state.AddMember(alicePK, []string{"everyone"})
	state.AddMember(bobPK, []string{"everyone"})
	state.AddChannel("chat-general", []string{"everyone"}, []string{"everyone"})
	state.AddChannel("staff-only", []string{"Staff"}, []string{"Staff"})
	state.AddChannel("recursos", []string{"everyone"}, []string{"everyone"})

	// Publish the same structure as kinds 39000-39101 so subscribers can
	// reconstruct the community state from the event log.
	now := time.Now().Unix()
	if err := spike.PublishSeed(context.Background(), spike.SeedConfig{
		GroupID:      "spike-group",
		OwnerSK:      ownerSK,
		GroupName:    "Spike Demo Community",
		GroupAbout:   "Comunidad de ejemplo seedeada por el binario spike. Solo para validar §1.4.",
		GroupPicture: "",
		Roles: []spike.SeedRole{
			{ID: "Staff", Name: "Staff", Color: "#ef4444", Badge: "🛡️", Permissions: []string{"manage_channels", "manage_roles", "kick", "ban", "view_audit_log"}, Priority: 100},
			{ID: "everyone", Name: "Everyone", Color: "#94a3b8", Badge: "", Permissions: []string{}, Priority: 10},
		},
		Members: []spike.SeedMember{
			{Pubkey: ownerPK, RoleIDs: []string{"Staff"}, DisplayOverride: "owner", JoinedAt: now},
			{Pubkey: alicePK, RoleIDs: []string{"everyone"}, DisplayOverride: "alice", JoinedAt: now},
			{Pubkey: bobPK, RoleIDs: []string{"everyone"}, DisplayOverride: "bob", JoinedAt: now},
		},
		Categories: []spike.SeedCategory{
			{ID: "cat-general", Name: "General", Position: 0},
			{ID: "cat-staff", Name: "Staff", Position: 1},
		},
		Channels: []spike.SeedChannel{
			{ID: "chat-general", Name: "chat-general", CategoryID: "cat-general", Type: "text", Topic: "Charla general", Position: 0, WriteRoles: []string{"everyone"}, ReadRoles: []string{"everyone"}},
			{ID: "recursos", Name: "recursos", CategoryID: "cat-general", Type: "text", Topic: "Material útil", Position: 1, WriteRoles: []string{"everyone"}, ReadRoles: []string{"everyone"}},
			{ID: "staff-only", Name: "staff-only", CategoryID: "cat-staff", Type: "text", Topic: "Coordinación staff", Position: 0, WriteRoles: []string{"Staff"}, ReadRoles: []string{"Staff"}},
		},
	}, events.Save); err != nil {
		log.Fatalf("seed structure: %v", err)
	}

	// ── Hooks ────────────────────────────────────────────────────────────
	relay.OnConnect = append(relay.OnConnect, spike.IssueAuthOnConnect)
	relay.RejectFilter = append(relay.RejectFilter, spike.RequireAuth)
	relay.RejectEvent = append(relay.RejectEvent,
		spike.RequireAuth4Event,
		spike.RequireHTag,
		spike.RequireMembership(state),
		spike.RequireChannelWriteRole(state),
	)

	addr := os.Getenv("SPIKE_ADDR")
	if addr == "" {
		addr = ":7780"
	}

	log.Printf("─────────────────────────────────────────────────────────")
	log.Printf("nostrdome-spike listening on ws://localhost%s", addr)
	log.Printf("Group: spike-group")
	log.Printf("Owner npub:  %s", mustNpub(ownerPK))
	log.Printf("Owner nsec:  %s", mustNsec(ownerSK))
	log.Printf("Alice npub:  %s", mustNpub(alicePK))
	log.Printf("Alice nsec:  %s   ← log in with this to test as a member", mustNsec(aliceSK))
	log.Printf("Bob   npub:  %s", mustNpub(bobPK))
	log.Printf("Bob   nsec:  %s", mustNsec(bobSK))
	log.Printf("─────────────────────────────────────────────────────────")
	if err := http.ListenAndServe(addr, relay); err != nil {
		log.Fatal(err)
	}
}

func randomHex32() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		log.Fatalf("randomness: %v", err)
	}
	return hex.EncodeToString(b)
}

func mustNpub(hex string) string {
	s, err := nip19.EncodePublicKey(hex)
	if err != nil {
		log.Fatalf("npub encode: %v", err)
	}
	return s
}

func mustNsec(hex string) string {
	s, err := nip19.EncodePrivateKey(hex)
	if err != nil {
		log.Fatalf("nsec encode: %v", err)
	}
	return s
}
