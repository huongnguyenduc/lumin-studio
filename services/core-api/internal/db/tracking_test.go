package db

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// SetShippingArtifactsTx persists both mandatory SHIPPING artifacts (tracking code + QC photo) and
// its RETURNING row reflects them alongside the status already flipped earlier in the same tx (the
// SHIPPING transition handler's atomic combo, §3h / §6 D12 / D-P3-6). A missing order id maps to
// ErrNotFound. testcontainers: skip-local/run-CI.
func TestSetShippingArtifacts(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	customerID, productID, _ := seedOrderDeps(t, ctx, pool)
	seed := createCommittedWebOrder(t, ctx, pool, customerID, productID)

	// Drive PENDING_CONFIRM→PAID→PRINTING→SHIPPING then set the artifacts — all inside one tx,
	// exactly as the handler does, to prove RETURNING carries the in-tx status flip alongside both.
	tx := mustBegin(t, ctx, pool)
	for _, to := range []order.Status{order.Paid, order.Printing, order.Shipping} {
		if _, err := AdvanceStatusTx(ctx, tx, seed.ID, to, order.TransitionContext{
			Role: order.RoleOwner, ByUser: "owner", At: orderAt,
		}); err != nil {
			t.Fatalf("advance →%s: %v", to, err)
		}
	}
	const qcURL = "https://cdn.lumin.test/qc/pack.jpg"
	row, err := SetShippingArtifactsTx(ctx, tx, seed.ID, "VN-999", qcURL)
	if err != nil {
		t.Fatalf("SetShippingArtifactsTx: %v", err)
	}
	if row.TrackingCode == nil || *row.TrackingCode != "VN-999" {
		t.Fatalf("returned tracking_code = %v, want VN-999", row.TrackingCode)
	}
	if row.QcPhotoUrl == nil || *row.QcPhotoUrl != qcURL {
		t.Fatalf("returned qc_photo_url = %v, want %q", row.QcPhotoUrl, qcURL)
	}
	if row.Status != order.Shipping {
		t.Fatalf("returned status = %s, want SHIPPING (in-tx flip must be visible)", row.Status)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}

	missTx := mustBegin(t, ctx, pool)
	defer func() { _ = missTx.Rollback(ctx) }() // release the conn so pool.Close (cleanup) can't hang
	if _, err := SetShippingArtifactsTx(ctx, missTx, uuid.New(), "x", "y"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing order err = %v, want ErrNotFound", err)
	}
}
