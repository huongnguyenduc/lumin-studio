package httpapi

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// internal_asset_jobs.go — the OUTPUT half of the asset pipeline (ADR-045). The in-cluster asset-worker
// drains `asset_job.created` off the JetStream WorkQueue, renders/ingests the source model, then calls
// PATCH /internal/asset-jobs/{id} here to report the result. This is the counterpart to admin_asset_jobs.go
// (the INPUT side: owner uploads a model → enqueues the job). Auth is the authService class (a static
// worker bearer, no user actor — middleware_auth.go); the handler owns the state guard + the product write.

// lastErrorMaxRunes caps the worker-supplied failure reason before it hits the (unbounded) text column.
// Truncate rune-safe (never split a multibyte rune → invalid UTF-8 rejected by Postgres) rather than 400 a
// failure report for length: a rejected callback would leave the job un-marked and stuck.
const lastErrorMaxRunes = 2000

// errAssetResultMissingModelURL rolls back the callback tx when a `ready` `model_ingest` arrives with no
// derivative glb — the whole point of an ingest is to produce one. It is caught after withTx and rendered
// as a 400 (a worker bug the worker can fix by re-reporting with the URL), never a 500 or a partial write.
var errAssetResultMissingModelURL = errors.New("httpapi: ready model_ingest missing model3dUrl")

// errAssetResultMissingSpriteURL is the sprite_render analogue (ADR-049): a `ready` `sprite_render` with no
// sprite sheet rolls back the tx and renders as a 400 (a worker bug it fixes by re-reporting with the URL).
var errAssetResultMissingSpriteURL = errors.New("httpapi: ready sprite_render missing spriteSheetUrl")

// ReportAssetJobResult handles PATCH /internal/asset-jobs/{id} (ADR-045, service-auth). It transitions one
// asset job to the worker-reported status and, for a `ready` `model_ingest`, writes the derivative glb onto
// the product — all in ONE row-locked tx. Idempotent + at-least-once safe: a `ready` job is terminal and
// sticky, so a redelivered callback returns it unchanged. Unknown job → 404.
func (s *Server) ReportAssetJobResult(ctx context.Context, req api.ReportAssetJobResultRequestObject) (api.ReportAssetJobResultResponseObject, error) {
	if req.Body == nil {
		return api.ReportAssetJobResult400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	status, model3dURL, spriteSheetURL, lastErr, fields, err := s.cleanAssetJobResult(*req.Body)
	if err != nil {
		return nil, err // an output URL present but no upload store to host-pin against → 500 (worker can't fix)
	}
	if len(fields) > 0 {
		return api.ReportAssetJobResult400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(fields))}, nil
	}
	// f-2: the object-name list a model_ingest found in the source model (best-effort metadata — sanitized,
	// never rejected). Written only on a ready model_ingest below; harmless to compute for other kinds.
	objectNames := sanitizeModelObjectNames(req.Body.ObjectNames)

	var row sqlc.AssetJob
	err = withTx(ctx, s.pool, func(tx pgx.Tx) error {
		jobs := db.NewJobs(tx)
		job, e := jobs.AssetJobByIDForUpdate(ctx, req.Id)
		if e != nil {
			return e // ErrNotFound → 404 (mapped centrally)
		}
		// `ready` is terminal + sticky: return the stored job unchanged so a redelivered callback never
		// regresses the status or clobbers the model3d_url already written (at-least-once idempotency).
		if job.Status == sqlc.AssetJobStatusReady {
			row = job
			return nil
		}
		// job_type is only known after the lock; a ready job with no output rolls back (→400): a model_ingest
		// must produce a glb, a sprite_render must produce a sprite sheet (ADR-049).
		if status == sqlc.AssetJobStatusReady && job.JobType == sqlc.AssetJobTypeModelIngest && model3dURL == "" {
			return errAssetResultMissingModelURL
		}
		if status == sqlc.AssetJobStatusReady && job.JobType == sqlc.AssetJobTypeSpriteRender && spriteSheetURL == "" {
			return errAssetResultMissingSpriteURL
		}

		completedAt := pgtype.Timestamptz{} // zero → COALESCE keeps the prior value (processing)
		if status == sqlc.AssetJobStatusReady || status == sqlc.AssetJobStatusFailed {
			completedAt = pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true}
		}
		updated, e := jobs.MarkAssetJob(ctx, sqlc.UpdateAssetJobStatusParams{
			ID:          req.Id,
			Status:      status,
			Attempts:    job.Attempts, // preserved — the callback reports lifecycle, not retry accounting
			LastError:   lastErr,      // set on failed; nil clears it on ready/processing
			CompletedAt: completedAt,
		})
		if e != nil {
			return e
		}
		row = updated

		// D3/ADR-049: a ready job publishes its derivative onto the product — the ONE writer of that column.
		// model_ingest → model3d_url (the viewer's .glb); sprite_render → sprite_sheet_url (the card hover +
		// no-WebGL fallback). Each pipeline writes only its own column.
		if status == sqlc.AssetJobStatusReady && job.JobType == sqlc.AssetJobTypeModelIngest {
			if e := db.NewCatalog(tx).SetProductModel3dURL(ctx, job.ProductID, model3dURL); e != nil {
				return e
			}
			// f-2: record the model's object-name list alongside the glb — same single-writer, same ready tx.
			// Empty (older worker / a nameless STL) is fine: it sets '{}' (no mapping options). Runs once (a
			// redelivered ready is a sticky no-op above), so it can't clobber a later hand-set list.
			if e := db.NewCatalog(tx).SetProductModelObjectNames(ctx, job.ProductID, objectNames); e != nil {
				return e
			}
		}
		if status == sqlc.AssetJobStatusReady && job.JobType == sqlc.AssetJobTypeSpriteRender {
			if e := db.NewCatalog(tx).SetProductSpriteSheetURL(ctx, job.ProductID, spriteSheetURL); e != nil {
				return e
			}
		}
		return nil
	})
	if errors.Is(err, errAssetResultMissingModelURL) {
		return api.ReportAssetJobResult400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(map[string]string{"model3dUrl": "required for a ready model_ingest job"}))}, nil
	}
	if errors.Is(err, errAssetResultMissingSpriteURL) {
		return api.ReportAssetJobResult400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(map[string]string{"spriteSheetUrl": "required for a ready sprite_render job"}))}, nil
	}
	if err != nil {
		return nil, err // ErrNotFound → 404, anything else → 500 (both mapped centrally)
	}
	return api.ReportAssetJobResult200JSONResponse(assetJobDTO(row)), nil
}

// cleanAssetJobResult validates the callback body at the HTTP boundary and returns the values to persist
// plus a per-field error map (empty ⇒ valid). status maps the worker-lifecycle enum to the stored enum.
// model3dUrl (model_ingest) and spriteSheetUrl (sprite_render), when present, MUST be host-pinned URLs of
// the right extension under this store's assets origin — each becomes a client-side src (<model-viewer> /
// <img>), so a foreign URL is stored content injection. The non-nil error is reserved for the un-fixable
// case (an output URL arrived but no upload store is wired to host-pin it → 500).
func (s *Server) cleanAssetJobResult(in api.AssetJobResultInput) (sqlc.AssetJobStatus, string, string, *string, map[string]string, error) {
	fields := map[string]string{}

	var status sqlc.AssetJobStatus
	switch in.Status {
	case api.AssetJobResultInputStatusProcessing:
		status = sqlc.AssetJobStatusProcessing
	case api.AssetJobResultInputStatusReady:
		status = sqlc.AssetJobStatusReady
	case api.AssetJobResultInputStatusFailed:
		status = sqlc.AssetJobStatusFailed
	default:
		fields["status"] = "invalid status"
	}

	model3dURL, err := s.cleanOutputURL(in.Model3dUrl, ".glb", "model3dUrl", fields)
	if err != nil {
		return status, "", "", nil, fields, err
	}
	spriteSheetURL, err := s.cleanOutputURL(in.SpriteSheetUrl, ".webp", "spriteSheetUrl", fields)
	if err != nil {
		return status, "", "", nil, fields, err
	}

	var lastErr *string
	if in.LastError != nil {
		le := strings.TrimSpace(*in.LastError)
		if utf8.RuneCountInString(le) > lastErrorMaxRunes {
			le = string([]rune(le)[:lastErrorMaxRunes])
		}
		if le != "" {
			lastErr = &le
		}
	}

	return status, model3dURL, spriteSheetURL, lastErr, fields, nil
}

// cleanOutputURL validates one optional worker-output URL (model3dUrl / spriteSheetUrl). Absent or empty →
// "" (the tx's job-type guard decides whether it was required). Present → it MUST end in wantExt AND be
// host-pinned under this store's assets origin (OwnsOutputURL), else a field error under fieldName. A
// present URL with no upload store to host-pin against is the un-fixable 500 (errModelUploadNotConfigured),
// never a field error — the worker can't fix a mis-provisioned server.
func (s *Server) cleanOutputURL(raw *string, wantExt, fieldName string, fields map[string]string) (string, error) {
	if raw == nil {
		return "", nil
	}
	out := strings.TrimSpace(*raw)
	if out == "" {
		return "", nil
	}
	if s.modelUploads == nil {
		return "", errModelUploadNotConfigured
	}
	if !strings.HasSuffix(strings.ToLower(out), wantExt) || !s.modelUploads.OwnsOutputURL(out) {
		fields[fieldName] = "must be a " + wantExt + " URL under this store's assets origin"
	}
	return out, nil
}

// maxModelObjectNames caps how many object names one model_ingest callback records on a product (f-2) — a
// bound on the editor's mapping dropdown + the column. A real lamp has a handful of parts; 500 is slack.
const maxModelObjectNames = 500

// sanitizeModelObjectNames trims + drops-empty + caps the worker-reported object-name list (f-2) before it
// lands in products.model_object_names. Best-effort metadata (never a 400): the worker is service-authed, so
// an over-long name is truncated (rune-safe, like lastError) and an oversized list is clamped rather than
// rejected — a rejected callback would leave the job un-marked and stuck. Order is preserved (the worker
// sorts; the editor shows them as-is). nil / all-empty → a non-nil empty slice (sets '{}').
func sanitizeModelObjectNames(in *[]string) []string {
	out := []string{}
	if in == nil {
		return out
	}
	for _, n := range *in {
		n = strings.TrimSpace(n)
		if n == "" {
			continue
		}
		if utf8.RuneCountInString(n) > maxPartNameChars {
			n = string([]rune(n)[:maxPartNameChars])
		}
		out = append(out, n)
		if len(out) >= maxModelObjectNames {
			break
		}
	}
	return out
}
