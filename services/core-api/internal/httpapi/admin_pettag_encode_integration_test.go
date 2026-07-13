package httpapi

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// TestEncodePrintJobTagEndToEnd exercises the NFC-encode step (P3-t t-2) over a real Postgres: seed an
// nfc_tag line + a standard line, each with a print job, then drive the dual-mode encode endpoint.
// PREPARE (no chipUid) mints the tag (UNENCODED, code + shortId + URL) and leaves the stage at
// NFC_ENCODE. CONFIRM (chipUid) reuses that SAME tag, flips it ENCODED, advances the card → PACKING, and
// broadcasts it. A non-nfc_tag job → 400, a blank chipUid → 400, an unknown job → 404. The order's own
// status never moves (the tag lifecycle is separate — spec §10).
func TestEncodePrintJobTagEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()

	catID := seedCategory(t, ctx, pool)
	tagProduct := seedProductNamed(t, ctx, pool, catID, "pet-tag", "Pet Tag NFC", 390_000)
	stdProduct := seedProductNamed(t, ctx, pool, catID, "mochi", "Đèn Mochi", 390_000)
	// seedProductNamed defaults product_type='standard' (t-1); mark the tag product nfc_tag.
	if _, err := pool.Exec(ctx, `UPDATE products SET product_type='nfc_tag' WHERE id=$1`, tagProduct); err != nil {
		t.Fatalf("mark nfc_tag: %v", err)
	}

	orderID := seedAdminOrder(t, ctx, pool, adminOrderSeed{
		customer: "Nguyễn An", channel: order.ChannelWeb, createdAt: "2026-07-03T08:00:00Z",
		items: []db.NewOrderItem{
			{ProductID: tagProduct, Quantity: 1, UnitPrice: 390_000},
			{ProductID: stdProduct, Quantity: 1, UnitPrice: 390_000},
		},
	})
	tagItem := orderItemID(t, ctx, pool, orderID, tagProduct)
	stdItem := orderItemID(t, ctx, pool, orderID, stdProduct)
	tagJob := seedPrintJob(t, ctx, pool, printJobSeed{item: tagItem, stage: sqlc.PrintStageNFCENCODE})
	stdJob := seedPrintJob(t, ctx, pool, printJobSeed{item: stdItem, stage: sqlc.PrintStagePRINTING})

	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)

	// --- PREPARE (no chipUid): mint the tag, return the URL, DON'T advance the stage. ---
	prep := encodePrintTag(t, srv, ctx, tagJob, nil)
	if prep.Tag.Status != api.UNENCODED {
		t.Fatalf("prepare tag status = %q, want UNENCODED", prep.Tag.Status)
	}
	if prep.Tag.Code == "" || prep.Tag.ShortId == "" || prep.Tag.ChipUid != nil {
		t.Fatalf("prepare must mint code + shortId and leave chipUid nil, got %+v", prep.Tag)
	}
	if !strings.HasSuffix(prep.Tag.Url, "/t/"+prep.Tag.ShortId) {
		t.Fatalf("prepare url = %q, want …/t/%s (derived from shortId)", prep.Tag.Url, prep.Tag.ShortId)
	}
	if string(prep.Card.Stage) != string(sqlc.PrintStageNFCENCODE) {
		t.Fatalf("prepare must NOT advance the stage; card stage = %q, want NFC_ENCODE", prep.Card.Stage)
	}
	if prep.Card.ProductType != api.NfcTag {
		t.Fatalf("card productType = %q, want nfc_tag", prep.Card.ProductType)
	}

	// --- CONFIRM (chipUid): flip ENCODED, advance → PACKING, reuse the SAME tag, broadcast the card. ---
	events, unsub := srv.printHub.subscribe()
	defer unsub()
	chip := "04:A1:B2:C3:D4:E5:80"
	conf := encodePrintTag(t, srv, ctx, tagJob, &chip)
	if conf.Tag.Status != api.ENCODED || conf.Tag.ChipUid == nil || *conf.Tag.ChipUid != chip {
		t.Fatalf("confirm tag = %+v, want ENCODED + chipUid %q", conf.Tag, chip)
	}
	if conf.Tag.ShortId != prep.Tag.ShortId || conf.Tag.Code != prep.Tag.Code {
		t.Fatalf("confirm minted a NEW tag (%q/%q) instead of reusing prepare's (%q/%q)",
			conf.Tag.Code, conf.Tag.ShortId, prep.Tag.Code, prep.Tag.ShortId)
	}
	if string(conf.Card.Stage) != string(sqlc.PrintStagePACKING) {
		t.Fatalf("confirm must advance the card → PACKING, got %q", conf.Card.Stage)
	}
	select {
	case pushed := <-events:
		if pushed.Id != tagJob || string(pushed.Stage) != string(sqlc.PrintStagePACKING) {
			t.Fatalf("broadcast card = %+v, want tagJob/PACKING", pushed)
		}
	default:
		t.Fatal("confirm did not broadcast the advanced card to a subscribed board (P3-g SSE)")
	}

	// --- Reject paths: a standard (non-nfc_tag) job → 400; a blank chipUid → 400; an unknown job → 404. ---
	if resp, _ := srv.EncodePrintJobTag(ctx, api.EncodePrintJobTagRequestObject{Id: stdJob}); !isEncode400(resp) {
		t.Fatalf("encode of a standard job → %T, want 400", resp)
	}
	blank := "   "
	if resp, _ := srv.EncodePrintJobTag(ctx, api.EncodePrintJobTagRequestObject{Id: tagJob, Body: &api.PrintTagEncodeInput{ChipUid: &blank}}); !isEncode400(resp) {
		t.Fatalf("blank chipUid → %T, want 400", resp)
	}
	if _, err := srv.EncodePrintJobTag(ctx, api.EncodePrintJobTagRequestObject{Id: uuid.New()}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("unknown id → err %v, want db.ErrNotFound (→ 404)", err)
	}
}

// encodePrintTag calls the encode handler and unwraps the 200 result, failing on any other outcome. A nil
// chipUid is the prepare call (no body); a non-nil chipUid is the confirm call.
func encodePrintTag(t *testing.T, srv *Server, ctx context.Context, id uuid.UUID, chipUid *string) api.PrintTagEncodeResult {
	t.Helper()
	var body *api.PrintTagEncodeInput
	if chipUid != nil {
		body = &api.PrintTagEncodeInput{ChipUid: chipUid}
	}
	resp, err := srv.EncodePrintJobTag(ctx, api.EncodePrintJobTagRequestObject{Id: id, Body: body})
	if err != nil {
		t.Fatalf("EncodePrintJobTag: %v", err)
	}
	ok, isOK := resp.(api.EncodePrintJobTag200JSONResponse)
	if !isOK {
		t.Fatalf("response type = %T, want EncodePrintJobTag200JSONResponse", resp)
	}
	return api.PrintTagEncodeResult(ok)
}

func isEncode400(resp api.EncodePrintJobTagResponseObject) bool {
	_, ok := resp.(api.EncodePrintJobTag400JSONResponse)
	return ok
}
