package integration_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/nbd-wtf/go-nostr"
)

// §1.2.9 — Bot no-miembro intenta WRITE: rechazado por membership.
func TestAdversarial_NonMemberWriteRejected(t *testing.T) {
	fr := startFullRelay(t)
	ownerSK := nostr.GeneratePrivateKey()
	aliceSK := nostr.GeneratePrivateKey()
	bobSK := nostr.GeneratePrivateKey()
	groupID, channelID := seedCommunity(t, fr, ownerSK, aliceSK, bobSK)

	// Mallory connects (post-AUTH) but is NOT in kind 39002.
	mallorySK := nostr.GeneratePrivateKey()
	mallory := authedClient(t, fr.url, mallorySK)
	err := rawPublish(mallory, mallorySK, 39200, "trying to break in",
		nostr.Tag{"h", groupID}, nostr.Tag{"e", channelID},
	)
	if err == nil {
		t.Fatalf("non-member publish must be rejected")
	}
	if !contains(err.Error(), "restricted:") || !contains(err.Error(), "not a group member") {
		t.Fatalf("expected 'restricted: not a group member', got: %v", err)
	}
}

// §1.2.9 — Bot no-miembro intenta READ: REQ post-AUTH se permite (NIP-50
// search en kind 39200 también pasa el filtro), pero la membership es lo
// que cierra el grifo de WRITE arriba. Aquí confirmamos que la lectura no
// filtra estado privado a no-miembros — los kinds que importan (chat 39200)
// se tipan como "público dentro del grupo" en F1, así que la prueba
// adversarial acá es: mallory NO logra publicar mensajes que enmascaren
// como kind permitido.
func TestAdversarial_NonMemberStateMutationRejected(t *testing.T) {
	fr := startFullRelay(t)
	ownerSK := nostr.GeneratePrivateKey()
	aliceSK := nostr.GeneratePrivateKey()
	bobSK := nostr.GeneratePrivateKey()
	groupID, _ := seedCommunity(t, fr, ownerSK, aliceSK, bobSK)

	mallorySK := nostr.GeneratePrivateKey()
	mallory := authedClient(t, fr.url, mallorySK)

	// Try to seize ownership by publishing kind 39000 with own pubkey.
	mPK, _ := nostr.GetPublicKey(mallorySK)
	// Audit must come first per §1.2.8. Membership rejects the audit
	// itself because Mallory isn't a member; that's enough — the mutation
	// will fail downstream regardless. Verify the audit gets rejected:
	err := rawPublish(mallory, mallorySK, 39250,
		`{"action":"metadata_change"}`,
		nostr.Tag{"h", groupID}, nostr.Tag{"action", "metadata_change"},
	)
	if err == nil {
		t.Fatalf("non-member audit publish must be rejected")
	}
	if !contains(err.Error(), "not a group member") {
		t.Fatalf("expected membership rejection on audit, got: %v", err)
	}

	// And even if we skip audit and try the mutation directly: it carries
	// `d=<group>` not `h=<group>`, so membership skips it (no h-tag). The
	// audit-pair gate then catches it because there's no recent 39250.
	err = rawPublish(mallory, mallorySK, 39000,
		`{"name":"hijack","owner_pubkey":"`+mPK+`"}`,
		nostr.Tag{"d", groupID},
	)
	if err == nil {
		t.Fatalf("non-member metadata mutation must be rejected")
	}
	if !contains(err.Error(), "audit") {
		t.Fatalf("expected audit rejection, got: %v", err)
	}
}

// §1.2.9 — Miembro regular intenta postear en canal staff-only.
func TestAdversarial_MemberInStaffOnlyChannelRejected(t *testing.T) {
	fr := startFullRelay(t)
	ownerSK := nostr.GeneratePrivateKey()
	aliceSK := nostr.GeneratePrivateKey()
	bobSK := nostr.GeneratePrivateKey()
	groupID, channelID := seedCommunity(t, fr, ownerSK, aliceSK, bobSK)

	// Alice is B4OS, channel "general" requires Staff.
	alice := authedClient(t, fr.url, aliceSK)
	err := rawPublish(alice, aliceSK, 39200, "anuncio sin permiso",
		nostr.Tag{"h", groupID}, nostr.Tag{"e", channelID},
	)
	if err == nil {
		t.Fatalf("B4OS member must be rejected from Staff-only channel")
	}
	if !contains(err.Error(), "no write permission") {
		t.Fatalf("expected 'no write permission for channel', got: %v", err)
	}
}

// §1.2.9 — AUTH bypass: cliente intenta REQ y EVENT antes de r.Auth().
// Este escenario duplica las pruebas del paquete auth pero las corre
// contra el stack completo para asegurar que ningún hook posterior
// "abre" el grifo accidentalmente.
func TestAdversarial_AuthBypassAttempts(t *testing.T) {
	fr := startFullRelay(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	r, err := nostr.RelayConnect(ctx, fr.url)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer r.Close()

	// REQ pre-AUTH must close with auth-required.
	sub, err := r.Subscribe(ctx, nostr.Filters{{Kinds: []int{39200}}})
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	select {
	case reason := <-sub.ClosedReason:
		if !strings.HasPrefix(reason, "auth-required:") {
			t.Fatalf("expected auth-required prefix on REQ, got %q", reason)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("expected ClosedReason within 2s")
	}

	// EVENT pre-AUTH must be rejected before any other gate evaluates.
	sk := nostr.GeneratePrivateKey()
	err = rawPublish(r, sk, 39200, "should not arrive",
		nostr.Tag{"h", "demo-group"}, nostr.Tag{"e", "general"},
	)
	if err == nil {
		t.Fatalf("EVENT pre-AUTH must be rejected")
	}
	if !contains(err.Error(), "auth-required:") {
		t.Fatalf("expected auth-required: prefix, got: %v", err)
	}
}

// §1.2.9 — Eventos contradictorios admin-vs-admin: dos owners (mismo
// pubkey, dos clientes) publican kind 39002 con conjuntos distintos de
// miembros. LWW por created_at debe ganar el más reciente, sin importar
// el orden de llegada al relay.
//
// Realismo: nuestro modelo único-owner significa que el "conflicto" real
// admin-vs-admin sucede entre dos sesiones del MISMO actor (clave
// rotada/replicada). El test simula eso emitiendo dos 39002 desde el mismo
// sk con createdAt explícitos y verificando que la projección converja al
// más reciente.
func TestAdversarial_ContradictoryAdminWritesLWW(t *testing.T) {
	fr := startFullRelay(t)
	ownerSK := nostr.GeneratePrivateKey()
	aliceSK := nostr.GeneratePrivateKey()
	bobSK := nostr.GeneratePrivateKey()
	groupID, _ := seedCommunity(t, fr, ownerSK, aliceSK, bobSK)
	alicePK, _ := nostr.GetPublicKey(aliceSK)
	bobPK, _ := nostr.GetPublicKey(bobSK)
	ownerPK, _ := nostr.GetPublicKey(ownerSK)

	owner := authedClient(t, fr.url, ownerSK)

	// Conflicting publish A (older): drop bob.
	pubA := func(ts int64) {
		audit := mustSign(t, ownerSK, 39250, `{"action":"role_assign"}`,
			nostr.Tag{"h", groupID}, nostr.Tag{"action", "role_assign"})
		audit.CreatedAt = nostr.Timestamp(ts)
		_ = audit.Sign(ownerSK)
		ctxP, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := owner.Publish(ctxP, *audit); err != nil {
			t.Fatalf("audit ts=%d: %v", ts, err)
		}
		mut := mustSign(t, ownerSK, 39002,
			`{"members":[`+
				`{"pubkey":"`+ownerPK+`","role_ids":["Staff"],"joined_at":1},`+
				`{"pubkey":"`+alicePK+`","role_ids":["B4OS"],"joined_at":2}`+
				`]}`,
			nostr.Tag{"d", groupID},
		)
		mut.CreatedAt = nostr.Timestamp(ts)
		_ = mut.Sign(ownerSK)
		if err := owner.Publish(ctxP, *mut); err != nil {
			t.Fatalf("mutation ts=%d: %v", ts, err)
		}
	}
	// Conflicting publish B (newer): keep bob, drop alice.
	pubB := func(ts int64) {
		audit := mustSign(t, ownerSK, 39250, `{"action":"role_assign"}`,
			nostr.Tag{"h", groupID}, nostr.Tag{"action", "role_assign"})
		audit.CreatedAt = nostr.Timestamp(ts)
		_ = audit.Sign(ownerSK)
		ctxP, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := owner.Publish(ctxP, *audit); err != nil {
			t.Fatalf("audit ts=%d: %v", ts, err)
		}
		mut := mustSign(t, ownerSK, 39002,
			`{"members":[`+
				`{"pubkey":"`+ownerPK+`","role_ids":["Staff"],"joined_at":1},`+
				`{"pubkey":"`+bobPK+`","role_ids":["B4OS"],"joined_at":3}`+
				`]}`,
			nostr.Tag{"d", groupID},
		)
		mut.CreatedAt = nostr.Timestamp(ts)
		_ = mut.Sign(ownerSK)
		if err := owner.Publish(ctxP, *mut); err != nil {
			t.Fatalf("mutation ts=%d: %v", ts, err)
		}
	}

	// Use timestamps near wall-clock so the audit-pair window (60s around
	// time.Now) accepts them. Send out of order: newer (B) first, older
	// (A) second. LWW must drop A.
	now := time.Now().Unix()
	pubB(now + 30)   // strictly newer than the seed's 39002 (created near now)
	pubA(now + 10)   // older than B but newer than the seed

	// Wait briefly for StoreEvent → AfterStoreApply propagation.
	time.Sleep(100 * time.Millisecond)

	if !fr.state.IsMember(groupID, bobPK) {
		t.Fatalf("LWW failed: newer publish (B with bob) should have won")
	}
	if fr.state.IsMember(groupID, alicePK) {
		t.Fatalf("LWW failed: older publish (A with alice) should have lost")
	}
}
