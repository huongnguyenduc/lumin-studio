package db

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// --- pure unit (no Docker) -------------------------------------------------------------

func sampleBankChange() BankAccountChange {
	reason := "đổi sang STK Vietcombank"
	return BankAccountChange{
		ChangedBy:   uuid.New(),
		BankAccount: json.RawMessage(`{"bin":"970436","accountNumber":"1023456789","accountName":"LUMIN STUDIO"}`),
		Reason:      &reason,
	}
}

func TestBankAccountChangeValidate(t *testing.T) {
	if err := sampleBankChange().validate(); err != nil {
		t.Fatalf("valid change rejected: %v", err)
	}
	bad := map[string]func(BankAccountChange) BankAccountChange{
		"missing changedBy": func(c BankAccountChange) BankAccountChange { c.ChangedBy = uuid.Nil; return c },
		"empty bankAccount": func(c BankAccountChange) BankAccountChange { c.BankAccount = nil; return c },
		"invalid json":      func(c BankAccountChange) BankAccountChange { c.BankAccount = json.RawMessage(`{nope`); return c },
		// Valid JSON that is NOT a usable STK object — the jsonb NOT NULL column would accept these, so
		// validate() is the only thing standing between a "change" and a nullified/garbage bank account.
		"json null":    func(c BankAccountChange) BankAccountChange { c.BankAccount = json.RawMessage(`null`); return c },
		"empty object": func(c BankAccountChange) BankAccountChange { c.BankAccount = json.RawMessage(`{}`); return c },
		"json array":   func(c BankAccountChange) BankAccountChange { c.BankAccount = json.RawMessage(`["x"]`); return c },
	}
	for name, mutate := range bad {
		t.Run(name, func(t *testing.T) {
			if err := mutate(sampleBankChange()).validate(); !errors.Is(err, ErrInvalidBankChange) {
				t.Fatalf("validate(%s) err = %v, want ErrInvalidBankChange", name, err)
			}
		})
	}
}

// --- integration (testcontainers; skips without a Docker provider) ---------------------

// jsonEqual asserts two JSON documents are semantically equal (jsonb normalizes key order /
// whitespace, so a raw byte compare would be wrong).
func jsonEqual(t *testing.T, got []byte, want string) {
	t.Helper()
	var g, w any
	if err := json.Unmarshal(got, &g); err != nil {
		t.Fatalf("unmarshal got %q: %v", got, err)
	}
	if err := json.Unmarshal([]byte(want), &w); err != nil {
		t.Fatalf("unmarshal want %q: %v", want, err)
	}
	if !reflect.DeepEqual(g, w) {
		t.Fatalf("json mismatch:\n got  %s\n want %s", got, want)
	}
}

func seedOwner(t *testing.T, ctx context.Context, pool *pgxpool.Pool, email string) uuid.UUID {
	t.Helper()
	u, err := NewIdentity(pool).CreateUser(ctx, sqlc.InsertUserParams{
		ID: uuid.New(), Name: "Chủ shop", Email: email, Role: sqlc.UserRoleOwner, Active: true,
	})
	if err != nil {
		t.Fatalf("seed owner: %v", err)
	}
	return u.ID
}

func TestSettingsSingleton(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	settings := NewSettings(pool)

	// The migration seeds exactly one row with defaults.
	got, err := settings.Get(ctx)
	if err != nil {
		t.Fatalf("get settings: %v", err)
	}
	if got.ID != true || got.RefundPolicy != "" {
		t.Fatalf("seeded singleton wrong: %+v", got)
	}
	jsonEqual(t, got.ShopInfo, `{}`)
	jsonEqual(t, got.ShippingRules, `[]`)

	// UpdateConfig writes the non-money config and round-trips.
	updated, err := settings.UpdateConfig(ctx, sqlc.UpdateSettingsParams{
		ShopInfo:      []byte(`{"name":"Lumin Studio"}`),
		ShippingRules: []byte(`[{"region":"HN","fee":30000}]`),
		RefundPolicy:  "Không đổi trả hàng cá nhân hoá",
	})
	if err != nil {
		t.Fatalf("update config: %v", err)
	}
	if updated.RefundPolicy != "Không đổi trả hàng cá nhân hoá" {
		t.Fatalf("refund_policy = %q", updated.RefundPolicy)
	}
	jsonEqual(t, updated.ShopInfo, `{"name":"Lumin Studio"}`)
	// bank_account is untouched by UpdateConfig (money-out config is split off).
	jsonEqual(t, updated.BankAccount, `{}`)

	// Exactly one row, and the singleton guard rejects a second one.
	if n := countRows(t, ctx, pool, `SELECT count(*) FROM settings`); n != 1 {
		t.Fatalf("settings rows = %d, want 1", n)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO settings (id) VALUES (true)`); err == nil {
		t.Fatal("a second settings row (id=true) must be rejected by the PRIMARY KEY")
	}
	if _, err := pool.Exec(ctx, `INSERT INTO settings (id) VALUES (false)`); err == nil {
		t.Fatal("settings id=false must be rejected by CHECK (id)")
	}
}

func TestUpdateBankAccountWritesAudit(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	settings := NewSettings(pool)
	owner := seedOwner(t, ctx, pool, "owner@lumin.vn")

	const firstBA = `{"bin":"970436","accountNumber":"1023456789","accountName":"LUMIN STUDIO"}`
	reason := "khởi tạo STK"

	tx := mustBegin(t, ctx, pool)
	row, err := UpdateBankAccountTx(ctx, tx, BankAccountChange{
		ChangedBy: owner, BankAccount: json.RawMessage(firstBA), Reason: &reason,
	})
	if err != nil {
		t.Fatalf("update bank account: %v", err)
	}
	jsonEqual(t, row.BankAccount, firstBA)
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}

	// The settings singleton now carries the new STK...
	cur, err := settings.Get(ctx)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	jsonEqual(t, cur.BankAccount, firstBA)

	// ...and exactly one audit row recorded who/what/why (the audit is structural, not optional).
	audits, err := settings.BankAudits(ctx)
	if err != nil {
		t.Fatalf("list audits: %v", err)
	}
	if len(audits) != 1 {
		t.Fatalf("audit rows = %d, want 1", len(audits))
	}
	if audits[0].ChangedBy != owner || audits[0].Reason == nil || *audits[0].Reason != reason {
		t.Fatalf("audit row wrong: %+v", audits[0])
	}
	jsonEqual(t, audits[0].BankAccount, firstBA)

	// A second change accumulates a second audit row (history, never overwrite).
	const secondBA = `{"bin":"970415","accountNumber":"0987654321","accountName":"LUMIN STUDIO"}`
	tx2 := mustBegin(t, ctx, pool)
	if _, err := UpdateBankAccountTx(ctx, tx2, BankAccountChange{
		ChangedBy: owner, BankAccount: json.RawMessage(secondBA),
	}); err != nil {
		t.Fatalf("second change: %v", err)
	}
	if err := tx2.Commit(ctx); err != nil {
		t.Fatalf("commit 2: %v", err)
	}
	audits2, err := settings.BankAudits(ctx)
	if err != nil {
		t.Fatalf("list audits after 2nd change: %v", err)
	}
	if len(audits2) != 2 {
		t.Fatalf("audit rows after 2nd change = %d, want 2", len(audits2))
	}
	// Newest first (seq DESC): the 2nd change leads, the 1st follows — binds the audit ordering.
	jsonEqual(t, audits2[0].BankAccount, secondBA)
	jsonEqual(t, audits2[1].BankAccount, firstBA)
	// The 2nd change carried no reason → persisted as SQL NULL (nil), not coerced to "".
	if audits2[0].Reason != nil {
		t.Fatalf("no-reason change must persist reason as nil, got %q", *audits2[0].Reason)
	}
	if audits2[1].Reason == nil || *audits2[1].Reason != reason {
		t.Fatalf("first audit reason = %v, want %q", audits2[1].Reason, reason)
	}
	if cur, _ := settings.Get(ctx); !json.Valid(cur.BankAccount) {
		t.Fatal("bank account corrupted")
	} else {
		jsonEqual(t, cur.BankAccount, secondBA)
	}

	// Rollback is atomic: a change in a rolled-back tx leaves neither the column nor the audit.
	tx3 := mustBegin(t, ctx, pool)
	if _, err := UpdateBankAccountTx(ctx, tx3, BankAccountChange{
		ChangedBy: owner, BankAccount: json.RawMessage(`{"bin":"999999","accountNumber":"1","accountName":"X"}`),
	}); err != nil {
		t.Fatalf("third change: %v", err)
	}
	if err := tx3.Rollback(ctx); err != nil {
		t.Fatalf("rollback: %v", err)
	}
	if cur, _ := settings.Get(ctx); true {
		jsonEqual(t, cur.BankAccount, secondBA) // still the 2nd value, not the rolled-back one
	}
	if audits, _ := settings.BankAudits(ctx); len(audits) != 2 {
		t.Fatalf("audit rows after rollback = %d, want 2 (rollback added none)", len(audits))
	}
}

// The money-out audit log is immutable: a direct UPDATE, DELETE or TRUNCATE is blocked by the DB
// triggers, so the trail cannot be rewritten or erased even outside the no-mutate query set (§57).
func TestBankAuditAppendOnly(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	owner := seedOwner(t, ctx, pool, "owner-audit@lumin.vn")

	tx := mustBegin(t, ctx, pool)
	if _, err := UpdateBankAccountTx(ctx, tx, BankAccountChange{
		ChangedBy: owner, BankAccount: json.RawMessage(`{"bin":"970436","accountNumber":"1","accountName":"X"}`),
	}); err != nil {
		t.Fatalf("seed audit: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}
	audits, err := NewSettings(pool).BankAudits(ctx)
	if err != nil || len(audits) != 1 {
		t.Fatalf("audits = %d (err %v), want 1", len(audits), err)
	}
	id := audits[0].ID

	if _, err := pool.Exec(ctx, `UPDATE setting_bank_audit SET reason='tampered' WHERE id=$1`, id); err == nil {
		t.Fatal("UPDATE on setting_bank_audit must be rejected (append-only trigger)")
	}
	if _, err := pool.Exec(ctx, `DELETE FROM setting_bank_audit WHERE id=$1`, id); err == nil {
		t.Fatal("DELETE on setting_bank_audit must be rejected (append-only trigger)")
	}
	// TRUNCATE bypasses a row-level trigger, so the statement-level BEFORE TRUNCATE trigger must block it
	// too — otherwise the entire money-out trail could be wiped in a single statement.
	if _, err := pool.Exec(ctx, `TRUNCATE setting_bank_audit`); err == nil {
		t.Fatal("TRUNCATE on setting_bank_audit must be rejected (append-only trigger)")
	}
	// The row survives every blocked mutation.
	if n := countRows(t, ctx, pool, `SELECT count(*) FROM setting_bank_audit WHERE id=$1`, id); n != 1 {
		t.Fatalf("audit row count = %d, want 1 (untouched)", n)
	}
}

func TestReplyTemplateRoundTrip(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	settings := NewSettings(pool)

	const vars = `["{tên}","{mã đơn}","{STK}"]`
	tmpl, err := settings.CreateReplyTemplate(ctx, sqlc.InsertReplyTemplateParams{
		ID: uuid.New(), Title: "Xác nhận đơn", Body: "Chào {tên}, đơn {mã đơn} của bạn đã được xác nhận.",
		Variables: []byte(vars),
	})
	if err != nil {
		t.Fatalf("create reply template: %v", err)
	}

	back, err := settings.ReplyTemplateByID(ctx, tmpl.ID)
	if err != nil {
		t.Fatalf("get reply template: %v", err)
	}
	if back.Title != "Xác nhận đơn" || back.Body != "Chào {tên}, đơn {mã đơn} của bạn đã được xác nhận." {
		t.Fatalf("reply template round-trip wrong: %+v", back)
	}
	jsonEqual(t, back.Variables, vars)

	all, err := settings.ReplyTemplates(ctx)
	if err != nil {
		t.Fatalf("list reply templates: %v", err)
	}
	var found bool
	for _, r := range all {
		if r.ID == tmpl.ID {
			found = true
		}
	}
	if !found {
		t.Fatal("ListReplyTemplates should contain the new template")
	}

	if _, err := settings.ReplyTemplateByID(ctx, uuid.New()); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown template = %v, want ErrNotFound", err)
	}
}
