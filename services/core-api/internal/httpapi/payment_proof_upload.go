package httpapi

import (
	"context"
	"errors"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/proofstore"
)

// errPaymentProofUploadNotConfigured is returned when the endpoint is hit but no S3/Garage
// credentials were wired (nil store). It maps to a generic 500 — the client cannot fix it and no
// signable contract exists — rather than leaking config state or issuing a partial upload form.
var errPaymentProofUploadNotConfigured = errors.New("httpapi: payment proof uploads not configured")

// CreatePaymentProofUpload handles POST /checkout/payment-proof-upload (P2-c). It returns a
// short-lived presigned POST form for one receipt image plus the host-pinned finalUrl the storefront
// later sends as paymentProofUrl to POST /orders. The image goes browser→Garage; core-api only signs
// the policy, so Cloudflare never proxies the receipt body (ADR-035). Public + rate-limited: it mints
// nothing money-bearing, only an upload contract, so a session is not required but abuse is throttled.
func (s *Server) CreatePaymentProofUpload(ctx context.Context, req api.CreatePaymentProofUploadRequestObject) (api.CreatePaymentProofUploadResponseObject, error) {
	if req.Body == nil {
		return createPaymentProofUploadBadRequest(), nil
	}
	if s.proofUploads == nil {
		return nil, errPaymentProofUploadNotConfigured
	}
	if !s.proofUploadLimiter.allow() {
		if s.logger != nil {
			s.logger.Warn("payment proof upload rate-limited")
		}
		return nil, errRateLimited
	}
	up, err := s.proofUploads.PresignPost(ctx, string(req.Body.ContentType))
	if errors.Is(err, proofstore.ErrInvalidContentType) {
		return createPaymentProofUploadBadRequest(), nil
	}
	if err != nil {
		return nil, err
	}
	return api.CreatePaymentProofUpload200JSONResponse(api.PaymentProofUpload{
		UploadUrl: up.UploadURL,
		Fields:    up.Fields,
		FinalUrl:  up.FinalURL,
		ExpiresAt: up.ExpiresAt,
		MaxBytes:  up.MaxBytes,
	}), nil
}

func createPaymentProofUploadBadRequest() api.CreatePaymentProofUpload400JSONResponse {
	return api.CreatePaymentProofUpload400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}
}
