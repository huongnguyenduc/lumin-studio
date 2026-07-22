package httpapi

import (
	"context"
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
	Slug               string          `json:"slug"`
	Name               string          `json:"name"`
	SortOrder          int             `json:"sortOrder"`
	Subdomain          *string         `json:"subdomain"`
	RequestedSubdomain *string         `json:"requestedSubdomain"`
	WeddingSlug        string          `json:"weddingSlug"`
	Data               json.RawMessage `json:"data"`
}

const eventSelect = `slug, name, sort_order, subdomain, requested_subdomain, wedding_slug, data`

func scanEvent(row pgx.Row, e *eventRow) error {
	return row.Scan(&e.Slug, &e.Name, &e.SortOrder, &e.Subdomain, &e.RequestedSubdomain,
		&e.WeddingSlug, &e.Data)
}

// listEvents returns the session's events: every wedding for master, own only
// for a couple.
func (s *server) listEvents(w http.ResponseWriter, r *http.Request) {
	q := `SELECT ` + eventSelect + ` FROM events`
	args := []any{}
	if !isMaster(r) {
		q += ` WHERE wedding_slug = $1`
		args = append(args, sessionWedding(r))
	}
	rows, err := s.pool.Query(r.Context(), q+` ORDER BY sort_order, slug`, args...)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	defer rows.Close()
	items := []eventRow{}
	for rows.Next() {
		var e eventRow
		if err := scanEvent(rows, &e); err != nil {
			writeError(w, http.StatusInternalServerError, "DB", err.Error())
			return
		}
		items = append(items, e)
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// createEvent generates the immutable slug from the name (same probe-then-insert
// pattern as createGuest). Couple sessions create under their own wedding;
// master passes weddingSlug in the body.
func (s *server) createEvent(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name        string `json:"name"`
		WeddingSlug string `json:"weddingSlug"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "BAD_NAME", "tên đám cưới không được để trống")
		return
	}
	wedding := body.WeddingSlug
	if !isMaster(r) {
		wedding = sessionWedding(r)
	}
	if wedding == "" {
		writeError(w, http.StatusBadRequest, "NO_WEDDING", "thiếu weddingSlug")
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
	err = scanEvent(tx.QueryRow(r.Context(),
		`INSERT INTO events (slug, name, wedding_slug, sort_order)
		 VALUES ($1, $2, $3, (SELECT coalesce(max(sort_order), 0) + 1 FROM events))
		 RETURNING `+eventSelect,
		id, name, wedding), &e)
	if isForeignKeyViolation(err) {
		writeError(w, http.StatusNotFound, "WEDDING_NOT_FOUND", "không tìm thấy cặp đôi")
		return
	}
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
// optionally renames. Subdomain: master sets it directly; a couple's value
// lands in requested_subdomain, pending master review (reviewSubdomain).
func (s *server) patchEvent(w http.ResponseWriter, r *http.Request) {
	eventSlug := chi.URLParam(r, "slug")
	if !s.eventInScope(w, r, eventSlug) {
		return
	}
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
		err = scanEvent(s.pool.QueryRow(r.Context(),
			`UPDATE events SET name = coalesce($2, name), data = (data || $3::jsonb) - $4::text[]
			 WHERE slug = $1
			 RETURNING `+eventSelect,
			eventSlug, body.Name, merged, nullKeys), &e)
	} else {
		// Admin types the label only (e.g. "damcuoisg"); we own the domain suffix so the
		// site can start serving it immediately via the wildcard Ingress (no redeploy).
		var sub *string
		if label := strings.TrimSpace(*body.Subdomain); label != "" {
			full := slug.Make(label) + ".luminstudio.vn"
			sub = &full
		}
		col := "subdomain"
		if !isMaster(r) {
			col = "requested_subdomain" // couple proposal — live only after master approval
			// requested_subdomain has no UNIQUE constraint (only live `subdomain`
			// does), so a couple would otherwise learn the name is taken only when
			// master tries to approve it (409, much later). Reject up front if it
			// collides with any other event's live or pending subdomain.
			if sub != nil {
				var taken bool
				if qerr := s.pool.QueryRow(r.Context(),
					`SELECT EXISTS (SELECT 1 FROM events
					 WHERE slug <> $1 AND (subdomain = $2 OR requested_subdomain = $2))`,
					eventSlug, *sub).Scan(&taken); qerr != nil {
					writeError(w, http.StatusInternalServerError, "DB", qerr.Error())
					return
				}
				if taken {
					writeError(w, http.StatusConflict, "SUBDOMAIN_TAKEN", "subdomain đã được dùng cho đám cưới khác")
					return
				}
			}
		}
		err = scanEvent(s.pool.QueryRow(r.Context(),
			`UPDATE events SET name = coalesce($2, name), `+col+` = $3,
			                    data = (data || $4::jsonb) - $5::text[]
			 WHERE slug = $1
			 RETURNING `+eventSelect,
			eventSlug, body.Name, sub, merged, nullKeys), &e)
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, "SUBDOMAIN_TAKEN", "subdomain đã được dùng cho đám cưới khác")
			return
		}
		if err == nil && isMaster(r) && sub != nil {
			s.allowOrigin(r.Context(), *sub)
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

// deleteEvent removes one event ("đám") and everything under it — its guests and
// groups — in one tx. Wishes are per-WEDDING (not per-event), so the couple's
// wall is untouched. Scoped: a couple can only delete its own events; master
// (bearer) any. Deleting a couple's only event just leaves it with no live
// subdomain (recoverable — add another), so it isn't blocked.
func (s *server) deleteEvent(w http.ResponseWriter, r *http.Request) {
	eventSlug := chi.URLParam(r, "slug")
	if !s.eventInScope(w, r, eventSlug) {
		return
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck // no-op after commit

	for _, q := range []string{
		`DELETE FROM guests WHERE event_slug = $1`,
		`DELETE FROM groups WHERE event_slug = $1`,
	} {
		if _, err := tx.Exec(r.Context(), q, eventSlug); err != nil {
			writeError(w, http.StatusInternalServerError, "DB", err.Error())
			return
		}
	}
	tag, err := tx.Exec(r.Context(), `DELETE FROM events WHERE slug = $1`, eventSlug)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "EVENT_NOT_FOUND", "không tìm thấy đám cưới")
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// allowOrigin best-effort adds a bucket CORS rule for a newly live subdomain —
// a failure only means uploads on that subdomain need the old manual step.
func (s *server) allowOrigin(ctx context.Context, host string) {
	if s.uploads == nil {
		return
	}
	if err := s.uploads.EnsureOriginAllowed(ctx, "https://"+host); err != nil {
		log.Printf("wedding-api: cors allow %s: %v", host, err)
	}
}
