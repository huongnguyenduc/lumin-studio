package httpapi

import (
	"context"
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

// TestAdminPetTagRosterEndToEnd drives the roster (P3-t t-5) over a real Postgres: seed one tag in each of
// the three lifecycle states and read them back through GET /admin/pet-tags. The load-bearing assertions are
// the LEFT JOIN shape — a tag with no pet yet (UNENCODED/ENCODED) still appears, with the pet-derived fields
// absent — and that an ACTIVATED tag carries its pet's @handle/name/species/lost-mode. Ordering is newest
// tag first. The pet is identified by its public @handle, never the customer account (no owner PII).
func TestAdminPetTagRosterEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()

	catID := seedCategory(t, ctx, pool)
	tagProduct := seedProductNamed(t, ctx, pool, catID, "pet-tag-roster", "Pet Tag NFC", 390_000)
	if _, err := pool.Exec(ctx, `UPDATE products SET product_type='nfc_tag' WHERE id=$1`, tagProduct); err != nil {
		t.Fatalf("mark nfc_tag: %v", err)
	}
	orderID := seedAdminOrder(t, ctx, pool, adminOrderSeed{
		customer: "Mai Lê", channel: order.ChannelWeb, createdAt: "2026-07-05T08:00:00Z",
		items: []db.NewOrderItem{{ProductID: tagProduct, Quantity: 1, UnitPrice: 390_000}},
	})
	item := orderItemID(t, ctx, pool, orderID, tagProduct)

	// Three tags on the same order line (order_item_id is NOT unique — qty→N tags, t-1), one per state,
	// with explicit created_at so newest-first is deterministic. T3 starts ENCODED so it can be activated.
	insertRosterTag(t, ctx, pool, item, "#LMN-TR1", "rosteraaa", "UNENCODED", nil, "2026-07-01T00:00:00Z")
	encChip := "04:EN:CO:DE"
	insertRosterTag(t, ctx, pool, item, "#LMN-TR2", "rosterbbb", "ENCODED", &encChip, "2026-07-02T00:00:00Z")
	actChip := "04:AC:71:VE"
	insertRosterTag(t, ctx, pool, item, "#LMN-TR3", "rosterccc", "ENCODED", &actChip, "2026-07-03T00:00:00Z")

	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)

	// Activate the newest tag → creates its pet profile, flips ACTIVATED; then flip the pet to lost mode.
	owner := seedCustomerRow(t, ctx, pool, "Mai Lê", "0905552261", nil, nil, []byte("[]"))
	activatePetTag(t, srv, withCustomer(ctx, owner), "rosterccc", validPetInput())
	if _, err := pool.Exec(ctx, `UPDATE pet_profiles SET lost_mode=true
		WHERE tag_id=(SELECT id FROM pet_tags WHERE short_id='rosterccc')`); err != nil {
		t.Fatalf("set lost mode: %v", err)
	}

	roster := listAdminPetTags(t, srv, ctx)
	if len(roster) != 3 {
		t.Fatalf("roster has %d tags, want 3", len(roster))
	}

	// Newest tag first (created_at DESC): activated (T3), encoded (T2), unencoded (T1).
	act, enc, un := roster[0], roster[1], roster[2]
	if act.Code != "#LMN-TR3" || enc.Code != "#LMN-TR2" || un.Code != "#LMN-TR1" {
		t.Fatalf("roster order = %s/%s/%s, want TR3/TR2/TR1 (newest first)", act.Code, enc.Code, un.Code)
	}

	// UNENCODED: no chip, no pet (LEFT JOIN miss → all pet fields absent).
	if un.Status != api.UNENCODED || un.ChipUid != nil || un.Handle != nil || un.PetName != nil || un.Species != nil || un.LostMode != nil {
		t.Fatalf("unencoded row leaked chip/pet fields: %+v", un)
	}

	// ENCODED: chip present, still no pet.
	if enc.Status != api.ENCODED || enc.ChipUid == nil || *enc.ChipUid != encChip || enc.Handle != nil || enc.Species != nil || enc.LostMode != nil {
		t.Fatalf("encoded row wrong: %+v", enc)
	}

	// ACTIVATED: pet fields populated (Bơ the dog from validPetInput), in lost mode; URL derived from short_id.
	if act.Status != api.ACTIVATED || act.ChipUid == nil || *act.ChipUid != actChip {
		t.Fatalf("activated row status/chip wrong: %+v", act)
	}
	if act.Handle == nil || *act.Handle == "" || act.PetName == nil || *act.PetName != "Bơ" {
		t.Fatalf("activated row missing @handle/name: %+v", act)
	}
	if act.Species == nil || *act.Species != api.Dog || act.LostMode == nil || !*act.LostMode {
		t.Fatalf("activated row species/lostMode wrong: species=%v lost=%v", act.Species, act.LostMode)
	}
	if !strings.HasSuffix(act.Url, "/t/rosterccc") {
		t.Fatalf("activated url = %q, want …/t/rosterccc", act.Url)
	}
}

// insertRosterTag inserts a pet tag in a chosen state with an explicit created_at (so the roster's
// newest-first ordering is deterministic). A nil chip leaves chip_uid NULL (the UNENCODED shape).
func insertRosterTag(t *testing.T, ctx context.Context, pool *pgxpool.Pool, item uuid.UUID, code, shortID, status string, chip *string, createdAt string) {
	t.Helper()
	if _, err := pool.Exec(ctx, `INSERT INTO pet_tags (id, code, short_id, order_item_id, status, chip_uid, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`, uuid.New(), code, shortID, item, status, chip, createdAt); err != nil {
		t.Fatalf("insert roster tag %s: %v", shortID, err)
	}
}

// listAdminPetTags calls the roster handler and unwraps the 200 list, failing on any other outcome.
func listAdminPetTags(t *testing.T, srv *Server, ctx context.Context) []api.AdminPetTag {
	t.Helper()
	resp, err := srv.GetAdminPetTags(ctx, api.GetAdminPetTagsRequestObject{})
	if err != nil {
		t.Fatalf("GetAdminPetTags: %v", err)
	}
	ok, isOK := resp.(api.GetAdminPetTags200JSONResponse)
	if !isOK {
		t.Fatalf("response type = %T, want GetAdminPetTags200JSONResponse", resp)
	}
	return []api.AdminPetTag(ok)
}
