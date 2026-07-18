package httpapi

import (
	"context"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// admin_outbox.go — outbox observability (ops/outbox-observability). A quarantined `failed`
// outbox row is a LOST domain event (order.paid, asset jobs) until someone notices: the relay
// only logs it once. These two owner-only endpoints make that visible (stats — pollable by
// uptime-kuma as a JSON/keyword monitor) and recoverable (requeue — after the poison cause is
// fixed). Owner-only (classify → authOwnerOnly): outbox internals are infrastructure, not shop
// data, mirroring the domains/staff posture.

// GetOutboxStats handles GET /admin/outbox/stats (owner-only): pending/failed counts + the age
// of the oldest pending row. failed > 0 is the alarm condition; a growing pending age means the
// relay is stuck or NATS is down.
func (s *Server) GetOutboxStats(ctx context.Context, _ api.GetOutboxStatsRequestObject) (api.GetOutboxStatsResponseObject, error) {
	row, err := sqlc.New(s.pool).OutboxStats(ctx)
	if err != nil {
		return nil, err
	}
	return api.GetOutboxStats200JSONResponse(toOutboxStats(row)), nil
}

// RequeueOutbox handles POST /admin/outbox/requeue (owner-only): flip every failed row back to
// pending (attempts reset) so the relay retries after the owner fixed the cause. Who requeued is
// logged — a requeue re-publishes money events, so the audit trail must name the actor.
func (s *Server) RequeueOutbox(ctx context.Context, _ api.RequeueOutboxRequestObject) (api.RequeueOutboxResponseObject, error) {
	n, err := sqlc.New(s.pool).RequeueFailedOutbox(ctx)
	if err != nil {
		return nil, err
	}
	actor, _ := actorFrom(ctx) // authOwnerOnly guarantees an actor; zero-value only in tests
	s.logger.Info("outbox: failed rows requeued", "requeued", n, "byUser", actor.ByUser)
	return api.RequeueOutbox200JSONResponse{Requeued: n}, nil
}

// toOutboxStats maps the stats row to the wire shape. Split out (pure) so the field wiring —
// which counter lands in which JSON key uptime-kuma matches on — is pinned by a Docker-free test.
func toOutboxStats(r sqlc.OutboxStatsRow) api.OutboxStats {
	return api.OutboxStats{
		Pending:                 r.Pending,
		Failed:                  r.Failed,
		OldestPendingAgeSeconds: r.OldestPendingAgeSeconds,
	}
}
