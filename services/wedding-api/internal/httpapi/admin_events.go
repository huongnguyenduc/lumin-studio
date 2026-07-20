package httpapi

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"github.com/huongnguyenduc/lumin-studio/services/wedding-api/internal/slug"
)

// defaultGroups seeds a newly created event with the same starter groups the
// first wedding shipped with (000001_init.up.sql) — host can rename/delete.
var defaultGroups = []string{"Nhà gái", "Nhà trai", "Bạn cô dâu", "Bạn chú rể", "Đồng nghiệp", "Bạn bè"}

type eventRow struct {
	Slug      string          `json:"slug"`
	Name      string          `json:"name"`
	SortOrder int             `json:"sortOrder"`
	Subdomain *string         `json:"subdomain"`
	Data      json.RawMessage `json:"data"`
}

func (s *server) listEvents(w http.ResponseWriter, r *http.Request) {
	rows, err := s.pool.Query(r.Context(),
		`SELECT slug, name, sort_order, subdomain, data FROM events ORDER BY sort_order, slug`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	defer rows.Close()
	items := []eventRow{}
	for rows.Next() {
		var e eventRow
		if err := rows.Scan(&e.Slug, &e.Name, &e.SortOrder, &e.Subdomain, &e.Data); err != nil {
			writeError(w, http.StatusInternalServerError, "DB", err.Error())
			return
		}
		items = append(items, e)
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// createEvent generates the immutable slug from the name (same probe-then-insert
// pattern as createGuest — one host creating events can't race itself).
func (s *server) createEvent(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "BAD_NAME", "tên đám cưới không được để trống")
		return
	}
	base := slug.Make(name)
	id := slug.Unique(base, func(candidate string) bool {
		var exists bool
		err := s.pool.QueryRow(r.Context(),
			`SELECT EXISTS (SELECT 1 FROM events WHERE slug = $1)`, candidate).Scan(&exists)
		return err != nil || exists
	})

	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck // no-op after commit

	var e eventRow
	err = tx.QueryRow(r.Context(),
		`INSERT INTO events (slug, name, sort_order)
		 VALUES ($1, $2, (SELECT coalesce(max(sort_order), 0) + 1 FROM events))
		 RETURNING slug, name, sort_order, subdomain, data`,
		id, name).Scan(&e.Slug, &e.Name, &e.SortOrder, &e.Subdomain, &e.Data)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	for i, g := range defaultGroups {
		if _, err := tx.Exec(r.Context(),
			`INSERT INTO groups (event_slug, name, sort_order) VALUES ($1, $2, $3)`,
			id, g, i+1); err != nil {
			writeError(w, http.StatusInternalServerError, "DB", err.Error())
			return
		}
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, e)
}

// patchEvent shallow-merges into data (same behavior as patchSettings) and
// optionally renames — mirrors patchSettings' null-key-removes convention.
func (s *server) patchEvent(w http.ResponseWriter, r *http.Request) {
	eventSlug := chi.URLParam(r, "slug")
	var body struct {
		Name      *string                    `json:"name"`
		Subdomain *string                    `json:"subdomain"` // absent = unchanged; "" = clear; else label, normalized below
		Data      map[string]json.RawMessage `json:"data"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	if body.Name != nil && strings.TrimSpace(*body.Name) == "" {
		writeError(w, http.StatusBadRequest, "BAD_NAME", "tên đám cưới không được để trống")
		return
	}
	// A patch that only touches name/subdomain omits "data" entirely, which
	// decodes to a nil map — json.Marshal(nil map) is the literal `null`, and
	// jsonb `data || null` corrupts the column into a 2-element array instead
	// of leaving it alone. Force it to an empty object so `||` is a no-op.
	if body.Data == nil {
		body.Data = map[string]json.RawMessage{}
	}
	nullKeys := []string{}
	for k, v := range body.Data {
		if string(v) == "null" {
			nullKeys = append(nullKeys, k)
			delete(body.Data, k)
		}
	}
	merged, err := json.Marshal(body.Data)
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_JSON", err.Error())
		return
	}

	var e eventRow
	if body.Subdomain == nil {
		// Column untouched — coalesce($2,...) already leaves name alone too when absent.
		err = s.pool.QueryRow(r.Context(),
			`UPDATE events SET name = coalesce($2, name), data = (data || $3::jsonb) - $4::text[]
			 WHERE slug = $1
			 RETURNING slug, name, sort_order, subdomain, data`,
			eventSlug, body.Name, merged, nullKeys).
			Scan(&e.Slug, &e.Name, &e.SortOrder, &e.Subdomain, &e.Data)
	} else {
		// Admin types the label only (e.g. "damcuoisg"); we own the domain suffix so the
		// site can start serving it immediately via the wildcard Ingress (no redeploy).
		var sub *string
		if label := strings.TrimSpace(*body.Subdomain); label != "" {
			full := slug.Make(label) + ".luminstudio.vn"
			sub = &full
		}
		err = s.pool.QueryRow(r.Context(),
			`UPDATE events SET name = coalesce($2, name), subdomain = $3,
			                    data = (data || $4::jsonb) - $5::text[]
			 WHERE slug = $1
			 RETURNING slug, name, sort_order, subdomain, data`,
			eventSlug, body.Name, sub, merged, nullKeys).
			Scan(&e.Slug, &e.Name, &e.SortOrder, &e.Subdomain, &e.Data)
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, "SUBDOMAIN_TAKEN", "subdomain đã được dùng cho đám cưới khác")
			return
		}
		// New subdomain → its origin needs its own bucket CORS rule before browser
		// uploads from it will work (§EnsureOriginAllowed). Best-effort: a failure
		// here only means uploads on that subdomain need the old manual step.
		if err == nil && sub != nil && s.uploads != nil {
			if cerr := s.uploads.EnsureOriginAllowed(r.Context(), "https://"+*sub); cerr != nil {
				log.Printf("wedding-api: cors allow %s: %v", *sub, cerr)
			}
		}
	}
	if err == pgx.ErrNoRows {
		writeError(w, http.StatusNotFound, "EVENT_NOT_FOUND", "không tìm thấy đám cưới")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, e)
}
