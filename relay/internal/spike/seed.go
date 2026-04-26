package spike

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/nbd-wtf/go-nostr"
)

// SeedConfig describes what structure to publish at boot.
type SeedConfig struct {
	GroupID      string
	OwnerSK      string
	OwnerName    string
	OwnerPicture string
	GroupName    string
	GroupAbout   string
	GroupPicture string
	Members      []SeedMember // includes owner if you want them in the member list
	Roles        []SeedRole
	Categories   []SeedCategory
	Channels     []SeedChannel
}

type SeedMember struct {
	Pubkey            string
	RoleIDs           []string
	DisplayOverride   string
	JoinedAt          int64
}

type SeedRole struct {
	ID, Name, Color, Badge string
	Permissions            []string
	Priority               int
}

type SeedCategory struct {
	ID, Name string
	Position int
}

type SeedChannel struct {
	ID, Name, CategoryID, Type, Topic string
	Position                          int
	WriteRoles, ReadRoles             []string
}

// PublishSeed signs and stores kind 39000-39101 events that describe the
// community. Subscribers (clients) see these as if the owner had published
// them. Used only by the spike binary; F1 §1.2 will reconstruct this state
// from real published events.
func PublishSeed(ctx context.Context, cfg SeedConfig, save func(context.Context, *nostr.Event) error) error {
	ownerPK, err := nostr.GetPublicKey(cfg.OwnerSK)
	if err != nil {
		return fmt.Errorf("derive owner pubkey: %w", err)
	}

	now := nostr.Now()
	type kinded struct {
		kind    int
		dTag    string
		hTag    bool // include h tag for non-replaceable scoping
		content any
	}

	items := []kinded{
		// kind 39000 group_metadata
		{39000, cfg.GroupID, false, map[string]any{
			"name":         cfg.GroupName,
			"picture":      cfg.GroupPicture,
			"about":        cfg.GroupAbout,
			"owner_pubkey": ownerPK,
		}},
		// kind 39001 group_admins (owner with everything)
		{39001, cfg.GroupID, false, map[string]any{
			"admins": []map[string]any{{
				"pubkey":      ownerPK,
				"permissions": []string{"manage_metadata", "manage_channels", "manage_roles", "kick", "ban", "view_audit_log", "manage_voice", "manage_files"},
			}},
		}},
		// kind 39003 group_roles
		{39003, cfg.GroupID, false, map[string]any{
			"roles": cfg.Roles,
		}},
		// kind 39002 group_members
		{39002, cfg.GroupID, false, map[string]any{
			"members": cfg.Members,
		}},
	}
	// One event per category (kind 39101) and per channel (kind 39100); each
	// is parameterized by its own d-tag and scoped to the group via h-tag.
	for _, c := range cfg.Categories {
		items = append(items, kinded{39101, c.ID, true, map[string]any{
			"name":     c.Name,
			"position": c.Position,
		}})
	}
	for _, ch := range cfg.Channels {
		items = append(items, kinded{39100, ch.ID, true, map[string]any{
			"name":        ch.Name,
			"category_id": ch.CategoryID,
			"type":        ch.Type,
			"topic":       ch.Topic,
			"position":    ch.Position,
			"write_roles": ch.WriteRoles,
			"read_roles":  ch.ReadRoles,
		}})
	}

	for _, it := range items {
		body, err := json.Marshal(it.content)
		if err != nil {
			return err
		}
		evt := &nostr.Event{
			PubKey:    ownerPK,
			CreatedAt: now,
			Kind:      it.kind,
			Tags:      nostr.Tags{nostr.Tag{"d", it.dTag}},
			Content:   string(body),
		}
		if it.hTag {
			evt.Tags = append(evt.Tags, nostr.Tag{"h", cfg.GroupID})
		}
		if err := evt.Sign(cfg.OwnerSK); err != nil {
			return fmt.Errorf("sign kind %d: %w", it.kind, err)
		}
		if err := save(ctx, evt); err != nil {
			return fmt.Errorf("save kind %d: %w", it.kind, err)
		}
	}
	return nil
}
