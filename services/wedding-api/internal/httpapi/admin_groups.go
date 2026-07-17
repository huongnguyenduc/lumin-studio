package httpapi

import (
	"errors"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// fallbackGroup receives members of a deleted group (HANDOFF §4).
const fallbackGroup = "Khác"

func (s *server) listGroups(w http.ResponseWriter, r *http.Request) {
	rows, err := s.pool.Query(r.Context(),
		`SELECT name, sort_order FROM groups ORDER BY sort_order, name`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var name string
		var sortOrder int
		if err := rows.Scan(&name, &sortOrder); err != nil {
			writeError(w, http.StatusInternalServerError, "DB", err.Error())
			return
		}
		items = append(items, map[string]any{"name": name, "sortOrder": sortOrder})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (s *server) createGroup(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	name := strings.TrimSpace(body.Name)
	if name == "" {
		writeError(w, http.StatusBadRequest, "BAD_NAME", "tên nhóm không được để trống")
		return
	}
	_, err := s.pool.Exec(r.Context(),
		`INSERT INTO groups (name, sort_order)
		 VALUES ($1, (SELECT coalesce(max(sort_order), 0) + 1 FROM groups))`, name)
	if isUniqueViolation(err) {
		writeError(w, http.StatusConflict, "GROUP_EXISTS", "nhóm đã tồn tại")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, map[string]string{"name": name})
}

// renameGroup cascades to members in one tx (HANDOFF §4: renaming cascades).
func (s *server) renameGroup(w http.ResponseWriter, r *http.Request) {
	oldName := chi.URLParam(r, "name")
	var body struct {
		Name string `json:"name"`
	}
	if !readJSON(w, r, &body) {
		return
	}
	newName := strings.TrimSpace(body.Name)
	if newName == "" {
		writeError(w, http.StatusBadRequest, "BAD_NAME", "tên nhóm không được để trống")
		return
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck // no-op after commit

	tag, err := tx.Exec(r.Context(),
		`UPDATE groups SET name = $2 WHERE name = $1`, oldName, newName)
	if isUniqueViolation(err) {
		writeError(w, http.StatusConflict, "GROUP_EXISTS", "nhóm đã tồn tại")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "GROUP_NOT_FOUND", "không tìm thấy nhóm")
		return
	}
	if _, err := tx.Exec(r.Context(),
		`UPDATE guests SET "group" = $2 WHERE "group" = $1`, oldName, newName); err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"name": newName})
}

// deleteGroup reassigns members to "Khác" (created on demand) in one tx.
func (s *server) deleteGroup(w http.ResponseWriter, r *http.Request) {
	name := chi.URLParam(r, "name")
	if name == fallbackGroup {
		writeError(w, http.StatusBadRequest, "PROTECTED_GROUP", `không thể xoá nhóm "Khác"`)
		return
	}
	tx, err := s.pool.Begin(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	defer tx.Rollback(r.Context()) //nolint:errcheck // no-op after commit

	tag, err := tx.Exec(r.Context(), `DELETE FROM groups WHERE name = $1`, name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	if tag.RowsAffected() == 0 {
		writeError(w, http.StatusNotFound, "GROUP_NOT_FOUND", "không tìm thấy nhóm")
		return
	}
	if _, err := tx.Exec(r.Context(),
		`INSERT INTO groups (name, sort_order)
		 VALUES ($1, (SELECT coalesce(max(sort_order), 0) + 1 FROM groups))
		 ON CONFLICT (name) DO NOTHING`, fallbackGroup); err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	if _, err := tx.Exec(r.Context(),
		`UPDATE guests SET "group" = $2 WHERE "group" = $1`, name, fallbackGroup); err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	if err := tx.Commit(r.Context()); err != nil {
		writeError(w, http.StatusInternalServerError, "DB", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
