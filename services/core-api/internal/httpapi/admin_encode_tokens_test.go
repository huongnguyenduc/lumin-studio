package httpapi

import (
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// Docker-free unit tests for the encode-token crypto + projection — the pure logic behind the scoped
// Shortcuts Bearer (000032_encode_tokens.up.sql). newRawEncodeToken/hashEncodeToken is the trust boundary
// authMiddleware's resolveEncodeToken relies on: the raw token must hash to exactly what gets looked up,
// and never collide/repeat.

func TestNewRawEncodeTokenHashesConsistently(t *testing.T) {
	raw, hash, err := newRawEncodeToken()
	if err != nil {
		t.Fatalf("newRawEncodeToken: %v", err)
	}
	if len(raw) <= len(encodeTokenPrefix) {
		t.Fatalf("raw token too short: %q", raw)
	}
	if raw[:len(encodeTokenPrefix)] != encodeTokenPrefix {
		t.Fatalf("raw token missing prefix: %q", raw)
	}
	if got := hashEncodeToken(raw); got != hash {
		t.Fatalf("hashEncodeToken(raw) = %q, want %q (must match what was stored)", got, hash)
	}
	raw2, hash2, err := newRawEncodeToken()
	if err != nil {
		t.Fatalf("newRawEncodeToken (2nd): %v", err)
	}
	if raw == raw2 || hash == hash2 {
		t.Fatal("two mints produced the same token/hash — crypto/rand not varying")
	}
}

func TestToEncodeTokenProjection(t *testing.T) {
	id := uuid.New()
	row := sqlc.EncodeToken{
		ID:        id,
		Label:     "iPhone Shortcuts",
		Scope:     encodeTokenScope,
		CreatedAt: pgtype.Timestamptz{Valid: true},
	}
	out := toEncodeToken(row)
	if out.Id != id || out.Label != "iPhone Shortcuts" || out.Scope != encodeTokenScope {
		t.Fatalf("projection wrong: %+v", out)
	}
	if out.Revoked {
		t.Fatal("unrevoked row projected as revoked")
	}
	if out.LastUsedAt != nil {
		t.Fatal("never-used row projected a lastUsedAt")
	}

	row.RevokedAt = pgtype.Timestamptz{Valid: true}
	if out := toEncodeToken(row); !out.Revoked {
		t.Fatal("revoked row (RevokedAt.Valid) not projected as revoked")
	}
}
