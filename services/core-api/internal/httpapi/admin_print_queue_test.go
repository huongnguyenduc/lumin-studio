package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// TestGetPrintQueueRequiresAuth proves GET /admin/print-queue is mounted AND admin-gated (classify →
// authRequired default): a no-cookie request is rejected at the boundary with 401 before the handler runs,
// so it needs no DB (serverWithUsers has a nil pool). The class is locked in TestClassifyFailsClosed; this
// locks the mounted route.
func TestGetPrintQueueRequiresAuth(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/admin/print-queue", nil)
	testAuthedRouter(serverWithUsers(fakeUsers{})).ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("GET /admin/print-queue (no cookie) = %d, want 401 (admin-gated, fail-closed)", rec.Code)
	}
}

// TestAdvancePrintJobStageRequiresAuth proves PATCH /admin/print-jobs/{id} is mounted AND admin-gated: a
// no-cookie request is rejected with 401 before the handler runs (nil pool). A valid uuid + valid body are
// sent so path- and body-binding succeed and the request reaches the auth boundary (a malformed id/body
// would 400 at binding, before auth). The class is locked in TestClassifyFailsClosed; this locks the route.
func TestAdvancePrintJobStageRequiresAuth(t *testing.T) {
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPatch, "/admin/print-jobs/"+uuid.NewString(), strings.NewReader(`{"stage":"PRINTING"}`))
	req.Header.Set("Content-Type", "application/json")
	testAuthedRouter(serverWithUsers(fakeUsers{})).ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("PATCH /admin/print-jobs/{id} (no cookie) = %d, want 401 (admin-gated, fail-closed)", rec.Code)
	}
}

// TestPrintQueueDTO pins the row→card slot wiring with DISTINCT values in every field, so any swap (e.g.
// orderCode↔productName) or mis-widened enum fails. It also proves the nullable columns map both ways: a set
// color / a nil printer / a valid eta on one row, and a nil color / a set printer / an absent eta on the
// other. Pure — runs in the Docker-free lane.
func TestPrintQueueDTO(t *testing.T) {
	id1, id2 := uuid.New(), uuid.New()
	eta := mustParse(t, "2026-06-21T10:00:00Z")
	color, printer := "Cam", "máy #2"
	// Card B is a PARTS product (ADR-037): no flat colorName, but a part_colors jsonb snapshot with the
	// colour names frozen at capture. The card must surface them as per-part labels — what filament for
	// which part, at the printer — read straight off the snapshot with no catalog join.
	partColorsJSON := []byte(`[{"partId":"11111111-1111-1111-1111-111111111111","partName":"Chao","colorId":"22222222-2222-2222-2222-222222222222","colorName":"Đỏ","hex":"#E23"},` +
		`{"partId":"33333333-3333-3333-3333-333333333333","partName":"Đế","colorId":"44444444-4444-4444-4444-444444444444","colorName":"Trắng","hex":"#FFF"}]`)
	rows := []sqlc.ListPrintQueueRow{
		{ID: id1, Stage: sqlc.PrintStageNEEDPRINT, OrderCode: "#LMN-2048", ProductName: "Đèn Mochi", Quantity: 1,
			ColorName: &color, Printer: nil, Eta: pgtype.Timestamptz{Time: eta, Valid: true}},
		{ID: id2, Stage: sqlc.PrintStagePRINTING, OrderCode: "#LMN-2050", ProductName: "Mèo Mập", Quantity: 3,
			ColorName: nil, Printer: &printer, Eta: pgtype.Timestamptz{}, PartColors: partColorsJSON},
	}
	got, err := printQueueDTO(rows)
	if err != nil {
		t.Fatalf("printQueueDTO: unexpected error: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("len = %d, want 2", len(got))
	}

	a := got[0]
	if a.Id != id1 || string(a.Stage) != "NEED_PRINT" || a.OrderCode != "#LMN-2048" ||
		a.ProductName != "Đèn Mochi" || a.Quantity != 1 {
		t.Fatalf("card A core fields wrong: %+v", a)
	}
	if a.ColorName == nil || *a.ColorName != "Cam" {
		t.Fatalf("card A colorName = %v, want 'Cam'", a.ColorName)
	}
	if a.Printer != nil {
		t.Fatalf("card A printer = %v, want nil (unassigned stays nil)", a.Printer)
	}
	if a.Eta == nil || !a.Eta.Equal(eta) {
		t.Fatalf("card A eta = %v, want %v", a.Eta, eta)
	}
	if a.PartColorLabels != nil {
		t.Fatalf("card A partColorLabels = %v, want nil (a flat line carries none)", a.PartColorLabels)
	}

	b := got[1]
	if b.Id != id2 || string(b.Stage) != "PRINTING" || b.OrderCode != "#LMN-2050" ||
		b.ProductName != "Mèo Mập" || b.Quantity != 3 {
		t.Fatalf("card B core fields wrong: %+v", b)
	}
	if b.ColorName != nil {
		t.Fatalf("card B colorName = %v, want nil (no color stays nil)", b.ColorName)
	}
	if b.Printer == nil || *b.Printer != "máy #2" {
		t.Fatalf("card B printer = %v, want 'máy #2'", b.Printer)
	}
	if b.Eta != nil {
		t.Fatalf("card B eta = %v, want nil (absent eta stays nil)", b.Eta)
	}
	if b.PartColorLabels == nil || len(*b.PartColorLabels) != 2 ||
		(*b.PartColorLabels)[0] != "Chao: Đỏ" || (*b.PartColorLabels)[1] != "Đế: Trắng" {
		t.Fatalf("card B partColorLabels = %v, want [Chao: Đỏ, Đế: Trắng]", b.PartColorLabels)
	}
}

// printQueueDTO must render an empty result as a non-nil slice so the JSON is `[]`, not `null` (spec §03
// zero-state — the empty print board renders as empty columns, never blank).
func TestPrintQueueDTOEmptyIsNonNil(t *testing.T) {
	got, err := printQueueDTO(nil)
	if err != nil {
		t.Fatalf("printQueueDTO(nil): unexpected error: %v", err)
	}
	if got == nil {
		t.Fatal("printQueueDTO(nil) = nil, want non-nil empty slice (renders [], not null)")
	}
	if got, err := printQueueDTO([]sqlc.ListPrintQueueRow{}); err != nil || len(got) != 0 || got == nil {
		t.Fatalf("printQueueDTO([]) = %v (err %v), want non-nil empty", got, err)
	}
}

// TestPrintStagesMembership: every print_stage enum value is a member of the validation set, and a token
// outside it is not — the guard the stage PATCH uses to 400 a bad stage before the ::print_stage cast.
func TestPrintStagesMembership(t *testing.T) {
	for _, s := range []sqlc.PrintStage{sqlc.PrintStageNEEDPRINT, sqlc.PrintStagePRINTING, sqlc.PrintStagePACKING, sqlc.PrintStageSHIPPED} {
		if !printStages[s] {
			t.Fatalf("printStages[%q] = false, want true (valid enum member)", s)
		}
	}
	if printStages[sqlc.PrintStage("NOT_A_STAGE")] {
		t.Fatal("printStages['NOT_A_STAGE'] = true, want false (unknown → 400)")
	}
}

// TestAdvancePrintJobStageRejectsBadStage: a nil body and a stage outside the enum are both 400, returned
// BEFORE any DB read — so the handler never touches the (nil) pool on the reject path. This is the "guard
// stage hợp lệ" check, proven Docker-free.
func TestAdvancePrintJobStageRejectsBadStage(t *testing.T) {
	srv := serverWithUsers(fakeUsers{}) // nil pool — the reject paths return before using it
	ctx := context.Background()

	if resp, _ := srv.AdvancePrintJobStage(ctx, api.AdvancePrintJobStageRequestObject{Id: uuid.New(), Body: nil}); !isPrintPatch400(resp) {
		t.Fatalf("nil body → %T, want AdvancePrintJobStage400JSONResponse", resp)
	}
	bogus := api.AdvancePrintJobStageRequestObject{Id: uuid.New(), Body: &api.PrintStageUpdate{Stage: api.PrintStage("BOGUS")}}
	if resp, _ := srv.AdvancePrintJobStage(ctx, bogus); !isPrintPatch400(resp) {
		t.Fatalf("bogus stage → %T, want AdvancePrintJobStage400JSONResponse", resp)
	}
}

func isPrintPatch400(resp api.AdvancePrintJobStageResponseObject) bool {
	_, ok := resp.(api.AdvancePrintJobStage400JSONResponse)
	return ok
}
