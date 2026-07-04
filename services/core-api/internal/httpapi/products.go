package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// Catalog-list paging bounds (PR-P1-c). oapi-codegen binds the query params' Go types but does NOT
// enforce their schema minimum/maximum, so these are the RUNTIME gate. maxPageSize bounds the LIMIT on
// this public, unauthenticated, rate-limit-free endpoint (mirrors price.go's maxQuoteItems); maxCatalogOffset
// bounds the OFFSET so a huge page number can never overflow the int32 OFFSET into a negative SQL value —
// a page beyond it is an empty page, not an error (generous for a made-to-order shop with no stock inventory).
const (
	defaultPageSize  = 12
	maxPageSize      = 48
	maxCatalogOffset = 100_000
	// maxSearchLen bounds the `?q=` full-text term (PR-P1-e) on this public, unauthenticated, rate-limit-free
	// endpoint — the same "bound every public input" stance as maxPageSize / price.go's maxQuoteItems. Product
	// names/descriptions are short, so 100 chars is generous; a longer term is a request-shape violation (400),
	// not a silent truncation, so a client can't smuggle a pathological string into plainto_tsquery.
	maxSearchLen = 100
)

// catalogCacheControl is the response cache directive for the public catalog list. It is a deliberately
// CONSERVATIVE, PROVISIONAL value: the storefront's real freshness strategy (a timed ISR window vs an
// on-write revalidateTag purge) is decided WITH the frontend PR (P1-f, user 2026-07-03) where the caching
// actually lives. The ETag is the primary validator here — a mutated price/stock/rating changes the body
// hash so a stale client revalidates to 304 or a fresh 200; max-age is only a short floor so a shared cache
// never serves badly stale money. Kept a package const (not an env knob) to avoid a NewServer/NewRouter
// signature change across ~13 call sites for a value that P1-f will supersede.
const catalogCacheControl = "public, max-age=60"

// GetProductBySlug handles GET /products/{slug} (PR-P1-a): the public storefront product-detail read.
// It is authPublic (classify) — no session needed. It returns the ACTIVE product for the slug bundled
// with its named print colors and customization options, or 404 for an unknown slug OR a draft/archived
// product. Both miss cases return the SAME 404 NOT_FOUND on purpose: the public surface must not let a
// caller distinguish a hidden (draft/archived) product from one that never existed (no catalog-existence
// probe — the same non-leak stance the checkout path takes with PRODUCT_UNAVAILABLE). Money crosses the
// wire raw int-VND (basePrice, priceDelta) — never formatted server-side (always-must #2); the frontend
// formats via @lumin/core. r.Context() propagates into every read so a client disconnect / 30s timeout
// cancels them.
func (s *Server) GetProductBySlug(ctx context.Context, request api.GetProductBySlugRequestObject) (api.GetProductBySlugResponseObject, error) {
	repo := db.NewCatalog(s.pool)

	p, err := repo.ProductBySlug(ctx, request.Slug)
	if err != nil {
		// db.ErrNotFound → 404 (unknown slug); any other error → 500.
		return nil, err
	}
	// Active-only: a draft/archived product is 404 to the public — identical to an unknown slug so the
	// response cannot be used to probe which hidden slugs exist. mapError renders db.ErrNotFound → 404.
	if p.Status != sqlc.ProductStatusActive {
		return nil, db.ErrNotFound
	}

	colors, err := repo.ColorsByProduct(ctx, p.ID)
	if err != nil {
		return nil, err
	}
	options, err := repo.OptionsByProduct(ctx, p.ID)
	if err != nil {
		return nil, err
	}

	dto, err := productDTO(p, colors, options)
	if err != nil {
		// Corrupt dimensions/images JSONB is a server data fault, not a client error → logged, 500.
		return nil, err
	}
	return api.GetProductBySlug200JSONResponse(dto), nil
}

// productDTO maps a product row + its colors/options into the wire Product. Split from the I/O (pure) so
// the field mapping — and the two JSONB decodes (dimensions object, images string array) — is pinned by a
// Docker-free unit test. Money stays raw int VND (never formatted server-side, always-must #2). colors,
// options and images are non-nil empty slices when absent so the JSON renders `[]`, never `null`
// (spec §03 zero-state).
func productDTO(p sqlc.Product, colors []sqlc.Color, options []sqlc.Option) (api.Product, error) {
	var dims api.Dimensions
	if err := json.Unmarshal(p.Dimensions, &dims); err != nil {
		return api.Product{}, fmt.Errorf("product %s: decode dimensions jsonb: %w", p.Slug, err)
	}
	images := []string{}
	if len(p.Images) > 0 {
		if err := json.Unmarshal(p.Images, &images); err != nil {
			return api.Product{}, fmt.Errorf("product %s: decode images jsonb: %w", p.Slug, err)
		}
	}
	return api.Product{
		Id:          p.ID,
		Slug:        p.Slug,
		Name:        p.Name,
		Description: p.Description,
		CategoryId:  p.CategoryID,
		BasePrice:   p.BasePrice, // raw int-VND, never formatted server-side (always-must #2)
		Dimensions:  dims,
		Material:    p.Material,
		Model3dUrl:  p.Model3dUrl,
		Images:      images,
		Colors:      colorsDTO(colors),
		Options:     optionsDTO(options),
		Status:      api.ProductStatus(p.Status),
		RatingAvg:   p.RatingAvg,
		ReviewCount: int(p.ReviewCount),
		CreatedAt:   p.CreatedAt.Time,
	}, nil
}

// colorsDTO maps color rows to the wire shape, dropping the internal productId. A nil/empty result yields
// a non-nil empty slice → JSON `[]`, not `null`.
func colorsDTO(rows []sqlc.Color) []api.Color {
	out := make([]api.Color, len(rows))
	for i, c := range rows {
		out[i] = api.Color{
			Id:         c.ID,
			Name:       c.Name,
			Hex:        c.Hex,
			Available:  c.Available,
			PriceDelta: c.PriceDelta, // raw int-VND (may be 0)
		}
	}
	return out
}

// optionsDTO maps option rows to the wire shape, dropping the internal productId and widening the
// nullable max_chars (int32) to the wire *int. A nil/empty result yields a non-nil empty slice → `[]`.
func optionsDTO(rows []sqlc.Option) []api.Option {
	out := make([]api.Option, len(rows))
	for i, o := range rows {
		out[i] = api.Option{
			Id:          o.ID,
			Label:       o.Label,
			Description: o.Description,
			Type:        api.OptionType(o.Type),
			PriceDelta:  o.PriceDelta, // raw int-VND (may be 0)
			MaxChars:    maxCharsPtr(o.MaxChars),
		}
	}
	return out
}

// maxCharsPtr widens the sqlc nullable *int32 to the wire *int (nil stays nil → JSON null).
func maxCharsPtr(v *int32) *int {
	if v == nil {
		return nil
	}
	n := int(*v)
	return &n
}

// GetProducts handles GET /products (PR-P1-c): the public storefront catalog list. It is authPublic
// (classify) — no session — and returns ONLY active products as a lightweight card projection (the
// ListActiveProducts query selects a subset of columns and makes NO per-product colors/options read →
// no N+1). Draft/archived products are never listed: the active-only filter lives in the SQL WHERE, so
// the public list cannot leak a hidden row (the same non-leak stance the detail read and checkout take).
//
// It is paginated (page/pageSize, bounded here since oapi-codegen ignores the schema min/max), sortable
// over a WHITELIST (newest|price_asc|price_desc|rating — never raw client text into ORDER BY), optionally
// filtered by category slug (an unknown slug → an empty page, not a 404), and — since P1-e — optionally
// searched by the `q` full-text term (ADR-016: accent-folded, so "den" matches "đèn"). Search is a filter
// ANDed inside the active-only scope (SQL), so it can never surface a hidden row; the term is length-bounded
// (maxSearchLen → 400) and parameterized through plainto_tsquery, never interpolated. Money (basePrice)
// crosses the wire raw int-VND (always-must #2). The response carries a weak ETag + a provisional
// Cache-Control (see catalogCacheControl); a matching If-None-Match short-circuits to 304 with no body (the
// ETag hashes the body, so it already varies by q). r.Context() propagates into every read so a client
// disconnect / 30s timeout cancels them.
func (s *Server) GetProducts(ctx context.Context, request api.GetProductsRequestObject) (api.GetProductsResponseObject, error) {
	badRequest := api.GetProducts400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}

	page, pageSize, ok := pageParams(request.Params.Page, request.Params.PageSize)
	if !ok {
		// page < 1, pageSize < 1, or pageSize > maxPageSize — a request-shape violation (400), enforced
		// here because oapi-codegen does not honor the schema's minimum/maximum. Bounds the LIMIT before
		// any DB read on this public, rate-limit-free endpoint.
		return badRequest, nil
	}
	sort, ok := sortParam(request.Params.Sort)
	if !ok {
		// An unrecognized sort token (only reachable if the generated enum binding is bypassed). Reject
		// rather than silently fall back, so ORDER BY is always a whitelisted value.
		return badRequest, nil
	}
	search, ok := searchParam(request.Params.Q)
	if !ok {
		// A search term over maxSearchLen — a request-shape violation (400), bounding the term before it
		// reaches plainto_tsquery on this public, rate-limit-free endpoint (oapi-codegen ignores maxLength).
		return badRequest, nil
	}

	// Guard the OFFSET before the multiply can overflow: a page far beyond any real catalog is an empty
	// page, so clamp the offset to maxCatalogOffset (the LIMIT then returns nothing) rather than let a
	// huge (page-1)*pageSize wrap negative into the SQL OFFSET. The comparison avoids the multiply.
	offset := maxCatalogOffset
	if page-1 <= maxCatalogOffset/pageSize {
		offset = (page - 1) * pageSize
	}

	rows, total, err := db.NewCatalog(s.pool).ListActiveProductCards(ctx, db.ProductCardFilter{
		CategorySlug: normalizeFilter(request.Params.Category),
		Search:       search,
		Sort:         sort,
		Limit:        int32(pageSize),
		Offset:       int32(offset),
	})
	if err != nil {
		return nil, err // db error → mapError (handleResponseError) → 500, no leak
	}

	cards, err := productCardsDTO(rows)
	if err != nil {
		// Corrupt images JSONB is a server data fault (can't happen: NOT NULL DEFAULT '[]', written only
		// via validated paths) → logged, 500. Hard-fail like the detail read rather than hide corruption.
		return nil, err
	}
	list := api.ProductList{Items: cards, Page: page, PageSize: pageSize, Total: int(total)}

	etag, err := weakETag(list)
	if err != nil {
		return nil, err // marshal fault → 500 (logged); never emit a bad validator
	}
	// NOTE: the ETag needs the body to hash, so a 304 still pays the two origin reads above — the
	// conditional GET saves BANDWIDTH, not origin compute. The scan+count amplification stays bounded by
	// maxPageSize/maxCatalogOffset; a real edge cache (revalidateTag/ISR) that offloads origin compute is
	// the P1-f caching decision (deliberately deferred, user 2026-07-03).
	if ifNoneMatch(request.Params.IfNoneMatch, etag) {
		return api.GetProducts304Response{Headers: api.GetProducts304ResponseHeaders{
			ETag: etag, CacheControl: catalogCacheControl,
		}}, nil
	}
	return api.GetProducts200JSONResponse{
		Body:    list,
		Headers: api.GetProducts200ResponseHeaders{ETag: etag, CacheControl: catalogCacheControl},
	}, nil
}

// pageParams applies the defaults for the omitted (nil) page/pageSize params and validates them against
// their bounds — the runtime enforcement oapi-codegen skips. It returns ok=false for page < 1, pageSize
// < 1, or pageSize > maxPageSize (all 400 VALIDATION at the call site).
func pageParams(pageP, sizeP *int) (page, pageSize int, ok bool) {
	page, pageSize = 1, defaultPageSize
	if pageP != nil {
		page = *pageP
	}
	if sizeP != nil {
		pageSize = *sizeP
	}
	if page < 1 || pageSize < 1 || pageSize > maxPageSize {
		return 0, 0, false
	}
	return page, pageSize, true
}

// sortParam maps the optional sort enum to the whitelisted token the SQL CASE understands. nil OR an
// empty-string value (`?sort=`) → the default "newest": an empty query value is treated as OMITTED, so
// it behaves like leaving the param off (and symmetric with normalizeFilter's handling of `?category=`).
// Any other value outside the enum → ok=false (400). The returned string is one of a fixed set, so it can
// never carry raw client text into the query's ORDER BY.
func sortParam(s *api.GetProductsParamsSort) (string, bool) {
	if s == nil || *s == "" {
		return string(api.Newest), true
	}
	switch *s {
	case api.Newest, api.PriceAsc, api.PriceDesc, api.Rating:
		return string(*s), true
	default:
		return "", false
	}
}

// searchParam normalizes the optional `?q=` full-text term (PR-P1-e). It trims surrounding whitespace and
// treats an empty/whitespace-only value as OMITTED (nil → no search filter), symmetric with how sortParam
// and normalizeFilter collapse an empty query value to the default — so `?q=` behaves exactly like leaving
// the param off (the full catalog), not an empty search that matches nothing. It returns ok=false (a 400 at
// the call site) for two request-shape violations oapi-codegen does not catch: a term longer than
// maxSearchLen (keeps a pathological term out of plainto_tsquery on this public, rate-limit-free endpoint;
// length measured in runes, not bytes, so a character bound is not tripped early by multi-byte Vietnamese
// text) OR a term carrying invalid UTF-8. The encoding check matters because Postgres rejects a non-UTF-8
// text parameter — without it, `?q=%ff` (RuneError bytes count <= the rune cap) would reach the query and
// surface as a client-caused 500; a malformed request is a 400, not a server fault.
func searchParam(q *string) (*string, bool) {
	if q == nil {
		return nil, true
	}
	trimmed := strings.TrimSpace(*q)
	if trimmed == "" {
		return nil, true
	}
	if !utf8.ValidString(trimmed) || utf8.RuneCountInString(trimmed) > maxSearchLen {
		return nil, false
	}
	return &trimmed, true
}

// normalizeFilter treats an empty-string query value as "omitted" (nil). A frontend commonly maps an
// "All categories" control to `?category=${selected}` with selected="" — without this, an empty slug is
// NOT NULL, so the SQL filter would run `slug = ”`, match no category, and return an empty page instead
// of the full catalog. Collapsing ""→nil makes `?category=` mean "all", identical to omitting the param.
func normalizeFilter(s *string) *string {
	if s != nil && *s == "" {
		return nil
	}
	return s
}

// productCardsDTO maps the projected list rows to wire cards. images is a non-nil empty slice when
// absent so the JSON renders `[]`, never `null` (spec §03 zero-state); money stays raw int-VND. A corrupt
// images JSONB hard-fails the whole page (consistent with the detail read) rather than silently dropping
// a cover — corruption should surface, and it cannot happen on the validated write paths.
func productCardsDTO(rows []sqlc.ListActiveProductsRow) ([]api.ProductCard, error) {
	out := make([]api.ProductCard, len(rows))
	for i, r := range rows {
		images := []string{}
		if len(r.Images) > 0 {
			if err := json.Unmarshal(r.Images, &images); err != nil {
				return nil, fmt.Errorf("product %s: decode images jsonb: %w", r.Slug, err)
			}
		}
		out[i] = api.ProductCard{
			Id:          r.ID,
			Slug:        r.Slug,
			Name:        r.Name,
			BasePrice:   r.BasePrice, // raw int-VND, never formatted server-side (always-must #2)
			CategoryId:  r.CategoryID,
			Images:      images,
			RatingAvg:   r.RatingAvg,
			ReviewCount: int(r.ReviewCount),
		}
	}
	return out, nil
}

// weakETag computes a WEAK validator over the marshaled list. Weak (W/) is correct: it asserts semantic
// equality of the representation (the strict layer re-marshals the body, so byte identity across encoders
// is not guaranteed), and a changed price/stock/rating/order changes the hash → a stale client revalidates.
// The page is a single bounded slice (<= maxPageSize cards) so the extra marshal is cheap.
func weakETag(v any) (string, error) {
	buf, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(buf)
	return `W/"` + hex.EncodeToString(sum[:16]) + `"`, nil
}

// ifNoneMatch reports whether the client's If-None-Match header matches the current ETag so the handler
// can answer 304. Per RFC 9110 §13.1.2 If-None-Match uses WEAK comparison (the W/ prefix is ignored) and
// a bare "*" matches any current representation; the header may be a comma-separated list.
func ifNoneMatch(header *string, etag string) bool {
	if header == nil {
		return false
	}
	want := strings.TrimPrefix(etag, "W/")
	for _, tok := range strings.Split(*header, ",") {
		tok = strings.TrimSpace(tok)
		if tok == "*" {
			return true
		}
		if strings.TrimPrefix(tok, "W/") == want {
			return true
		}
	}
	return false
}
