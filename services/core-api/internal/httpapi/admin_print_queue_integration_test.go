package httpapi

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// TestGetPrintQueueEndToEnd exercises the print-queue read + stage PATCH over a real Postgres: seed a
// 2-item web order, attach a print job to each item at a different stage, then assert the board list is
// enriched (order code + product name + quantity + color/printer/eta) and ordered by stage; that a stage
// PATCH advances a card and returns the SAME enriched shape (the join survives the re-read); and that a bad
// stage / a nil body / an unknown id are 400/400/404. The pure row→card wiring is pinned Docker-free in
// TestPrintQueueDTO; this proves the routes are wired, the join assembles, and the D6 stage-only advance
// works.
func TestGetPrintQueueEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()

	catID := seedCategory(t, ctx, pool)
	mochi := seedProductNamed(t, ctx, pool, catID, "mochi", "Đèn Mochi", 390_000)
	origami := seedProductNamed(t, ctx, pool, catID, "origami", "Kệ Origami", 120_000)

	orderID := seedAdminOrder(t, ctx, pool, adminOrderSeed{
		customer: "Nguyễn An", channel: order.ChannelWeb, createdAt: "2026-07-03T08:00:00Z",
		items: []db.NewOrderItem{
			{ProductID: mochi, Quantity: 1, UnitPrice: 390_000},
			{ProductID: origami, Quantity: 2, UnitPrice: 120_000},
		},
	})
	orderCode := orderCodeOf(t, ctx, pool, orderID)
	mochiItem := orderItemID(t, ctx, pool, orderID, mochi)
	origamiItem := orderItemID(t, ctx, pool, orderID, origami)

	eta := mustParse(t, "2026-06-21T10:00:00Z")
	color := "Cam"
	printer := "máy #2"
	// job1: NEED_PRINT, color set, eta set, no printer. job2: PRINTING, printer set, no color/eta.
	job1 := seedPrintJob(t, ctx, pool, printJobSeed{item: mochiItem, stage: sqlc.PrintStageNEEDPRINT, colorName: &color, eta: pgtype.Timestamptz{Time: eta, Valid: true}})
	seedPrintJob(t, ctx, pool, printJobSeed{item: origamiItem, stage: sqlc.PrintStagePRINTING, printer: &printer})

	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)

	// --- Board list: two enriched cards, ordered by stage (NEED_PRINT before PRINTING). ---
	cards := getPrintQueue(t, srv, ctx)
	if len(cards) != 2 {
		t.Fatalf("print queue len = %d, want 2", len(cards))
	}
	c0 := cards[0]
	if c0.Id != job1 || string(c0.Stage) != string(sqlc.PrintStageNEEDPRINT) || c0.OrderCode != orderCode ||
		c0.ProductName != "Đèn Mochi" || c0.Quantity != 1 {
		t.Fatalf("card 0 wrong: %+v (want job1/NEED_PRINT/%s/Đèn Mochi/qty 1)", c0, orderCode)
	}
	if c0.ColorName == nil || *c0.ColorName != "Cam" || c0.Eta == nil || !c0.Eta.Equal(eta) || c0.Printer != nil {
		t.Fatalf("card 0 nullable fields wrong: color=%v eta=%v printer=%v", c0.ColorName, c0.Eta, c0.Printer)
	}
	c1 := cards[1]
	if string(c1.Stage) != string(sqlc.PrintStagePRINTING) || c1.OrderCode != orderCode ||
		c1.ProductName != "Kệ Origami" || c1.Quantity != 2 {
		t.Fatalf("card 1 wrong: %+v (want PRINTING/Kệ Origami/qty 2)", c1)
	}
	if c1.Printer == nil || *c1.Printer != "máy #2" || c1.ColorName != nil || c1.Eta != nil {
		t.Fatalf("card 1 nullable fields wrong: printer=%v color=%v eta=%v", c1.Printer, c1.ColorName, c1.Eta)
	}

	// --- Stage PATCH: advance job1 NEED_PRINT → PRINTING; response is the SAME enriched card shape,
	// and the advance is broadcast to a subscribed board (P3-g SSE). Subscribe BEFORE the PATCH so the
	// receive is deterministic (the broadcast is a synchronous buffered send inside the handler) — no
	// goroutine or sleep race. ---
	events, unsub := srv.printHub.subscribe()
	defer unsub()
	updated := advancePrintStage(t, srv, ctx, job1, api.PrintStagePRINTING)
	if updated.Id != job1 || string(updated.Stage) != string(sqlc.PrintStagePRINTING) ||
		updated.OrderCode != orderCode || updated.ProductName != "Đèn Mochi" || updated.Quantity != 1 {
		t.Fatalf("advanced card wrong: %+v (want job1/PRINTING/Đèn Mochi/qty 1)", updated)
	}
	if updated.ColorName == nil || *updated.ColorName != "Cam" {
		t.Fatalf("advanced card colorName = %v, want 'Cam' (join must survive the re-read)", updated.ColorName)
	}
	select {
	case pushed := <-events:
		if pushed.Id != job1 || string(pushed.Stage) != string(sqlc.PrintStagePRINTING) || pushed.ProductName != "Đèn Mochi" {
			t.Fatalf("broadcast card = %+v, want the advanced job1/PRINTING/Đèn Mochi card", pushed)
		}
	default:
		t.Fatal("stage PATCH did not broadcast the advanced card to a subscribed board (P3-g SSE)")
	}

	// --- Reject paths: bad stage → 400, nil body → 400, unknown id → db.ErrNotFound (→ 404). ---
	if resp, _ := srv.AdvancePrintJobStage(ctx, api.AdvancePrintJobStageRequestObject{Id: job1, Body: &api.PrintStageUpdate{Stage: api.PrintStage("BOGUS")}}); !isPrintPatch400(resp) {
		t.Fatalf("bogus stage → %T, want 400", resp)
	}
	if resp, _ := srv.AdvancePrintJobStage(ctx, api.AdvancePrintJobStageRequestObject{Id: job1, Body: nil}); !isPrintPatch400(resp) {
		t.Fatalf("nil body → %T, want 400", resp)
	}
	if _, err := srv.AdvancePrintJobStage(ctx, api.AdvancePrintJobStageRequestObject{Id: uuid.New(), Body: &api.PrintStageUpdate{Stage: api.PrintStagePRINTING}}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("unknown id → err %v, want db.ErrNotFound (→ 404)", err)
	}
}

// TestGetPrintQueueEmptyIsRenderable: no print jobs → an empty (non-nil) slice, so the JSON renders `[]`
// not null (spec §03 zero-state — empty kanban columns, never blank).
func TestGetPrintQueueEmptyIsRenderable(t *testing.T) {
	pool := startPostgres(t)
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)
	cards := getPrintQueue(t, srv, context.Background())
	if cards == nil || len(cards) != 0 {
		t.Fatalf("empty DB = %#v, want non-nil empty slice", cards)
	}
}

// getPrintQueue calls the handler and unwraps the 200 body, failing on any other outcome.
func getPrintQueue(t *testing.T, srv *Server, ctx context.Context) []api.PrintQueueJob {
	t.Helper()
	resp, err := srv.GetPrintQueue(ctx, api.GetPrintQueueRequestObject{})
	if err != nil {
		t.Fatalf("GetPrintQueue: %v", err)
	}
	ok, isOK := resp.(api.GetPrintQueue200JSONResponse)
	if !isOK {
		t.Fatalf("response type = %T, want GetPrintQueue200JSONResponse", resp)
	}
	return []api.PrintQueueJob(ok)
}

// advancePrintStage calls the stage PATCH and unwraps the 200 card, failing on any other outcome.
func advancePrintStage(t *testing.T, srv *Server, ctx context.Context, id uuid.UUID, stage api.PrintStage) api.PrintQueueJob {
	t.Helper()
	resp, err := srv.AdvancePrintJobStage(ctx, api.AdvancePrintJobStageRequestObject{Id: id, Body: &api.PrintStageUpdate{Stage: stage}})
	if err != nil {
		t.Fatalf("AdvancePrintJobStage: %v", err)
	}
	ok, isOK := resp.(api.AdvancePrintJobStage200JSONResponse)
	if !isOK {
		t.Fatalf("response type = %T, want AdvancePrintJobStage200JSONResponse", resp)
	}
	return api.PrintQueueJob(ok)
}

type printJobSeed struct {
	item      uuid.UUID
	stage     sqlc.PrintStage
	printer   *string
	colorName *string
	eta       pgtype.Timestamptz
}

// seedPrintJob inserts a print_jobs row for one order item via the production CreatePrintJob seam, returning
// its id.
func seedPrintJob(t *testing.T, ctx context.Context, pool *pgxpool.Pool, s printJobSeed) uuid.UUID {
	t.Helper()
	job, err := db.NewJobs(pool).CreatePrintJob(ctx, sqlc.InsertPrintJobParams{
		ID: uuid.New(), OrderItemID: s.item, Stage: s.stage, Printer: s.printer, ColorName: s.colorName, Eta: s.eta,
	})
	if err != nil {
		t.Fatalf("seed print job (%s): %v", s.stage, err)
	}
	return job.ID
}

// orderItemID returns the order_items.id of a given product on an order — so a print job can be attached to
// a known product and its productName asserted on the card.
func orderItemID(t *testing.T, ctx context.Context, pool *pgxpool.Pool, orderID, productID uuid.UUID) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT id FROM order_items WHERE order_id=$1 AND product_id=$2`, orderID, productID).Scan(&id); err != nil {
		t.Fatalf("lookup order item (order %s, product %s): %v", orderID, productID, err)
	}
	return id
}

// orderCodeOf returns an order's display code, to assert the card's orderCode against the real value.
func orderCodeOf(t *testing.T, ctx context.Context, pool *pgxpool.Pool, orderID uuid.UUID) string {
	t.Helper()
	var code string
	if err := pool.QueryRow(ctx, `SELECT code FROM orders WHERE id=$1`, orderID).Scan(&code); err != nil {
		t.Fatalf("lookup order code (%s): %v", orderID, err)
	}
	return code
}
