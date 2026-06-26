-- users.sql — staff/owner account queries (PR-2d). spec.md §02 User.

-- name: InsertUser :one
INSERT INTO users (id, name, email, role, active)
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = $1;
