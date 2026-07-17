package httpapi

import (
	"encoding/json"
	"net/http"
)

// writeJSON writes v with the right header; encode errors past the header are
// unrecoverable mid-stream and just logged by the caller's Recoverer.
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// readJSON decodes the body into v (strict: unknown fields rejected, 1MB cap —
// the biggest legit body here is a bulk-delete id list).
func readJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		writeError(w, http.StatusBadRequest, "BAD_JSON", err.Error())
		return false
	}
	return true
}

// writeError is the single error envelope: {"error":{"code","message"}}.
func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{
		"error": map[string]string{"code": code, "message": message},
	})
}
