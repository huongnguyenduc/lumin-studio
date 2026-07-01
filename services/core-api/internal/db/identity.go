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

// FindOrCreateCustomer returns the existing customer matching arg.Phone, or inserts arg as a new
// one; the bool reports whether a row was created. Checkout resolves a returning buyer by phone
// (no storefront Account this slice) without overwriting their stored name/addresses. Run it on an
// Identity built over the create tx so the customer, consent and order commit atomically.
//
// phone is indexed but NOT unique (a person may re-appear; enforcing uniqueness would need a schema
// change + a merge policy — out of scope). The find-then-insert therefore has a narrow race: two
// simultaneous first orders from the same phone can both miss and insert two customer rows. That
// yields a duplicate customer, never a money/consent error, and is acceptable until a checkout
// surface that produces real concurrency lands (§6 D5, same posture as deferred idempotency).
func (i *Identity) FindOrCreateCustomer(ctx context.Context, arg sqlc.InsertCustomerParams) (sqlc.Customer, bool, error) {
	existing, err := i.q.GetCustomerByPhone(ctx, arg.Phone)
	if err == nil {
		return existing, false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return sqlc.Customer{}, false, err
	}
	created, err := i.q.InsertCustomer(ctx, arg)
	if err != nil {
		return sqlc.Customer{}, false, err
	}
	return created, true, nil
}

// GrantConsent appends a consent grant. PDPL: consent is append-then-mark — every grant is
// an explicit row (never a pre-defaulted boolean), and the active partial-unique index
// keeps at most one un-withdrawn grant per (customer, scope, channel).
func (i *Identity) GrantConsent(ctx context.Context, arg sqlc.InsertConsentGrantParams) (sqlc.ConsentGrant, error) {
	return i.q.InsertConsentGrant(ctx, arg)
}

// GrantConsentIfAbsent records a consent grant idempotently: a returning customer who already has
// an ACTIVE grant for (scope, channel) is a no-op rather than a partial-unique violation that would
// roll back their order tx. Use this on the checkout path (a buyer consents on every order); use
// GrantConsent when a fresh row is required. PDPL semantics are unchanged — still one explicit row
// per active purpose, re-grant-after-withdrawal is a new row.
func (i *Identity) GrantConsentIfAbsent(ctx context.Context, arg sqlc.InsertConsentGrantIfAbsentParams) error {
	return i.q.InsertConsentGrantIfAbsent(ctx, arg)
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

// UserByID returns the user with the given id, or ErrNotFound. The PR-3e-2 auth boundary
// resolves a verified JWT's `sub` through here to read the authoritative role + active flag
// from the row (never trusting the token's own role claim).
func (i *Identity) UserByID(ctx context.Context, id uuid.UUID) (sqlc.User, error) {
	u, err := i.q.GetUserByID(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return sqlc.User{}, ErrNotFound
	}
	return u, err
}

// UpsertOwnerCredential seeds or rotates the first owner's login credential (PR-3e-1,
// `make seed-owner`). Idempotent on the UNIQUE email: re-running rotates the password hash.
func (i *Identity) UpsertOwnerCredential(ctx context.Context, arg sqlc.UpsertOwnerCredentialParams) (sqlc.User, error) {
	return i.q.UpsertOwnerCredential(ctx, arg)
}
