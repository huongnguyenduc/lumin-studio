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
	srv, admin, _ := setupIntegrationWithPool(t)
	return srv, admin
}

func setupIntegrationWithPool(t *testing.T) (*httptest.Server, *http.Cookie, *pgxpool.Pool) {
	t.Helper()
	pool := freshPool(t)
	a := auth.New(config.Config{AdminPassword: masterSecret, JWTSecret: "test", JWTTTL: time.Hour})
	srv := httptest.NewServer(New(pool, a, nil, "luminstudio.vn", "test-gi-secret"))
	t.Cleanup(srv.Close)
	return srv, &http.Cookie{Name: bearerSentinel, Value: masterSecret}, pool
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
	// GET is a pure read — a preview bot fetching the link must not mark it opened.
	if openedAt() != nil {
		t.Fatal("opened_at set by GET — must only be set by consented identity flow")
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

	// --- wishes: self-edit via editToken (right token succeeds, wrong/missing forbidden) ---
	var created struct {
		ID        string
		EditToken string
	}
	call(t, "POST", u+"/api/wishes", nil, map[string]string{"text": "chưa sửa"}, &created)
	if created.EditToken == "" {
		t.Fatalf("postWish did not return an editToken")
	}
	if code := call(t, "PATCH", u+"/api/wishes/"+created.ID, nil,
		map[string]string{"editToken": "deadbeef", "text": "sửa trộm"}, nil); code != 403 {
		t.Fatalf("patch with wrong editToken = %d, want 403", code)
	}
	if code := call(t, "PATCH", u+"/api/wishes/"+created.ID, nil,
		map[string]string{"text": "sửa không có token"}, nil); code != 403 {
		t.Fatalf("patch with no editToken = %d, want 403", code)
	}
	var edited struct{ Text string }
	if code := call(t, "PATCH", u+"/api/wishes/"+created.ID, nil,
		map[string]string{"editToken": created.EditToken, "text": "đã sửa xong"}, &edited); code != 200 {
		t.Fatalf("patch with right editToken = %d, want 200", code)
	}
	if edited.Text != "đã sửa xong" {
		t.Fatalf("edited text = %q", edited.Text)
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
	if stats["guests"] != 2 || stats["opened"] != 0 || stats["rsvpNo"] != 1 || stats["wishes"] != 2 {
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

func TestGuestIdentityFlows(t *testing.T) {
	srv, admin, pool := setupIntegrationWithPool(t)
	u := srv.URL

	var guest struct{ ID string }
	if code := call(t, "POST", u+"/api/admin/guests", admin,
		map[string]string{"label": "Khách GI", "eventSlug": evt}, &guest); code != 201 {
		t.Fatalf("create guest = %d", code)
	}
	signals := map[string]any{
		"userAgent": "Mozilla/5.0 (iPhone) Safari/604.1", "screenWidth": 390,
		"screenHeight": 844, "devicePixelRatio": "3", "timezone": "Asia/Ho_Chi_Minh",
		"language": "vi-VN", "platform": "iPhone", "touchPoints": 5,
	}
	var identity struct {
		IdentityID string `json:"identityId"`
		Token      string `json:"token"`
		IsAdmin    bool   `json:"isAdmin"`
	}
	body := map[string]any{
		"consent": true, "eventSlug": evt, "source": "personalized",
		"guestId": guest.ID, "signals": signals,
	}
	if code := call(t, "POST", u+"/api/identity/resolve", nil, body, &identity); code != 200 {
		t.Fatalf("resolve identity = %d", code)
	}
	if identity.IdentityID == "" || identity.Token == "" || identity.IsAdmin {
		t.Fatalf("identity = %+v", identity)
	}

	var listed struct {
		Items []struct {
			ID       string     `json:"id"`
			OpenedAt *time.Time `json:"openedAt"`
		} `json:"items"`
	}
	call(t, "GET", u+"/api/admin/guests?event="+evt, admin, nil, &listed)
	if len(listed.Items) != 1 || listed.Items[0].OpenedAt == nil {
		t.Fatalf("non-admin open not reflected: %+v", listed.Items)
	}

	// The same identity resolving with authenticated master scope becomes admin;
	// all of its prior personalized opens are excluded retroactively.
	body["token"] = identity.Token
	if code := call(t, "POST", u+"/api/identity/resolve", admin, body, &identity); code != 200 {
		t.Fatalf("admin resolve = %d", code)
	}
	if !identity.IsAdmin {
		t.Fatal("authenticated identity was not marked admin")
	}
	call(t, "GET", u+"/api/admin/guests?event="+evt, admin, nil, &listed)
	if listed.Items[0].OpenedAt != nil {
		t.Fatal("admin open was not removed retroactively")
	}

	// A pre-migration summary survives every later recomputation.
	legacyAt := time.Now().Add(-24 * time.Hour).UTC().Truncate(time.Microsecond)
	if _, err := pool.Exec(context.Background(), `
		UPDATE guests SET opened_at=$2,legacy_opened_at=$2 WHERE id=$1`,
		guest.ID, legacyAt); err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if err := recomputeOpened(context.Background(), tx, "giang-hieu"); err != nil {
		_ = tx.Rollback(context.Background())
		t.Fatal(err)
	}
	if err := tx.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	var preserved time.Time
	if err := pool.QueryRow(context.Background(),
		`SELECT opened_at FROM guests WHERE id=$1`, guest.ID).Scan(&preserved); err != nil {
		t.Fatal(err)
	}
	if !preserved.Equal(legacyAt) {
		t.Fatalf("legacy open changed: got %s want %s", preserved, legacyAt)
	}

	// A fresh token with the same fingerprint must not inherit an admin identity.
	var shared struct {
		IdentityID string `json:"identityId"`
		Token      string `json:"token"`
	}
	if code := call(t, "POST", u+"/api/identity/resolve", nil, map[string]any{
		"consent": true, "eventSlug": evt, "source": "shared", "signals": signals,
	}, &shared); code != 200 {
		t.Fatalf("shared resolve = %d", code)
	}
	if shared.IdentityID == identity.IdentityID {
		t.Fatal("different device merged into admin identity")
	}
	if code := call(t, "POST", u+"/api/identity/shared-rsvp", nil, map[string]any{
		"token": shared.Token, "eventSlug": evt, "name": "Bạn An", "rsvp": "yes",
	}, nil); code != 204 {
		t.Fatalf("shared RSVP = %d", code)
	}
	var restored struct {
		Profile *sharedProfile `json:"profile"`
	}
	if code := call(t, "POST", u+"/api/identity/resolve", nil, map[string]any{
		"consent": true, "eventSlug": evt, "source": "shared",
		"token": shared.Token, "signals": signals,
	}, &restored); code != 200 {
		t.Fatalf("restore shared identity = %d", code)
	}
	if restored.Profile == nil || restored.Profile.Name != "Bạn An" ||
		restored.Profile.RSVP == nil || *restored.Profile.RSVP != "yes" {
		t.Fatalf("restored profile = %+v", restored.Profile)
	}
	var sharedList struct {
		Items []struct {
			Name      *string `json:"name"`
			RSVP      *string `json:"rsvp"`
			OpenCount int     `json:"openCount"`
		} `json:"items"`
	}
	call(t, "GET", u+"/api/admin/shared-guests?event="+evt, admin, nil, &sharedList)
	if len(sharedList.Items) != 1 || sharedList.Items[0].Name == nil ||
		*sharedList.Items[0].Name != "Bạn An" || sharedList.Items[0].RSVP == nil ||
		*sharedList.Items[0].RSVP != "yes" || sharedList.Items[0].OpenCount != 2 {
		t.Fatalf("shared guests = %+v", sharedList.Items)
	}
	var claim struct {
		Token string `json:"token"`
	}
	if code := call(t, "POST", u+"/api/admin/identity-claims?wedding=giang-hieu", admin, nil, &claim); code != 201 {
		t.Fatalf("create identity claim = %d", code)
	}
	claimBody := map[string]string{"identityToken": shared.Token}
	claimURL := u + "/api/identity/claim/" + claim.Token
	if code := call(t, "POST", claimURL, nil, claimBody, nil); code != 204 {
		t.Fatalf("consume identity claim = %d", code)
	}
	if code := call(t, "POST", claimURL, nil, claimBody, nil); code != 410 {
		t.Fatalf("reuse identity claim = %d, want 410", code)
	}

	// Declining later withdraws consent: identity and profile cascade away.
	if code := call(t, "POST", u+"/api/identity/resolve", nil, map[string]any{
		"consent": false, "eventSlug": evt, "source": "shared", "token": shared.Token,
	}, nil); code != 200 {
		t.Fatalf("withdraw identity = %d", code)
	}
	var remaining int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM guest_identities WHERE id=$1`, shared.IdentityID).Scan(&remaining); err != nil {
		t.Fatal(err)
	}
	if remaining != 0 {
		t.Fatal("declined identity was not deleted")
	}

	// Expiry removes pseudonyms but preserves the non-identifying opened summary.
	var retainedGuest struct{ ID string }
	if code := call(t, "POST", u+"/api/admin/guests", admin,
		map[string]string{"label": "Khách lưu summary", "eventSlug": evt}, &retainedGuest); code != 201 {
		t.Fatalf("create retained guest = %d", code)
	}
	signals["screenWidth"] = 412
	signals["screenHeight"] = 915
	var expiring struct {
		IdentityID string `json:"identityId"`
	}
	if code := call(t, "POST", u+"/api/identity/resolve", nil, map[string]any{
		"consent": true, "eventSlug": evt, "source": "personalized",
		"guestId": retainedGuest.ID, "signals": signals,
	}, &expiring); code != 200 {
		t.Fatalf("resolve expiring identity = %d", code)
	}
	var survivingGuest struct{ ID string }
	if code := call(t, "POST", u+"/api/admin/guests", admin,
		map[string]string{"label": "Khách còn hạn", "eventSlug": evt}, &survivingGuest); code != 201 {
		t.Fatalf("create surviving guest = %d", code)
	}
	signals["screenWidth"] = 430
	signals["screenHeight"] = 932
	var surviving struct {
		IdentityID string `json:"identityId"`
	}
	if code := call(t, "POST", u+"/api/identity/resolve", nil, map[string]any{
		"consent": true, "eventSlug": evt, "source": "personalized",
		"guestId": survivingGuest.ID, "signals": signals,
	}, &surviving); code != 200 {
		t.Fatalf("resolve surviving identity = %d", code)
	}
	if _, err := pool.Exec(context.Background(),
		`UPDATE guest_identities SET expires_at=now()-interval '1 minute' WHERE id=$1`,
		expiring.IdentityID); err != nil {
		t.Fatal(err)
	}
	if err := (&server{pool: pool}).purgeExpiredIdentities(context.Background()); err != nil {
		t.Fatal(err)
	}
	tx, err = pool.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if err := recomputeOpened(context.Background(), tx, "giang-hieu"); err != nil {
		_ = tx.Rollback(context.Background())
		t.Fatal(err)
	}
	if err := tx.Commit(context.Background()); err != nil {
		t.Fatal(err)
	}
	var retainedOpen *time.Time
	if err := pool.QueryRow(context.Background(),
		`SELECT opened_at FROM guests WHERE id=$1`, retainedGuest.ID).Scan(&retainedOpen); err != nil {
		t.Fatal(err)
	}
	if retainedOpen == nil {
		t.Fatal("retention purge erased effective opened summary")
	}
	if code := call(t, "PATCH",
		u+"/api/admin/identities/"+surviving.IdentityID+"/admin?wedding=giang-hieu",
		admin, map[string]bool{"admin": true}, nil); code != 204 {
		t.Fatalf("mark surviving identity admin = %d", code)
	}
	var survivingOpen *time.Time
	if err := pool.QueryRow(context.Background(),
		`SELECT opened_at FROM guests WHERE id=$1`, survivingGuest.ID).Scan(&survivingOpen); err != nil {
		t.Fatal(err)
	}
	if survivingOpen != nil {
		t.Fatal("partial purge froze a surviving identity's opened summary")
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
	pub.Items = nil
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

// TestSessionOnAnotherCouplesHost: the session cookie is set on the root domain
// (one login covers every subdomain of the same couple), so it also travels to
// ANOTHER couple's subdomain. The admin there must refuse (401 → that host's own
// login) instead of rendering the logged-in couple's data.
func TestSessionOnAnotherCouplesHost(t *testing.T) {
	srv, admin := setupIntegration(t)
	u := srv.URL

	var wed struct{ Slug string }
	if code := call(t, "POST", u+"/api/admin/weddings", admin,
		map[string]string{"name": "An & Bình"}, &wed); code != 201 {
		t.Fatalf("create wedding = %d", code)
	}
	var ev struct{ Slug string }
	if code := call(t, "POST", u+"/api/admin/events", admin,
		map[string]string{"name": "Đám cưới An Bình", "weddingSlug": wed.Slug}, &ev); code != 201 {
		t.Fatalf("create event = %d", code)
	}
	if code := call(t, "PATCH", u+"/api/admin/events/"+ev.Slug, admin,
		map[string]string{"subdomain": "anbinh"}, nil); code != 200 {
		t.Fatal("set subdomain failed")
	}
	if code := call(t, "PATCH", u+"/api/admin/weddings/"+wed.Slug, admin,
		map[string]string{"password": "matkhau-cua-an-binh"}, nil); code != 200 {
		t.Fatal("set couple password failed")
	}

	var buf bytes.Buffer
	_ = json.NewEncoder(&buf).Encode(map[string]string{
		"password": "matkhau-cua-an-binh", "host": "anbinh.luminstudio.vn"})
	req, err := http.NewRequest("POST", u+"/api/admin/login", &buf)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	var couple *http.Cookie
	for _, c := range resp.Cookies() {
		if c.Name == auth.CookieName && c.Value != "" {
			couple = c
		}
	}
	if couple == nil {
		t.Fatalf("couple login = %d, no cookie", resp.StatusCode)
	}

	// pageHost sends the admin page's own hostname the way the browser client does.
	pageHost := func(host string) int {
		t.Helper()
		req, err := http.NewRequest("GET", u+"/api/admin/weddings", nil)
		if err != nil {
			t.Fatal(err)
		}
		req.AddCookie(couple)
		if host != "" {
			req.Header.Set(HostHeader, host)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		return resp.StatusCode
	}

	if code := pageHost("giangvahieu.luminstudio.vn"); code != 401 {
		t.Fatalf("session on another couple's host = %d, want 401", code)
	}
	if code := pageHost("anbinh.luminstudio.vn"); code != 200 {
		t.Fatalf("session on own host = %d, want 200", code)
	}
	// No header (dev/localhost, server-to-server) → unchanged behaviour.
	if code := pageHost(""); code != 200 {
		t.Fatalf("session without page host = %d, want 200", code)
	}
	// A subdomain mapped to no event at all is refused too.
	if code := pageHost("khong-ton-tai.luminstudio.vn"); code != 401 {
		t.Fatalf("session on unmapped subdomain = %d, want 401", code)
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

// A couple's SECOND event usually has no subdomain of its own, so the host only
// ever resolves the first one. Its guests' personal links must still open, RSVP
// and record their open against their OWN event — not 404 into the anonymous card.
func TestSecondEventGuestLinkResolvesByWedding(t *testing.T) {
	srv, admin, _ := setupIntegrationWithPool(t)
	u := srv.URL
	host := "giangvahieu.luminstudio.vn" // subdomain of event 1 only

	var ev2 struct{ Slug string }
	if code := call(t, "POST", u+"/api/admin/events", admin,
		map[string]string{"name": "Đám cưới 2", "weddingSlug": "giang-hieu"}, &ev2); code != 201 {
		t.Fatalf("create event 2 = %d", code)
	}
	var guest struct{ ID string }
	if code := call(t, "POST", u+"/api/admin/guests", admin,
		map[string]string{"label": "Khách tiệc 2", "eventSlug": ev2.Slug}, &guest); code != 201 {
		t.Fatalf("create guest = %d", code)
	}

	var invite struct{ Label string }
	if code := call(t, "GET",
		u+"/api/invite/"+guest.ID+"?host="+host, nil, nil, &invite); code != 200 {
		t.Fatalf("get invite = %d, want 200", code)
	}
	if invite.Label != "Khách tiệc 2" {
		t.Fatalf("label = %q", invite.Label)
	}
	if code := call(t, "POST", u+"/api/invite/"+guest.ID+"/rsvp?host="+host, nil,
		map[string]string{"rsvp": "yes"}, nil); code != 204 {
		t.Fatalf("rsvp = %d, want 204", code)
	}

	// eventSlug is the host's default event — the open must still land on ev2.
	if code := call(t, "POST", u+"/api/identity/resolve", nil, map[string]any{
		"consent": true, "host": host, "eventSlug": evt, "source": "personalized",
		"guestId": guest.ID, "signals": map[string]any{"userAgent": "Mozilla/5.0 (iPhone)"},
	}, nil); code != 200 {
		t.Fatalf("resolve identity = %d, want 200", code)
	}
	var listed struct {
		Items []struct {
			OpenedAt *time.Time `json:"openedAt"`
			RSVP     *string    `json:"rsvp"`
		} `json:"items"`
	}
	call(t, "GET", u+"/api/admin/guests?event="+ev2.Slug, admin, nil, &listed)
	if len(listed.Items) != 1 || listed.Items[0].OpenedAt == nil ||
		listed.Items[0].RSVP == nil || *listed.Items[0].RSVP != "yes" {
		t.Fatalf("second-event guest = %+v", listed.Items)
	}
}

// ScopeFromRequest is reachable from the PUBLIC identity endpoint, so a couple
// session must only ever tag its OWN wedding's devices as the couple's. Couple
// B browsing couple A's shared link stays an ordinary guest — otherwise B's
// opens would silently vanish from A's "đã mở" counts.
func TestIdentityAdminTagIsWeddingScoped(t *testing.T) {
	srv, admin, _ := setupIntegrationWithPool(t)
	u := srv.URL

	var wed struct{ Slug string }
	if code := call(t, "POST", u+"/api/admin/weddings", admin,
		map[string]string{"name": "An & Bình"}, &wed); code != 201 {
		t.Fatalf("create wedding = %d", code)
	}
	var ev struct{ Slug string }
	if code := call(t, "POST", u+"/api/admin/events", admin,
		map[string]string{"name": "Đám cưới An Bình", "weddingSlug": wed.Slug}, &ev); code != 201 {
		t.Fatalf("create event = %d", code)
	}
	if code := call(t, "PATCH", u+"/api/admin/events/"+ev.Slug, admin,
		map[string]string{"subdomain": "anbinh"}, nil); code != 200 {
		t.Fatal("set subdomain failed")
	}
	if code := call(t, "PATCH", u+"/api/admin/weddings/"+wed.Slug, admin,
		map[string]string{"password": "matkhau-cua-an-binh"}, nil); code != 200 {
		t.Fatal("set couple password failed")
	}
	var buf bytes.Buffer
	_ = json.NewEncoder(&buf).Encode(map[string]string{
		"password": "matkhau-cua-an-binh", "host": "anbinh.luminstudio.vn",
	})
	req, err := http.NewRequest("POST", u+"/api/admin/login", &buf)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var couple *http.Cookie
	for _, c := range resp.Cookies() {
		if c.Name == auth.CookieName && c.Value != "" {
			couple = c
		}
	}
	if couple == nil {
		t.Fatalf("couple login = %d, no cookie", resp.StatusCode)
	}

	// Couple B on couple A's host: a guest, not an admin device.
	var foreign struct {
		IsAdmin bool `json:"isAdmin"`
	}
	if code := call(t, "POST", u+"/api/identity/resolve", couple, map[string]any{
		"consent": true, "host": "giangvahieu.luminstudio.vn", "source": "shared",
		"signals": map[string]any{"userAgent": "Mozilla/5.0 (Macintosh)"},
	}, &foreign); code != 200 {
		t.Fatalf("foreign couple resolve = %d", code)
	}
	if foreign.IsAdmin {
		t.Fatal("another couple's session was tagged as this wedding's admin device")
	}

	// Same session on its OWN host is the admin device.
	var own struct {
		IsAdmin bool `json:"isAdmin"`
	}
	if code := call(t, "POST", u+"/api/identity/resolve", couple, map[string]any{
		"consent": true, "host": "anbinh.luminstudio.vn", "source": "shared",
		"signals": map[string]any{"userAgent": "Mozilla/5.0 (Macintosh)"},
	}, &own); code != 200 {
		t.Fatalf("own couple resolve = %d", code)
	}
	if !own.IsAdmin {
		t.Fatal("couple session was not tagged admin on its own wedding")
	}
}

// Tên tự lưu sau khi khách ngưng gõ, TRƯỚC khi họ bấm tham dự/không tham dự.
// Hàng đó phải tồn tại với rsvp NULL, và lần lưu-tên sau đó không được xoá mất
// lựa chọn RSVP đã có.
func TestSharedNameSavesBeforeRSVP(t *testing.T) {
	srv, admin, _ := setupIntegrationWithPool(t)
	u := srv.URL

	var gi struct{ Token string }
	if code := call(t, "POST", u+"/api/identity/resolve", nil, map[string]any{
		"consent": true, "eventSlug": evt, "source": "shared",
		"signals": map[string]any{"userAgent": "Mozilla/5.0 (iPhone)"},
	}, &gi); code != 200 {
		t.Fatalf("resolve = %d", code)
	}

	// 1. Chỉ có tên, chưa chọn gì.
	if code := call(t, "POST", u+"/api/identity/shared-rsvp", nil, map[string]any{
		"token": gi.Token, "eventSlug": evt, "name": "Bạn Chưa Quyết", "rsvp": "",
	}, nil); code != 204 {
		t.Fatalf("name-only save = %d, want 204", code)
	}
	var restored struct {
		Profile *sharedProfile `json:"profile"`
	}
	if code := call(t, "POST", u+"/api/identity/resolve", nil, map[string]any{
		"consent": true, "eventSlug": evt, "source": "shared", "token": gi.Token,
		"signals": map[string]any{"userAgent": "Mozilla/5.0 (iPhone)"},
	}, &restored); code != 200 {
		t.Fatalf("restore = %d", code)
	}
	if restored.Profile == nil || restored.Profile.Name != "Bạn Chưa Quyết" ||
		restored.Profile.RSVP != nil {
		t.Fatalf("name-only profile = %+v", restored.Profile)
	}
	var listed struct {
		Items []struct {
			Name *string `json:"name"`
			RSVP *string `json:"rsvp"`
		} `json:"items"`
	}
	call(t, "GET", u+"/api/admin/shared-guests?event="+evt, admin, nil, &listed)
	if len(listed.Items) != 1 || listed.Items[0].Name == nil ||
		*listed.Items[0].Name != "Bạn Chưa Quyết" || listed.Items[0].RSVP != nil {
		t.Fatalf("admin row = %+v", listed.Items)
	}

	// 2. Chọn RSVP.
	if code := call(t, "POST", u+"/api/identity/shared-rsvp", nil, map[string]any{
		"token": gi.Token, "eventSlug": evt, "name": "Bạn Chưa Quyết", "rsvp": "yes",
	}, nil); code != 204 {
		t.Fatalf("rsvp save = %d", code)
	}

	// 3. Sửa tên (rsvp rỗng) — KHÔNG được xoá lựa chọn vừa chọn.
	if code := call(t, "POST", u+"/api/identity/shared-rsvp", nil, map[string]any{
		"token": gi.Token, "eventSlug": evt, "name": "Bạn Đã Quyết", "rsvp": "",
	}, nil); code != 204 {
		t.Fatalf("rename = %d", code)
	}
	call(t, "GET", u+"/api/admin/shared-guests?event="+evt, admin, nil, &listed)
	if len(listed.Items) != 1 || *listed.Items[0].Name != "Bạn Đã Quyết" ||
		listed.Items[0].RSVP == nil || *listed.Items[0].RSVP != "yes" {
		t.Fatalf("rename wiped the RSVP: %+v", listed.Items)
	}

	// rsvp sai vẫn phải bị từ chối.
	if code := call(t, "POST", u+"/api/identity/shared-rsvp", nil, map[string]any{
		"token": gi.Token, "eventSlug": evt, "name": "X", "rsvp": "maybe",
	}, nil); code != 400 {
		t.Fatalf("bad rsvp = %d, want 400", code)
	}
}
