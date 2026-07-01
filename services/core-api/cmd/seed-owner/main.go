// Command seed-owner creates or rotates the first `owner` account's login credential (ADR-030,
// PR-3e-1). It reads OWNER_EMAIL + OWNER_PASSWORD (and optional OWNER_NAME) from the environment,
// bcrypt-hashes the password, and upserts an owner row via UpsertOwnerCredential — idempotent on
// email, so re-running rotates the password rather than erroring. No credential is ever committed
// to the repo: run this once at deploy time with the password supplied via the environment. See
// docs/operations.md. It reuses the same DATABASE_URL config the server loads.
package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/auth"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/config"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

func main() {
	if err := run(); err != nil {
		log.Fatalf("seed-owner: %v", err)
	}
}

func run() error {
	email := strings.ToLower(strings.TrimSpace(os.Getenv("OWNER_EMAIL")))
	password := os.Getenv("OWNER_PASSWORD")
	name := strings.TrimSpace(os.Getenv("OWNER_NAME"))
	if name == "" {
		name = "Chủ shop"
	}
	if email == "" || password == "" {
		return fmt.Errorf("OWNER_EMAIL and OWNER_PASSWORD are required (OWNER_NAME optional)")
	}
	if len(password) < 8 {
		return fmt.Errorf("OWNER_PASSWORD must be at least 8 characters")
	}

	hash, err := auth.HashPassword(password)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}

	ctx := context.Background()
	pool, err := db.Open(ctx, config.Load())
	if err != nil {
		return err
	}
	defer pool.Close()

	user, err := db.NewIdentity(pool).UpsertOwnerCredential(ctx, sqlc.UpsertOwnerCredentialParams{
		ID:           uuid.New(),
		Name:         name,
		Email:        email,
		PasswordHash: &hash,
	})
	if err != nil {
		return fmt.Errorf("upsert owner: %w", err)
	}
	log.Printf("seeded owner %q (id=%s, role=%s)", user.Email, user.ID, user.Role)
	return nil
}
