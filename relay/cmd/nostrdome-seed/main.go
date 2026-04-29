// Command nostrdome-seed publishes the initial community-state events
// (kinds 39000-39003 + a default category 39101 + a default channel 39100)
// to a running nostrdome-relay over the websocket protocol.
//
// Use cases:
//   - dev smoke testing: fill an empty relay with a throwaway community.
//   - bundle install.sh: bootstrap a fresh self-hosted instance with the
//     operator's chosen name + their pubkey as owner.
//
// The seeder authenticates over NIP-42 with the seeding keypair (which
// becomes the owner unless --owner-pubkey is overridden). Everything is
// signed and published over ws — no direct DB writes — so this works
// against any nostrdome-relay regardless of where its SQLite file lives.
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/nip19"
)

func main() {
	relayURL := flag.String("relay", "ws://localhost:7780", "ws/wss URL of the target relay")
	groupID := flag.String("group", "spike-group", "NIP-29 group id (also the d-tag of 39000-39003)")
	name := flag.String("name", "Spike Group", "human-readable community name (kind 39000)")
	about := flag.String("about", "Local dev community.", "community description (kind 39000)")
	picture := flag.String("picture", "", "optional avatar URL (kind 39000)")
	nsecFlag := flag.String("nsec", "", "owner nsec (bech32 or hex). If empty a fresh keypair is generated and printed.")
	ownerPubkeyFlag := flag.String("owner-pubkey", "", "override owner pubkey in 39000 (default: derived from nsec)")
	flag.Parse()

	priv, pub := mustResolveKeypair(*nsecFlag)
	if *nsecFlag == "" {
		// Print the freshly-generated key BEFORE doing anything else so a
		// network failure doesn't leave the operator without their nsec.
		nsec, _ := nip19.EncodePrivateKey(priv)
		npub, _ := nip19.EncodePublicKey(pub)
		fmt.Println("=== generated owner keypair ===")
		fmt.Println("nsec:", nsec)
		fmt.Println("npub:", npub)
		fmt.Println("================================")
	}
	owner := pub
	if *ownerPubkeyFlag != "" {
		owner = *ownerPubkeyFlag
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	r, err := nostr.RelayConnect(ctx, *relayURL)
	if err != nil {
		log.Fatalf("connect %s: %v", *relayURL, err)
	}
	defer r.Close()

	// NIP-42 AUTH. The relay pushes the challenge from OnConnect (see
	// internal/auth.IssueOnConnect) but the envelope arrives async; if we
	// call r.Auth() before the challenge handler fires, go-nostr returns
	// "failed to authenticate" because there's no challenge cached yet.
	// Same workaround the integration tests use — a short warmup after
	// connect is enough for any localhost or LAN relay.
	time.Sleep(150 * time.Millisecond)
	if err := r.Auth(ctx, func(authEvt *nostr.Event) error {
		return authEvt.Sign(priv)
	}); err != nil {
		log.Fatalf("auth: %v", err)
	}

	now := nostr.Now()
	publish := func(kind int, content string, tags nostr.Tags, label string) {
		evt := &nostr.Event{Kind: kind, CreatedAt: now, Tags: tags, Content: content}
		if err := evt.Sign(priv); err != nil {
			log.Fatalf("sign %s: %v", label, err)
		}
		if err := r.Publish(ctx, *evt); err != nil {
			log.Fatalf("publish %s: %v", label, err)
		}
		fmt.Printf("✓ %-12s kind=%d id=%s\n", label, kind, evt.ID[:12])
	}

	// Per §1.2.8 the relay rejects state mutations not preceded by a
	// matching kind 39250 (audit) from the same actor + same group within
	// RecentWindow. Publish that audit BEFORE every state-defining event
	// (39000-39003, 39100, 39101) so the seed mirrors what real admin
	// clients (MemberPanel kick, CreateChannelModal, …) already do.
	//
	// The first 39000 is bootstrap-exempt at the relay (no group exists
	// yet to audit against), so we don't pre-pair it. Every subsequent
	// mutation needs the pair.
	auditPair := func(action, target string) {
		publish(39250,
			fmt.Sprintf(`{"action":%q,"target":%q}`, action, target),
			nostr.Tags{{"h", *groupID}, {"action", action}, {"target", target}},
			"audit:"+action,
		)
	}

	// kind 39000 — group_metadata.
	publish(39000,
		fmt.Sprintf(`{"name":%q,"about":%q,"picture":%q,"owner_pubkey":%q}`, *name, *about, *picture, owner),
		nostr.Tags{{"d", *groupID}},
		"metadata",
	)

	// kind 39001 — group_admins. Owner is admin-by-virtue-of-ownership;
	// listing them here too keeps clients that rely solely on 39001 happy.
	auditPair("admin_add", owner)
	publish(39001,
		fmt.Sprintf(`{"admins":[{"pubkey":%q,"permissions":["manage_channels","manage_roles","kick","ban","manage_community"]}]}`, owner),
		nostr.Tags{{"d", *groupID}},
		"admins",
	)

	// kind 39003 — group_roles. Single "owner" role with all manage perms;
	// the client surfaces every gate based on these (see community-types.ts).
	// Roles must precede members so the membership references known role ids.
	auditPair("role_change", "owner")
	publish(39003,
		`{"roles":[{"id":"owner","name":"Owner","color":"#FF8A00","badge":"★","priority":1000,"permissions":["manage_channels","manage_roles","kick","ban","manage_community"]}]}`,
		nostr.Tags{{"d", *groupID}},
		"roles",
	)

	// kind 39002 — group_members. Owner joins as the first member.
	auditPair("invite", owner)
	publish(39002,
		fmt.Sprintf(`{"members":[{"pubkey":%q,"role_ids":["owner"],"joined_at":%d}]}`, owner, int64(now)),
		nostr.Tags{{"d", *groupID}},
		"members",
	)

	// kind 39101 — default category "General".
	auditPair("category_create", "general")
	publish(39101,
		`{"name":"General","position":0}`,
		nostr.Tags{{"d", "general"}, {"h", *groupID}},
		"category",
	)

	// kind 39100 — default text channel #general inside the General category.
	// read_roles=["everyone"] makes it publicly readable to any member;
	// write_roles=["everyone"] lets any member post (we'll restrict via
	// per-channel ACL in §1.2.5).
	auditPair("channel_create", "general")
	publish(39100,
		`{"name":"general","category_id":"general","type":"text","topic":"Welcome!","position":0,"read_roles":["everyone"],"write_roles":["everyone"]}`,
		nostr.Tags{{"d", "general"}, {"h", *groupID}},
		"channel",
	)

	fmt.Printf("\nseeded group %q on %s\n", *groupID, *relayURL)
}

// mustResolveKeypair returns (privHex, pubHex). If `arg` is empty, a fresh
// keypair is generated. Accepts both bech32 ("nsec1…") and raw hex.
func mustResolveKeypair(arg string) (string, string) {
	if arg == "" {
		priv := nostr.GeneratePrivateKey()
		pub, err := nostr.GetPublicKey(priv)
		if err != nil {
			fmt.Fprintln(os.Stderr, "derive pubkey:", err)
			os.Exit(2)
		}
		return priv, pub
	}
	priv := arg
	if len(arg) > 4 && arg[:4] == "nsec" {
		_, decoded, err := nip19.Decode(arg)
		if err != nil {
			fmt.Fprintln(os.Stderr, "decode nsec:", err)
			os.Exit(2)
		}
		priv = decoded.(string)
	}
	pub, err := nostr.GetPublicKey(priv)
	if err != nil {
		fmt.Fprintln(os.Stderr, "derive pubkey:", err)
		os.Exit(2)
	}
	return priv, pub
}
