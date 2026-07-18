package httpapi

// Integration test against a REAL Postgres — the wedding flows are SQL-shaped
// (write-once opened_at, upsert rsvp, cascade rename, reassign-on-delete), so a
// mock would test nothing. Gated on WEDDING_TEST_DATABASE_URL (skip-local /
// run-anywhere-with-a-DB, same stance as core-api's db integration tests):
//
//	docker run -d --rm -e POSTGRES_PASSWORD=pg -e POSTGRES_DB=wedding -p 5434:5432 postgres:16-alpine
//	WEDDING_TEST_DATABASE_URL='postgres://postgres:pg@localhost:5434/wedding?sslmode=disable' go test ./internal/httpapi/
//
// The test applies db/migrations itself (down -all then up) — it OWNS the target
// database's schema and data.

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/huongnguyenduc/lumin-studio/services/wedding-api/internal/auth"
	"github.com/huongnguyenduc/lumin-studio/services/wedding-api/internal/config"
)

func setupIntegration(t *testing.T) (*httptest.Server, *http.Cookie) {
	t.Helper()
	dsn := os.Getenv("WEDDING_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("WEDDING_TEST_DATABASE_URL unset — integration test skipped")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)

	// Fresh schema: down (ignore errors on a virgin DB) then up.
	for _, f := range []struct {
		name        string
		mustSucceed bool
	}{{"000001_init.down.sql", false}, {"000001_init.up.sql", true}} {
		sql, err := os.ReadFile(filepath.Join("..", "..", "db", "migrations", f.name))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(context.Background(), string(sql)); err != nil && f.mustSucceed {
			t.Fatalf("apply %s: %v", f.name, err)
		}
	}

	a := auth.New(config.Config{AdminPassword: "pw", JWTSecret: "test", JWTTTL: time.Hour})
	srv := httptest.NewServer(New(pool, a, nil))
	t.Cleanup(srv.Close)
	cookie, err := a.IssueCookie()
	if err != nil {
		t.Fatal(err)
	}
	return srv, cookie
}

// call is a tiny JSON client; cookie nil → unauthenticated.
func call(t *testing.T, method, url string, cookie *http.Cookie, body any, out any) int {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatal(err)
		}
	}
	req, err := http.NewRequest(method, url, &buf)
	if err != nil {
		t.Fatal(err)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if out != nil {
		_ = json.NewDecoder(resp.Body).Decode(out)
	}
	return resp.StatusCode
}

func TestEndToEndFlows(t *testing.T) {
	srv, admin := setupIntegration(t)
	u := srv.URL

	// --- guests: create, slug collision, immutable id on rename ---
	var g1, g2 struct{ ID, Label string }
	if code := call(t, "POST", u+"/api/admin/guests", admin,
		map[string]string{"label": "Cô Lan & Chú Minh", "group": "Nhà gái"}, &g1); code != 201 {
		t.Fatalf("create guest = %d", code)
	}
	if g1.ID != "co-lan-chu-minh" {
		t.Fatalf("slug = %q", g1.ID)
	}
	call(t, "POST", u+"/api/admin/guests", admin, map[string]string{"label": "Cô Lan & Chú Minh"}, &g2)
	if g2.ID != "co-lan-chu-minh-2" {
		t.Fatalf("collision slug = %q", g2.ID)
	}
	if code := call(t, "PATCH", u+"/api/admin/guests/"+g1.ID, admin,
		map[string]string{"label": "Cô Lan (đã đổi tên)"}, nil); code != 204 {
		t.Fatalf("rename = %d", code)
	}

	// --- invite: open tracking is write-once; rename kept the old link alive ---
	var invite struct {
		Label string  `json:"label"`
		RSVP  *string `json:"rsvp"`
	}
	if code := call(t, "GET", u+"/api/invite/"+g1.ID, nil, nil, &invite); code != 200 {
		t.Fatalf("invite = %d", code)
	}
	if invite.Label != "Cô Lan (đã đổi tên)" {
		t.Fatalf("label = %q", invite.Label)
	}
	var guests struct {
		Items []struct {
			ID       string     `json:"id"`
			OpenedAt *time.Time `json:"openedAt"`
		} `json:"items"`
	}
	openedAt := func() *time.Time {
		call(t, "GET", u+"/api/admin/guests", admin, nil, &guests)
		for _, it := range guests.Items {
			if it.ID == g1.ID {
				return it.OpenedAt
			}
		}
		return nil
	}
	// GET is a pure read now — a preview bot fetching the link must not mark it opened.
	if openedAt() != nil {
		t.Fatal("opened_at set by GET — must only be set by POST /opened")
	}
	if code := call(t, "POST", u+"/api/invite/"+g1.ID+"/opened", nil, nil, nil); code != 204 {
		t.Fatalf("mark opened = %d, want 204", code)
	}
	firstOpen := openedAt()
	if firstOpen == nil {
		t.Fatal("opened_at not set on first open")
	}
	call(t, "POST", u+"/api/invite/"+g1.ID+"/opened", nil, nil, nil) // re-open
	if got := openedAt(); got == nil || !got.Equal(*firstOpen) {
		t.Fatal("opened_at overwritten on re-open — must be write-once")
	}
	if code := call(t, "POST", u+"/api/invite/khong-ton-tai/opened", nil, nil, nil); code != 204 {
		t.Fatalf("mark opened unknown guest = %d, want idempotent 204", code)
	}
	if code := call(t, "GET", u+"/api/invite/khong-ton-tai", nil, nil, nil); code != 404 {
		t.Fatalf("unknown invite = %d, want 404", code)
	}

	// --- rsvp: upsert, changeable ---
	if code := call(t, "POST", u+"/api/invite/"+g1.ID+"/rsvp", nil,
		map[string]string{"rsvp": "yes"}, nil); code != 204 {
		t.Fatalf("rsvp yes = %d", code)
	}
	if code := call(t, "POST", u+"/api/invite/"+g1.ID+"/rsvp", nil,
		map[string]string{"rsvp": "no"}, nil); code != 204 {
		t.Fatalf("rsvp change = %d", code)
	}
	if code := call(t, "POST", u+"/api/invite/"+g1.ID+"/rsvp", nil,
		map[string]string{"rsvp": "maybe"}, nil); code != 400 {
		t.Fatalf("bad rsvp = %d, want 400", code)
	}

	// --- wishes: guest, anonymous, invalid color, wall order ---
	if code := call(t, "POST", u+"/api/wishes", nil, map[string]string{
		"guestId": g1.ID, "name": "Cô Lan", "text": "Trăm năm hạnh phúc!",
		"color": "rgb(249,241,232)"}, nil); code != 201 {
		t.Fatalf("wish = %d", code)
	}
	if code := call(t, "POST", u+"/api/wishes", nil,
		map[string]string{"text": "Ẩn danh chúc mừng"}, nil); code != 201 {
		t.Fatalf("anonymous wish = %d", code)
	}
	if code := call(t, "POST", u+"/api/wishes", nil,
		map[string]string{"text": "x", "color": "red"}, nil); code != 400 {
		t.Fatalf("bad color = %d, want 400", code)
	}
	if code := call(t, "POST", u+"/api/wishes", nil,
		map[string]string{"text": "x", "name": strings.Repeat("a", 101)}, nil); code != 400 {
		t.Fatalf("101-char name = %d, want 400", code)
	}
	var wall struct {
		Items []struct{ Name string }
		Total int
	}
	call(t, "GET", u+"/api/wishes?limit=1", nil, nil, &wall)
	if wall.Total != 2 || len(wall.Items) != 1 || wall.Items[0].Name != "Khách mời" {
		t.Fatalf("wall = %+v (want total 2, newest first = anonymous default name)", wall)
	}

	// --- groups: rename cascades, delete reassigns to Khác ---
	if code := call(t, "POST", u+"/api/admin/groups", admin,
		map[string]string{"name": "Nhà gái"}, nil); code != 409 {
		t.Fatalf("dup group = %d, want 409", code)
	}
	if code := call(t, "PATCH", u+"/api/admin/groups/Nhà gái", admin,
		map[string]string{"name": "Họ nhà gái"}, nil); code != 200 {
		t.Fatalf("rename group = %d", code)
	}
	var afterRename struct {
		Items []struct{ ID, Group string } `json:"items"`
	}
	call(t, "GET", u+"/api/admin/guests", admin, nil, &afterRename)
	for _, it := range afterRename.Items {
		if it.ID == g1.ID && it.Group != "Họ nhà gái" {
			t.Fatalf("rename did not cascade: %q", it.Group)
		}
	}
	if code := call(t, "DELETE", u+"/api/admin/groups/Họ nhà gái", admin, nil, nil); code != 204 {
		t.Fatalf("delete group = %d", code)
	}
	call(t, "GET", u+"/api/admin/guests", admin, nil, &afterRename)
	for _, it := range afterRename.Items {
		if it.ID == g1.ID && it.Group != "Khác" {
			t.Fatalf("delete did not reassign to Khác: %q", it.Group)
		}
	}

	// --- stats ---
	var stats map[string]int
	call(t, "GET", u+"/api/admin/stats", admin, nil, &stats)
	if stats["guests"] != 2 || stats["opened"] != 1 || stats["rsvpNo"] != 1 || stats["wishes"] != 2 {
		t.Fatalf("stats = %v", stats)
	}

	// --- settings: shallow merge + null deletes a key ---
	call(t, "PATCH", u+"/api/admin/settings", admin,
		map[string]any{"heroImage": "hero/abc.jpg", "mapsUrl": "https://maps.example"}, nil)
	var settings map[string]any
	call(t, "PATCH", u+"/api/admin/settings", admin,
		map[string]any{"mapsUrl": nil, "title": "Giang & Hiếu"}, &settings)
	if settings["heroImage"] != "hero/abc.jpg" || settings["title"] != "Giang & Hiếu" {
		t.Fatalf("settings merge = %v", settings)
	}
	if _, still := settings["mapsUrl"]; still {
		t.Fatalf("null key not removed: %v", settings)
	}

	// --- bulk delete + FK SET NULL keeps the wish anonymous ---
	var bulk struct{ Deleted int }
	call(t, "POST", u+"/api/admin/guests/bulk-delete", admin,
		map[string][]string{"ids": {g1.ID, g2.ID}}, &bulk)
	if bulk.Deleted != 2 {
		t.Fatalf("bulk deleted = %d", bulk.Deleted)
	}
	call(t, "GET", u+"/api/wishes", nil, nil, &wall)
	if wall.Total != 2 {
		t.Fatalf("wishes lost on guest delete = total %d, want 2 (SET NULL)", wall.Total)
	}
}
