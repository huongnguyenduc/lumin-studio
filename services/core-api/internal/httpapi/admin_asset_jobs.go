package httpapi

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/modelstore"
)

// admin_asset_jobs.go — the model-upload + asset-job surface behind the product editor (P3-j-b,
// ADR-036). The editor uploads a source model straight to Garage via a presigned POST, then enqueues a
// render/ingest job that points at the uploaded object. Model upload + asset-job WRITE are owner-only
// (spec §08 — catalog is an owner power; classify→authOwnerOnly AND re-asserted here with assertOwner);
// the asset-job LIST is admin-gated (owner+staff read, mirroring the product reads). This PR builds the
// INPUT side only — the slice-3 worker writes the rendered OUTPUTS onto the product (D3), so nothing
// here touches products.model3d_url.

// errModelUploadNotConfigured is returned when a model endpoint is hit but no catalog-asset bucket
// credentials were wired (nil store). It maps to a generic 500 — the client cannot fix it and no
// signable/host-pinnable contract exists — rather than leaking config state or signing a partial form.
var errModelUploadNotConfigured = errors.New("httpapi: model uploads not configured")

// sourceVersionRe accepts a content-hash-shaped source version (hex, 8..128 chars — SHA-1 is 40, SHA-256
// is 64). The editor hashes the uploaded object client-side; the server cannot re-hash without
// downloading it, so this is a shape guard (not a bytes-match), capping length and rejecting junk before
// it reaches the outbox payload and DB.
var sourceVersionRe = regexp.MustCompile(`^[0-9a-fA-F]{8,128}$`)

// hexColorRe matches a #RRGGBB colour — the shape colors.hex carries (copied from a filament at write, f-1).
// The sprite_render payload's per-part colours are re-validated against it at the render trust boundary
// (D-E): a value that isn't a clean hex rejects the enqueue instead of reaching Blender as a poison colour.
var hexColorRe = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// CreateProductModelUpload handles POST /admin/products/{id}/model-upload (owner-only, P3-j-b). It
// returns a short-lived presigned POST form for one source model (.glb/.stl/.3mf) plus the host-pinned
// finalUrl the editor later sends as sourceModelUrl to POST .../asset-jobs. The model goes browser→Garage;
// core-api only signs the policy, so the Cloudflare tunnel never proxies the (up to 100MB) model body.
func (s *Server) CreateProductModelUpload(ctx context.Context, req api.CreateProductModelUploadRequestObject) (api.CreateProductModelUploadResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	if s.modelUploads == nil {
		return nil, errModelUploadNotConfigured
	}
	if req.Body == nil {
		return api.CreateProductModelUpload400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	if err := s.requireProduct(ctx, req.Id); err != nil {
		return nil, err // db.ErrNotFound → 404
	}
	up, err := s.modelUploads.PresignPost(ctx, string(req.Body.ContentType))
	if errors.Is(err, modelstore.ErrInvalidContentType) {
		return api.CreateProductModelUpload400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	if err != nil {
		return nil, err
	}
	return api.CreateProductModelUpload200JSONResponse(api.ModelUpload{
		UploadUrl: up.UploadURL,
		Fields:    up.Fields,
		FinalUrl:  up.FinalURL,
		ExpiresAt: up.ExpiresAt,
		MaxBytes:  up.MaxBytes,
	}), nil
}

// GetProductAssetJobs handles GET /admin/products/{id}/asset-jobs (admin-gated read; owner+staff). It
// returns every render/ingest job for the product, newest first, so the editor can show render status.
// Unknown product id → 404 (an existing product with no jobs returns an empty list).
func (s *Server) GetProductAssetJobs(ctx context.Context, req api.GetProductAssetJobsRequestObject) (api.GetProductAssetJobsResponseObject, error) {
	if err := s.requireProduct(ctx, req.Id); err != nil {
		return nil, err // db.ErrNotFound → 404
	}
	jobs, err := db.NewJobs(s.pool).AssetJobsByProduct(ctx, req.Id)
	if err != nil {
		return nil, err
	}
	out := make([]api.AssetJob, len(jobs))
	for i, j := range jobs {
		out[i] = assetJobDTO(j)
	}
	return api.GetProductAssetJobs200JSONResponse(out), nil
}

// CreateProductAssetJob handles POST /admin/products/{id}/asset-jobs (owner-only, P3-j-b). It enqueues one
// render/ingest job for a model already uploaded via .../model-upload. The sourceModelUrl is host-pinned
// (must be a URL this server minted) so a foreign or spoofed source can never be enqueued; the job row +
// its asset_job.created outbox event commit atomically (publish-on-commit, ADR-006). Unknown product → 404.
func (s *Server) CreateProductAssetJob(ctx context.Context, req api.CreateProductAssetJobRequestObject) (api.CreateProductAssetJobResponseObject, error) {
	if err := assertOwner(ctx); err != nil {
		return nil, err
	}
	if s.modelUploads == nil {
		return nil, errModelUploadNotConfigured // no store ⇒ cannot host-pin the sourceModelUrl
	}
	if req.Body == nil {
		return api.CreateProductAssetJob400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
	}
	jobType, src, ver, fields := s.cleanAssetJobInput(*req.Body)
	if len(fields) > 0 {
		return api.CreateProductAssetJob400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(fieldEnvelope(fields))}, nil
	}

	// f-5: a sprite_render job FREEZES each named part's default filament colour into the payload (D-E), so the
	// render paints each part in its colour. Built from the product's CURRENT parts+colours at enqueue — the
	// owner re-renders after mapping/recolouring to refresh the sprite. model_ingest carries no colours. Reads
	// before the tx; an unknown product yields empty slices here and still 404s on the insert's FK check below.
	var partColors map[string]string
	var cameraTheta *float64
	if jobType == sqlc.AssetJobTypeSpriteRender {
		cat := db.NewCatalog(s.pool)
		parts, e := cat.PartsByProduct(ctx, req.Id)
		if e != nil {
			return nil, e
		}
		colors, e := cat.ColorsByProduct(ctx, req.Id)
		if e != nil {
			return nil, e
		}
		pc, e := spritePartColors(parts, colors)
		if e != nil {
			// A malformed hex crossing into the render payload → reject the enqueue rather than ship a grey
			// part (D-E). A backstop: colours already carry a validated #RRGGBB from the filament (f-1).
			return api.CreateProductAssetJob400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}, nil
		}
		partColors = pc

		// ADR-038 follow-up: the sprite's frame-0 azimuth mirrors the owner-saved live-viewer angle, so the
		// hover/no-WebGL turntable opens facing the same way. Product already read above for parts/colors —
		// reuse that read for model3d_view instead of a second round-trip.
		p, e := cat.ProductByID(ctx, req.Id)
		if e != nil {
			return nil, e
		}
		view, e := model3dViewFromJSON(p.Model3dView)
		if e != nil {
			return nil, fmt.Errorf("asset job: decode model3d_view for sprite render: %w", e)
		}
		if view != nil {
			cameraTheta = &view.OrbitTheta
		}
	}

	var row sqlc.AssetJob
	err := withTx(ctx, s.pool, func(tx pgx.Tx) error {
		created, e := db.CreateAssetJobTx(ctx, tx, db.CreateAssetJobInput{
			ID:             uuid.New(),
			ProductID:      req.Id,
			JobType:        jobType,
			SourceModelURL: src,
			SourceVersion:  ver,
			PartColors:     partColors,
			CameraTheta:    cameraTheta,
		})
		row = created
		return e
	})
	if pgCode(err) == pgForeignKeyViolation {
		return nil, db.ErrNotFound // unknown product (asset_jobs.product_id FK) → 404
	}
	if err != nil {
		return nil, err
	}
	return api.CreateProductAssetJob201JSONResponse(assetJobDTO(row)), nil
}

// requireProduct returns db.ErrNotFound (→404) when no product with id exists. Used by the model
// endpoints whose 404 cannot come from an insert's FK check (a signed upload / a list read).
func (s *Server) requireProduct(ctx context.Context, id uuid.UUID) error {
	_, err := db.NewCatalog(s.pool).ProductByID(ctx, id)
	return err // db.ErrNotFound on unknown id, mapped to 404 by handleResponseError
}

// cleanAssetJobInput validates the enqueue body at the HTTP boundary and returns the values to persist
// plus a per-field error map (empty ⇒ valid). jobType must be a known enum; sourceModelUrl must be a
// host-pinned URL this server minted (modelUploads is non-nil — the caller 500s otherwise); sourceVersion
// must be content-hash-shaped. Validating here yields a 400 field error rather than a doomed insert.
func (s *Server) cleanAssetJobInput(in api.AssetJobInput) (sqlc.AssetJobType, string, string, map[string]string) {
	fields := map[string]string{}

	jobType := sqlc.AssetJobType(in.JobType)
	switch jobType {
	case sqlc.AssetJobTypeModelIngest, sqlc.AssetJobTypeSpriteRender:
	default:
		fields["jobType"] = "invalid job type"
	}

	src := strings.TrimSpace(in.SourceModelUrl)
	if !s.modelUploads.OwnsURL(src) {
		fields["sourceModelUrl"] = "must be an uploaded model URL from this store"
	}

	ver := strings.TrimSpace(in.SourceVersion)
	if !sourceVersionRe.MatchString(ver) {
		fields["sourceVersion"] = "must be a content hash (hex)"
	}

	return jobType, src, ver, fields
}

// spritePartColors builds the {objectName → hex} snapshot a sprite_render job paints its parts with (f-5,
// oracle D-C/D-E). For each part mapped to a model object, the DEFAULT colour is the first AVAILABLE colour
// of that part in catalog order — ColorsByProduct returns colours by name (colours have no display_order),
// the same order the editor/storefront list them, so "first available" is a stable, predictable default.
// The hex is re-validated (#RRGGBB) here at the render trust boundary; a malformed one fails the WHOLE
// enqueue (a poison job, never a grey part — D-E). A part with no object name or no available colour is
// omitted: it renders in the model's own baked material, never grey.
func spritePartColors(parts []sqlc.Part, colors []sqlc.Color) (map[string]string, error) {
	m := map[string]string{}
	for _, p := range parts {
		obj := strings.TrimSpace(p.ModelObjectName)
		if obj == "" {
			continue
		}
		for _, c := range colors {
			if !c.Available || !c.PartID.Valid || uuid.UUID(c.PartID.Bytes) != p.ID {
				continue
			}
			if !hexColorRe.MatchString(c.Hex) {
				return nil, fmt.Errorf("part %s default colour hex %q is not #RRGGBB", p.ID, c.Hex)
			}
			m[obj] = c.Hex
			break // first available in catalog order = the default (D-C)
		}
	}
	return m, nil
}

// assetJobDTO maps a stored asset_jobs row to the wire shape. attempts/lastError/completedAt reflect the
// slice-3 worker's lifecycle writes; a freshly queued job carries 0/nil/nil.
func assetJobDTO(j sqlc.AssetJob) api.AssetJob {
	dto := api.AssetJob{
		Id:             j.ID,
		ProductId:      j.ProductID,
		JobType:        api.AssetJobType(j.JobType),
		Status:         api.AssetJobStatus(j.Status),
		SourceModelUrl: j.SourceModelUrl,
		SourceVersion:  j.SourceVersion,
		Attempts:       int(j.Attempts),
		LastError:      j.LastError,
		CreatedAt:      j.CreatedAt.Time,
	}
	if j.CompletedAt.Valid {
		t := j.CompletedAt.Time
		dto.CompletedAt = &t
	}
	return dto
}
