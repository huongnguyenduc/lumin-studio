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
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/huongnguyenduc/lumin-studio/services/wedding-api/internal/auth"
	"github.com/huongnguyenduc/lumin-studio/services/wedding-api/internal/config"
)

// freshPool opens the test DB and resets it to a freshly-migrated schema.
func freshPool(t *testing.T) *pgxpool.Pool {
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

	// Fresh schema: reset to an empty public schema (simpler and more robust
	// than replaying every *.down.sql — this test owns the target DB) then
	// apply every *.up.sql in order.
	if _, err := pool.Exec(context.Background(),
		`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`); err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join("..", "..", "db", "migrations")
	ups, err := filepath.Glob(filepath.Join(dir, "*.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	sort.Strings(ups)
	for _, path := range ups {
		sql, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(context.Background(), string(sql)); err != nil {
			t.Fatalf("apply %s: %v", filepath.Base(path), err)
		}
	}
	return pool
}

// masterSecret is the wedding ADMIN_PASSWORD in tests; the lumin admin BFF sends
// it as a bearer to reach master scope. Tests reuse the same value.
const masterSecret = "pw"

// bearerSentinel: a fake cookie name that `call` recognises to mean "send this
// value as an Authorization: Bearer header" instead of a cookie — lets the many
// master-scoped call sites keep passing a single `admin` credential unchanged.
const bearerSentinel = "__bearer__"

func setupIntegration(t *testing.T) (*httptest.Server, *http.Cookie) {
	t.Helper()
	pool := freshPool(t)
	a := auth.New(config.Config{AdminPassword: masterSecret, JWTSecret: "test", JWTTTL: time.Hour})
	srv := httptest.NewServer(New(pool, a, nil, "luminstudio.vn"))
	t.Cleanup(srv.Close)
	return srv, &http.Cookie{Name: bearerSentinel, Value: masterSecret}
}

// call is a tiny JSON client. cred nil → unauthenticated; a bearerSentinel
// cookie → Authorization: Bearer (master); any other cookie → a real session.
func call(t *testing.T, method, url string, cred *http.Cookie, body any, out any) int {
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
	if cred != nil {
		if cred.Name == bearerSentinel {
			req.Header.Set("Authorization", "Bearer "+cred.Value)
		} else {
			req.AddCookie(cred)
		}
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

// dam-cuoi-1 is the event seeded by 000003_events.up.sql for pre-existing data.
const evt = "dam-cuoi-1"

func TestEndToEndFlows(t *testing.T) {
	srv, admin := setupIntegration(t)
	u := srv.URL

	// --- guests: create, slug collision, immutable id on rename ---
	var g1, g2 struct{ ID, Label string }
	if code := call(t, "POST", u+"/api/admin/guests", admin,
		map[string]string{"label": "Cô Lan & Chú Minh", "group": "Nhà gái", "eventSlug": evt}, &g1); code != 201 {
		t.Fatalf("create guest = %d", code)
	}
	if g1.ID != "co-lan-chu-minh" {
		t.Fatalf("slug = %q", g1.ID)
	}
	call(t, "POST", u+"/api/admin/guests", admin,
		map[string]string{"label": "Cô Lan & Chú Minh", "eventSlug": evt}, &g2)
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
		call(t, "GET", u+"/api/admin/guests?event="+evt, admin, nil, &guests)
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
		map[string]string{"name": "Nhà gái", "eventSlug": evt}, nil); code != 409 {
		t.Fatalf("dup group = %d, want 409", code)
	}
	if code := call(t, "PATCH", u+"/api/admin/groups/"+evt+"/Nhà gái", admin,
		map[string]string{"name": "Họ nhà gái"}, nil); code != 200 {
		t.Fatalf("rename group = %d", code)
	}
	var afterRename struct {
		Items []struct{ ID, Group string } `json:"items"`
	}
	call(t, "GET", u+"/api/admin/guests?event="+evt, admin, nil, &afterRename)
	for _, it := range afterRename.Items {
		if it.ID == g1.ID && it.Group != "Họ nhà gái" {
			t.Fatalf("rename did not cascade: %q", it.Group)
		}
	}
	if code := call(t, "DELETE", u+"/api/admin/groups/"+evt+"/Họ nhà gái", admin, nil, nil); code != 204 {
		t.Fatalf("delete group = %d", code)
	}
	call(t, "GET", u+"/api/admin/guests?event="+evt, admin, nil, &afterRename)
	for _, it := range afterRename.Items {
		if it.ID == g1.ID && it.Group != "Khác" {
			t.Fatalf("delete did not reassign to Khác: %q", it.Group)
		}
	}

	// --- stats ---
	var stats map[string]int
	call(t, "GET", u+"/api/admin/overview?event="+evt, admin, nil, &stats)
	if stats["guests"] != 2 || stats["opened"] != 1 || stats["rsvpNo"] != 1 || stats["wishes"] != 2 {
		t.Fatalf("stats = %v", stats)
	}

	// --- settings: shallow merge + null deletes a key ---
	call(t, "PATCH", u+"/api/admin/settings?wedding=giang-hieu", admin,
		map[string]any{"heroImage": "hero/abc.jpg", "mapsUrl": "https://maps.example"}, nil)
	var settings map[string]any
	call(t, "PATCH", u+"/api/admin/settings?wedding=giang-hieu", admin,
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

// TestEventScoping: a second event gets its own groups/guests, invisible from
// the first event's admin lists — the point of this feature (second wedding,
// separate venue/schedule/guests).
func TestEventScoping(t *testing.T) {
	srv, admin := setupIntegration(t)
	u := srv.URL

	var ev2 struct{ Slug, Name string }
	if code := call(t, "POST", u+"/api/admin/events", admin,
		map[string]string{"name": "Đám cưới 2", "weddingSlug": "giang-hieu"}, &ev2); code != 201 {
		t.Fatalf("create event = %d", code)
	}
	if ev2.Slug != "dam-cuoi-2" {
		t.Fatalf("event slug = %q", ev2.Slug)
	}

	// New event ships with its own default groups.
	var groups struct {
		Items []struct{ Name string } `json:"items"`
	}
	call(t, "GET", u+"/api/admin/groups?event="+ev2.Slug, admin, nil, &groups)
	if len(groups.Items) == 0 {
		t.Fatal("new event has no default groups")
	}

	// Guest created under event 2 must not show up when listing event 1.
	var g struct{ ID string }
	if code := call(t, "POST", u+"/api/admin/guests", admin,
		map[string]string{"label": "Khách sự kiện 2", "eventSlug": ev2.Slug}, &g); code != 201 {
		t.Fatalf("create guest in event 2 = %d", code)
	}
	var evt1Guests struct {
		Items []struct{ ID string } `json:"items"`
	}
	call(t, "GET", u+"/api/admin/guests?event="+evt, admin, nil, &evt1Guests)
	for _, it := range evt1Guests.Items {
		if it.ID == g.ID {
			t.Fatal("event-2 guest leaked into event-1 list")
		}
	}

	// Venue/timeline PATCH round-trips through the shallow-merge data column.
	var patched struct {
		Data map[string]any `json:"data"`
	}
	call(t, "PATCH", u+"/api/admin/events/"+ev2.Slug, admin,
		map[string]any{"data": map[string]any{"venueHall": "Sảnh A", "time": "18:00"}}, &patched)
	if patched.Data["venueHall"] != "Sảnh A" || patched.Data["time"] != "18:00" {
		t.Fatalf("event data patch = %v", patched.Data)
	}

	// Public /api/events lists both, unauthenticated.
	var pub struct {
		Items []struct{ Slug string } `json:"items"`
	}
	call(t, "GET", u+"/api/events", nil, nil, &pub)
	if len(pub.Items) != 2 {
		t.Fatalf("public events = %v, want 2", pub.Items)
	}

	// Subdomain: admin types a bare label, API owns the domain suffix, and it
	// round-trips through the public list — this is what wedding-web matches
	// the request Host against to pick the active event (no redeploy).
	var withSub struct {
		Subdomain *string        `json:"subdomain"`
		Data      map[string]any `json:"data"`
	}
	// Body omits "data" entirely (only subdomain) — regression check: this
	// used to decode to a nil map, which json.Marshal turns into `null`, and
	// `existing_data || null` in Postgres corrupts an object into a 2-element
	// array instead of leaving it untouched.
	if code := call(t, "PATCH", u+"/api/admin/events/"+ev2.Slug, admin,
		map[string]string{"subdomain": "Dam Cuoi SG!!"}, &withSub); code != 200 {
		t.Fatalf("patch subdomain = %d", code)
	}
	if withSub.Subdomain == nil || *withSub.Subdomain != "dam-cuoi-sg.luminstudio.vn" {
		t.Fatalf("subdomain = %v, want normalized dam-cuoi-sg.luminstudio.vn", withSub.Subdomain)
	}
	if withSub.Data["venueHall"] != "Sảnh A" || withSub.Data["time"] != "18:00" {
		t.Fatalf("data corrupted by data-omitted patch: %#v", withSub.Data)
	}

	// A second event can't steal an already-claimed subdomain.
	var ev3 struct{ Slug string }
	call(t, "POST", u+"/api/admin/events", admin,
		map[string]string{"name": "Đám cưới 3", "weddingSlug": "giang-hieu"}, &ev3)
	if code := call(t, "PATCH", u+"/api/admin/events/"+ev3.Slug, admin,
		map[string]string{"subdomain": "Dam Cuoi SG!!"}, nil); code != 409 {
		t.Fatalf("duplicate subdomain = %d, want 409", code)
	}

	// Empty string clears it back to unconfigured.
	if code := call(t, "PATCH", u+"/api/admin/events/"+ev2.Slug, admin,
		map[string]string{"subdomain": ""}, &withSub); code != 200 {
		t.Fatalf("clear subdomain = %d", code)
	}
	if withSub.Subdomain != nil {
		t.Fatalf("subdomain not cleared: %v", withSub.Subdomain)
	}
}

// TestMultiWeddingScoping: a second COUPLE (weddings layer) gets its own
// events/settings/wishes and a couple login confined to it — the point of
// multi-couple support.
func TestMultiWeddingScoping(t *testing.T) {
	srv, admin := setupIntegration(t)
	u := srv.URL

	// Master creates the couple; a couple session must not be able to.
	var wed struct{ Slug string }
	if code := call(t, "POST", u+"/api/admin/weddings", admin,
		map[string]string{"name": "An & Bình"}, &wed); code != 201 {
		t.Fatalf("create wedding = %d", code)
	}
	if wed.Slug != "an-binh" {
		t.Fatalf("wedding slug = %q", wed.Slug)
	}

	// Its first event + a live subdomain (master sets directly).
	var ev struct{ Slug string }
	if code := call(t, "POST", u+"/api/admin/events", admin,
		map[string]string{"name": "Đám cưới An Bình", "weddingSlug": wed.Slug}, &ev); code != 201 {
		t.Fatalf("create event = %d", code)
	}
	if code := call(t, "PATCH", u+"/api/admin/events/"+ev.Slug, admin,
		map[string]string{"subdomain": "anbinh"}, nil); code != 200 {
		t.Fatal("set subdomain failed")
	}

	// Master sets the couple password → couple logs in ON THEIR SUBDOMAIN only.
	if code := call(t, "PATCH", u+"/api/admin/weddings/"+wed.Slug, admin,
		map[string]string{"password": "matkhau-cua-an-binh"}, nil); code != 200 {
		t.Fatal("set couple password failed")
	}
	// Each login gets its own CF-Connecting-IP so the tight per-IP login rate
	// limit (burst 5) doesn't 429 the test's ~7 attempts.
	loginN := 0
	loginCookie := func(password, host string) (*http.Cookie, int) {
		loginN++
		var buf bytes.Buffer
		_ = json.NewEncoder(&buf).Encode(map[string]string{"password": password, "host": host})
		req, err := http.NewRequest("POST", u+"/api/admin/login", &buf)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("CF-Connecting-IP", "10.0.0."+strconv.Itoa(loginN))
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		for _, c := range resp.Cookies() {
			if c.Name == auth.CookieName && c.Value != "" {
				return c, resp.StatusCode
			}
		}
		return nil, resp.StatusCode
	}
	if _, code := loginCookie("matkhau-cua-an-binh", "giangvahieu.luminstudio.vn"); code != 401 {
		t.Fatalf("couple password on another couple's host = %d, want 401", code)
	}
	couple, code := loginCookie("matkhau-cua-an-binh", "anbinh.luminstudio.vn")
	if code != 200 || couple == nil {
		t.Fatalf("couple login = %d, cookie %v", code, couple)
	}

	// Couple session: sees only its own wedding/events, cannot touch the other's.
	var weds struct{ Items []struct{ Slug string } }
	call(t, "GET", u+"/api/admin/weddings", couple, nil, &weds)
	if len(weds.Items) != 1 || weds.Items[0].Slug != wed.Slug {
		t.Fatalf("couple weddings = %+v, want only own", weds.Items)
	}
	if code := call(t, "GET", u+"/api/admin/guests?event="+evt, couple, nil, nil); code != 404 {
		t.Fatalf("couple listing other couple's guests = %d, want 404", code)
	}
	if code := call(t, "POST", u+"/api/admin/weddings", couple,
		map[string]string{"name": "Hack"}, nil); code != 403 {
		t.Fatalf("couple creating wedding = %d, want 403", code)
	}

	// Settings are per wedding: couple writes its own without ?wedding=.
	var set map[string]any
	call(t, "PATCH", u+"/api/admin/settings", couple, map[string]any{"couple": "An & Bình"}, &set)
	if set["couple"] != "An & Bình" {
		t.Fatalf("couple settings write = %v", set)
	}
	var other map[string]any
	call(t, "GET", u+"/api/admin/settings?wedding=giang-hieu", admin, nil, &other)
	if other["couple"] == "An & Bình" {
		t.Fatal("settings leaked across weddings")
	}

	// Public wall is scoped by host; a wish posted on anbinh stays off the default wall.
	if code := call(t, "POST", u+"/api/wishes?host=anbinh.luminstudio.vn", nil,
		map[string]string{"text": "Chúc An Bình trăm năm"}, nil); code != 201 {
		t.Fatal("scoped wish failed")
	}
	var wall struct{ Total int }
	call(t, "GET", u+"/api/wishes?host=anbinh.luminstudio.vn", nil, nil, &wall)
	if wall.Total != 1 {
		t.Fatalf("anbinh wall = %d, want 1", wall.Total)
	}
	call(t, "GET", u+"/api/wishes", nil, nil, &wall)
	if wall.Total != 0 {
		t.Fatalf("default wall = %d, want 0 (no cross-wedding leak)", wall.Total)
	}
	var pub struct{ Items []struct{ Slug string } }
	call(t, "GET", u+"/api/events?host=anbinh.luminstudio.vn", nil, nil, &pub)
	if len(pub.Items) != 1 || pub.Items[0].Slug != ev.Slug {
		t.Fatalf("public events by host = %+v", pub.Items)
	}

	// Couple subdomain change is a REQUEST pending master review.
	var reqd struct {
		Subdomain          *string `json:"subdomain"`
		RequestedSubdomain *string `json:"requestedSubdomain"`
	}
	call(t, "PATCH", u+"/api/admin/events/"+ev.Slug, couple,
		map[string]string{"subdomain": "anbinh2026"}, &reqd)
	if reqd.RequestedSubdomain == nil || *reqd.RequestedSubdomain != "anbinh2026.luminstudio.vn" {
		t.Fatalf("requested subdomain = %v", reqd.RequestedSubdomain)
	}
	if reqd.Subdomain == nil || *reqd.Subdomain != "anbinh.luminstudio.vn" {
		t.Fatalf("live subdomain changed without approval: %v", reqd.Subdomain)
	}
	if code := call(t, "POST", u+"/api/admin/events/"+ev.Slug+"/subdomain-review", couple,
		map[string]bool{"approve": true}, nil); code != 403 {
		t.Fatalf("couple approving own request = %d, want 403", code)
	}
	call(t, "POST", u+"/api/admin/events/"+ev.Slug+"/subdomain-review", admin,
		map[string]bool{"approve": true}, &reqd)
	if reqd.Subdomain == nil || *reqd.Subdomain != "anbinh2026.luminstudio.vn" ||
		reqd.RequestedSubdomain != nil {
		t.Fatalf("approve = sub %v req %v", reqd.Subdomain, reqd.RequestedSubdomain)
	}

	// Couple changes its own password; old one stops working.
	if code := call(t, "POST", u+"/api/admin/password", couple,
		map[string]string{"current": "matkhau-cua-an-binh", "new": "mat-khau-moi-123"}, nil); code != 204 {
		t.Fatalf("change password = %d", code)
	}
	if _, code := loginCookie("matkhau-cua-an-binh", "anbinh2026.luminstudio.vn"); code != 401 {
		t.Fatalf("old couple password still works = %d", code)
	}
	if _, code := loginCookie("mat-khau-moi-123", "anbinh2026.luminstudio.vn"); code != 200 {
		t.Fatalf("new couple password = %d", code)
	}

	// changePassword is couple-only: a master (bearer) session is refused.
	if code := call(t, "POST", u+"/api/admin/password", admin,
		map[string]string{"current": "pw", "new": "whatever12"}, nil); code != 403 {
		t.Fatalf("master changePassword = %d, want 403", code)
	}
	// Login requires a host (master scope is bearer-only, never browser login).
	if _, code := loginCookie(masterSecret, ""); code != 400 {
		t.Fatalf("login without host = %d, want 400", code)
	}

	// Master deletes the couple — everything under it goes. (Two weddings exist:
	// the seeded giang-hieu + an-binh, so this isn't the last one.)
	if code := call(t, "DELETE", u+"/api/admin/weddings/"+wed.Slug, admin, nil, nil); code != 204 {
		t.Fatalf("delete wedding = %d", code)
	}
	call(t, "GET", u+"/api/events?host=anbinh2026.luminstudio.vn", nil, nil, &pub)
	for _, it := range pub.Items {
		if it.Slug == ev.Slug {
			t.Fatal("deleted wedding's event still public")
		}
	}

	// The last remaining wedding can't be deleted — an empty weddings table would
	// 500 every public endpoint.
	if code := call(t, "DELETE", u+"/api/admin/weddings/giang-hieu", admin, nil, nil); code != 409 {
		t.Fatalf("delete last wedding = %d, want 409", code)
	}
}

// TestSubdomainRequestCollision: a couple requesting a subdomain already claimed
// (live or pending) by another event is rejected up front (409), not silently
// accepted until master approval.
func TestSubdomainRequestCollision(t *testing.T) {
	srv, admin := setupIntegration(t)
	u := srv.URL

	// Couple B with a live subdomain, and its own password to log in with.
	var wedB struct{ Slug string }
	call(t, "POST", u+"/api/admin/weddings", admin, map[string]string{"name": "B Couple"}, &wedB)
	var evB struct{ Slug string }
	call(t, "POST", u+"/api/admin/events", admin,
		map[string]string{"name": "B event", "weddingSlug": wedB.Slug}, &evB)
	if code := call(t, "PATCH", u+"/api/admin/events/"+evB.Slug, admin,
		map[string]string{"subdomain": "taken"}, nil); code != 200 {
		t.Fatal("set B subdomain failed")
	}
	call(t, "PATCH", u+"/api/admin/weddings/"+wedB.Slug, admin,
		map[string]string{"password": "b-couple-password"}, nil)

	// Couple B (its own session) requests "taken" for its own event again — that's
	// its OWN live subdomain, so the slug<>self guard means no collision (allowed).
	var buf bytes.Buffer
	_ = json.NewEncoder(&buf).Encode(map[string]string{
		"password": "b-couple-password", "host": "taken.luminstudio.vn",
	})
	req, _ := http.NewRequest("POST", u+"/api/admin/login", &buf)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("CF-Connecting-IP", "10.1.0.1")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var coupleB *http.Cookie
	for _, c := range resp.Cookies() {
		if c.Name == auth.CookieName && c.Value != "" {
			coupleB = c
		}
	}
	resp.Body.Close()
	if coupleB == nil {
		t.Fatal("couple B login failed")
	}

	// Couple C requests the subdomain already live for B → 409 up front.
	var wedC struct{ Slug string }
	call(t, "POST", u+"/api/admin/weddings", admin, map[string]string{"name": "C Couple"}, &wedC)
	var evC struct{ Slug string }
	call(t, "POST", u+"/api/admin/events", admin,
		map[string]string{"name": "C event", "weddingSlug": wedC.Slug}, &evC)
	if code := call(t, "PATCH", u+"/api/admin/events/"+evC.Slug, admin,
		map[string]string{"subdomain": "cc"}, nil); code != 200 {
		t.Fatal("set C subdomain failed")
	}
	call(t, "PATCH", u+"/api/admin/weddings/"+wedC.Slug, admin,
		map[string]string{"password": "c-couple-password"}, nil)
	_ = json.NewEncoder(&buf).Encode(map[string]string{
		"password": "c-couple-password", "host": "cc.luminstudio.vn",
	})
	req2, _ := http.NewRequest("POST", u+"/api/admin/login", &buf)
	req2.Header.Set("Content-Type", "application/json")
	req2.Header.Set("CF-Connecting-IP", "10.1.0.2")
	resp2, _ := http.DefaultClient.Do(req2)
	var coupleC *http.Cookie
	for _, c := range resp2.Cookies() {
		if c.Name == auth.CookieName && c.Value != "" {
			coupleC = c
		}
	}
	resp2.Body.Close()
	if coupleC == nil {
		t.Fatal("couple C login failed")
	}
	if code := call(t, "PATCH", u+"/api/admin/events/"+evC.Slug, coupleC,
		map[string]string{"subdomain": "taken"}, nil); code != 409 {
		t.Fatalf("request already-live subdomain = %d, want 409", code)
	}
}

// TestCoupleCookieCannotReachMaster: a valid couple session (cookie) is confined
// to its own wedding — it can't hit master-only endpoints even though it's
// authenticated. Master scope is reachable ONLY via the bearer.
func TestCoupleCookieCannotReachMaster(t *testing.T) {
	srv, admin := setupIntegration(t)
	u := srv.URL

	var wed struct{ Slug string }
	call(t, "POST", u+"/api/admin/weddings", admin, map[string]string{"name": "Couple X"}, &wed)
	var ev struct{ Slug string }
	call(t, "POST", u+"/api/admin/events", admin,
		map[string]string{"name": "X event", "weddingSlug": wed.Slug}, &ev)
	call(t, "PATCH", u+"/api/admin/events/"+ev.Slug, admin, map[string]string{"subdomain": "cx"}, nil)
	call(t, "PATCH", u+"/api/admin/weddings/"+wed.Slug, admin, map[string]string{"password": "couple-x-pw"}, nil)

	// Couple login → real session cookie.
	var buf bytes.Buffer
	_ = json.NewEncoder(&buf).Encode(map[string]string{"password": "couple-x-pw", "host": "cx.luminstudio.vn"})
	req, _ := http.NewRequest("POST", u+"/api/admin/login", &buf)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("CF-Connecting-IP", "10.2.0.1")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var couple *http.Cookie
	for _, c := range resp.Cookies() {
		if c.Name == auth.CookieName && c.Value != "" {
			couple = c
		}
	}
	resp.Body.Close()
	if couple == nil {
		t.Fatal("couple login failed")
	}
	// Master-only endpoints reject the couple cookie (403).
	if code := call(t, "POST", u+"/api/admin/weddings", couple, map[string]string{"name": "hack"}, nil); code != 403 {
		t.Fatalf("couple create wedding = %d, want 403", code)
	}
	if code := call(t, "DELETE", u+"/api/admin/weddings/giang-hieu", couple, nil, nil); code != 403 {
		t.Fatalf("couple delete wedding = %d, want 403", code)
	}
}

// TestDeleteEvent: an event created by mistake can be removed with its guests,
// while the couple's (wedding-wide) wishes wall survives.
func TestDeleteEvent(t *testing.T) {
	srv, admin := setupIntegration(t)
	u := srv.URL

	var ev struct{ Slug string }
	if code := call(t, "POST", u+"/api/admin/events", admin,
		map[string]string{"name": "Đám nhầm", "weddingSlug": "giang-hieu"}, &ev); code != 201 {
		t.Fatalf("create event = %d", code)
	}
	if code := call(t, "POST", u+"/api/admin/guests", admin,
		map[string]string{"label": "Khách của đám nhầm", "eventSlug": ev.Slug}, nil); code != 201 {
		t.Fatalf("create guest = %d", code)
	}
	// A wish on the wedding's wall (posted on the seeded subdomain) must survive.
	if code := call(t, "POST", u+"/api/wishes?host=giangvahieu.luminstudio.vn", nil,
		map[string]string{"text": "Chúc mừng"}, nil); code != 201 {
		t.Fatalf("wish = %d", code)
	}

	if code := call(t, "DELETE", u+"/api/admin/events/"+ev.Slug, admin, nil, nil); code != 204 {
		t.Fatalf("delete event = %d, want 204", code)
	}
	// Gone from the couple's event list; its guests gone; deleting again 404s.
	var evs struct{ Items []struct{ Slug string } }
	call(t, "GET", u+"/api/admin/events", admin, nil, &evs)
	for _, it := range evs.Items {
		if it.Slug == ev.Slug {
			t.Fatal("deleted event still listed")
		}
	}
	if code := call(t, "GET", u+"/api/admin/guests?event="+ev.Slug, admin, nil, nil); code != 404 {
		t.Fatalf("guests of deleted event = %d, want 404 (event out of scope)", code)
	}
	if code := call(t, "DELETE", u+"/api/admin/events/"+ev.Slug, admin, nil, nil); code != 404 {
		t.Fatalf("delete already-deleted event = %d, want 404", code)
	}
	var wall struct{ Total int }
	call(t, "GET", u+"/api/wishes?host=giangvahieu.luminstudio.vn", nil, nil, &wall)
	if wall.Total != 1 {
		t.Fatalf("wishes wall = %d, want 1 (per-wedding, survives event delete)", wall.Total)
	}
}
