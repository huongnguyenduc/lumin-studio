package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/pricing"
)

// --- integration (testcontainers; skips without a Docker provider) ---------------------

func seedOwnerUser(t *testing.T, ctx context.Context, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	u, err := db.NewIdentity(pool).CreateUser(ctx, sqlc.InsertUserParams{
		ID: uuid.New(), Name: "Chủ shop", Email: "owner+" + uuid.NewString()[:8] + "@lumin.vn",
		Role: sqlc.UserRoleOwner, Active: true,
	})
	if err != nil {
		t.Fatalf("seed owner: %v", err)
	}
	return u.ID
}

// TestUpdateBankAccountEndToEnd drives the owner STK change through the handler over a real Postgres:
// the settings.bank_account column AND a setting_bank_audit row must both be written (one tx — a
// change can never land without its audit trail, conventions §57), and GetSettings must then reflect
// the new STK. changed_by comes from the actor context (users.id), never the body.
func TestUpdateBankAccountEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	ownerID := seedOwnerUser(t, ctx, pool)
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)

	actorCtx := withActor(ctx, Actor{ByUser: ownerID.String(), Role: order.RoleOwner, At: time.Now().UTC()})
	reason := "đổi sang Vietcombank"
	resp, err := srv.UpdateBankAccount(actorCtx, api.UpdateBankAccountRequestObject{
		Body: &api.BankAccountUpdate{Bin: "970436", AccountNumber: "1023456789", AccountName: "LUMIN STUDIO", Reason: &reason},
	})
	if err != nil {
		t.Fatalf("UpdateBankAccount: %v", err)
	}
	ok, isOK := resp.(api.UpdateBankAccount200JSONResponse)
	if !isOK {
		t.Fatalf("response type = %T, want UpdateBankAccount200JSONResponse", resp)
	}
	if ok.BankAccount.Bin == nil || *ok.BankAccount.Bin != "970436" {
		t.Fatalf("returned STK = %+v, want bin 970436", ok.BankAccount)
	}

	// The column is persisted...
	row, err := db.NewSettings(pool).Get(ctx)
	if err != nil {
		t.Fatalf("get settings: %v", err)
	}
	var rec bankAccountRecord
	if err := json.Unmarshal(row.BankAccount, &rec); err != nil {
		t.Fatalf("decode stored bank_account: %v", err)
	}
	if rec.Bin != "970436" || rec.AccountNumber != "1023456789" || rec.AccountName != "LUMIN STUDIO" {
		t.Fatalf("stored STK = %+v, want the new values", rec)
	}
	// ...AND an audit row was appended in the same tx, attributed to the owner from the actor context.
	audits, err := db.NewSettings(pool).BankAudits(ctx)
	if err != nil {
		t.Fatalf("bank audits: %v", err)
	}
	if len(audits) != 1 {
		t.Fatalf("audit rows = %d, want 1 (STK change is audited)", len(audits))
	}
	if audits[0].ChangedBy != ownerID {
		t.Fatalf("audit changed_by = %s, want owner %s (from actor ctx, not body)", audits[0].ChangedBy, ownerID)
	}
	if audits[0].Reason == nil || *audits[0].Reason != reason {
		t.Fatalf("audit reason = %v, want %q", audits[0].Reason, reason)
	}

	// GetSettings reflects the change.
	gresp, err := srv.GetSettings(ctx, api.GetSettingsRequestObject{})
	if err != nil {
		t.Fatalf("GetSettings: %v", err)
	}
	gok, isOK := gresp.(api.GetSettings200JSONResponse)
	if !isOK {
		t.Fatalf("GetSettings type = %T", gresp)
	}
	if gok.BankAccount.AccountName == nil || *gok.BankAccount.AccountName != "LUMIN STUDIO" {
		t.Fatalf("GetSettings STK = %+v, want the updated account name", gok.BankAccount)
	}
}

// TestGetSettingsSeededDefaults reads the migration-seeded singleton: empty STK, non-nil rules.
func TestGetSettingsSeededDefaults(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)

	resp, err := srv.GetSettings(ctx, api.GetSettingsRequestObject{})
	if err != nil {
		t.Fatalf("GetSettings: %v", err)
	}
	ok, isOK := resp.(api.GetSettings200JSONResponse)
	if !isOK {
		t.Fatalf("response type = %T", resp)
	}
	if ok.BankAccount.Bin != nil {
		t.Fatalf("seeded STK should be empty, got bin %v", *ok.BankAccount.Bin)
	}
	if ok.ShippingRules == nil {
		t.Fatal("shippingRules should be non-nil (renders [])")
	}
}

// TestListReplyTemplatesEndToEnd returns the templates ordered by title, variables decoded.
func TestListReplyTemplatesEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)
	settings := db.NewSettings(pool)

	// Insert out of title order to prove the ORDER BY.
	if _, err := settings.CreateReplyTemplate(ctx, sqlc.InsertReplyTemplateParams{
		ID: uuid.New(), Title: "Zalo", Body: "STK: {STK}", Variables: []byte(`["{STK}"]`),
	}); err != nil {
		t.Fatalf("seed template: %v", err)
	}
	if _, err := settings.CreateReplyTemplate(ctx, sqlc.InsertReplyTemplateParams{
		ID: uuid.New(), Title: "Chào", Body: "Xin chào {tên}", Variables: []byte(`["{tên}"]`),
	}); err != nil {
		t.Fatalf("seed template: %v", err)
	}

	resp, err := srv.ListReplyTemplates(ctx, api.ListReplyTemplatesRequestObject{})
	if err != nil {
		t.Fatalf("ListReplyTemplates: %v", err)
	}
	list, isOK := resp.(api.ListReplyTemplates200JSONResponse)
	if !isOK {
		t.Fatalf("response type = %T", resp)
	}
	if len(list) != 2 || list[0].Title != "Chào" || list[1].Title != "Zalo" {
		t.Fatalf("templates = %+v, want [Chào, Zalo] ordered by title", list)
	}
	if len(list[1].Variables) != 1 || list[1].Variables[0] != "{STK}" {
		t.Fatalf("variables decode wrong: %+v", list[1].Variables)
	}
}

// TestUpdateShippingRulesEndToEnd drives the owner fee-table edit over real Postgres and proves the
// PERSISTED jsonb resolves through the SAME checkout fee resolver (pricing.ShippingFee) — a shape drift
// would silently misroute every order's shipping fee. A negative fee is rejected 400 before any write.
func TestUpdateShippingRulesEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	ownerID := seedOwnerUser(t, ctx, pool)
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)
	actorCtx := withActor(ctx, Actor{ByUser: ownerID.String(), Role: order.RoleOwner, At: time.Now().UTC()})

	resp, err := srv.UpdateShippingRules(actorCtx, api.UpdateShippingRulesRequestObject{
		Body: &api.ShippingRulesUpdate{ShippingRules: []api.ShippingRule{
			{Province: "Nội thành TP.HCM", Fee: 25000},
			{Province: "*", Fee: 40000},
		}},
	})
	if err != nil {
		t.Fatalf("UpdateShippingRules: %v", err)
	}
	if _, ok := resp.(api.UpdateShippingRules200JSONResponse); !ok {
		t.Fatalf("response type = %T, want 200", resp)
	}

	row, err := db.NewSettings(pool).Get(ctx)
	if err != nil {
		t.Fatalf("get settings: %v", err)
	}
	if fee, err := pricing.ShippingFee(row.ShippingRules, "Nội thành TP.HCM"); err != nil || fee != 25000 {
		t.Fatalf("resolver on persisted rules: fee=%d err=%v", fee, err)
	}
	if fee, err := pricing.ShippingFee(row.ShippingRules, "Đà Nẵng"); err != nil || fee != 40000 {
		t.Fatalf("wildcard fallback on persisted rules: fee=%d err=%v", fee, err)
	}

	bad, err := srv.UpdateShippingRules(actorCtx, api.UpdateShippingRulesRequestObject{
		Body: &api.ShippingRulesUpdate{ShippingRules: []api.ShippingRule{{Province: "Hà Nội", Fee: -5}}},
	})
	if err != nil {
		t.Fatalf("bad rules should be a 400 response, not a handler error: %v", err)
	}
	if _, ok := bad.(api.UpdateShippingRules400JSONResponse); !ok {
		t.Fatalf("negative fee: response = %T, want 400", bad)
	}
}

// TestUpdateRefundPolicyEndToEnd persists the refund-policy text (trimmed) and reads it back.
func TestUpdateRefundPolicyEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	ownerID := seedOwnerUser(t, ctx, pool)
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)
	actorCtx := withActor(ctx, Actor{ByUser: ownerID.String(), Role: order.RoleOwner, At: time.Now().UTC()})

	policy := "Đổi trả trong 3 ngày nếu lỗi do shop."
	if _, err := srv.UpdateRefundPolicy(actorCtx, api.UpdateRefundPolicyRequestObject{
		Body: &api.RefundPolicyUpdate{RefundPolicy: "  " + policy + "  "},
	}); err != nil {
		t.Fatalf("UpdateRefundPolicy: %v", err)
	}
	gresp, err := srv.GetSettings(ctx, api.GetSettingsRequestObject{})
	if err != nil {
		t.Fatalf("GetSettings: %v", err)
	}
	gok, ok := gresp.(api.GetSettings200JSONResponse)
	if !ok {
		t.Fatalf("GetSettings type = %T", gresp)
	}
	if gok.RefundPolicy != policy {
		t.Fatalf("refundPolicy = %q, want trimmed %q", gok.RefundPolicy, policy)
	}
}

// TestReplyTemplateCRUDEndToEnd walks create → update → delete over real Postgres: variables are
// derived server-side from the body on both create and update, and an unknown id → ErrNotFound (→404).
func TestReplyTemplateCRUDEndToEnd(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	ownerID := seedOwnerUser(t, ctx, pool)
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), pool, nil, nil)
	actorCtx := withActor(ctx, Actor{ByUser: ownerID.String(), Role: order.RoleOwner, At: time.Now().UTC()})

	cresp, err := srv.CreateReplyTemplate(actorCtx, api.CreateReplyTemplateRequestObject{
		Body: &api.ReplyTemplateInput{Title: "Báo phí ship", Body: "Phí khu vực là {phí}. CK {STK} nha"},
	})
	if err != nil {
		t.Fatalf("CreateReplyTemplate: %v", err)
	}
	created, ok := cresp.(api.CreateReplyTemplate201JSONResponse)
	if !ok {
		t.Fatalf("create response = %T, want 201", cresp)
	}
	if len(created.Variables) != 2 || created.Variables[0] != "{phí}" || created.Variables[1] != "{STK}" {
		t.Fatalf("derived variables = %v, want [{phí} {STK}]", created.Variables)
	}
	id := created.Id

	uresp, err := srv.UpdateReplyTemplate(actorCtx, api.UpdateReplyTemplateRequestObject{
		Id: id, Body: &api.ReplyTemplateInput{Title: "Báo phí ship (v2)", Body: "Chỉ còn {ngày}"},
	})
	if err != nil {
		t.Fatalf("UpdateReplyTemplate: %v", err)
	}
	updated, ok := uresp.(api.UpdateReplyTemplate200JSONResponse)
	if !ok {
		t.Fatalf("update response = %T, want 200", uresp)
	}
	if updated.Title != "Báo phí ship (v2)" || len(updated.Variables) != 1 || updated.Variables[0] != "{ngày}" {
		t.Fatalf("updated = %+v, want title v2 + variables [{ngày}]", updated)
	}

	dresp, err := srv.DeleteReplyTemplate(actorCtx, api.DeleteReplyTemplateRequestObject{Id: id})
	if err != nil {
		t.Fatalf("DeleteReplyTemplate: %v", err)
	}
	if _, ok := dresp.(api.DeleteReplyTemplate204Response); !ok {
		t.Fatalf("delete response = %T, want 204", dresp)
	}
	if _, err := db.NewSettings(pool).ReplyTemplateByID(ctx, id); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("after delete, ByID err = %v, want ErrNotFound", err)
	}

	if _, err := srv.UpdateReplyTemplate(actorCtx, api.UpdateReplyTemplateRequestObject{
		Id: uuid.New(), Body: &api.ReplyTemplateInput{Title: "x", Body: "y"},
	}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("update unknown id: err = %v, want ErrNotFound (→404)", err)
	}
	if _, err := srv.DeleteReplyTemplate(actorCtx, api.DeleteReplyTemplateRequestObject{Id: uuid.New()}); !errors.Is(err, db.ErrNotFound) {
		t.Fatalf("delete unknown id: err = %v, want ErrNotFound (→404)", err)
	}
}
