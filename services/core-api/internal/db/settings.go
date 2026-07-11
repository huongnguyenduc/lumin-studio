package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// Settings is the repository for the config/reference axis: the settings singleton, the append-only
// bank-account audit log, and the extension reply templates. The money-out write — changing the
// VietQR STK — goes through the transactional seam UpdateBankAccountTx (it updates the column AND
// appends an audit row on the same pgx.Tx, so an STK change can never land without its audit trail;
// conventions §57, the audit analogue of the outbox publish-on-commit seam). The rest are plain repo
// methods. Construct over the *pgxpool.Pool for autocommit reads/writes, or over a pgx.Tx to enlist
// in a transaction.
type Settings struct {
	q *sqlc.Queries
}

// NewSettings builds a Settings over any sqlc.DBTX (the pool or a pgx.Tx).
func NewSettings(db sqlc.DBTX) *Settings {
	return &Settings{q: sqlc.New(db)}
}

// Get returns the settings singleton. The row is seeded by the migration, so a healthy DB always has
// it; ErrNotFound would mean the seed is missing.
func (s *Settings) Get(ctx context.Context) (sqlc.Setting, error) {
	row, err := s.q.GetSettings(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.Setting{}, ErrNotFound
	}
	return row, err
}

// UpdateConfig writes the non-money settings (shop info, shipping rules, refund policy) and returns
// the updated singleton. It does NOT change bank_account — that goes through the audited
// UpdateBankAccountTx seam.
func (s *Settings) UpdateConfig(ctx context.Context, arg sqlc.UpdateSettingsParams) (sqlc.Setting, error) {
	return s.q.UpdateSettings(ctx, arg)
}

// UpdateShippingRules replaces the per-region shipping-fee table (settings.shipping_rules) and returns
// the updated singleton. Targeted single-column write (does not touch shop_info/bank_account/
// refund_policy). Not audited — unlike the STK, the fee table is not a money-out destination (P3-i).
func (s *Settings) UpdateShippingRules(ctx context.Context, shippingRules []byte) (sqlc.Setting, error) {
	return s.q.UpdateShippingRules(ctx, shippingRules)
}

// UpdateRefundPolicy replaces the refund-policy text (ADR-012) and returns the updated singleton.
func (s *Settings) UpdateRefundPolicy(ctx context.Context, refundPolicy string) (sqlc.Setting, error) {
	return s.q.UpdateRefundPolicy(ctx, refundPolicy)
}

// BankAudits returns the money-out config history, newest first (the owner audit view).
func (s *Settings) BankAudits(ctx context.Context) ([]sqlc.SettingBankAudit, error) {
	return s.q.ListBankAudit(ctx)
}

// CreateReplyTemplate inserts an extension reply template and returns the persisted row.
func (s *Settings) CreateReplyTemplate(ctx context.Context, arg sqlc.InsertReplyTemplateParams) (sqlc.ReplyTemplate, error) {
	return s.q.InsertReplyTemplate(ctx, arg)
}

// ReplyTemplateByID returns the reply template, or ErrNotFound.
func (s *Settings) ReplyTemplateByID(ctx context.Context, id uuid.UUID) (sqlc.ReplyTemplate, error) {
	row, err := s.q.GetReplyTemplateByID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.ReplyTemplate{}, ErrNotFound
	}
	return row, err
}

// ReplyTemplates lists all reply templates, ordered by title.
func (s *Settings) ReplyTemplates(ctx context.Context) ([]sqlc.ReplyTemplate, error) {
	return s.q.ListReplyTemplates(ctx)
}

// UpdateReplyTemplate replaces a template's title/body/variables, or returns ErrNotFound if the id is
// unknown (the RETURNING clause matches no row → pgx.ErrNoRows).
func (s *Settings) UpdateReplyTemplate(ctx context.Context, arg sqlc.UpdateReplyTemplateParams) (sqlc.ReplyTemplate, error) {
	row, err := s.q.UpdateReplyTemplate(ctx, arg)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.ReplyTemplate{}, ErrNotFound
	}
	return row, err
}

// DeleteReplyTemplate removes a template, or returns ErrNotFound if the id matched no row (so the
// handler renders a uniform 404 rather than a silent success on a bogus id).
func (s *Settings) DeleteReplyTemplate(ctx context.Context, id uuid.UUID) error {
	n, err := s.q.DeleteReplyTemplate(ctx, id)
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// ErrInvalidBankChange is returned for a structurally invalid BankAccountChange, before any write.
var ErrInvalidBankChange = errors.New("bank account change: invalid input")

// BankAccountChange is the server-authoritative input to change the VietQR STK. ChangedBy is the
// owner performing the change (RBAC owner-only is enforced by the slice-3 middleware); BankAccount is
// the new STK snapshot (VietQR {bin, accountNumber, accountName}); Reason is an optional note.
type BankAccountChange struct {
	ChangedBy   uuid.UUID
	BankAccount json.RawMessage
	Reason      *string
}

// UpdateBankAccountTx changes the settings bank_account AND appends a setting_bank_audit row — both
// WITHIN tx, so the STK change and its audit entry commit (or roll back) as ONE unit. This is the
// structural guarantee behind conventions §57 ("STK owner-only + audit append-only"): a bank-account
// change cannot be persisted without its audit trail, the same way the outbox seam makes an event
// un-skippable. Owner-only is checked at the slice-3 RBAC boundary; append-only is additionally
// enforced by a DB trigger on setting_bank_audit. Caller owns the commit. Returns the updated
// singleton.
func UpdateBankAccountTx(ctx context.Context, tx pgx.Tx, in BankAccountChange) (sqlc.Setting, error) {
	if err := in.validate(); err != nil {
		return sqlc.Setting{}, err
	}
	q := sqlc.New(tx)

	row, err := q.UpdateBankAccount(ctx, in.BankAccount)
	if err != nil {
		return sqlc.Setting{}, fmt.Errorf("bank account: update: %w", err)
	}
	if _, err := q.InsertBankAudit(ctx, sqlc.InsertBankAuditParams{
		ID:          uuid.New(),
		ChangedBy:   in.ChangedBy,
		BankAccount: in.BankAccount,
		Reason:      in.Reason,
	}); err != nil {
		return sqlc.Setting{}, fmt.Errorf("bank account: audit: %w", err)
	}
	return row, nil
}

// validate rejects a malformed change before any round-trip: a non-nil actor and a non-empty JSON
// OBJECT for the STK. The jsonb NOT NULL column is NOT a sufficient backstop — a JSON `null` is not a
// SQL NULL, and `{}`/`[]`/scalars satisfy NOT NULL too — so the object-shape check here is load-bearing
// for a money-out field the server renders a static QR from, not cosmetic. The VietQR field shape
// (bin / accountNumber / accountName presence) is enforced at the slice-3 validation boundary.
func (in BankAccountChange) validate() error {
	switch {
	case in.ChangedBy == uuid.Nil:
		return fmt.Errorf("%w: changedBy required", ErrInvalidBankChange)
	case len(in.BankAccount) == 0:
		return fmt.Errorf("%w: bankAccount required", ErrInvalidBankChange)
	case !json.Valid(in.BankAccount):
		return fmt.Errorf("%w: bankAccount not valid JSON", ErrInvalidBankChange)
	}
	// Require a non-empty JSON object. json.Unmarshal of `null` yields a nil map (no error), of `{}` an
	// empty map, of `[]`/scalars an error — all rejected here, so a non-account value can never be
	// stored as "the STK".
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(in.BankAccount, &obj); err != nil || len(obj) == 0 {
		return fmt.Errorf("%w: bankAccount must be a non-empty JSON object", ErrInvalidBankChange)
	}
	return nil
}
