package httpapi

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// TestActivatePetTagEndToEnd drives pet-tag activation (P3-t t-3) over a real Postgres: seed an nfc_tag
// order line + an ENCODED tag, then activate it as a signed-in customer. GetPetPage reflects the lifecycle
// (ENCODED → no profile; ACTIVATED → a minimal summary with NO owner PII). Activation attaches the owner,
// creates the profile (jsonb medical/contact), records the PDPL consent grant, and flips the tag ACTIVATED
// — all atomic. Re-activation → 409; unknown shortId → 404; missing consent / bad phone → 400; no session
// → 401. A second pet with the same name gets a distinct auto-suffixed handle.
func TestActivatePetTagEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()

	catID := seedCategory(t, ctx, pool)
	tagProduct := seedProductNamed(t, ctx, pool, catID, "pet-tag", "Pet Tag NFC", 390_000)
	if _, err := pool.Exec(ctx, `UPDATE products SET product_type='nfc_tag' WHERE id=$1`, tagProduct); err != nil {
		t.Fatalf("mark nfc_tag: %v", err)
	}
	orderID := seedAdminOrder(t, ctx, pool, adminOrderSeed{
		customer: "Nguyễn An", channel: order.ChannelWeb, createdAt: "2026-07-03T08:00:00Z",
		items: []db.NewOrderItem{{ProductID: tagProduct, Quantity: 1, UnitPrice: 390_000}},
	})
	item := orderItemID(t, ctx, pool, orderID, tagProduct)
	shortID := seedEncodedTag(t, ctx, pool, item, "petshortaaa")

	owner := seedCustomerRow(t, ctx, pool, "Mai Lê", "0905552261", nil, nil, []byte("[]"))
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)

	// --- Before activation: the public read shows ENCODED with no profile (data-minimized). ---
	pre := getPetPage(t, srv, ctx, shortID)
	if pre.Status != api.ENCODED || pre.Profile != nil {
		t.Fatalf("pre-activation page = %+v, want ENCODED + nil profile", pre)
	}

	// --- Activate as the signed-in owner. ---
	page := activatePetTag(t, srv, withCustomer(ctx, owner), shortID, validPetInput())
	if page.Status != api.ACTIVATED || page.Profile == nil {
		t.Fatalf("activate page = %+v, want ACTIVATED + profile", page)
	}
	if page.Profile.Handle == "" || page.Profile.PetName != "Bơ" || page.Profile.Species != api.Dog {
		t.Fatalf("activate profile summary = %+v, want handle + Bơ + dog", page.Profile)
	}
	firstHandle := page.Profile.Handle

	// DB: tag attached to the owner, ACTIVATED, activated_at stamped.
	var (
		status    string
		attached  uuid.UUID
		activated bool
	)
	if err := pool.QueryRow(ctx, `SELECT status, owner_account_id, activated_at IS NOT NULL FROM pet_tags WHERE short_id=$1`, shortID).
		Scan(&status, &attached, &activated); err != nil {
		t.Fatalf("read tag: %v", err)
	}
	if status != "ACTIVATED" || attached != owner || !activated {
		t.Fatalf("tag after activate: status=%s owner=%v activated=%v, want ACTIVATED/%v/true", status, attached, activated, owner)
	}
	// DB: the profile carries the jsonb contact + medical the onboarding collected.
	var phone, allergies string
	if err := pool.QueryRow(ctx, `SELECT owner_contact->>'phone', medical->>'allergies'
		FROM pet_profiles WHERE tag_id=(SELECT id FROM pet_tags WHERE short_id=$1) AND owner_account_id=$2`, shortID, owner).
		Scan(&phone, &allergies); err != nil {
		t.Fatalf("read profile: %v", err)
	}
	if phone != "0905552261" || allergies != "Dị ứng thịt gà" {
		t.Fatalf("profile jsonb = phone %q / allergies %q, want the onboarding values", phone, allergies)
	}
	// DB: PDPL consent point 1 — one active pet_profile/web grant for the owner (ADR-042).
	var consents int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM consent_grants
		WHERE customer_id=$1 AND scope='pet_profile' AND channel='web' AND withdrawn_at IS NULL`, owner).Scan(&consents); err != nil {
		t.Fatalf("read consent: %v", err)
	}
	if consents != 1 {
		t.Fatalf("pet_profile consent grants = %d, want 1", consents)
	}

	// --- Public read now shows the ACTIVATED page; an anonymous read reveals no full owner PII (masked
	// contact only — the 3 view-states + masking are exercised in TestPetPageLostModeAndMasking). ---
	post := getPetPage(t, srv, ctx, shortID)
	if post.Status != api.ACTIVATED || post.Profile == nil || post.Profile.Handle != firstHandle {
		t.Fatalf("post-activation page = %+v, want ACTIVATED + same handle", post)
	}

	// --- Reject paths. ---
	// Re-activating the same tag → 409 (already activated).
	if resp, _ := srv.ActivatePetTag(withCustomer(ctx, owner), api.ActivatePetTagRequestObject{ShortId: shortID, Body: ptrInput(validPetInput())}); !isActivate409(resp) {
		t.Fatalf("re-activate → %T, want 409", resp)
	}
	// Unknown shortId → 404 (db.ErrNotFound).
	if _, err := srv.ActivatePetTag(withCustomer(ctx, owner), api.ActivatePetTagRequestObject{ShortId: "does-not-exist", Body: ptrInput(validPetInput())}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("unknown shortId → err %v, want db.ErrNotFound (→ 404)", err)
	}
	// Missing consent → 400.
	noConsent := validPetInput()
	noConsent.Consent = false
	if resp, _ := srv.ActivatePetTag(withCustomer(ctx, owner), api.ActivatePetTagRequestObject{ShortId: shortID, Body: ptrInput(noConsent)}); !isActivate400(resp) {
		t.Fatalf("no consent → %T, want 400", resp)
	}
	// Bad phone → 400.
	badPhone := validPetInput()
	badPhone.OwnerContact.Phone = "not-a-phone"
	if resp, _ := srv.ActivatePetTag(withCustomer(ctx, owner), api.ActivatePetTagRequestObject{ShortId: shortID, Body: ptrInput(badPhone)}); !isActivate400(resp) {
		t.Fatalf("bad phone → %T, want 400", resp)
	}
	// No customer session → 401 (errUnauthenticated).
	if _, err := srv.ActivatePetTag(ctx, api.ActivatePetTagRequestObject{ShortId: shortID, Body: ptrInput(validPetInput())}); !errors.Is(err, errUnauthenticated) {
		t.Fatalf("no session → err %v, want errUnauthenticated (→ 401)", err)
	}

	// --- Handle collision: a SECOND tag activated with the same pet name gets a distinct handle. ---
	order2 := seedAdminOrder(t, ctx, pool, adminOrderSeed{
		customer: "Trần Bình", channel: order.ChannelWeb, createdAt: "2026-07-04T08:00:00Z",
		items: []db.NewOrderItem{{ProductID: tagProduct, Quantity: 1, UnitPrice: 390_000}},
	})
	item2 := orderItemID(t, ctx, pool, order2, tagProduct)
	shortID2 := seedEncodedTag(t, ctx, pool, item2, "petshortbbb")
	owner2 := seedCustomerRow(t, ctx, pool, "Trần Bình", "0912345678", nil, nil, []byte("[]"))
	page2 := activatePetTag(t, srv, withCustomer(ctx, owner2), shortID2, validPetInput())
	if page2.Profile.Handle == firstHandle {
		t.Fatalf("second same-named pet reused handle %q; want an auto-suffixed distinct handle", firstHandle)
	}
}

// seedEncodedTag inserts an ENCODED pet tag for an order line with a chosen short_id (the /t/{shortId}
// routing key), mirroring the state the t-2 encode step leaves. code is derived from the short_id to stay
// unique across calls.
func seedEncodedTag(t *testing.T, ctx context.Context, pool *pgxpool.Pool, orderItemID uuid.UUID, shortID string) string {
	t.Helper()
	if _, err := pool.Exec(ctx, `INSERT INTO pet_tags (id, code, short_id, order_item_id, status, chip_uid, encoded_at)
		VALUES ($1, $2, $3, $4, 'ENCODED', '04:A1:B2:C3', now())`,
		uuid.New(), "#LMN-T-"+shortID, shortID, orderItemID); err != nil {
		t.Fatalf("seed encoded tag %s: %v", shortID, err)
	}
	return shortID
}

// validPetInput is a complete, valid onboarding payload (Bơ the corgi) with jsonb contact + medical so the
// activation round-trip exercises the jsonb columns.
func validPetInput() api.PetActivateInput {
	zalo := "0905552261"
	allergies := "Dị ứng thịt gà"
	vaccinated := true
	return api.PetActivateInput{
		PetName:      "Bơ",
		Species:      api.Dog,
		OwnerContact: api.PetOwnerContact{Name: "Mai Lê", Phone: "0905552261", Zalo: &zalo},
		Medical:      &api.PetMedical{Allergies: &allergies, Vaccinated: &vaccinated},
		Consent:      true,
	}
}

func ptrInput(in api.PetActivateInput) *api.PetActivateInput { return &in }

func getPetPage(t *testing.T, srv *Server, ctx context.Context, shortID string) api.PetPage {
	t.Helper()
	resp, err := srv.GetPetPage(ctx, api.GetPetPageRequestObject{ShortId: shortID})
	if err != nil {
		t.Fatalf("GetPetPage(%s): %v", shortID, err)
	}
	ok, isOK := resp.(api.GetPetPage200JSONResponse)
	if !isOK {
		t.Fatalf("GetPetPage response = %T, want 200", resp)
	}
	return api.PetPage(ok)
}

func activatePetTag(t *testing.T, srv *Server, ctx context.Context, shortID string, in api.PetActivateInput) api.PetPage {
	t.Helper()
	resp, err := srv.ActivatePetTag(ctx, api.ActivatePetTagRequestObject{ShortId: shortID, Body: &in})
	if err != nil {
		t.Fatalf("ActivatePetTag(%s): %v", shortID, err)
	}
	ok, isOK := resp.(api.ActivatePetTag200JSONResponse)
	if !isOK {
		t.Fatalf("ActivatePetTag response = %T, want 200", resp)
	}
	return api.PetPage(ok)
}

func isActivate400(resp api.ActivatePetTagResponseObject) bool {
	_, ok := resp.(api.ActivatePetTag400JSONResponse)
	return ok
}

func isActivate409(resp api.ActivatePetTagResponseObject) bool {
	_, ok := resp.(api.ActivatePetTag409JSONResponse)
	return ok
}

// TestPetPageLostModeAndMasking drives the t-4a public pet page over a real Postgres: the 3 view-states
// (stranger-home / owner / stranger-lost) and the owner-only lost-mode toggle. The load-bearing assertions
// are PDPL: on an at-home page a stranger gets ONLY the masked phone (no callable value on the wire); on a
// lost page the full contact is revealed BUT the owner name is still withheld from finders; and the owner —
// recognised via the optional session — sees the full contact incl. their own name regardless of lost mode.
// The toggle is owner-only: a signed-in non-owner is 403, an unknown tag 404, no session 401, nil body 400.
func TestPetPageLostModeAndMasking(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()

	catID := seedCategory(t, ctx, pool)
	tagProduct := seedProductNamed(t, ctx, pool, catID, "pet-tag-view", "Pet Tag NFC", 390_000)
	if _, err := pool.Exec(ctx, `UPDATE products SET product_type='nfc_tag' WHERE id=$1`, tagProduct); err != nil {
		t.Fatalf("mark nfc_tag: %v", err)
	}
	orderID := seedAdminOrder(t, ctx, pool, adminOrderSeed{
		customer: "Mai Lê", channel: order.ChannelWeb, createdAt: "2026-07-05T08:00:00Z",
		items: []db.NewOrderItem{{ProductID: tagProduct, Quantity: 1, UnitPrice: 390_000}},
	})
	item := orderItemID(t, ctx, pool, orderID, tagProduct)
	shortID := seedEncodedTag(t, ctx, pool, item, "petviewaaa")
	owner := seedCustomerRow(t, ctx, pool, "Mai Lê", "0905552261", nil, nil, []byte("[]"))
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)

	// Activate so a profile exists (Bơ the corgi: phone 0905552261 + zalo + a chicken allergy).
	activatePetTag(t, srv, withCustomer(ctx, owner), shortID, validPetInput())

	// --- Stranger, at-home (lostMode=false): contact masked, NOTHING callable, but the allergy shows. ---
	stranger := getPetPage(t, srv, ctx, shortID)
	if stranger.ViewerIsOwner {
		t.Fatalf("anonymous read should not be recognised as owner")
	}
	sp := stranger.Profile
	if sp == nil || sp.LostMode || !sp.Contact.Masked || sp.Contact.Phone != nil || sp.Contact.Name != nil {
		t.Fatalf("stranger at-home page leaked contact / wrong lostMode: %+v", sp)
	}
	if sp.Contact.PhoneMasked != "+84 90 •••• 261" {
		t.Fatalf("stranger masked phone = %q, want the partial", sp.Contact.PhoneMasked)
	}
	if sp.Medical == nil || sp.Medical.Allergies == nil {
		t.Fatalf("allergy data missing from the stranger page (safety info is not PII)")
	}

	// --- Owner viewing (still at-home): recognised via the optional session, full contact incl. own name. ---
	ownerView := getPetPage(t, srv, withCustomer(ctx, owner), shortID)
	if !ownerView.ViewerIsOwner || ownerView.Profile.Contact.Masked ||
		ownerView.Profile.Contact.Phone == nil || ownerView.Profile.Contact.Name == nil {
		t.Fatalf("owner view should be recognised + fully revealed: %+v", ownerView.Profile.Contact)
	}

	// --- Owner toggles lost mode ON. ---
	lostPage := toggleLostMode(t, srv, withCustomer(ctx, owner), shortID, true)
	if lostPage.Profile == nil || !lostPage.Profile.LostMode {
		t.Fatalf("toggle-on page lostMode = %+v, want true", lostPage.Profile)
	}
	var dbLost bool
	if err := pool.QueryRow(ctx, `SELECT lost_mode FROM pet_profiles WHERE tag_id=(SELECT id FROM pet_tags WHERE short_id=$1)`, shortID).Scan(&dbLost); err != nil {
		t.Fatalf("read lost_mode: %v", err)
	}
	if !dbLost {
		t.Fatalf("db lost_mode = false after toggle-on, want true")
	}

	// --- Stranger on the LOST page: full contact revealed (callable) BUT still no owner name. ---
	finder := getPetPage(t, srv, ctx, shortID)
	if finder.ViewerIsOwner {
		t.Fatalf("anonymous finder should not be owner")
	}
	fc := finder.Profile.Contact
	if fc.Masked || fc.Phone == nil || *fc.Phone != "0905552261" || fc.Name != nil {
		t.Fatalf("finder lost page: want revealed phone + NO owner name, got %+v", fc)
	}

	// --- Toggle reject paths. ---
	// A different signed-in customer is NOT the owner → 403 (the SQL owner guard, not a silent no-op).
	owner2 := seedCustomerRow(t, ctx, pool, "Trần Bình", "0912345678", nil, nil, []byte("[]"))
	if _, err := srv.ToggleLostMode(withCustomer(ctx, owner2), api.ToggleLostModeRequestObject{ShortId: shortID, Body: &api.PetLostModeInput{LostMode: true}}); !errors.Is(err, errForbidden) {
		t.Fatalf("non-owner toggle → %v, want errForbidden (403)", err)
	}
	// Unknown shortId → 404.
	if _, err := srv.ToggleLostMode(withCustomer(ctx, owner), api.ToggleLostModeRequestObject{ShortId: "does-not-exist", Body: &api.PetLostModeInput{LostMode: true}}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("unknown-tag toggle → %v, want db.ErrNotFound (404)", err)
	}
	// No customer session → 401.
	if _, err := srv.ToggleLostMode(ctx, api.ToggleLostModeRequestObject{ShortId: shortID, Body: &api.PetLostModeInput{LostMode: true}}); !errors.Is(err, errUnauthenticated) {
		t.Fatalf("no-session toggle → %v, want errUnauthenticated (401)", err)
	}
	// Nil body → 400.
	if resp, _ := srv.ToggleLostMode(withCustomer(ctx, owner), api.ToggleLostModeRequestObject{ShortId: shortID, Body: nil}); !isToggle400(resp) {
		t.Fatalf("nil-body toggle → %T, want 400", resp)
	}
}

func toggleLostMode(t *testing.T, srv *Server, ctx context.Context, shortID string, lost bool) api.PetPage {
	t.Helper()
	resp, err := srv.ToggleLostMode(ctx, api.ToggleLostModeRequestObject{ShortId: shortID, Body: &api.PetLostModeInput{LostMode: lost}})
	if err != nil {
		t.Fatalf("ToggleLostMode(%s,%v): %v", shortID, lost, err)
	}
	ok, isOK := resp.(api.ToggleLostMode200JSONResponse)
	if !isOK {
		t.Fatalf("ToggleLostMode response = %T, want 200", resp)
	}
	return api.PetPage(ok)
}

func isToggle400(resp api.ToggleLostModeResponseObject) bool {
	_, ok := resp.(api.ToggleLostMode400JSONResponse)
	return ok
}
