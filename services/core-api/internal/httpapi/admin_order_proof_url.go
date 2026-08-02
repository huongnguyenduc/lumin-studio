package httpapi

import (
	"context"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
)

// GetAdminOrderProofUrl handles GET /admin/orders/{id}/proof-url (P3-x). The payment-proof/refund-proof/
// QC-photo bucket is private by design (ADR-046 — no anon read, no website alias) and Garage has no
// anonymous GET, so `order.paymentProofUrl` etc. were previously unviewable by admin at all (a real gap,
// not a misconfiguration — grep found no presigned-GET anywhere before this). This mints a short-lived
// signed GET so the admin UI can render an <img>. authRequired (owner AND staff — same read tier as
// GetAdminOrder). Reads the URL off the order itself (never from client input) and re-runs the proofstore
// host-pin (OwnsURL) before signing, so this can only ever produce a URL for an object the shop actually
// issued — never sign an arbitrary caller-supplied URL.
func (s *Server) GetAdminOrderProofUrl(ctx context.Context, req api.GetAdminOrderProofUrlRequestObject) (api.GetAdminOrderProofUrlResponseObject, error) {
	if s.proofUploads == nil {
		return nil, errPaymentProofUploadNotConfigured
	}
	row, err := db.NewOrders(s.pool).ByID(ctx, req.Id)
	if err != nil {
		return nil, err // ErrNotFound → 404; any other db fault → 500 (mapError, no leak)
	}
	var raw *string
	switch req.Params.Kind {
	case api.Payment:
		raw = row.PaymentProofUrl
	case api.Refund:
		raw = row.RefundProofUrl
	case api.Qc:
		raw = row.QcPhotoUrl
	default:
		return api.GetAdminOrderProofUrl400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	if raw == nil || *raw == "" {
		return api.GetAdminOrderProofUrl404JSONResponse{NotFoundJSONResponse: api.NotFoundJSONResponse(envelope(codeNotFound))}, nil
	}
	url, expiresAt, err := s.proofUploads.PresignGet(ctx, *raw, 0)
	if err != nil {
		// Not owned by this store, or a signing fault — either way there is nothing safe to return.
		return api.GetAdminOrderProofUrl404JSONResponse{NotFoundJSONResponse: api.NotFoundJSONResponse(envelope(codeNotFound))}, nil
	}
	return api.GetAdminOrderProofUrl200JSONResponse(api.SignedAssetUrl{Url: url, ExpiresAt: expiresAt}), nil
}
