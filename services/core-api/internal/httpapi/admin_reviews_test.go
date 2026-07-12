package httpapi

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// --- Docker-free unit -----------------------------------------------------------------

// buildReviewModeration validates a moderation body and builds the UPDATE params: status-only leaves the
// reply untouched (SetReply false), reply-only trims + marshals {body, at} and leaves status unset, an empty
// body / blank or over-cap reply / bad status enum are all rejected (→ 400). The clock is passed in so the
// stamped `at` is deterministic.
func TestBuildReviewModeration(t *testing.T) {
	id := uuid.New()
	at := time.Date(2026, 7, 12, 10, 0, 0, 0, time.UTC)

	// status only → status set + valid, reply untouched.
	arg, ok := buildReviewModeration(id, api.ReviewModeration{Status: ptrTo(api.ReviewStatus("published"))}, at)
	if !ok || !arg.Status.Valid || arg.Status.ReviewStatus != sqlc.ReviewStatusPublished || arg.SetReply {
		t.Fatalf("status-only: ok=%v arg=%+v", ok, arg)
	}

	// reply only → SetReply true with a trimmed body; status stays unset.
	arg, ok = buildReviewModeration(id, api.ReviewModeration{Reply: ptrTo("  Cảm ơn bạn nhé!  ")}, at)
	if !ok || !arg.SetReply || arg.Status.Valid {
		t.Fatalf("reply-only: ok=%v arg=%+v", ok, arg)
	}
	if !strings.Contains(string(arg.Reply), `"body":"Cảm ơn bạn nhé!"`) {
		t.Fatalf("reply not trimmed/marshaled: %s", arg.Reply)
	}

	// both status + reply.
	arg, ok = buildReviewModeration(id, api.ReviewModeration{
		Status: ptrTo(api.ReviewStatus("hidden")), Reply: ptrTo("Đã gửi hàng"),
	}, at)
	if !ok || !arg.Status.Valid || arg.Status.ReviewStatus != sqlc.ReviewStatusHidden || !arg.SetReply {
		t.Fatalf("both: ok=%v arg=%+v", ok, arg)
	}

	// empty body (neither field) → rejected: nothing to moderate.
	if _, ok := buildReviewModeration(id, api.ReviewModeration{}, at); ok {
		t.Error("empty moderation body should be rejected")
	}
	// blank reply → rejected.
	if _, ok := buildReviewModeration(id, api.ReviewModeration{Reply: ptrTo("   ")}, at); ok {
		t.Error("blank reply should be rejected")
	}
	// over-cap reply → rejected.
	if _, ok := buildReviewModeration(id, api.ReviewModeration{Reply: ptrTo(strings.Repeat("a", maxReviewReplyChars+1))}, at); ok {
		t.Error("over-cap reply should be rejected")
	}
	// invalid status enum → rejected.
	if _, ok := buildReviewModeration(id, api.ReviewModeration{Status: ptrTo(api.ReviewStatus("deleted"))}, at); ok {
		t.Error("invalid status should be rejected")
	}
}

// parseReviewStatusFilter maps the optional ?status= param: nil → all (nil filter), a known value → that
// status, an unknown value → not-ok (400).
func TestParseReviewStatusFilter(t *testing.T) {
	if f, ok := parseReviewStatusFilter(nil); !ok || f != nil {
		t.Fatalf("nil param: f=%v ok=%v, want nil/true", f, ok)
	}
	if f, ok := parseReviewStatusFilter(ptrTo(api.ReviewStatus("published"))); !ok || f == nil || *f != sqlc.ReviewStatusPublished {
		t.Fatalf("published: f=%v ok=%v", f, ok)
	}
	if _, ok := parseReviewStatusFilter(ptrTo(api.ReviewStatus("archived"))); ok {
		t.Error("invalid status filter should be rejected")
	}
}
