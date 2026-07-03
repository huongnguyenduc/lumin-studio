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

-- ListActiveProducts is the storefront catalog list (PR-P1-c). It returns ACTIVE products ONLY as a
-- CARD projection (a subset of columns — no description/model3d_url, and no colors/options join → no
-- N+1). The optional category filter matches by category SLUG via an UNCORRELATED subquery (Postgres
-- runs it once as an InitPlan, not per row); an unknown slug simply matches no rows → an empty page,
-- never a 404. Sort is a WHITELISTED CASE so the ORDER BY can never be built from raw client text; the
-- non-selected CASE arms evaluate to a constant NULL and drop out, and created_at DESC, id DESC give a
-- deterministic TOTAL order so OFFSET pagination is stable across pages. @page_limit is bounded by the
-- handler (pageSize <= 48).
-- name: ListActiveProducts :many
SELECT id, slug, name, base_price, category_id, images, rating_avg, review_count
FROM products
WHERE status = 'active'
  AND (
    sqlc.narg('category_slug')::text IS NULL
    OR category_id = (SELECT id FROM categories WHERE slug = sqlc.narg('category_slug')::text)
  )
ORDER BY
  CASE WHEN @sort::text = 'price_asc'  THEN base_price END ASC,
  CASE WHEN @sort::text = 'price_desc' THEN base_price END DESC,
  CASE WHEN @sort::text = 'rating'     THEN rating_avg END DESC NULLS LAST,
  created_at DESC,
  id DESC
LIMIT @page_limit::int OFFSET @page_offset::int;

-- CountActiveProducts is the total for the list envelope — the SAME WHERE as ListActiveProducts, with no
-- sort/limit. It runs alongside the list as a second autocommit read; a concurrent catalog write landing
-- between the two can skew the total by one. That is cosmetic (a display count that self-heals next
-- request) on a made-to-order shop whose catalog rarely mutates, and it is never a money value — so we
-- accept it rather than pay for a snapshot transaction (documented on the repo method).
-- name: CountActiveProducts :one
SELECT count(*) FROM products
WHERE status = 'active'
  AND (
    sqlc.narg('category_slug')::text IS NULL
    OR category_id = (SELECT id FROM categories WHERE slug = sqlc.narg('category_slug')::text)
  );

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
