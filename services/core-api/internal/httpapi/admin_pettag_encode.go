package httpapi

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
)

// defaultPetPageBaseURL is the fallback base for the /t/{shortId} pet-page URL burned to a chip. lumin.pet
// is RESERVED (D1, ADR-040) for a later edge-rewrite; until it exists, set PET_TAG_BASE_URL to the
// storefront origin so a chip carries a URL that actually serves today. Not a secret — a plain deploy
// config, so NewServer defaults it and unit tests need no wiring.
const defaultPetPageBaseURL = "https://lumin.pet"

// errNotNfcTag flags an encode attempt on a print job whose product is not a Pet Tag — a client/UI bug
// (only nfc_tag cards should offer encode). Caught in the handler and returned as a 400, never a 500.
var errNotNfcTag = errors.New("pet tag: print job product is not nfc_tag")

// EncodePrintJobTag handles POST /admin/print-jobs/{id}/encode (P3-t t-2): the "Ghi chip NFC" step for an
// nfc_tag print job in the NFC_ENCODE stage. TWO-PHASE on one endpoint (ADR-041): with NO chipUid it
// PREPARES — get-or-create the pet tag (mint code + short_id) and return the URL to burn, leaving the
// board stage untouched (the sheet-open call); with a chipUid it CONFIRMS — record the chip UID, flip the
// tag to ENCODED, and advance the print job to PACKING (the write-done call). Admin-gated (owner AND
// staff — fulfillment work, mirrors the print board). It moves ONLY the tag lifecycle + the print stage;
// it does NOT transition OrderStatus (spec §10: the tag lifecycle is separate — no statusHistory). A
// non-nfc_tag job → 400; an unknown job id → 404. The mint + encode + stage advance run in ONE tx so a
// fault rolls all of it back (retryable, no half-encode).
func (s *Server) EncodePrintJobTag(ctx context.Context, request api.EncodePrintJobTagRequestObject) (api.EncodePrintJobTagResponseObject, error) {
	badRequest := api.EncodePrintJobTag400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}

	// chipUid present ⇒ CONFIRM; absent ⇒ PREPARE. A present-but-blank chipUid is a malformed confirm.
	var chipUID string
	if request.Body != nil && request.Body.ChipUid != nil {
		chipUID = strings.TrimSpace(*request.Body.ChipUid)
		if chipUID == "" {
			return badRequest, nil
		}
	}
	confirm := chipUID != ""

	var result api.PrintTagEncodeResult
	err := withTx(ctx, s.pool, func(tx pgx.Tx) error {
		jobs := db.NewJobs(tx)
		tags := db.NewPetTags(tx)

		entry, err := jobs.PrintQueueEntry(ctx, request.Id)
		if err != nil {
			return err // ErrNotFound → 404
		}
		if entry.ProductType != sqlc.ProductTypeNfcTag {
			return errNotNfcTag // → 400 (nothing written yet — the guard is first)
		}

		tag, err := tags.GetOrCreateForOrderItem(ctx, entry.OrderItemID)
		if err != nil {
			return err
		}
		if confirm {
			if tag, err = tags.MarkEncoded(ctx, tag.ID, chipUID); err != nil {
				return err
			}
			// The chip is written → the tag is packable. Advance NFC_ENCODE → PACKING in the same tx so
			// the board reflects the encode as one staff step (no filament draw here — that fired at PRINTING).
			if _, err := jobs.AdvancePrintStage(ctx, request.Id, sqlc.PrintStagePACKING); err != nil {
				return err
			}
		}
		// Re-read the card so it carries the (possibly advanced) stage in the board's shape.
		row, err := jobs.PrintQueueEntry(ctx, request.Id)
		if err != nil {
			return err
		}
		card, err := printQueueEntryDTO(row)
		if err != nil {
			return err
		}
		result = api.PrintTagEncodeResult{Tag: s.petTagRef(tag), Card: card}
		return nil
	})
	if err != nil {
		if errors.Is(err, errNotNfcTag) {
			return badRequest, nil
		}
		return nil, err // ErrNotFound → 404; any other db fault → 500 (mapError, no leak)
	}
	// Push the (possibly advanced) card to every open board post-commit (P3-g SSE) — publish-on-commit
	// spirit, best-effort, never affects this response. A prepare call re-broadcasts the same card (idempotent).
	s.printHub.broadcast(result.Card)
	return api.EncodePrintJobTag200JSONResponse(result), nil
}

// petTagRef maps a stored tag to the wire ref the encode sheet needs: the display code, the routing
// short_id, the absolute URL to burn (composed from PET_TAG_BASE_URL), the lifecycle status, and the
// chip UID (nil until ENCODED).
func (s *Server) petTagRef(tag sqlc.PetTag) api.PetTagRef {
	return api.PetTagRef{
		Code:    tag.Code,
		ShortId: tag.ShortID,
		Url:     s.petPageURL(tag.ShortID),
		Status:  api.PetTagStatus(tag.Status),
		ChipUid: tag.ChipUid, // *string, omitempty until the chip is written
	}
}

// petPageURL composes the absolute /t/{shortId} pet-page URL from the configured base. TrimRight keeps a
// trailing slash on the base from doubling the separator.
func (s *Server) petPageURL(shortID string) string {
	return strings.TrimRight(s.petPageBaseURL, "/") + "/t/" + shortID
}
