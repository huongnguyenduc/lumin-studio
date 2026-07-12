-- users.sql — staff/owner account queries (PR-2d). spec.md §02 User.

-- name: InsertUser :one
INSERT INTO users (id, name, email, role, active)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: ListUsers :many
-- Team roster for the admin staff/roles surface (P3-q). Every account (owner + staff); owner first
-- (user_role orders by its declared order, owner < staff), then by name — deterministic, no pagination
-- (a made-to-order shop's team is small).
SELECT * FROM users ORDER BY role, name;

-- name: InsertUserWithCredential :one
-- Invite a staff/owner account WITH a login credential (P3-q). Unlike InsertUser (attribution-only, no
-- password), this sets password_hash so the invitee logs in immediately with the owner-set password.
-- active is forced true (an invited account is live). A duplicate email hits the UNIQUE(email) index →
-- 23505, surfaced as ErrDuplicate → 409 (Identity.InviteUser). role is validated to {owner,staff} in the
-- handler before it reaches the user_role enum.
INSERT INTO users (id, name, email, role, active, password_hash)
VALUES ($1, $2, $3, $4, true, $5)
RETURNING *;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = $1;

-- name: GetUserByID :one
-- Resolve a verified JWT's `sub` back to the authoritative user row (PR-3e-2 auth boundary).
-- The DB row — not the token claim — is the source of truth for role + active: a token minted
-- before a role change or deactivation must not outrank the current record.
SELECT * FROM users WHERE id = $1;

-- name: UpsertOwnerCredential :one
-- Seed or rotate the first owner's login credential (PR-3e-1, `make seed-owner`). Forces
-- role=owner + active=true and is idempotent on the UNIQUE email, so re-running it rotates the
-- password hash rather than failing. This is the ONLY writer of password_hash this slice; there
-- is no self-service change-password endpoint yet (deferred).
INSERT INTO users (id, name, email, role, active, password_hash)
VALUES ($1, $2, $3, 'owner', true, $4)
ON CONFLICT (email) DO UPDATE
  SET password_hash = EXCLUDED.password_hash,
      role          = 'owner',
      active        = true,
      name          = EXCLUDED.name
RETURNING *;
