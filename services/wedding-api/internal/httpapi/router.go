// Package httpapi builds the wedding-api HTTP router (Chi v5) — the API surface
// of HANDOFF §5: rate-limited public invite/RSVP/wishes routes + the /api/admin
// group behind the shared-password JWT cookie (internal/auth).
//
// Not here on purpose: GET /api/admin/export.xlsx — marked optional in §5; the
// admin app exports client-side with SheetJS (§3.8).
package httpapi

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"github.com/huongnguyenduc/lumin-studio/services/wedding-api/internal/auth"
	"github.com/huongnguyenduc/lumin-studio/services/wedding-api/internal/uploadstore"
)

type server struct {
	pool       *pgxpool.Pool
	auth       *auth.Auth
	uploads    *uploadstore.Store // nil → presign answers 503 (log-and-disable)
	rootDomain string             // e.g. "luminstudio.vn" — see weddingByHost
}

// New builds the router. uploads may be nil when UPLOAD_S3_* is not configured.
func New(pool *pgxpool.Pool, a *auth.Auth, uploads *uploadstore.Store, rootDomain string) http.Handler {
	s := &server{pool: pool, auth: a, uploads: uploads, rootDomain: rootDomain}

	r := chi.NewRouter()
	// No RealIP middleware: deprecated/spoofable — clientIP() reads CF-Connecting-IP
	// deliberately (the service only ever sits behind the Cloudflare Tunnel).
	r.Use(middleware.RequestID)
	r.Use(middleware.Recoverer)

	// Liveness: the process is up and serving.
	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	// Readiness: the database answers a ping.
	r.Get("/readyz", func(w http.ResponseWriter, req *http.Request) {
		ctx, cancel := context.WithTimeout(req.Context(), 2*time.Second)
		defer cancel()
		if err := pool.Ping(ctx); err != nil {
			http.Error(w, "db: "+err.Error(), http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	// Public routes — per-IP rate limit (HANDOFF §5 "rate-limit these").
	public := newRateLimiter(10, 30)
	r.Group(func(r chi.Router) {
		r.Use(public.middleware)
		r.Get("/api/invite/{guestId}", s.getInvite)
		r.Post("/api/invite/{guestId}/opened", s.markOpened)
		r.Post("/api/invite/{guestId}/rsvp", s.postRSVP)
		r.Post("/api/wishes", s.postWish)
		r.Get("/api/wishes", s.getWishes)
		// Site settings are public page content (hero/gallery/map/music/meta) —
		// the invitation SSR reads them without a session (HANDOFF §3.5).
		r.Get("/api/settings", s.publicSettings)
		// Events (venue/timeline per wedding) — each wedding-web deployment
		// resolves its active event from this list.
		r.Get("/api/events", s.getEvents)
	})

	// Login is rate-limited MUCH tighter (shared password → brute-force surface).
	login := newRateLimiter(0.2, 5)
	r.With(login.middleware).Post("/api/admin/login", s.login)
	r.Post("/api/admin/logout", s.logout)

	// Admin routes — session cookie required.
	r.Route("/api/admin", func(r chi.Router) {
		r.Use(s.auth.Middleware)
		r.Get("/guests", s.listGuests)
		r.Post("/guests", s.createGuest)
		r.Patch("/guests/{id}", s.patchGuest)
		r.Delete("/guests/{id}", s.deleteGuest)
		r.Post("/guests/bulk-delete", s.bulkDeleteGuests)

		r.Get("/wishes", s.adminListWishes)
		r.Delete("/wishes/{id}", s.adminDeleteWish)
		r.Post("/wishes/bulk-delete", s.bulkDeleteWishes)

		r.Get("/groups", s.listGroups)
		r.Post("/groups", s.createGroup)
		r.Patch("/groups/{event}/{name}", s.renameGroup)
		r.Delete("/groups/{event}/{name}", s.deleteGroup)

		r.Get("/events", s.listEvents)
		r.Post("/events", s.createEvent)
		r.Patch("/events/{slug}", s.patchEvent)
		r.Delete("/events/{slug}", s.deleteEvent)
		r.Post("/events/{slug}/subdomain-review", s.reviewSubdomain)

		r.Get("/weddings", s.listWeddings)
		r.Post("/weddings", s.createWedding)
		r.Patch("/weddings/{slug}", s.patchWedding)
		r.Delete("/weddings/{slug}", s.deleteWedding)
		// Rate-limit the self-service password change: it checks the current
		// password, so it's a (session-gated, bcrypt-slow) brute-force surface.
		pw := newRateLimiter(0.2, 5)
		r.With(pw.middleware).Post("/password", s.changePassword)

		// "overview", not "stats" — generic ad-blocker filter lists (EasyPrivacy-style)
		// block URLs containing "stats" as presumed analytics, breaking this in-browser.
		r.Get("/overview", s.adminStats)
		r.Get("/settings", s.adminGetSettings)
		r.Patch("/settings", s.patchSettings)
		r.Post("/uploads/presign", s.presignUpload)
	})

	return r
}

// login is couple-only: the page host the client sends resolves — strictly, via
// events.subdomain, no fallback — to one wedding whose own bcrypt password is
// checked, yielding a session cookie confined to that couple. Master scope is
// NOT reachable here (it's a server-to-server bearer used by the lumin admin);
// a browser can never escalate past its own wedding.
func (s *server) login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Password string `json:"password"`
		Host     string `json:"host"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	if body.Host == "" {
		writeError(w, http.StatusBadRequest, "NO_HOST", "thiếu host")
		return
	}
	hostname := strings.ToLower(strings.Split(body.Host, ":")[0])
	var wedding string
	var hash *string
	err := s.pool.QueryRow(r.Context(),
		`SELECT w.slug, w.password_hash FROM weddings w
		 JOIN events e ON e.wedding_slug = w.slug
		 WHERE lower(e.subdomain) = $1 LIMIT 1`, hostname).Scan(&wedding, &hash)
	if err != nil && err != pgx.ErrNoRows {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	if err == pgx.ErrNoRows || hash == nil ||
		bcrypt.CompareHashAndPassword([]byte(*hash), []byte(body.Password)) != nil {
		writeError(w, http.StatusUnauthorized, "BAD_PASSWORD", "mật khẩu không đúng")
		return
	}
	cookie, err := s.auth.IssueCookie(wedding)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "TOKEN", err.Error())
		return
	}
	http.SetCookie(w, cookie)
	writeJSON(w, http.StatusOK, map[string]any{"scope": wedding, "master": false})
}

func (s *server) logout(w http.ResponseWriter, _ *http.Request) {
	http.SetCookie(w, s.auth.Clear())
	w.WriteHeader(http.StatusNoContent)
}
