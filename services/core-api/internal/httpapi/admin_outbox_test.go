package httpapi

import (
	"testing"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// Docker-free unit test for the outbox-stats projection: uptime-kuma keyword/JSON monitors match
// on these exact JSON keys, so a swapped counter (pending↔failed) or a renamed field would break
// alerting silently — pin the slot wiring. The owner-only gating of both endpoints is pinned in
// TestClassify (middleware_auth_test.go); the SQL itself in internal/db/outbox_test.go.
func TestToOutboxStats(t *testing.T) {
	got := toOutboxStats(sqlc.OutboxStatsRow{Pending: 3, Failed: 1, OldestPendingAgeSeconds: 42})
	if got.Pending != 3 || got.Failed != 1 || got.OldestPendingAgeSeconds != 42 {
		t.Fatalf("toOutboxStats wired wrong: %+v", got)
	}
}
