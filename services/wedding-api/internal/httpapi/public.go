package httpapi

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

// wishColors are the 4 curated card presets (HANDOFF §2.7) — the DB CHECK is the
// backstop; validating here gives the client a 400 instead of a 500.
var wishColors = map[string]bool{
	"rgb(255,251,248)": true, // Trắng ngà
	"rgb(249,241,232)": true, // Kem
	"rgb(248,235,230)": true, // Hồng phấn
	"rgb(238,239,230)": true, // Xanh ô liu
}

const (
	maxWishLen     = 500
	maxWishNameLen = 100
)

// getInvite resolves a guest link — a pure read. Open tracking moved to
// markOpened (POST) so link-preview bots (Zalo/Messenger fetch the page via
// GET) never fake an open. 404 → the page renders the anonymous card.
func (s *server) getInvite(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "guestId")
	var label string
	var rsvp *string
	err := s.pool.QueryRow(r.Context(),
		`SELECT label, rsvp FROM guests WHERE id = $1`, id).Scan(&label, &rsvp)
	if err == pgx.ErrNoRows {
		writeError(w, http.StatusNotFound, "GUEST_NOT_FOUND", "không tìm thấy khách mời")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "label": label, "rsvp": rsvp})
}

// markOpened is the write-once open tracking (HANDOFF §5), fired by the client
// after the invitation mounts: the UPDATE only touches a NULL opened_at, so
// re-opens never overwrite the first timestamp. Idempotent 204 either way —
// the client fires-and-forgets.
func (s *server) markOpened(w http.ResponseWriter, r *http.Request) {
	_, err := s.pool.Exec(r.Context(),
		`UPDATE guests SET opened_at = now() WHERE id = $1 AND opened_at IS NULL`,
		chi.URLParam(r, "guestId"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// postRSVP upserts the guest's answer — last write wins, always stamps rsvp_at
// (HANDOFF §2.6: changeable any time, idempotent).
func (s *server) postRSVP(w http.ResponseWriter, r *http.Request) {
	var body struct {
		RSVP string `json:"rsvp"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	if body.RSVP != "yes" && body.RSVP != "no" {
		writeError(w, http.StatusBadRequest, "BAD_RSVP", `rsvp phải là "yes" hoặc "no"`)
		return
	}
	tag, err := s.pool.Exec(r.Context(),
		`UPDATE guests SET rsvp = $2, rsvp_at = now() WHERE id = $1`,
		chi.URLParam(r, "guestId"), body.RSVP)
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

// postWish validates and stores a wish (HANDOFF §5). An unknown guestId degrades
// to anonymous (NULL) rather than failing — the wall doesn't care, and a stale
// link should never eat a wish.
func (s *server) postWish(w http.ResponseWriter, r *http.Request) {
	var body struct {
		GuestID string `json:"guestId"`
		Name    string `json:"name"`
		Text    string `json:"text"`
		Color   string `json:"color"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	text := strings.TrimSpace(body.Text)
	if text == "" || len([]rune(text)) > maxWishLen {
		writeError(w, http.StatusBadRequest, "BAD_TEXT", "lời chúc phải có nội dung và tối đa 500 ký tự")
		return
	}
	var color *string
	if body.Color != "" {
		if !wishColors[body.Color] {
			writeError(w, http.StatusBadRequest, "BAD_COLOR", "màu thiệp không hợp lệ")
			return
		}
		color = &body.Color
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		name = "Khách mời"
	}
	if len([]rune(name)) > maxWishNameLen {
		writeError(w, http.StatusBadRequest, "BAD_NAME", "tên tối đa 100 ký tự")
		return
	}
	var guestID *string
	if body.GuestID != "" {
		var exists bool
		if err := s.pool.QueryRow(r.Context(),
			`SELECT EXISTS (SELECT 1 FROM guests WHERE id = $1)`, body.GuestID).Scan(&exists); err != nil {
			writeError(w, http.StatusInternalServerError, "DB", err.Error())
			return
		}
		if exists {
			guestID = &body.GuestID
		}
	}
	var (
		id        string
		createdAt time.Time
	)
	err := s.pool.QueryRow(r.Context(),
		`INSERT INTO wishes (guest_id, name, text, color) VALUES ($1, $2, $3, $4)
		 RETURNING id, created_at`, guestID, name, text, color).Scan(&id, &createdAt)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"id": id, "name": name, "text": text, "color": color, "createdAt": createdAt,
	})
}

// getWishes returns the public wall, newest first (HANDOFF §2.8) with a total
// for the "Xem thêm" button.
func (s *server) getWishes(w http.ResponseWriter, r *http.Request) {
	limit := queryInt(r, "limit", 20, 100)
	offset := queryInt(r, "offset", 0, 1<<30)

	rows, err := s.pool.Query(r.Context(),
		`SELECT id, name, text, color, created_at, count(*) OVER () AS total
		 FROM wishes ORDER BY created_at DESC LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	defer rows.Close()

	items := []map[string]any{}
	total := 0
	for rows.Next() {
		var (
			id, name, text string
			color          *string
			createdAt      time.Time
		)
		if err := rows.Scan(&id, &name, &text, &color, &createdAt, &total); err != nil {
			writeError(w, http.StatusInternalServerError, "DB", err.Error())
			return
		}
		items = append(items, map[string]any{
			"id": id, "name": name, "text": text, "color": color, "createdAt": createdAt,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": total})
}

func queryInt(r *http.Request, key string, def, max int) int {
	v := r.URL.Query().Get(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 0 {
		return def
	}
	if n > max {
		return max
	}
	return n
}
