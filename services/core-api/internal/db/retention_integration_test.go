package db

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// TestPurgeableProofOrders drives the ADR-035 retention query against real Postgres: only orders that
// are BOTH in a terminal status AND older than the cutoff AND still carry a proof are returned,
// oldest-first; ClearPaymentProof then nulls the reference idempotently. (testcontainers: skips local
// without Docker, runs in CI — ADR-020.)
func TestPurgeableProofOrders(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	customerID, productID, _ := seedOrderDeps(t, ctx, pool)

	cutoff := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	old := cutoff.Add(-48 * time.Hour)
	older := cutoff.Add(-72 * time.Hour)
	recent := cutoff.Add(48 * time.Hour)
	proof := "https://cdn.lumin.vn/proof/abc.jpg"

	// Force each order into an exact (status, updated_at, proof) state — a test-setup shortcut past the
	// multi-hop transition seams, since the query is what's under test.
	setState := func(id uuid.UUID, status string, updatedAt time.Time, proofURL *string) {
		t.Helper()
		if _, err := pool.Exec(ctx,
			`UPDATE orders SET status = $2::order_status, updated_at = $3, payment_proof_url = $4 WHERE id = $1`,
			id, status, updatedAt, proofURL); err != nil {
			t.Fatalf("setState(%s): %v", status, err)
		}
	}
	mk := func() uuid.UUID { return createCommittedWebOrder(t, ctx, pool, customerID, productID).ID }

	selectedNewer := mk()  // terminal + old + proof  → selected
	selectedOldest := mk() // terminal + older + proof → selected (sorts first)
	tooRecent := mk()      // terminal + recent + proof → excluded (not old enough)
	notTerminal := mk()    // PAID (open) + old + proof → excluded (not terminal)
	noProof := mk()        // terminal + old + NO proof → excluded (nothing to delete)

	setState(selectedNewer, "COMPLETED", old, &proof)
	setState(selectedOldest, "CANCELLED", older, &proof)
	setState(tooRecent, "COMPLETED", recent, &proof)
	setState(notTerminal, "PAID", old, &proof)
	setState(noProof, "REFUNDED", old, nil)

	got, err := NewOrders(pool).PurgeableProofOrders(ctx, cutoff, 10)
	if err != nil {
		t.Fatalf("PurgeableProofOrders: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d rows, want 2 (the two terminal+old+proof orders); ids=%v", len(got), ids(got))
	}
	// Oldest-first ordering.
	if got[0].ID != selectedOldest || got[1].ID != selectedNewer {
		t.Fatalf("order = %v, want [%s, %s] (oldest-first)", ids(got), selectedOldest, selectedNewer)
	}

	// ClearPaymentProof nulls the reference; a re-run is a no-op (idempotent), and the row drops out.
	if err := NewOrders(pool).ClearPaymentProof(ctx, selectedOldest); err != nil {
		t.Fatalf("ClearPaymentProof: %v", err)
	}
	if err := NewOrders(pool).ClearPaymentProof(ctx, selectedOldest); err != nil {
		t.Fatalf("ClearPaymentProof (idempotent re-run): %v", err)
	}
	var stillSet *string
	if err := pool.QueryRow(ctx, `SELECT payment_proof_url FROM orders WHERE id = $1`, selectedOldest).Scan(&stillSet); err != nil {
		t.Fatalf("read cleared row: %v", err)
	}
	if stillSet != nil {
		t.Fatalf("payment_proof_url = %q after clear, want NULL", *stillSet)
	}

	after, err := NewOrders(pool).PurgeableProofOrders(ctx, cutoff, 10)
	if err != nil {
		t.Fatalf("PurgeableProofOrders (after clear): %v", err)
	}
	if len(after) != 1 || after[0].ID != selectedNewer {
		t.Fatalf("after clear got %v, want only %s", ids(after), selectedNewer)
	}
}

func ids(rows []sqlc.ListPurgeableProofOrdersRow) []uuid.UUID {
	out := make([]uuid.UUID, len(rows))
	for i, r := range rows {
		out[i] = r.ID
	}
	return out
}
