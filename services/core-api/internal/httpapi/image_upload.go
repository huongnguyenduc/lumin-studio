package httpapi

import (
	"context"
	"errors"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/proofstore"
)

// errImageUploadNotConfigured mirrors the payment-proof case: the endpoint was hit but no lumin-assets
// image signer was wired (nil store). It maps to a generic 500 — the client cannot fix it and no signable
// contract exists — rather than leaking config state or issuing a partial upload form.
var errImageUploadNotConfigured = errors.New("httpapi: image uploads not configured")

// CreateImageUpload handles POST /uploads/image (P3-t t-6, P3-l). It returns a short-lived presigned POST
// form for one PERMANENT public image — a pet-page photo or a product-gallery photo — plus the host-pinned
// finalUrl the caller stores. Identical browser→Garage flow to CreatePaymentProofUpload (core-api only
// signs the policy, never proxies the body), but the object lands in the world-readable lumin-assets bucket
// with NO retention sweeper, so a lost pet's photo is never swept by payment-proof retention (t-6). Public +
// rate-limited: it mints nothing money-bearing, only an upload contract, so a session is not required but
// abuse is throttled.
func (s *Server) CreateImageUpload(ctx context.Context, req api.CreateImageUploadRequestObject) (api.CreateImageUploadResponseObject, error) {
	if req.Body == nil {
		return createImageUploadBadRequest(), nil
	}
	if s.imageUploads == nil {
		return nil, errImageUploadNotConfigured
	}
	if !s.imageUploadLimiter.allow() {
		if s.logger != nil {
			s.logger.Warn("image upload rate-limited")
		}
		return nil, errRateLimited
	}
	up, err := s.imageUploads.PresignPost(ctx, string(req.Body.ContentType))
	if errors.Is(err, proofstore.ErrInvalidContentType) {
		return createImageUploadBadRequest(), nil
	}
	if err != nil {
		return nil, err
	}
	return api.CreateImageUpload200JSONResponse(api.ImageUpload{
		UploadUrl: up.UploadURL,
		Fields:    up.Fields,
		FinalUrl:  up.FinalURL,
		ExpiresAt: up.ExpiresAt,
		MaxBytes:  up.MaxBytes,
	}), nil
}

func createImageUploadBadRequest() api.CreateImageUpload400JSONResponse {
	return api.CreateImageUpload400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}
}
