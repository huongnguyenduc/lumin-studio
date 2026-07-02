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
//   TransitionOrder → PR-3h (done, see transition.go) · CreateOrder → PR-3g ·
//   GetDashboard → PR-3i · GetSettings/UpdateBankAccount/ListReplyTemplates → PR-3k.

// GetDashboard is not implemented yet (PR-3i).
func (s *Server) GetDashboard(_ context.Context, _ api.GetDashboardRequestObject) (api.GetDashboardResponseObject, error) {
	return nil, errNotImplemented
}

// ListReplyTemplates is not implemented yet (PR-3k).
func (s *Server) ListReplyTemplates(_ context.Context, _ api.ListReplyTemplatesRequestObject) (api.ListReplyTemplatesResponseObject, error) {
	return nil, errNotImplemented
}

// GetSettings is not implemented yet (PR-3k).
func (s *Server) GetSettings(_ context.Context, _ api.GetSettingsRequestObject) (api.GetSettingsResponseObject, error) {
	return nil, errNotImplemented
}

// UpdateBankAccount is not implemented yet (PR-3k, owner-only).
func (s *Server) UpdateBankAccount(_ context.Context, _ api.UpdateBankAccountRequestObject) (api.UpdateBankAccountResponseObject, error) {
	return nil, errNotImplemented
}

// CreateOrder is not implemented yet (PR-3g; web public, inbox staff-gated).
func (s *Server) CreateOrder(_ context.Context, _ api.CreateOrderRequestObject) (api.CreateOrderResponseObject, error) {
	return nil, errNotImplemented
}
