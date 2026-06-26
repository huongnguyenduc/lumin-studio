package db

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// Identity is the read/write repository for the identity + PDPL-consent axis (customers,
// consent_grants, users). It wraps the sqlc Querier; pgx.ErrNoRows surfaces as ErrNotFound
// on the single-row lookups. Construct over the *pgxpool.Pool or a pgx.Tx.
type Identity struct {
	q *sqlc.Queries
}

// NewIdentity builds an Identity over any sqlc.DBTX (the pool or a pgx.Tx).
func NewIdentity(db sqlc.DBTX) *Identity {
	return &Identity{q: sqlc.New(db)}
}

// CreateCustomer inserts a customer and returns the persisted row.
func (i *Identity) CreateCustomer(ctx context.Context, arg sqlc.InsertCustomerParams) (sqlc.Customer, error) {
	return i.q.InsertCustomer(ctx, arg)
}

// CustomerByID returns the customer, or ErrNotFound. Serves PDPL export reads.
func (i *Identity) CustomerByID(ctx context.Context, id uuid.UUID) (sqlc.Customer, error) {
	c, err := i.q.GetCustomerByID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.Customer{}, ErrNotFound
	}
	return c, err
}

// CustomerByPhone returns the customer with the given phone, or ErrNotFound.
func (i *Identity) CustomerByPhone(ctx context.Context, phone string) (sqlc.Customer, error) {
	c, err := i.q.GetCustomerByPhone(ctx, phone)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.Customer{}, ErrNotFound
	}
	return c, err
}

// GrantConsent appends a consent grant. PDPL: consent is append-then-mark — every grant is
// an explicit row (never a pre-defaulted boolean), and the active partial-unique index
// keeps at most one un-withdrawn grant per (customer, scope, channel).
func (i *Identity) GrantConsent(ctx context.Context, arg sqlc.InsertConsentGrantParams) (sqlc.ConsentGrant, error) {
	return i.q.InsertConsentGrant(ctx, arg)
}

// WithdrawConsent marks the active grant for (customer, scope, channel) as withdrawn. It
// never deletes the row, preserving the consent audit trail (PDPL).
func (i *Identity) WithdrawConsent(ctx context.Context, arg sqlc.WithdrawConsentParams) error {
	return i.q.WithdrawConsent(ctx, arg)
}

// ActiveConsents lists a customer's non-withdrawn grants.
func (i *Identity) ActiveConsents(ctx context.Context, customerID uuid.UUID) ([]sqlc.ConsentGrant, error) {
	return i.q.ListActiveConsents(ctx, customerID)
}

// CreateUser inserts a staff/owner user and returns the persisted row.
func (i *Identity) CreateUser(ctx context.Context, arg sqlc.InsertUserParams) (sqlc.User, error) {
	return i.q.InsertUser(ctx, arg)
}

// UserByEmail returns the user with the given email, or ErrNotFound.
func (i *Identity) UserByEmail(ctx context.Context, email string) (sqlc.User, error) {
	u, err := i.q.GetUserByEmail(ctx, email)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.User{}, ErrNotFound
	}
	return u, err
}
