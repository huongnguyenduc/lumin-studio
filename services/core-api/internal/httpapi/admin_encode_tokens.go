package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// admin_encode_tokens.go — scoped, revocable Bearer tokens for an iOS Shortcuts automation that needs
// to call ONLY POST /admin/print-jobs/{id}/encode (see 000032_encode_tokens.up.sql). Owner-only for
// BOTH read and write (classify → authOwnerOnly, mirrors staff & roles): minting/revoking a standing
// credential is an owner power. Unlike the extension's ADR-043 bearer JWT (a full admin session token,
// good for every authRequired/authOwnerOnly route), this token authenticates NOTHING except the one
// scope it was minted for — see authMiddleware's scoped-token branch (middleware_auth.go).

// encodeTokenScope is the ONE scope this slice supports. A plain string column in the DB (not an enum)
// so a future second scope needs no migration; the Go side still only ever mints/checks this one.
const encodeTokenScope = "pettag_encode"

// encodeTokenPrefix marks a Bearer credential as an encode-token (vs. a session JWT) so authMiddleware
// can route it to the scoped-token lookup instead of auth.Verify without first trying (and failing) JWT
// parsing on every request.
const encodeTokenPrefix = "lumin_pat_"

// newRawEncodeToken mints 32 random bytes (crypto/rand, mirrors randHandleSuffix in db/pettag.go) as a
// hex-encoded token behind encodeTokenPrefix, plus its SHA-256 hash (hex) for storage — the raw value
// is returned to the caller exactly once and is never itself persisted or logged.
func newRawEncodeToken() (raw string, hash string, err error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", "", err
	}
	raw = encodeTokenPrefix + hex.EncodeToString(b)
	sum := sha256.Sum256([]byte(raw))
	return raw, hex.EncodeToString(sum[:]), nil
}

// hashEncodeToken hashes a presented raw token the same way, for the auth-middleware lookup.
func hashEncodeToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// ListEncodeTokens handles GET /admin/encode-tokens (owner-only): the token-management list. Never
// projects token_hash — only metadata (toEncodeToken).
func (s *Server) ListEncodeTokens(ctx context.Context, _ api.ListEncodeTokensRequestObject) (api.ListEncodeTokensResponseObject, error) {
	rows, err := db.NewIdentity(s.pool).ListEncodeTokens(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]api.EncodeToken, len(rows))
	for i, r := range rows {
		out[i] = toEncodeToken(r)
	}
	return api.ListEncodeTokens200JSONResponse(out), nil
}

// encodeTokenLabelMax mirrors the schema's maxLength: 80 — the strict server does not enforce
// schema string bounds, so this handler is the only guard (parseStaffInvite is the precedent). Counted
// in RUNES, not bytes: a Vietnamese label's diacritics are multi-byte UTF-8, so byte length would
// reject valid labels well under 80 visible characters.
const encodeTokenLabelMax = 80

// CreateEncodeToken handles POST /admin/encode-tokens (owner-only): mints a token scoped to
// EncodeTokenScope and returns the raw value ONCE (EncodeTokenCreated) — only its hash is persisted.
func (s *Server) CreateEncodeToken(ctx context.Context, req api.CreateEncodeTokenRequestObject) (api.CreateEncodeTokenResponseObject, error) {
	if req.Body == nil {
		return api.CreateEncodeToken400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	label := strings.TrimSpace(req.Body.Label)
	if label == "" || utf8.RuneCountInString(label) > encodeTokenLabelMax {
		return api.CreateEncodeToken400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	actor, ok := actorFrom(ctx)
	if !ok {
		// Unreachable in practice — classify(CreateEncodeToken) is authOwnerOnly, so authMiddleware
		// has already injected an owner actor before the handler runs. Fail closed, not a panic.
		return nil, errUnauthenticated
	}
	userID, err := uuid.Parse(actor.ByUser)
	if err != nil {
		return nil, err
	}
	raw, hash, err := newRawEncodeToken()
	if err != nil {
		return nil, err // crypto/rand fault → 500, never leaked
	}
	row, err := db.NewIdentity(s.pool).CreateEncodeToken(ctx, sqlc.InsertEncodeTokenParams{
		ID:        uuid.New(),
		UserID:    userID,
		Label:     label,
		TokenHash: hash,
		Scope:     encodeTokenScope,
	})
	if err != nil {
		return nil, err
	}
	out := toEncodeToken(row)
	return api.CreateEncodeToken201JSONResponse(api.EncodeTokenCreated{
		Id:         out.Id,
		Label:      out.Label,
		Scope:      out.Scope,
		CreatedAt:  out.CreatedAt,
		LastUsedAt: out.LastUsedAt,
		Revoked:    out.Revoked,
		Token:      raw,
	}), nil
}

// RevokeEncodeToken handles DELETE /admin/encode-tokens/{id} (owner-only): revokes immediately. An
// unknown or already-revoked id → 404 (ErrNotFound, distinguishable from "nothing to do" at the DB layer
// but both surface the same way to the caller).
func (s *Server) RevokeEncodeToken(ctx context.Context, req api.RevokeEncodeTokenRequestObject) (api.RevokeEncodeTokenResponseObject, error) {
	_, err := db.NewIdentity(s.pool).RevokeEncodeToken(ctx, req.Id)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			return api.RevokeEncodeToken404JSONResponse{NotFoundJSONResponse: api.NotFoundJSONResponse(envelope(codeNotFound))}, nil
		}
		return nil, err
	}
	return api.RevokeEncodeToken204Response{}, nil
}

// toEncodeToken projects a stored row to the wire shape — token_hash is never included.
func toEncodeToken(t sqlc.EncodeToken) api.EncodeToken {
	out := api.EncodeToken{
		Id:        t.ID,
		Label:     t.Label,
		Scope:     t.Scope,
		CreatedAt: t.CreatedAt.Time,
		Revoked:   t.RevokedAt.Valid,
	}
	if t.LastUsedAt.Valid {
		lu := t.LastUsedAt.Time
		out.LastUsedAt = &lu
	}
	return out
}
