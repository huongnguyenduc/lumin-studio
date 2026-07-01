-- catalog.sql — catalog read/write queries (PR-2c). spec.md §02. Inserts return the row so
-- callers (slice-3 admin handlers, tests) get the persisted record back.

-- name: InsertCategory :one
INSERT INTO categories (id, slug, name)
VALUES ($1, $2, $3)
RETURNING *;

-- name: InsertProduct :one
INSERT INTO products (
  id, slug, name, description, category_id, base_price, dimensions, material, model3d_url, images, status
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING *;

-- name: GetProductBySlug :one
SELECT * FROM products WHERE slug = $1;

-- GetProductByID is the by-id read the checkout handler (PR-3g) needs to derive a
-- server-authoritative UnitPrice from base_price (never a client price). ProductBySlug is the
-- storefront read; this is the intake read. Colors/options are validated via the existing
-- ListColorsByProduct / ListOptionsByProduct (membership + availability checked in-process).
-- name: GetProductByID :one
SELECT * FROM products WHERE id = $1;

-- name: ListProductsByStatus :many
SELECT * FROM products WHERE status = $1 ORDER BY created_at DESC;

-- name: InsertColor :one
INSERT INTO colors (id, product_id, name, hex, available, price_delta)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: ListColorsByProduct :many
SELECT * FROM colors WHERE product_id = $1 ORDER BY name;

-- name: InsertOption :one
INSERT INTO options (id, product_id, label, description, type, price_delta, max_chars)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: ListOptionsByProduct :many
SELECT * FROM options WHERE product_id = $1 ORDER BY label;

-- name: InsertReview :one
INSERT INTO reviews (id, product_id, customer_id, rating, body, images, reply, status)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;
