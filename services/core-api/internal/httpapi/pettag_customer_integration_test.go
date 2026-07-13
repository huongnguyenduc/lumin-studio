package httpapi

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
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

// TestSharePetLocation drives the finder rescue send-once (P3-t t-4b) over a real Postgres. The finder is
// ANONYMOUS (no session) — the endpoint is public. An at-home pet REFUSES a share (409 — an at-home pet's
// location is never pinged); once the owner flips lost mode, a finder's {lat,lng} records ONE lost_events row
// (the PDPL consent-point-2 artifact) with owner_notified_at NULL (there is no push worker in t-4b). The owner
// then sees the scan IN-APP (recentScans with an OSM mapUrl) on their OWN page; a stranger never does. Bad
// coords / nil body → 400; an unknown shortId → 404.
func TestSharePetLocation(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()

	catID := seedCategory(t, ctx, pool)
	tagProduct := seedProductNamed(t, ctx, pool, catID, "pet-tag-finder", "Pet Tag NFC", 390_000)
	if _, err := pool.Exec(ctx, `UPDATE products SET product_type='nfc_tag' WHERE id=$1`, tagProduct); err != nil {
		t.Fatalf("mark nfc_tag: %v", err)
	}
	orderID := seedAdminOrder(t, ctx, pool, adminOrderSeed{
		customer: "Mai Lê", channel: order.ChannelWeb, createdAt: "2026-07-06T08:00:00Z",
		items: []db.NewOrderItem{{ProductID: tagProduct, Quantity: 1, UnitPrice: 390_000}},
	})
	item := orderItemID(t, ctx, pool, orderID, tagProduct)
	shortID := seedEncodedTag(t, ctx, pool, item, "petfindaaa")
	owner := seedCustomerRow(t, ctx, pool, "Mai Lê", "0905552261", nil, nil, []byte("[]"))
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)
	activatePetTag(t, srv, withCustomer(ctx, owner), shortID, validPetInput())

	const lat, lng = 10.762622, 106.660172 // Ho Chi Minh City

	// --- At-home pet: a finder share is REFUSED (409) and writes nothing. ---
	if _, err := srv.SharePetLocation(ctx, api.SharePetLocationRequestObject{ShortId: shortID, Body: &api.PetShareLocationInput{Lat: lat, Lng: lng}}); !errors.Is(err, errPetNotLost) {
		t.Fatalf("share at-home → %v, want errPetNotLost (409)", err)
	}
	if n := lostEventCount(t, ctx, pool, shortID); n != 0 {
		t.Fatalf("at-home share created %d lost_events, want 0", n)
	}

	// --- Owner flips lost mode; now an anonymous finder can share once. ---
	toggleLostMode(t, srv, withCustomer(ctx, owner), shortID, true)
	sharePetLocation(t, srv, ctx, shortID, lat, lng) // NO session — a stranger reporting a found pet

	// DB: exactly one lost_events row with the finder location; owner_notified_at still NULL (no push worker).
	if n := lostEventCount(t, ctx, pool, shortID); n != 1 {
		t.Fatalf("after share: %d lost_events, want 1", n)
	}
	var (
		gotLat, gotLng float64
		notified       bool
	)
	if err := pool.QueryRow(ctx, `SELECT (finder_location->>'lat')::float8, (finder_location->>'lng')::float8, owner_notified_at IS NOT NULL
		FROM lost_events WHERE tag_id=(SELECT id FROM pet_tags WHERE short_id=$1)`, shortID).Scan(&gotLat, &gotLng, &notified); err != nil {
		t.Fatalf("read lost_event: %v", err)
	}
	if gotLat != lat || gotLng != lng {
		t.Fatalf("stored finder_location = %v,%v want %v,%v", gotLat, gotLng, lat, lng)
	}
	if notified {
		t.Fatalf("owner_notified_at set, want NULL (t-4b has no push worker)")
	}

	// --- Owner sees the scan IN-APP (recentScans with an OSM mapUrl) on their OWN page. ---
	ownerView := getPetPage(t, srv, withCustomer(ctx, owner), shortID)
	if ownerView.RecentScans == nil || len(*ownerView.RecentScans) != 1 {
		t.Fatalf("owner recentScans = %v, want 1 entry", ownerView.RecentScans)
	}
	if mapURL := (*ownerView.RecentScans)[0].MapUrl; !strings.Contains(mapURL, "openstreetmap.org") || !strings.Contains(mapURL, "10.762622") {
		t.Fatalf("recentScan mapUrl = %q, want an OSM link with the coords", mapURL)
	}

	// --- A stranger NEVER learns where the pet was found (recentScans is owner-only). ---
	strangerView := getPetPage(t, srv, ctx, shortID)
	if strangerView.RecentScans != nil {
		t.Fatalf("stranger recentScans = %v, want nil (owner-only)", strangerView.RecentScans)
	}

	// --- Reject paths. ---
	// Coords out of range → 400.
	if resp, _ := srv.SharePetLocation(ctx, api.SharePetLocationRequestObject{ShortId: shortID, Body: &api.PetShareLocationInput{Lat: 200, Lng: lng}}); !isShare400(resp) {
		t.Fatalf("bad coords → %T, want 400", resp)
	}
	// Nil body → 400.
	if resp, _ := srv.SharePetLocation(ctx, api.SharePetLocationRequestObject{ShortId: shortID, Body: nil}); !isShare400(resp) {
		t.Fatalf("nil body → %T, want 400", resp)
	}
	// Unknown shortId → 404.
	if _, err := srv.SharePetLocation(ctx, api.SharePetLocationRequestObject{ShortId: "does-not-exist", Body: &api.PetShareLocationInput{Lat: lat, Lng: lng}}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("unknown shortId → %v, want db.ErrNotFound (404)", err)
	}
}

func sharePetLocation(t *testing.T, srv *Server, ctx context.Context, shortID string, lat, lng float64) {
	t.Helper()
	resp, err := srv.SharePetLocation(ctx, api.SharePetLocationRequestObject{
		ShortId: shortID, Body: &api.PetShareLocationInput{Lat: lat, Lng: lng},
	})
	if err != nil {
		t.Fatalf("SharePetLocation(%s): %v", shortID, err)
	}
	ok, isOK := resp.(api.SharePetLocation200JSONResponse)
	if !isOK || !ok.Ok {
		t.Fatalf("SharePetLocation response = %T (ok=%v), want 200 ok=true", resp, ok.Ok)
	}
}

func isShare400(resp api.SharePetLocationResponseObject) bool {
	_, ok := resp.(api.SharePetLocation400JSONResponse)
	return ok
}

// lostEventCount counts a tag's lost_events rows by short_id (t-4b test helper).
func lostEventCount(t *testing.T, ctx context.Context, pool *pgxpool.Pool, shortID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM lost_events WHERE tag_id=(SELECT id FROM pet_tags WHERE short_id=$1)`, shortID).Scan(&n); err != nil {
		t.Fatalf("count lost_events: %v", err)
	}
	return n
}

// TestUpdatePetProfile drives the in-place editor's save (P3-t t-4c-1) over a real Postgres. After activation
// (onboarding captures no bio/gallery/favorites), the owner PATCHes the full content: the new blocks land, the
// display fields change, and the projection reflects them on BOTH the owner's and a stranger's page (content
// is public — only the contact is PDPL-masked). theme/blocks are untouched (still default → projected nil).
// Owner-only: a different signed-in customer's update is a 403 (the SQL owner guard, not a silent no-op); a bad
// phone → 400; an unknown shortId → 404; no session → 401.
func TestUpdatePetProfile(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()

	catID := seedCategory(t, ctx, pool)
	tagProduct := seedProductNamed(t, ctx, pool, catID, "pet-tag-edit", "Pet Tag NFC", 390_000)
	if _, err := pool.Exec(ctx, `UPDATE products SET product_type='nfc_tag' WHERE id=$1`, tagProduct); err != nil {
		t.Fatalf("mark nfc_tag: %v", err)
	}
	orderID := seedAdminOrder(t, ctx, pool, adminOrderSeed{
		customer: "Mai Lê", channel: order.ChannelWeb, createdAt: "2026-07-07T08:00:00Z",
		items: []db.NewOrderItem{{ProductID: tagProduct, Quantity: 1, UnitPrice: 390_000}},
	})
	item := orderItemID(t, ctx, pool, orderID, tagProduct)
	shortID := seedEncodedTag(t, ctx, pool, item, "peteditaaa")
	owner := seedCustomerRow(t, ctx, pool, "Mai Lê", "0905552261", nil, nil, []byte("[]"))
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)
	activatePetTag(t, srv, withCustomer(ctx, owner), shortID, validPetInput())

	// --- Before edit: onboarding set no content blocks. ---
	pre := getPetPage(t, srv, withCustomer(ctx, owner), shortID)
	if pre.Profile.Bio != nil || pre.Profile.Gallery != nil || pre.Profile.Favorites != nil {
		t.Fatalf("pre-edit profile already has content blocks: %+v", pre.Profile)
	}

	// --- Owner edits the page content in place. ---
	edited := updatePetProfile(t, srv, withCustomer(ctx, owner), shortID, validUpdateInput())
	pp := edited.Profile
	if pp == nil || pp.Bio == nil || *pp.Bio != "Chân ngắn, lòng dài 🧀" {
		t.Fatalf("edited bio = %+v, want the new bio", pp)
	}
	if pp.Gallery == nil || len(*pp.Gallery) != 2 || pp.Favorites == nil || len(*pp.Favorites) != 2 {
		t.Fatalf("edited gallery/favorites = %+v / %+v, want 2 each", pp.Gallery, pp.Favorites)
	}
	if pp.Breed == nil || *pp.Breed != "Corgi" || pp.Socials == nil || len(*pp.Socials) != 1 {
		t.Fatalf("edited breed/socials = %+v / %+v, want Corgi + 1 social", pp.Breed, pp.Socials)
	}
	// theme/blocks were NOT part of the edit → still default → omitted.
	if pp.Theme != nil || pp.Blocks != nil {
		t.Fatalf("edit touched theme/blocks: theme=%+v blocks=%+v (t-4c-2 owns those)", pp.Theme, pp.Blocks)
	}

	// DB: the content columns persisted (gallery/favorites as jsonb, bio as text).
	var bio string
	var galleryLen, favLen int
	if err := pool.QueryRow(ctx, `SELECT bio, jsonb_array_length(gallery), jsonb_array_length(favorites)
		FROM pet_profiles WHERE tag_id=(SELECT id FROM pet_tags WHERE short_id=$1)`, shortID).Scan(&bio, &galleryLen, &favLen); err != nil {
		t.Fatalf("read profile content: %v", err)
	}
	if bio != "Chân ngắn, lòng dài 🧀" || galleryLen != 2 || favLen != 2 {
		t.Fatalf("db content = bio %q / gallery %d / fav %d, want the edited values", bio, galleryLen, favLen)
	}

	// --- A stranger sees the content (it's public) but the contact stays masked. ---
	stranger := getPetPage(t, srv, ctx, shortID)
	if stranger.Profile.Bio == nil || stranger.Profile.Gallery == nil {
		t.Fatalf("stranger should see public content (bio/gallery): %+v", stranger.Profile)
	}
	if !stranger.Profile.Contact.Masked || stranger.Profile.Contact.Phone != nil {
		t.Fatalf("stranger contact should stay masked after an edit: %+v", stranger.Profile.Contact)
	}

	// --- Reject paths. ---
	// A different signed-in customer is NOT the owner → 403 (the SQL owner guard).
	owner2 := seedCustomerRow(t, ctx, pool, "Trần Bình", "0912345678", nil, nil, []byte("[]"))
	if _, err := srv.UpdatePetProfile(withCustomer(ctx, owner2), api.UpdatePetProfileRequestObject{ShortId: shortID, Body: ptrUpdate(validUpdateInput())}); !errors.Is(err, errForbidden) {
		t.Fatalf("non-owner edit → %v, want errForbidden (403)", err)
	}
	// Bad phone → 400.
	badPhone := validUpdateInput()
	badPhone.OwnerContact.Phone = "not-a-phone"
	if resp, _ := srv.UpdatePetProfile(withCustomer(ctx, owner), api.UpdatePetProfileRequestObject{ShortId: shortID, Body: ptrUpdate(badPhone)}); !isUpdate400(resp) {
		t.Fatalf("bad phone → %T, want 400", resp)
	}
	// Unknown shortId → 404.
	if _, err := srv.UpdatePetProfile(withCustomer(ctx, owner), api.UpdatePetProfileRequestObject{ShortId: "does-not-exist", Body: ptrUpdate(validUpdateInput())}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("unknown shortId → %v, want db.ErrNotFound (404)", err)
	}
	// No customer session → 401.
	if _, err := srv.UpdatePetProfile(ctx, api.UpdatePetProfileRequestObject{ShortId: shortID, Body: ptrUpdate(validUpdateInput())}); !errors.Is(err, errUnauthenticated) {
		t.Fatalf("no session → %v, want errUnauthenticated (401)", err)
	}
	// Nil body → 400.
	if resp, _ := srv.UpdatePetProfile(withCustomer(ctx, owner), api.UpdatePetProfileRequestObject{ShortId: shortID, Body: nil}); !isUpdate400(resp) {
		t.Fatalf("nil body → %T, want 400", resp)
	}
}

// validUpdateInput is a full valid in-place-edit payload: the same required identity (Bơ the corgi + phone)
// plus the new content blocks (bio, a 2-photo gallery, 2 favorites) and a social handle.
func validUpdateInput() api.PetProfileUpdateInput {
	bio := "Chân ngắn, lòng dài 🧀"
	breed := "Corgi"
	age := "2 tuổi"
	weight := "9 kg"
	return api.PetProfileUpdateInput{
		PetName:      "Bơ",
		Species:      api.Dog,
		Breed:        &breed,
		Age:          &age,
		Weight:       &weight,
		Bio:          &bio,
		Gallery:      &[]string{"https://cdn.example/a.jpg", "https://cdn.example/b.jpg"},
		Favorites:    &[]string{"🧀 Phô mai", "🦴 Gặm xương"},
		OwnerContact: api.PetOwnerContact{Name: "Mai Lê", Phone: "0905552261"},
		Socials:      &[]api.PetSocial{{Platform: "instagram", Handle: "bo.corgi"}},
	}
}

func ptrUpdate(in api.PetProfileUpdateInput) *api.PetProfileUpdateInput { return &in }

func updatePetProfile(t *testing.T, srv *Server, ctx context.Context, shortID string, in api.PetProfileUpdateInput) api.PetPage {
	t.Helper()
	resp, err := srv.UpdatePetProfile(ctx, api.UpdatePetProfileRequestObject{ShortId: shortID, Body: &in})
	if err != nil {
		t.Fatalf("UpdatePetProfile(%s): %v", shortID, err)
	}
	ok, isOK := resp.(api.UpdatePetProfile200JSONResponse)
	if !isOK {
		t.Fatalf("UpdatePetProfile response = %T, want 200", resp)
	}
	return api.PetPage(ok)
}

func isUpdate400(resp api.UpdatePetProfileResponseObject) bool {
	_, ok := resp.(api.UpdatePetProfile400JSONResponse)
	return ok
}

// TestUpdatePetAppearance drives the t-4c-2 theme + reorder write end-to-end against real Postgres: an owner
// applies a theme (colorway + image bg + opacity + font) and a reordered/partly-hidden block list; the page
// projects them back + they persist; switching the bg away from image drops the stale image URL; the content
// columns stay untouched; a non-owner is a 403; bad theme/block fields are 400s; unknown 404; no session 401.
func TestUpdatePetAppearance(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()

	catID := seedCategory(t, ctx, pool)
	tagProduct := seedProductNamed(t, ctx, pool, catID, "pet-tag-theme", "Pet Tag NFC", 390_000)
	if _, err := pool.Exec(ctx, `UPDATE products SET product_type='nfc_tag' WHERE id=$1`, tagProduct); err != nil {
		t.Fatalf("mark nfc_tag: %v", err)
	}
	orderID := seedAdminOrder(t, ctx, pool, adminOrderSeed{
		customer: "Mai Lê", channel: order.ChannelWeb, createdAt: "2026-07-07T08:00:00Z",
		items: []db.NewOrderItem{{ProductID: tagProduct, Quantity: 1, UnitPrice: 390_000}},
	})
	item := orderItemID(t, ctx, pool, orderID, tagProduct)
	shortID := seedEncodedTag(t, ctx, pool, item, "petthemeaa")
	owner := seedCustomerRow(t, ctx, pool, "Mai Lê", "0905552261", nil, nil, []byte("[]"))
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)
	activatePetTag(t, srv, withCustomer(ctx, owner), shortID, validPetInput())

	// --- Before: a fresh profile carries no theme/blocks (renders the brand default). ---
	pre := getPetPage(t, srv, withCustomer(ctx, owner), shortID)
	if pre.Profile.Theme != nil || pre.Profile.Blocks != nil {
		t.Fatalf("pre-write profile already themed: theme=%+v blocks=%+v", pre.Profile.Theme, pre.Profile.Blocks)
	}

	// --- Owner applies a theme + reordered/hidden blocks. ---
	applied := updatePetAppearance(t, srv, withCustomer(ctx, owner), shortID, validAppearanceInput())
	th := applied.Profile.Theme
	if th == nil || th.Palette == nil || *th.Palette != "bac-ha" || th.Background == nil || *th.Background != "image" {
		t.Fatalf("applied theme = %+v, want bac-ha + image bg", th)
	}
	if th.BgImageUrl == nil || th.BgOpacity == nil || *th.BgOpacity != 40 {
		t.Fatalf("applied theme lost bgImageUrl/opacity: %+v", th)
	}
	if applied.Profile.Blocks == nil || len(*applied.Profile.Blocks) != 3 {
		t.Fatalf("applied blocks = %+v, want the 3 saved", applied.Profile.Blocks)
	}

	// DB: theme + blocks persisted as jsonb.
	var palette string
	var blockCount int
	if err := pool.QueryRow(ctx, `SELECT theme->>'palette', jsonb_array_length(blocks)
		FROM pet_profiles WHERE tag_id=(SELECT id FROM pet_tags WHERE short_id=$1)`, shortID).Scan(&palette, &blockCount); err != nil {
		t.Fatalf("read appearance: %v", err)
	}
	if palette != "bac-ha" || blockCount != 3 {
		t.Fatalf("db appearance = palette %q / %d blocks, want bac-ha / 3", palette, blockCount)
	}

	// The content columns are untouched by an appearance write (separate endpoints).
	pageAfter := getPetPage(t, srv, withCustomer(ctx, owner), shortID)
	if pageAfter.Profile.PetName != "Bơ" {
		t.Fatalf("appearance write changed content (petName=%q)", pageAfter.Profile.PetName)
	}

	// --- Switching the bg away from image drops the stale image URL (no ghost). ---
	plainTheme := validAppearanceInput()
	dots := "dots"
	plainTheme.Theme.Background = &dots // BgImageUrl still set from validAppearanceInput → must be dropped
	reapplied := updatePetAppearance(t, srv, withCustomer(ctx, owner), shortID, plainTheme)
	if reapplied.Profile.Theme != nil && reapplied.Profile.Theme.BgImageUrl != nil {
		t.Fatalf("dots bg kept a ghost bgImageUrl: %+v", reapplied.Profile.Theme)
	}

	// --- Reject paths. ---
	// A different signed-in customer is NOT the owner → 403 (the SQL owner guard).
	owner2 := seedCustomerRow(t, ctx, pool, "Trần Bình", "0912345678", nil, nil, []byte("[]"))
	if _, err := srv.UpdatePetAppearance(withCustomer(ctx, owner2), api.UpdatePetAppearanceRequestObject{ShortId: shortID, Body: ptrAppearance(validAppearanceInput())}); !errors.Is(err, errForbidden) {
		t.Fatalf("non-owner appearance → %v, want errForbidden (403)", err)
	}
	// Unknown palette → 400.
	badPalette := validAppearanceInput()
	neon := "neon"
	badPalette.Theme.Palette = &neon
	if resp, _ := srv.UpdatePetAppearance(withCustomer(ctx, owner), api.UpdatePetAppearanceRequestObject{ShortId: shortID, Body: ptrAppearance(badPalette)}); !isAppearance400(resp) {
		t.Fatalf("unknown palette → %T, want 400", resp)
	}
	// Hiding the fixed photo_name block → 400.
	hidden := validAppearanceInput()
	hidden.Blocks[0].Visible = false
	if resp, _ := srv.UpdatePetAppearance(withCustomer(ctx, owner), api.UpdatePetAppearanceRequestObject{ShortId: shortID, Body: ptrAppearance(hidden)}); !isAppearance400(resp) {
		t.Fatalf("hidden photo_name → %T, want 400", resp)
	}
	// Unknown shortId → 404.
	if _, err := srv.UpdatePetAppearance(withCustomer(ctx, owner), api.UpdatePetAppearanceRequestObject{ShortId: "does-not-exist", Body: ptrAppearance(validAppearanceInput())}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("unknown shortId → %v, want db.ErrNotFound (404)", err)
	}
	// No customer session → 401.
	if _, err := srv.UpdatePetAppearance(ctx, api.UpdatePetAppearanceRequestObject{ShortId: shortID, Body: ptrAppearance(validAppearanceInput())}); !errors.Is(err, errUnauthenticated) {
		t.Fatalf("no session → %v, want errUnauthenticated (401)", err)
	}
	// Nil body → 400.
	if resp, _ := srv.UpdatePetAppearance(withCustomer(ctx, owner), api.UpdatePetAppearanceRequestObject{ShortId: shortID, Body: nil}); !isAppearance400(resp) {
		t.Fatalf("nil body → %T, want 400", resp)
	}
}

// validAppearanceInput is a full valid theme + block payload: Bạc hà colorway on a custom-image background at
// 40% opacity with the display font, and a 3-block layout (photo_name fixed + visible, bio visible, socials
// hidden). A fresh copy each call so a test can mutate one field.
func validAppearanceInput() api.PetAppearanceInput {
	sp := func(s string) *string { return &s }
	op := 40
	return api.PetAppearanceInput{
		Theme: api.PetTheme{
			Palette:    sp("bac-ha"),
			Background: sp("image"),
			BgImageUrl: sp("https://garage.example/bo-ho-tay.jpg"),
			BgOpacity:  &op,
			NameFont:   sp("display"),
		},
		Blocks: []api.PetBlock{
			{Type: "photo_name", Order: 0, Visible: true},
			{Type: "bio", Order: 1, Visible: true},
			{Type: "socials", Order: 2, Visible: false},
		},
	}
}

func ptrAppearance(in api.PetAppearanceInput) *api.PetAppearanceInput { return &in }

func updatePetAppearance(t *testing.T, srv *Server, ctx context.Context, shortID string, in api.PetAppearanceInput) api.PetPage {
	t.Helper()
	resp, err := srv.UpdatePetAppearance(ctx, api.UpdatePetAppearanceRequestObject{ShortId: shortID, Body: &in})
	if err != nil {
		t.Fatalf("UpdatePetAppearance(%s): %v", shortID, err)
	}
	ok, isOK := resp.(api.UpdatePetAppearance200JSONResponse)
	if !isOK {
		t.Fatalf("UpdatePetAppearance response = %T, want 200", resp)
	}
	return api.PetPage(ok)
}

func isAppearance400(resp api.UpdatePetAppearanceResponseObject) bool {
	_, ok := resp.(api.UpdatePetAppearance400JSONResponse)
	return ok
}
