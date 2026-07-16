-- catalog.sql — catalog read/write queries (PR-2c). spec.md §02. Inserts return the row so
-- callers (slice-3 admin handlers, tests) get the persisted record back.

-- InsertCategory creates a category and APPENDS it to the end of the menu order (display_order = current
-- max + 1, or 0 for the first). description/image_url/visible take their column defaults ('', '', true) — a
-- new category is shown and un-described until the owner edits it. slug/name are the only create inputs
-- (design "+ Thêm danh mục"); the rich fields are set from the edit panel (UpdateCategory). The subquery
-- reads the pre-insert max (the new row is not visible to its own INSERT), so appends never collide.
-- name: InsertCategory :one
INSERT INTO categories (id, slug, name, display_order)
VALUES ($1, $2, $3, (SELECT coalesce(max(display_order) + 1, 0) FROM categories))
RETURNING *;

-- ListCategories is the storefront category list (PR-P1-d): the BROWSABLE taxonomy the catalog-browse chips
-- render (spec §02). It returns only categories that contain at least one ACTIVE product — the EXISTS
-- subquery applies the SAME non-leak-at-the-SQL-source discipline as ListActiveProducts (CAT-02). A category
-- whose only products are draft/archived (products default to status='draft', and category_id is NOT NULL),
-- or which is empty, is a hidden grouping: surfacing it would both dead-end the chip (→ an empty
-- /products?category= page) AND leak an unreleased category name — the exact catalog-existence info the
-- product reads deliberately withhold. Categories are a small, admin-curated, near-static set (created only
-- via admin CreateCategory — no user-generated path), so there is no filter/pagination: the browsable set
-- fits one response. The order is a deterministic TOTAL order (name first for a human-friendly A→Z, slug —
-- UNIQUE — as the tiebreak) so two categories sharing a display name never flap position; a stable order
-- keeps the response ETag stable. No browsable category → zero rows → the handler renders `[]`, not 404.
-- Two gates now decide menu membership (P3-o slice o-2): the owner's explicit `visible` toggle AND the
-- active-product EXISTS — a category shows iff BOTH hold (an owner hide removes a category with active
-- products from the menu; the auto-hide still catches empty/draft-only ones). Ordered by the owner-set
-- display_order first (the drag-to-reorder result), then name/slug as the deterministic tiebreak.
-- name: ListCategories :many
SELECT * FROM categories
WHERE visible AND EXISTS (SELECT 1 FROM products WHERE products.category_id = categories.id AND products.status = 'active')
ORDER BY display_order, name, slug;

-- ListAllCategories is the ADMIN category list (P3-o) — the INTERNAL projection that returns EVERY category,
-- including empty ones and those whose only products are draft/archived, unlike the storefront-facing
-- ListCategories (which hides categories with no ACTIVE product). Each row carries product_count = the number
-- of products referencing it across ALL statuses (LEFT JOIN so an empty category still appears, with count 0).
-- That count is the load-bearing admin figure: it tells the owner which categories are safe to delete (a
-- non-zero count means DeleteCategory will trip the products.category_id FK → 409). No pagination — categories
-- are a small, admin-curated set (same "fits one response" scale as ListCategories/ListAdminProducts). Ordered
-- by the owner-set display_order first (so the admin list mirrors the storefront menu order the owner is
-- arranging), then name/slug as the deterministic tiebreak. Unlike ListCategories it does NOT filter on
-- `visible` — the admin sees hidden categories too (with their toggle off), that is the point of the screen.
-- name: ListAllCategories :many
SELECT c.*, count(p.id) AS product_count
FROM categories c
LEFT JOIN products p ON p.category_id = c.id
GROUP BY c.id
ORDER BY c.display_order, c.name, c.slug;

-- UpdateCategory saves a category's editable fields (P3-o): slug, name, and the o-2 menu metadata
-- (description, image_url, visible). display_order is NOT set here — it moves only via ReorderCategories
-- (the drag), so a Save from the edit panel never disturbs the menu order. slug stays mutable — a changed
-- slug that collides with another category trips the UNIQUE(slug) constraint, which the handler maps to a
-- 400 field error (never a 500), mirroring UpdateProduct. RETURNING so an unknown id (0 rows → ErrNoRows)
-- surfaces as 404.
-- name: UpdateCategory :one
UPDATE categories
SET slug = $2, name = $3, description = $4, image_url = $5, visible = $6
WHERE id = $1
RETURNING *;

-- ReorderCategories sets each category's display_order to its position in the given id list (0-based), in
-- one atomic statement over the whole ordered set the admin drag produced. unnest(... ) WITH ORDINALITY
-- pairs each id with its 1-based index (ord), minus 1 for a 0-based order. Ids absent from the list keep
-- their current order (the FE sends the FULL list after a drag, so that is a no-op in practice); an unknown
-- id matches no row (harmless). Owner-only at the handler.
-- name: ReorderCategories :exec
UPDATE categories AS c
SET display_order = v.ord - 1
FROM (SELECT id, ord FROM unnest(@ids::uuid[]) WITH ORDINALITY AS t(id, ord)) AS v
WHERE c.id = v.id;

-- DeleteCategory is a HARD delete, allowed only for a category no product references: products.category_id is
-- NOT NULL REFERENCES categories(id) with the default NO ACTION (migration 000003), so deleting a category
-- still in use raises a foreign_key_violation the handler maps to 409 CATEGORY_IN_USE (reassign or archive the
-- products first). RETURNING id so a missing row surfaces as ErrNoRows→404, mirroring DeleteProduct.
-- name: DeleteCategory :one
DELETE FROM categories WHERE id = $1 RETURNING id;

-- name: InsertProduct :one
INSERT INTO products (
  id, slug, name, description, category_id, base_price, dimensions, material, model3d_url, images, status, est_filament_qty, est_print_minutes
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
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

-- ListAdminProducts is the admin catalog list (P3-j / P3-k) — the INTERNAL projection that shows EVERY
-- status (active/draft/archived), unlike the storefront's active-only ListActiveProducts (ADR-032: admin
-- may see unreleased rows). The optional status narg drives the "Tất cả/Đang bán/Nháp/Lưu trữ" tabs: NULL =
-- all statuses, else exact-match. No pagination/count — a made-to-order catalog is small and admin-curated
-- (same "fits one response" scale as ListCategories), so the FE lists+searches the whole set client-side;
-- add a page window here if the catalog ever grows large. Newest first with an id tiebreak = deterministic
-- total order.
-- name: ListAdminProducts :many
SELECT * FROM products
WHERE (sqlc.narg('status')::product_status IS NULL OR status = sqlc.narg('status')::product_status)
ORDER BY created_at DESC, id DESC;

-- UpdateProduct saves the editable fields of a product (P3-j). It deliberately does NOT touch model3d_url:
-- that column is owned by the asset pipeline (P3-j-b sets it when a model finishes ingesting), so the
-- product editor form can never blank it. slug stays mutable — a changed slug that collides trips the
-- UNIQUE(slug) constraint, which the handler maps to a 400 field error (never a 500).
-- name: UpdateProduct :one
UPDATE products
SET slug = $2, name = $3, description = $4, category_id = $5, base_price = $6,
    dimensions = $7, material = $8, images = $9, status = $10, est_filament_qty = $11, est_print_minutes = $12
WHERE id = $1
RETURNING *;

-- UpdateProductModelView persists the owner's saved default 3D-viewer camera pose (ADR-038) as the whole
-- atomic model3d_view jsonb blob ({orbitTheta,orbitPhi,orbitRadius,targetX,targetY,targetZ}). It is a
-- separate write from UpdateProduct (the design's "Lưu góc mặc định" is its own button) and touches no
-- other column — never pricing. :execrows so an unknown id (0 rows) surfaces as ErrNoRows→404; the handler
-- returns 204 (the editor keeps the pose it just sent — nothing new to echo).
-- name: UpdateProductModelView :execrows
UPDATE products SET model3d_view = $2 WHERE id = $1;

-- SetProductModel3dUrl is the asset pipeline's write of the LOD glb URL (the column UpdateProduct
-- deliberately never touches). Called only from the worker render callback (ReportAssetJobResult) when a
-- `model_ingest` job reaches `ready`, so the storefront's on-demand 3D viewer has a model to load. The
-- URL is host-pinned to the assets origin at the HTTP boundary before it reaches here. :execrows so a
-- vanished product surfaces (0 rows) — though asset_jobs.product_id is RESTRICT, so it should always hit 1.
-- name: SetProductModel3dUrl :execrows
UPDATE products SET model3d_url = $2 WHERE id = $1;

-- SetProductSpriteSheetUrl is the asset pipeline's write of the 360° sprite-sheet URL (ADR-049) — the
-- sprite_render analogue of SetProductModel3dUrl. Called only from the render callback when a
-- `sprite_render` job reaches `ready`, so the storefront's card hover + no-WebGL fallback have a sheet to
-- show. The URL is host-pinned (.webp under the assets origin) at the HTTP boundary before it reaches here.
-- UpdateProduct never touches this column. :execrows so a vanished product surfaces (0 rows).
-- name: SetProductSpriteSheetUrl :execrows
UPDATE products SET sprite_sheet_url = $2 WHERE id = $1;

-- SetProductModelObjectNames is the asset pipeline's write of the object-name LIST a `model_ingest` found
-- in the source model (f-2) — the editor dropdown's option set for mapping parts to model objects. Called
-- only from the render callback when a `model_ingest` job reaches `ready`, alongside SetProductModel3dUrl.
-- UpdateProduct never touches this column. :execrows so a vanished product surfaces (0 rows).
-- name: SetProductModelObjectNames :execrows
UPDATE products SET model_object_names = $2 WHERE id = $1;

-- DeleteProduct is a HARD delete, allowed only for never-ordered/never-rendered products (drafts, mistakes):
-- order_items and asset_jobs reference products ON DELETE RESTRICT (migrations 000005/000006), so deleting a
-- product with history raises a foreign_key_violation the handler maps to 409 "hãy lưu trữ thay vì xoá" — the
-- reversible "remove from store" path is PATCH status→archived. colors/options are ON DELETE CASCADE, so a
-- successful delete cleans them up. RETURNING id so a missing row surfaces as ErrNoRows→404.
-- name: DeleteProduct :one
DELETE FROM products WHERE id = $1 RETURNING id;

-- ListActiveProducts is the storefront catalog list (PR-P1-c). It returns ACTIVE products ONLY as a
-- CARD projection (a subset of columns — no description/model3d_url [the .glb loads on the detail page,
-- not the card], but sprite_sheet_url IS included for the card-hover turntable [ADR-049], and no
-- colors/options join → no N+1). The optional category filter matches by category SLUG via an UNCORRELATED subquery (Postgres
-- runs it once as an InitPlan, not per row); an unknown slug simply matches no rows → an empty page,
-- never a 404. Sort is a WHITELISTED CASE so the ORDER BY can never be built from raw client text; the
-- non-selected CASE arms evaluate to a constant NULL and drop out, and created_at DESC, id DESC give a
-- deterministic TOTAL order so OFFSET pagination is stable across pages. @page_limit is bounded by the
-- handler (pageSize <= 48).
--
-- The optional @search predicate (PR-P1-e, ADR-016) is the no-accent full-text filter: it is ANDed INSIDE
-- the active-only + category scope, so search can NEVER surface a draft/archived row (the same non-leak
-- discipline as the base list). The client term is never interpolated — it is parameterized through
-- plainto_tsquery, and both sides are accent-folded via immutable_unaccent so "den" matches "đèn". The
-- to_tsvector expression is byte-identical to the products_search_idx functional GIN index (000012) so the
-- planner uses it. NULL search (the common case) short-circuits to the exact pre-P1-e query — no regression.
-- Sort is unchanged under search (still the whitelist, default newest): ADR-016 scopes this to exact-token
-- matching on a tiny catalog, so relevance ranking (ts_rank) is a deliberate non-goal (it would also mean a
-- new sort enum value — a contract change P1-e avoids).
-- name: ListActiveProducts :many
SELECT id, slug, name, base_price, category_id, images, sprite_sheet_url, rating_avg, review_count
FROM products
WHERE status = 'active'
  AND (
    sqlc.narg('category_slug')::text IS NULL
    OR category_id = (SELECT id FROM categories WHERE slug = sqlc.narg('category_slug')::text)
  )
  AND (
    sqlc.narg('search')::text IS NULL
    OR to_tsvector('simple', immutable_unaccent(name || ' ' || description))
       @@ plainto_tsquery('simple', immutable_unaccent(sqlc.narg('search')::text))
  )
ORDER BY
  CASE WHEN @sort::text = 'price_asc'  THEN base_price END ASC,
  CASE WHEN @sort::text = 'price_desc' THEN base_price END DESC,
  CASE WHEN @sort::text = 'rating'     THEN rating_avg END DESC NULLS LAST,
  created_at DESC,
  id DESC
LIMIT @page_limit::int OFFSET @page_offset::int;

-- CountActiveProducts is the total for the list envelope — the SAME WHERE as ListActiveProducts (including
-- the P1-e @search filter, so the envelope total reflects the SEARCHED set, not the whole catalog), with no
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
  )
  AND (
    sqlc.narg('search')::text IS NULL
    OR to_tsvector('simple', immutable_unaccent(name || ' ' || description))
       @@ plainto_tsquery('simple', immutable_unaccent(sqlc.narg('search')::text))
  );

-- InsertColor takes an optional part_id (ADR-037): NULL = flat product-level colour (legacy/default);
-- set = the colour belongs to that part. The handler validates the part ∈ the same product first
-- (GetPartByProduct) so a colour can never be grouped under another product's part.
-- name: InsertColor :one
INSERT INTO colors (id, product_id, name, hex, available, price_delta, part_id, filament_material_id)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: ListColorsByProduct :many
SELECT * FROM colors WHERE product_id = $1 ORDER BY name;

-- UpdateColor / DeleteColor are scoped by BOTH id AND product_id (P3-j) so a colorId belonging to another
-- product (a mismatched /products/{id}/colors/{colorId} path) matches no row → ErrNoRows→404, never a
-- cross-product edit. RETURNING lets the handler 404 on a stale id.
-- name: UpdateColor :one
UPDATE colors
SET name = $3, hex = $4, available = $5, price_delta = $6, part_id = $7, filament_material_id = $8
WHERE id = $1 AND product_id = $2
RETURNING *;

-- name: DeleteColor :one
DELETE FROM colors WHERE id = $1 AND product_id = $2 RETURNING id;

-- name: InsertOption :one
INSERT INTO options (id, product_id, label, description, type, price_delta, max_chars)
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: ListOptionsByProduct :many
SELECT * FROM options WHERE product_id = $1 ORDER BY label;

-- UpdateOption / DeleteOption are scoped by BOTH id AND product_id (P3-j), same cross-product guard as the
-- color mutations: an optionId under the wrong product → no row → 404.
-- name: UpdateOption :one
UPDATE options
SET label = $3, description = $4, type = $5, price_delta = $6, max_chars = $7
WHERE id = $1 AND product_id = $2
RETURNING *;

-- name: DeleteOption :one
DELETE FROM options WHERE id = $1 AND product_id = $2 RETURNING id;

-- name: InsertReview :one
INSERT INTO reviews (id, product_id, customer_id, rating, body, images, reply, status)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- ListReviewsByProduct is the storefront product-review list (PR-P1-l). It returns PUBLISHED reviews
-- ONLY — the status='published' predicate lives HERE at the SQL source, the same non-leak discipline as
-- ListActiveProducts' status='active': a hidden (moderated-away) review can never surface on the public
-- list, no matter what the handler does. It is a CONTENT projection — id/rating/body/images/reply/
-- created_at, but NOT customer_id — so no reviewer PII (a nullable FK; guests may review) ever leaves the
-- DB for this public endpoint. Newest first with an id tiebreak gives a deterministic TOTAL order so
-- OFFSET pagination is stable across pages and the response ETag stays stable; @page_limit is bounded by
-- the handler (pageSize <= 48). No sort arm in Phase 1 (newest only — an additive sort is a later PR).
-- name: ListReviewsByProduct :many
SELECT id, rating, body, images, reply, created_at
FROM reviews
WHERE product_id = @product_id AND status = 'published'
ORDER BY created_at DESC, id DESC
LIMIT @page_limit::int OFFSET @page_offset::int;

-- CountPublishedReviewsByProduct is the total for the review-list envelope — the SAME product_id +
-- status='published' filter as ListReviewsByProduct, no sort/limit. It runs alongside the list as a
-- second autocommit read; a concurrent review write between the two can skew the total by one. That is
-- cosmetic (a display count that self-heals next request) and never a money value, so we accept it
-- rather than pay for a snapshot transaction (documented on the repo method).
-- name: CountPublishedReviewsByProduct :one
SELECT count(*) FROM reviews
WHERE product_id = @product_id AND status = 'published';

-- ListAllReviews is the ADMIN review-moderation list (P3-m) — EVERY review across ALL products, both
-- 'published' AND 'hidden' (the moderation surface, unlike the storefront ListReviewsByProduct which is
-- published-only at the SQL source). It is the INTERNAL projection: it JOINs the product name (for "review
-- on <product>") and LEFT JOINs the reviewer's name (customer_id is nullable — guests may review — so
-- customer_name is null for a guest). Reviewer identity is admin-only PII (PDPL): it appears here behind the
-- admin auth wall, never on the public Review. Optional status filter (nullable narg = Tất cả / a tab),
-- mirroring ListAdminProducts. No pagination — a made-to-order shop's review set is small and the FE derives
-- its tabs (Chờ trả lời / Đã trả lời / Có ảnh) client-side. -- ponytail: add a page window here if reviews
-- ever grow large. Newest first with an id tiebreak = a deterministic total order.
-- name: ListAllReviews :many
SELECT r.id, r.product_id, p.name AS product_name, r.customer_id, c.name AS customer_name,
       r.rating, r.body, r.images, r.reply, r.status, r.created_at
FROM reviews r
JOIN products p ON p.id = r.product_id
LEFT JOIN customers c ON c.id = r.customer_id
WHERE (sqlc.narg('status')::review_status IS NULL OR r.status = sqlc.narg('status')::review_status)
ORDER BY r.created_at DESC, r.id DESC;

-- UpdateReviewModeration is the admin moderation write (P3-m): change a review's status (publish ↔ hide)
-- and/or set its shop reply, in one partial UPDATE. status is a nullable narg (omit ⇒ unchanged, via
-- coalesce). reply is touched only when @set_reply is true (so a plain hide/unhide leaves an existing reply
-- intact); the handler builds the {body, at} jsonb (or passes it through). No outbox — review moderation is
-- an internal content decision, not a domain event (plan §5). RETURNING id so an unknown id (0 rows →
-- ErrNoRows) surfaces as 404; the handler answers 204 (the FE re-reads the list).
-- name: UpdateReviewModeration :one
UPDATE reviews
SET status = coalesce(sqlc.narg('status')::review_status, status),
    reply  = CASE WHEN @set_reply::boolean THEN sqlc.narg('reply') ELSE reply END
WHERE id = @id
RETURNING id;

-- === ADR-037 configurator: parts (named part groups, each with its own colour set) ===

-- name: InsertPart :one
INSERT INTO parts (id, product_id, name, display_order, est_filament_qty, model_object_name)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: ListPartsByProduct :many
SELECT * FROM parts WHERE product_id = $1 ORDER BY display_order, id;

-- GetPartByProduct scopes a part to its product — the colour handlers call it to validate that a colour's
-- claimed partId belongs to the SAME product before assigning it (ADR-037: colour ∈ part ∈ product), so a
-- colour can never be grouped under another product's part. Missing → ErrNoRows → 400 field(partId).
-- name: GetPartByProduct :one
SELECT * FROM parts WHERE id = $1 AND product_id = $2;

-- UpdatePart / DeletePart are scoped by BOTH id AND product_id (a partId under another product → no row →
-- 404), the same cross-product guard as UpdateColor/UpdateOption. Deleting a part CASCADEs its colours
-- (000015); a colour pinned by an order_item (FK NO ACTION) blocks the delete → 23503 → 409 (archive).
-- name: UpdatePart :one
UPDATE parts SET name = $3, display_order = $4, est_filament_qty = $5, model_object_name = $6
WHERE id = $1 AND product_id = $2
RETURNING *;

-- name: DeletePart :one
DELETE FROM parts WHERE id = $1 AND product_id = $2 RETURNING id;

-- === ADR-037 configurator: option choices (enumerated values for a `choice` option) ===

-- name: InsertOptionChoice :one
INSERT INTO option_choices (id, option_id, label, description, price_delta, display_order)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- ListChoicesByProduct returns every option_choice for a product's options (joined via options.product_id),
-- for the editor's Product-detail assembly (the handler groups them by option_id into Option.choices[]).
-- Ordered by option then display_order for a deterministic nesting.
-- name: ListChoicesByProduct :many
SELECT oc.* FROM option_choices oc
JOIN options o ON o.id = oc.option_id
WHERE o.product_id = $1
ORDER BY oc.option_id, oc.display_order, oc.id;

-- GetOptionByProduct scopes an option to its product — the choice handlers call it to validate the
-- {optionId} in the path belongs to {id} before touching its choices (a choice under another product's
-- option → 404), the option-level analogue of the (id, product_id) scoping on colours/options.
-- name: GetOptionByProduct :one
SELECT * FROM options WHERE id = $1 AND product_id = $2;

-- UpdateOptionChoice / DeleteOptionChoice are scoped by BOTH id AND option_id (a choiceId under another
-- option → no row → 404); the handler has already confirmed the option ∈ product via GetOptionByProduct.
-- name: UpdateOptionChoice :one
UPDATE option_choices SET label = $3, description = $4, price_delta = $5, display_order = $6
WHERE id = $1 AND option_id = $2
RETURNING *;

-- name: DeleteOptionChoice :one
DELETE FROM option_choices WHERE id = $1 AND option_id = $2 RETURNING id;
