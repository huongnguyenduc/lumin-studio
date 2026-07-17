package httpapi

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/huongnguyenduc/lumin-studio/services/wedding-api/internal/slug"
)

type guestRow struct {
	ID        string     `json:"id"`
	Label     string     `json:"label"`
	Group     string     `json:"group"`
	Note      *string    `json:"note"`
	OpenedAt  *time.Time `json:"openedAt"`
	RSVP      *string    `json:"rsvp"`
	RSVPAt    *time.Time `json:"rsvpAt"`
	CreatedAt time.Time  `json:"createdAt"`
	WishCount int        `json:"wishCount"`
	FirstWish *string    `json:"firstWish"`
}

const guestSelect = `
	SELECT g.id, g.label, g."group", g.note, g.opened_at, g.rsvp, g.rsvp_at, g.created_at,
	       (SELECT count(*) FROM wishes w WHERE w.guest_id = g.id) AS wish_count,
	       (SELECT w.text FROM wishes w WHERE w.guest_id = g.id ORDER BY w.created_at LIMIT 1)
	FROM guests g`

// listGuests returns the whole list — filters/sort/pagination are client-side in
// the admin app (prototype behavior; a wedding list is a few hundred rows).
func (s *server) listGuests(w http.ResponseWriter, r *http.Request) {
	rows, err := s.pool.Query(r.Context(), guestSelect+` ORDER BY g.created_at DESC`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	defer rows.Close()
	guests := []guestRow{}
	for rows.Next() {
		var g guestRow
		if err := rows.Scan(&g.ID, &g.Label, &g.Group, &g.Note, &g.OpenedAt, &g.RSVP,
			&g.RSVPAt, &g.CreatedAt, &g.WishCount, &g.FirstWish); err != nil {
			writeError(w, http.StatusInternalServerError, "DB", err.Error())
			return
		}
		guests = append(guests, g)
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": guests})
}

// createGuest generates the immutable slug id (collision → -2/-3…) by probing
// existing ids. ponytail: probe-then-insert, not retry-on-23505 — two adds
// racing to the same slug can 500 one of them; one host typing labels can't.
func (s *server) createGuest(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Label string  `json:"label"`
		Group string  `json:"group"`
		Note  *string `json:"note"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	label := strings.TrimSpace(body.Label)
	if label == "" {
		writeError(w, http.StatusBadRequest, "BAD_LABEL", "xưng hô không được để trống")
		return
	}
	group := strings.TrimSpace(body.Group)
	if group == "" {
		group = "Bạn bè"
	}

	base := slug.Make(label)
	id := slug.Unique(base, func(candidate string) bool {
		var exists bool
		err := s.pool.QueryRow(r.Context(),
			`SELECT EXISTS (SELECT 1 FROM guests WHERE id = $1)`, candidate).Scan(&exists)
		return err != nil || exists // an errored probe counts as taken → try the next suffix
	})

	var g guestRow
	err := s.pool.QueryRow(r.Context(),
		`INSERT INTO guests (id, label, "group", note) VALUES ($1, $2, $3, $4)
		 RETURNING id, label, "group", note, opened_at, rsvp, rsvp_at, created_at`,
		id, label, group, body.Note).
		Scan(&g.ID, &g.Label, &g.Group, &g.Note, &g.OpenedAt, &g.RSVP, &g.RSVPAt, &g.CreatedAt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, g)
}

// patchGuest updates label/group/note — never the id (slug immutable, links
// already sent must keep working).
func (s *server) patchGuest(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Label *string `json:"label"`
		Group *string `json:"group"`
		Note  *string `json:"note"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	if body.Label != nil && strings.TrimSpace(*body.Label) == "" {
		writeError(w, http.StatusBadRequest, "BAD_LABEL", "xưng hô không được để trống")
		return
	}
	tag, err := s.pool.Exec(r.Context(),
		`UPDATE guests SET label = coalesce($2, label),
		                   "group" = coalesce($3, "group"),
		                   note = coalesce($4, note)
		 WHERE id = $1`,
		chi.URLParam(r, "id"), body.Label, body.Group, body.Note)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "GUEST_NOT_FOUND", "không tìm thấy khách mời")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) deleteGuest(w http.ResponseWriter, r *http.Request) {
	tag, err := s.pool.Exec(r.Context(),
		`DELETE FROM guests WHERE id = $1`, chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "GUEST_NOT_FOUND", "không tìm thấy khách mời")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// bulkDeleteGuests deletes the selection in one statement (HANDOFF §3.7).
func (s *server) bulkDeleteGuests(w http.ResponseWriter, r *http.Request) {
	var body struct {
		IDs []string `json:"ids"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	if len(body.IDs) == 0 {
		writeError(w, http.StatusBadRequest, "NO_IDS", "danh sách ids trống")
		return
	}
	tag, err := s.pool.Exec(r.Context(),
		`DELETE FROM guests WHERE id = ANY($1)`, body.IDs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"deleted": tag.RowsAffected()})
}
