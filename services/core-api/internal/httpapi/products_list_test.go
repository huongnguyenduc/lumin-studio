package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"testing"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// Docker-free unit tests for the GET /products (PR-P1-c) building blocks: the paging/sort validation
// oapi-codegen skips, the card mapping, and the ETag/If-None-Match conditional-GET logic. The full
// end-to-end (active-only non-leak, filter, sort, paginate, 304) is in products_list_integration_test.go.

func ptrTo[T any](v T) *T { return &v }

func TestPageParams(t *testing.T) {
	cases := []struct {
		name             string
		page, size       *int
		wantPage, wantSz int
		wantOK           bool
	}{
		{"both nil → defaults", nil, nil, 1, defaultPageSize, true},
		{"explicit valid", ptrTo(3), ptrTo(24), 3, 24, true},
		{"pageSize at max ok", ptrTo(1), ptrTo(maxPageSize), 1, maxPageSize, true},
		{"page < 1 rejected", ptrTo(0), ptrTo(12), 0, 0, false},
		{"negative page rejected", ptrTo(-1), ptrTo(12), 0, 0, false},
		{"pageSize < 1 rejected", ptrTo(1), ptrTo(0), 0, 0, false},
		{"pageSize over max rejected (DoS bound)", ptrTo(1), ptrTo(maxPageSize + 1), 0, 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			page, size, ok := pageParams(tc.page, tc.size)
			if ok != tc.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tc.wantOK)
			}
			if ok && (page != tc.wantPage || size != tc.wantSz) {
				t.Errorf("page/size = %d/%d, want %d/%d", page, size, tc.wantPage, tc.wantSz)
			}
		})
	}
}

func TestSortParam(t *testing.T) {
	if got, ok := sortParam(nil); !ok || got != "newest" {
		t.Errorf("nil sort = %q/%v, want newest/true (default)", got, ok)
	}
	// An empty-string sort (?sort=) is treated as OMITTED → newest, symmetric with normalizeFilter.
	empty := api.GetProductsParamsSort("")
	if got, ok := sortParam(&empty); !ok || got != "newest" {
		t.Errorf("empty sort = %q/%v, want newest/true (empty == omitted)", got, ok)
	}
	for _, v := range []api.GetProductsParamsSort{api.Newest, api.PriceAsc, api.PriceDesc, api.Rating} {
		if got, ok := sortParam(&v); !ok || got != string(v) {
			t.Errorf("sort %q = %q/%v, want %q/true", v, got, ok, v)
		}
	}
	bad := api.GetProductsParamsSort("'; DROP TABLE products;--")
	if got, ok := sortParam(&bad); ok || got != "" {
		t.Errorf("unrecognized sort = %q/%v, want \"\"/false (never raw text into ORDER BY)", got, ok)
	}
}

func TestNormalizeFilter(t *testing.T) {
	if got := normalizeFilter(nil); got != nil {
		t.Errorf("nil → %v, want nil", got)
	}
	// Empty string (?category=) collapses to nil so it means "all categories", not an empty-slug filter.
	if got := normalizeFilter(ptrTo("")); got != nil {
		t.Errorf("empty string → %v, want nil (== omitted, all categories)", got)
	}
	if got := normalizeFilter(ptrTo("den")); got == nil || *got != "den" {
		t.Errorf("\"den\" → %v, want unchanged", got)
	}
}

func TestProductCardsDTO(t *testing.T) {
	id, cat := uuid.New(), uuid.New()
	rating := float32(4.5)
	rows := []sqlc.ListActiveProductsRow{
		{ID: id, Slug: "den-mochi", Name: "Đèn Mochi", BasePrice: 290_000, CategoryID: cat,
			Images: []byte(`["https://x/1.jpg","https://x/2.jpg"]`), RatingAvg: &rating, ReviewCount: 128},
		{ID: uuid.New(), Slug: "moc-robo", Name: "Móc Robo", BasePrice: 65_000, CategoryID: cat,
			Images: nil, RatingAvg: nil, ReviewCount: 0}, // no reviews yet, no images
	}
	cards, err := productCardsDTO(rows)
	if err != nil {
		t.Fatalf("productCardsDTO: %v", err)
	}
	if len(cards) != 2 {
		t.Fatalf("cards len = %d, want 2", len(cards))
	}
	c0 := cards[0]
	if c0.Id != id || c0.Slug != "den-mochi" || c0.BasePrice != 290_000 || c0.CategoryId != cat {
		t.Errorf("card[0] = %+v, want mapped id/slug/basePrice/categoryId", c0)
	}
	if len(c0.Images) != 2 || c0.Images[0] != "https://x/1.jpg" {
		t.Errorf("card[0].Images = %v, want the two cover urls", c0.Images)
	}
	if c0.RatingAvg == nil || *c0.RatingAvg != 4.5 || c0.ReviewCount != 128 {
		t.Errorf("card[0] rating/count = %v/%d, want 4.5/128", c0.RatingAvg, c0.ReviewCount)
	}
	// Absent images → non-nil empty slice → JSON [], never null; null rating stays nil.
	c1 := cards[1]
	if c1.Images == nil || len(c1.Images) != 0 {
		t.Errorf("card[1].Images = %v, want non-nil empty []", c1.Images)
	}
	if c1.RatingAvg != nil {
		t.Errorf("card[1].RatingAvg = %v, want nil (no reviews)", c1.RatingAvg)
	}
	b, _ := json.Marshal(c1)
	if !jsonHasEmptyImages(t, b) {
		t.Errorf("card[1] marshaled = %s, want images:[] not null", b)
	}
}

func jsonHasEmptyImages(t *testing.T, b []byte) bool {
	t.Helper()
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("unmarshal card: %v", err)
	}
	return string(m["images"]) == "[]"
}

func TestProductCardsDTOCorruptImagesHardFails(t *testing.T) {
	// A corrupt images JSONB surfaces as an error (→ 500), consistent with the detail read — corruption
	// must not be silently swallowed into an empty cover.
	rows := []sqlc.ListActiveProductsRow{
		{ID: uuid.New(), Slug: "hong", Name: "Hỏng", Images: []byte(`{not json`)},
	}
	if _, err := productCardsDTO(rows); err == nil {
		t.Fatal("corrupt images jsonb must return an error, got nil")
	}
}

func TestWeakETagDeterministicAndSensitive(t *testing.T) {
	base := api.ProductList{Items: []api.ProductCard{{Id: uuid.New(), Slug: "a", BasePrice: 100}}, Page: 1, PageSize: 12, Total: 1}
	e1, err := weakETag(base)
	if err != nil {
		t.Fatalf("weakETag: %v", err)
	}
	e2, _ := weakETag(base)
	if e1 != e2 {
		t.Errorf("etag not deterministic: %q vs %q", e1, e2)
	}
	if len(e1) < 4 || e1[:2] != "W/" {
		t.Errorf("etag = %q, want a weak W/\"...\" validator", e1)
	}
	// A price change (money mutation) must change the validator so a cached client revalidates.
	changed := base
	changed.Items = []api.ProductCard{{Id: base.Items[0].Id, Slug: "a", BasePrice: 200}}
	if e3, _ := weakETag(changed); e3 == e1 {
		t.Errorf("etag unchanged after a price mutation (%q) — stale money would be served", e3)
	}
}

func TestIfNoneMatch(t *testing.T) {
	etag := `W/"abc123"`
	cases := []struct {
		name   string
		header *string
		want   bool
	}{
		{"no header", nil, false},
		{"exact match", ptrTo(`W/"abc123"`), true},
		{"weak-prefix-insensitive match", ptrTo(`"abc123"`), true},
		{"star matches any", ptrTo("*"), true},
		{"list containing match", ptrTo(`W/"other", W/"abc123"`), true},
		{"no match", ptrTo(`W/"nope"`), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := ifNoneMatch(tc.header, etag); got != tc.want {
				t.Errorf("ifNoneMatch(%v) = %v, want %v", tc.header, got, tc.want)
			}
		})
	}
}

// The paging/sort validation runs BEFORE any DB read, so an out-of-range request is a 400 VALIDATION
// with a nil pool (no Postgres) — proving the DoS/shape guard short-circuits before the query.
func TestGetProductsRejectsBadParamsWithoutDB(t *testing.T) {
	srv := NewServer(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, nil)
	bad := api.GetProductsParamsSort("bogus")
	cases := []struct {
		name   string
		params api.GetProductsParams
	}{
		{"pageSize over cap", api.GetProductsParams{PageSize: ptrTo(maxPageSize + 1)}},
		{"page zero", api.GetProductsParams{Page: ptrTo(0)}},
		{"pageSize zero", api.GetProductsParams{PageSize: ptrTo(0)}},
		{"unknown sort", api.GetProductsParams{Sort: &bad}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp, err := srv.GetProducts(context.Background(), api.GetProductsRequestObject{Params: tc.params})
			if err != nil {
				t.Fatalf("GetProducts returned err (want 400 response): %v", err)
			}
			got, ok := resp.(api.GetProducts400JSONResponse)
			if !ok {
				t.Fatalf("resp = %T, want GetProducts400JSONResponse", resp)
			}
			if got.Code != codeValidation {
				t.Errorf("code = %q, want %s", got.Code, codeValidation)
			}
		})
	}
}
