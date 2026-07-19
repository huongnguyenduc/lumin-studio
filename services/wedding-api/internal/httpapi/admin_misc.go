package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/huongnguyenduc/lumin-studio/services/wedding-api/internal/uploadstore"
)

// --- wishes moderation (HANDOFF §3.6/§3.7: delete-only, no approval queue) ---

func (s *server) adminListWishes(w http.ResponseWriter, r *http.Request) {
	limit := queryInt(r, "limit", 24, 100)
	offset := queryInt(r, "offset", 0, 1<<30)
	rows, err := s.pool.Query(r.Context(),
		`SELECT w.id, w.guest_id, w.name, w.text, w.color, w.created_at, count(*) OVER ()
		 FROM wishes w ORDER BY w.created_at DESC LIMIT $1 OFFSET $2`, limit, offset)
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
			guestID, color *string
			createdAt      time.Time
		)
		if err := rows.Scan(&id, &guestID, &name, &text, &color, &createdAt, &total); err != nil {
			writeError(w, http.StatusInternalServerError, "DB", err.Error())
			return
		}
		items = append(items, map[string]any{
			"id": id, "guestId": guestID, "name": name, "text": text,
			"color": color, "createdAt": createdAt,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": total})
}

func (s *server) adminDeleteWish(w http.ResponseWriter, r *http.Request) {
	tag, err := s.pool.Exec(r.Context(),
		`DELETE FROM wishes WHERE id = $1`, chi.URLParam(r, "id"))
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "WISH_NOT_FOUND", "không tìm thấy lời chúc")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) bulkDeleteWishes(w http.ResponseWriter, r *http.Request) {
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
	tag, err := s.pool.Exec(r.Context(), `DELETE FROM wishes WHERE id = ANY($1)`, body.IDs)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"deleted": tag.RowsAffected()})
}

// --- stats (HANDOFF §3.1) ---

// adminStats scopes guest counts to one event (?event=) — wishes stay a
// shared wall across events, so that count is global.
func (s *server) adminStats(w http.ResponseWriter, r *http.Request) {
	event := r.URL.Query().Get("event")
	if event == "" {
		writeError(w, http.StatusBadRequest, "NO_EVENT", "thiếu tham số event")
		return
	}
	var total, opened, yes, no, wishes int
	err := s.pool.QueryRow(r.Context(), `
		SELECT (SELECT count(*) FROM guests WHERE event_slug = $1),
		       (SELECT count(*) FROM guests WHERE event_slug = $1 AND opened_at IS NOT NULL),
		       (SELECT count(*) FROM guests WHERE event_slug = $1 AND rsvp = 'yes'),
		       (SELECT count(*) FROM guests WHERE event_slug = $1 AND rsvp = 'no'),
		       (SELECT count(*) FROM wishes)`, event).
		Scan(&total, &opened, &yes, &no, &wishes)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{
		"guests": total, "opened": opened, "rsvpYes": yes, "rsvpNo": no, "wishes": wishes,
	})
}

// --- settings (HANDOFF §3.5: single JSONB row, shallow key merge) ---

func (s *server) getSettings(w http.ResponseWriter, r *http.Request) {
	var data json.RawMessage
	if err := s.pool.QueryRow(r.Context(), `SELECT data FROM settings`).Scan(&data); err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_, _ = w.Write(data)
}

// patchSettings shallow-merges the posted object into the row (jsonb ||). A key
// set to null is removed — that's how the host clears a slot (e.g. music).
func (s *server) patchSettings(w http.ResponseWriter, r *http.Request) {
	var patch map[string]json.RawMessage
	if !readJSONLoose(w, r, &patch) {
		return
	}
	nullKeys := []string{}
	for k, v := range patch {
		if string(v) == "null" {
			nullKeys = append(nullKeys, k)
			delete(patch, k)
		}
	}
	merged, err := json.Marshal(patch)
	if err != nil {
		writeError(w, http.StatusBadRequest, "BAD_JSON", err.Error())
		return
	}
	var data json.RawMessage
	err = s.pool.QueryRow(r.Context(),
		`UPDATE settings SET data = (data || $1::jsonb) - $2::text[] RETURNING data`,
		merged, nullKeys).Scan(&data)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_, _ = w.Write(data)
}

// readJSONLoose is readJSON without DisallowUnknownFields — settings keys are
// open-ended by design.
func readJSONLoose(w http.ResponseWriter, r *http.Request, v any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_JSON", err.Error())
		return false
	}
	return true
}

// --- uploads presign (HANDOFF §3.5/§5) ---

func (s *server) presignUpload(w http.ResponseWriter, r *http.Request) {
	if s.uploads == nil {
		writeError(w, http.StatusServiceUnavailable, "UPLOADS_DISABLED",
			"chưa cấu hình kho ảnh (UPLOAD_S3_*)")
		return
	}
	var body struct {
		Kind string `json:"kind"`
		Mime string `json:"mime"`
		Size int64  `json:"size"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	signed, err := s.uploads.Presign(strings.TrimSpace(body.Kind), body.Mime, body.Size)
	if errors.Is(err, uploadstore.ErrInvalid) {
		writeError(w, http.StatusBadRequest, "BAD_UPLOAD", err.Error())
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "PRESIGN", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, signed)
}
