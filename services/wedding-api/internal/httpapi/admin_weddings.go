package httpapi

// Multi-couple management: the `weddings` layer above events. A master session
// (scope "*") sees and manages every wedding; a couple session is confined to
// its own slug. Couple passwords are bcrypt hashes in weddings.password_hash;
// the master password lives in admin_config (env ADMIN_PASSWORD as bootstrap).

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"

	"github.com/huongnguyenduc/lumin-studio/services/wedding-api/internal/auth"
	"github.com/huongnguyenduc/lumin-studio/services/wedding-api/internal/slug"
)

const (
	minPasswordLen = 8
	maxPasswordLen = 72 // bcrypt input cap
)

// isMaster reports whether the session sees every wedding.
func isMaster(r *http.Request) bool { return auth.Scope(r.Context()) == auth.ScopeAll }

// sessionWedding is the couple session's own wedding slug ("*" for master —
// only meaningful after an !isMaster check).
func sessionWedding(r *http.Request) string { return auth.Scope(r.Context()) }

// weddingScope resolves which wedding a request operates on: a couple session
// is pinned to its own slug (any ?wedding= is ignored); a master session picks
// via ?wedding=. Writes the 400 itself when master omits the param.
func weddingScope(w http.ResponseWriter, r *http.Request) (string, bool) {
	if s := auth.Scope(r.Context()); s != auth.ScopeAll {
		return s, true
	}
	if q := r.URL.Query().Get("wedding"); q != "" {
		return q, true
	}
	writeError(w, http.StatusBadRequest, "NO_WEDDING", "thiếu tham số wedding")
	return "", false
}

// eventInScope verifies the event exists and belongs to the session's wedding.
// Writes the 404 itself so call sites stay one line.
func (s *server) eventInScope(w http.ResponseWriter, r *http.Request, eventSlug string) bool {
	var wedding string
	err := s.pool.QueryRow(r.Context(),
		`SELECT wedding_slug FROM events WHERE slug = $1`, eventSlug).Scan(&wedding)
	if err == pgx.ErrNoRows || (err == nil && !isMaster(r) && wedding != auth.Scope(r.Context())) {
		writeError(w, http.StatusNotFound, "EVENT_NOT_FOUND", "không tìm thấy đám cưới")
		return false
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return false
	}
	return true
}

// requireMaster gates master-only endpoints (403 for couple sessions).
func requireMaster(w http.ResponseWriter, r *http.Request) bool {
	if !isMaster(r) {
		writeError(w, http.StatusForbidden, "MASTER_ONLY", "chỉ quản trị viên chính làm được thao tác này")
		return false
	}
	return true
}

type weddingRow struct {
	Slug        string    `json:"slug"`
	Name        string    `json:"name"`
	SortOrder   int       `json:"sortOrder"`
	HasPassword bool      `json:"hasPassword"`
	CreatedAt   time.Time `json:"createdAt"`
}

// me tells the admin app what the session can see — the dashboard branches on
// this (wedding switcher + management for master, single locked wedding else).
func (s *server) me(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"scope":  auth.Scope(r.Context()),
		"master": isMaster(r),
	})
}

// listWeddings: master sees all, a couple sees only its own row (the frontend
// can call it unconditionally).
func (s *server) listWeddings(w http.ResponseWriter, r *http.Request) {
	q := `SELECT slug, name, sort_order, password_hash IS NOT NULL, created_at
	      FROM weddings`
	args := []any{}
	if !isMaster(r) {
		q += ` WHERE slug = $1`
		args = append(args, auth.Scope(r.Context()))
	}
	rows, err := s.pool.Query(r.Context(), q+` ORDER BY sort_order, slug`, args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	defer rows.Close()
	items := []weddingRow{}
	for rows.Next() {
		var wr weddingRow
		if err := rows.Scan(&wr.Slug, &wr.Name, &wr.SortOrder, &wr.HasPassword, &wr.CreatedAt); err != nil {
			writeError(w, http.StatusInternalServerError, "DB", err.Error())
			return
		}
		items = append(items, wr)
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// createWedding (master only) makes the couple row plus its empty settings row,
// slugged like events/guests (probe-then-insert; one operator can't race itself).
func (s *server) createWedding(w http.ResponseWriter, r *http.Request) {
	if !requireMaster(w, r) {
		return
	}
	var body struct {
		Name string `json:"name"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "BAD_NAME", "tên cặp đôi không được để trống")
		return
	}
	id := slug.Unique(slug.Make(name), func(candidate string) bool {
		var exists bool
		err := s.pool.QueryRow(r.Context(),
			`SELECT EXISTS (SELECT 1 FROM weddings WHERE slug = $1)`, candidate).Scan(&exists)
		return err != nil || exists
	})

	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck // no-op after commit

	var wr weddingRow
	err = tx.QueryRow(r.Context(),
		`INSERT INTO weddings (slug, name, sort_order)
		 VALUES ($1, $2, (SELECT coalesce(max(sort_order), 0) + 1 FROM weddings))
		 RETURNING slug, name, sort_order, password_hash IS NOT NULL, created_at`,
		id, name).Scan(&wr.Slug, &wr.Name, &wr.SortOrder, &wr.HasPassword, &wr.CreatedAt)
	if err == nil {
		_, err = tx.Exec(r.Context(), `INSERT INTO settings (wedding_slug) VALUES ($1)`, id)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, wr)
}

// patchWedding (master only): rename and/or set/clear the couple password.
func (s *server) patchWedding(w http.ResponseWriter, r *http.Request) {
	if !requireMaster(w, r) {
		return
	}
	weddingSlug := chi.URLParam(r, "slug")
	var body struct {
		Name     *string `json:"name"`
		Password *string `json:"password"` // "" = disable couple login; else set
	}
	if !readJSON(w, r, &body) {
		return
	}
	if body.Name != nil && strings.TrimSpace(*body.Name) == "" {
		writeError(w, http.StatusBadRequest, "BAD_NAME", "tên cặp đôi không được để trống")
		return
	}
	var hash *string
	setHash := false
	if body.Password != nil {
		setHash = true
		if *body.Password != "" {
			h, ok := hashPassword(w, *body.Password)
			if !ok {
				return
			}
			hash = &h
		}
	}
	var wr weddingRow
	err := s.pool.QueryRow(r.Context(),
		`UPDATE weddings SET name = coalesce($2, name),
		                     password_hash = CASE WHEN $3 THEN $4 ELSE password_hash END
		 WHERE slug = $1
		 RETURNING slug, name, sort_order, password_hash IS NOT NULL, created_at`,
		weddingSlug, body.Name, setHash, hash).
		Scan(&wr.Slug, &wr.Name, &wr.SortOrder, &wr.HasPassword, &wr.CreatedAt)
	if err == pgx.ErrNoRows {
		writeError(w, http.StatusNotFound, "WEDDING_NOT_FOUND", "không tìm thấy cặp đôi")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, wr)
}

// deleteWedding (master only) removes the couple and everything under it in one
// tx — guests hang off events, wishes/settings/events off the wedding.
func (s *server) deleteWedding(w http.ResponseWriter, r *http.Request) {
	if !requireMaster(w, r) {
		return
	}
	weddingSlug := chi.URLParam(r, "slug")
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck // no-op after commit

	for _, q := range []string{
		`DELETE FROM guests WHERE event_slug IN (SELECT slug FROM events WHERE wedding_slug = $1)`,
		`DELETE FROM groups WHERE event_slug IN (SELECT slug FROM events WHERE wedding_slug = $1)`,
		`DELETE FROM wishes WHERE wedding_slug = $1`,
		`DELETE FROM settings WHERE wedding_slug = $1`,
		`DELETE FROM events WHERE wedding_slug = $1`,
	} {
		if _, err := tx.Exec(r.Context(), q, weddingSlug); err != nil {
			writeError(w, http.StatusInternalServerError, "DB", err.Error())
			return
		}
	}
	tag, err := tx.Exec(r.Context(), `DELETE FROM weddings WHERE slug = $1`, weddingSlug)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "WEDDING_NOT_FOUND", "không tìm thấy cặp đôi")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// changePassword lets the session change ITS OWN password: master → the master
// password (admin_config), couple → its wedding's password. Requires the
// current password so a walked-away session can't be silently hijacked.
func (s *server) changePassword(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Current string `json:"current"`
		New     string `json:"new"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	if isMaster(r) {
		if !s.checkMaster(r.Context(), body.Current) {
			writeError(w, http.StatusUnauthorized, "BAD_PASSWORD", "mật khẩu hiện tại không đúng")
			return
		}
		h, ok := hashPassword(w, body.New)
		if !ok {
			return
		}
		if _, err := s.pool.Exec(r.Context(),
			`UPDATE admin_config SET master_password_hash = $1`, h); err != nil {
			writeError(w, http.StatusInternalServerError, "DB", err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	weddingSlug := auth.Scope(r.Context())
	var hash *string
	if err := s.pool.QueryRow(r.Context(),
		`SELECT password_hash FROM weddings WHERE slug = $1`, weddingSlug).Scan(&hash); err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	if hash == nil || bcrypt.CompareHashAndPassword([]byte(*hash), []byte(body.Current)) != nil {
		writeError(w, http.StatusUnauthorized, "BAD_PASSWORD", "mật khẩu hiện tại không đúng")
		return
	}
	h, ok := hashPassword(w, body.New)
	if !ok {
		return
	}
	if _, err := s.pool.Exec(r.Context(),
		`UPDATE weddings SET password_hash = $2 WHERE slug = $1`, weddingSlug, h); err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// checkMaster verifies a candidate against the DB master hash when set, else
// the ADMIN_PASSWORD env bootstrap.
func (s *server) checkMaster(ctx context.Context, pw string) bool {
	var hash *string
	if err := s.pool.QueryRow(ctx,
		`SELECT master_password_hash FROM admin_config`).Scan(&hash); err == nil && hash != nil {
		return bcrypt.CompareHashAndPassword([]byte(*hash), []byte(pw)) == nil
	}
	return s.auth.CheckEnvMaster(pw)
}

// hashPassword validates length and bcrypts; writes the 400 itself.
func hashPassword(w http.ResponseWriter, pw string) (string, bool) {
	if len(pw) < minPasswordLen || len(pw) > maxPasswordLen {
		writeError(w, http.StatusBadRequest, "BAD_NEW_PASSWORD",
			"mật khẩu mới cần từ 8 đến 72 ký tự")
		return "", false
	}
	h, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "HASH", err.Error())
		return "", false
	}
	return string(h), true
}

// reviewSubdomain (master only) resolves a couple's pending subdomain request:
// approve copies it into `subdomain` (and provisions bucket CORS), reject just
// clears it.
func (s *server) reviewSubdomain(w http.ResponseWriter, r *http.Request) {
	if !requireMaster(w, r) {
		return
	}
	eventSlug := chi.URLParam(r, "slug")
	var body struct {
		Approve bool `json:"approve"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	var e eventRow
	var err error
	if body.Approve {
		err = s.pool.QueryRow(r.Context(),
			`UPDATE events SET subdomain = requested_subdomain, requested_subdomain = NULL
			 WHERE slug = $1 AND requested_subdomain IS NOT NULL
			 RETURNING slug, name, sort_order, subdomain, requested_subdomain, data`,
			eventSlug).Scan(&e.Slug, &e.Name, &e.SortOrder, &e.Subdomain, &e.RequestedSubdomain, &e.Data)
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, "SUBDOMAIN_TAKEN", "subdomain đã được dùng cho đám cưới khác")
			return
		}
		if err == nil && e.Subdomain != nil {
			s.allowOrigin(r.Context(), *e.Subdomain)
		}
	} else {
		err = s.pool.QueryRow(r.Context(),
			`UPDATE events SET requested_subdomain = NULL
			 WHERE slug = $1 AND requested_subdomain IS NOT NULL
			 RETURNING slug, name, sort_order, subdomain, requested_subdomain, data`,
			eventSlug).Scan(&e.Slug, &e.Name, &e.SortOrder, &e.Subdomain, &e.RequestedSubdomain, &e.Data)
	}
	if err == pgx.ErrNoRows {
		writeError(w, http.StatusNotFound, "NO_REQUEST", "không có đề xuất subdomain đang chờ")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, e)
}
