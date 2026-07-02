package httpapi

import (
	"context"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
)

// Not-implemented handler stubs (PR-3d scaffolding). *Server must satisfy the full
// api.StrictServerInterface so the contract compiles and every route is mounted; each
// stub returns errNotImplemented (rendered as 501 NOT_IMPLEMENTED, ErrorEnvelope) until
// its domain PR lands. Replace — do not add to — each stub as the real handler arrives:
//   LoginUser/LogoutUser → PR-3e-1 (done, see auth.go) ·
//   TransitionOrder → PR-3h (done, see transition.go) ·
//   CreateOrder → PR-3g (done, see checkout.go) ·
//   GetSettings/UpdateBankAccount/ListReplyTemplates → PR-3k (done, see settings.go).
// GetDashboard (PR-3i) is the last stub standing.

// GetDashboard is not implemented yet (PR-3i).
func (s *Server) GetDashboard(_ context.Context, _ api.GetDashboardRequestObject) (api.GetDashboardResponseObject, error) {
	return nil, errNotImplemented
}
