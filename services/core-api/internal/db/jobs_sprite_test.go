package db

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// A sprite_render job FREEZES its per-part colours into the asset_job.created payload (f-5, oracle D-E), so a
// redelivered or re-run job paints the SAME colours it was created with (idempotency). A model_ingest job
// carries none — omitempty drops the key so the wire bytes stay byte-identical to pre-f-5. Real-PG because
// the assertion is on the committed outbox row (publish-on-commit, ADR-006).
func TestCreateAssetJobFreezesPartColors(t *testing.T) {
	pool := startPostgres(t)
	ctx := context.Background()
	prod := seedProduct(t, ctx, NewCatalog(pool), "den-sprite", 200000)

	readPayload := func(t *testing.T, jobID uuid.UUID) ([]byte, assetJobCreatedPayload) {
		t.Helper()
		var raw []byte
		if err := pool.QueryRow(ctx, `SELECT payload FROM outbox WHERE aggregate_id=$1 AND event_type='asset_job.created'`, jobID).Scan(&raw); err != nil {
			t.Fatalf("read payload: %v", err)
		}
		var p assetJobCreatedPayload
		if err := json.Unmarshal(raw, &p); err != nil {
			t.Fatalf("unmarshal payload: %v", err)
		}
		return raw, p
	}

	// sprite_render WITH colours → the payload round-trips the {objectName → hex} map (diacritics intact).
	spriteID := uuid.New()
	tx := mustBegin(t, ctx, pool)
	if _, err := CreateAssetJobTx(ctx, tx, CreateAssetJobInput{
		ID: spriteID, ProductID: prod.ID, JobType: sqlc.AssetJobTypeSpriteRender,
		SourceModelURL: "https://garage.lumin.vn/models/den.glb", SourceVersion: "sha256-sprite",
		PartColors: map[string]string{"Chao đèn": "#E8B923", "Đế": "#3A3A3A"},
	}); err != nil {
		t.Fatalf("create sprite job: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}
	raw, p := readPayload(t, spriteID)
	if len(p.PartColors) != 2 || p.PartColors["Chao đèn"] != "#E8B923" || p.PartColors["Đế"] != "#3A3A3A" {
		t.Fatalf("sprite payload partColors = %v (raw %s)", p.PartColors, raw)
	}

	// model_ingest (no colours) → omitempty drops the key entirely: the wire stays byte-identical to pre-f-5.
	ingestID := uuid.New()
	tx2 := mustBegin(t, ctx, pool)
	if _, err := CreateAssetJobTx(ctx, tx2, CreateAssetJobInput{
		ID: ingestID, ProductID: prod.ID, JobType: sqlc.AssetJobTypeModelIngest,
		SourceModelURL: "https://garage.lumin.vn/models/den.glb", SourceVersion: "sha256-ingest",
	}); err != nil {
		t.Fatalf("create ingest job: %v", err)
	}
	if err := tx2.Commit(ctx); err != nil {
		t.Fatalf("commit: %v", err)
	}
	raw2, p2 := readPayload(t, ingestID)
	if len(p2.PartColors) != 0 {
		t.Fatalf("ingest payload has partColors: %v", p2.PartColors)
	}
	if strings.Contains(string(raw2), "partColors") {
		t.Fatalf("ingest payload JSON must omit partColors: %s", raw2)
	}
}
