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

// ReportAssetJobResult handles PATCH /internal/asset-jobs/{id} (ADR-045, service-auth). It transitions one
// asset job to the worker-reported status and, for a `ready` `model_ingest`, writes the derivative glb onto
// the product — all in ONE row-locked tx. Idempotent + at-least-once safe: a `ready` job is terminal and
// sticky, so a redelivered callback returns it unchanged. Unknown job → 404.
func (s *Server) ReportAssetJobResult(ctx context.Context, req api.ReportAssetJobResultRequestObject) (api.ReportAssetJobResultResponseObject, error) {
	if req.Body == nil {
		return api.ReportAssetJobResult400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	status, model3dURL, lastErr, fields, err := s.cleanAssetJobResult(*req.Body)
	if err != nil {
		return nil, err // model3dUrl present but no upload store to host-pin against → 500 (worker can't fix)
	}
	if len(fields) > 0 {
		return api.ReportAssetJobResult400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(fields))}, nil
	}

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
		// job_type is only known after the lock; a ready model_ingest with no glb rolls back (→400).
		if status == sqlc.AssetJobStatusReady && job.JobType == sqlc.AssetJobTypeModelIngest && model3dURL == "" {
			return errAssetResultMissingModelURL
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

		// D3: a ready model_ingest publishes its LOD glb onto the product (the storefront viewer's
		// model3d_url) — the ONE writer of that column. sprite_render's output has no product column yet.
		if status == sqlc.AssetJobStatusReady && job.JobType == sqlc.AssetJobTypeModelIngest {
			if e := db.NewCatalog(tx).SetProductModel3dURL(ctx, job.ProductID, model3dURL); e != nil {
				return e
			}
		}
		return nil
	})
	if errors.Is(err, errAssetResultMissingModelURL) {
		return api.ReportAssetJobResult400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(map[string]string{"model3dUrl": "required for a ready model_ingest job"}))}, nil
	}
	if err != nil {
		return nil, err // ErrNotFound → 404, anything else → 500 (both mapped centrally)
	}
	return api.ReportAssetJobResult200JSONResponse(assetJobDTO(row)), nil
}

// cleanAssetJobResult validates the callback body at the HTTP boundary and returns the values to persist
// plus a per-field error map (empty ⇒ valid). status maps the worker-lifecycle enum to the stored enum.
// model3dUrl, when present, MUST be a .glb under this store's assets origin (host-pinned — it becomes a
// client-side <model-viewer src>, so a foreign URL is stored content injection). The non-nil error is
// reserved for the un-fixable case (a model3dUrl arrived but no upload store is wired to host-pin it → 500).
func (s *Server) cleanAssetJobResult(in api.AssetJobResultInput) (sqlc.AssetJobStatus, string, *string, map[string]string, error) {
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

	var model3dURL string
	if in.Model3dUrl != nil {
		model3dURL = strings.TrimSpace(*in.Model3dUrl)
	}
	if model3dURL != "" {
		if s.modelUploads == nil {
			return status, "", nil, fields, errModelUploadNotConfigured // can't host-pin → 500
		}
		if !strings.HasSuffix(strings.ToLower(model3dURL), ".glb") || !s.modelUploads.OwnsOutputURL(model3dURL) {
			fields["model3dUrl"] = "must be a .glb URL under this store's assets origin"
		}
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

	return status, model3dURL, lastErr, fields, nil
}
