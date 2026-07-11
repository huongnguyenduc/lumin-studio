package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// assembleOrderDTO builds the nested wire Order (customer + items + statusHistory inline) that
// every order-returning endpoint responds with — never the flat sqlc row (locked decision #7).
// It reads the item lines and the customer for the given order row via the passed querier `q`:
// a *pgxpool.Pool for a post-commit read (the transition handler, 3h), or the write tx itself so
// the reads join the same atomic unit (the checkout handler, 3g, passes its tx — a failed
// assembly then rolls the order back instead of committing one the client is told failed).
func assembleOrderDTO(ctx context.Context, q sqlc.DBTX, row sqlc.Order) (api.Order, error) {
	items, err := db.NewOrders(q).Items(ctx, row.ID)
	if err != nil {
		return api.Order{}, fmt.Errorf("assemble order %s: items: %w", row.ID, err)
	}
	cust, err := db.NewIdentity(q).CustomerByID(ctx, row.CustomerID)
	if err != nil {
		return api.Order{}, fmt.Errorf("assemble order %s: customer: %w", row.ID, err)
	}
	return toOrderDTO(row, items, cust)
}

// toOrderDTO is the pure mapping from the persisted spine (order row + items + customer) to the
// contract Order DTO — split out from the I/O so it is unit-testable without a database. Money
// stays raw int VND (no server formatting, always-must #2); the domain's ISO-8601 statusHistory
// timestamps are parsed to time.Time for the typed contract. A malformed stored `at` (never
// written by the seams, which validate via order.Transition) surfaces as an error, not a panic.
func toOrderDTO(row sqlc.Order, items []sqlc.ListOrderItemsRow, cust sqlc.Customer) (api.Order, error) {
	history, err := statusHistoryDTO(row.StatusHistory)
	if err != nil {
		return api.Order{}, err
	}
	itemDTOs, err := orderItemsDTO(items)
	if err != nil {
		return api.Order{}, err
	}

	dto := api.Order{
		Id:              row.ID,
		Code:            row.Code,
		Channel:         api.Channel(row.Channel),
		Status:          api.OrderStatus(row.Status),
		Customer:        customerDTO(cust),
		Items:           itemDTOs,
		ShippingAddress: addressDTO(row.ShippingAddress),
		Subtotal:        row.Subtotal,
		ShippingFee:     row.ShippingFee,
		Total:           row.Total,
		StatusHistory:   history,
		CreatedAt:       row.CreatedAt.Time,
		Note:            row.Note,
		PaymentProofUrl: row.PaymentProofUrl,
		RefundProofUrl:  row.RefundProofUrl,
		TrackingCode:    row.TrackingCode,
		QcPhotoUrl:      row.QcPhotoUrl,
	}
	if row.PaymentConfirmedAt.Valid {
		t := row.PaymentConfirmedAt.Time
		dto.PaymentConfirmedAt = &t
	}
	return dto, nil
}

// customerDTO maps the stored customer to its wire shape (no addresses/consent — an order shows
// only the shipping identity). The stored *string email becomes the contract's *Email.
func customerDTO(c sqlc.Customer) api.Customer {
	dto := api.Customer{Name: c.Name, Phone: c.Phone, SocialHandle: c.SocialHandle}
	if c.Email != nil {
		e := openapi_types.Email(*c.Email)
		dto.Email = &e
	}
	return dto
}

// addressDTO maps the stored order.Address to the wire Address (no district level, ADR-017).
func addressDTO(a order.Address) api.Address {
	return api.Address{Province: a.Province, Ward: a.Ward, Street: a.Street}
}

// orderItemsDTO maps each persisted line to its wire shape, carrying the joined product/color/option
// names (P3-e admin detail) so the client shows what to make, not raw ids. option_ids is a jsonb
// array of uuid strings; a nil/empty column yields a non-nil empty slice so the JSON renders `[]`,
// not `null`. productName is always present (NOT NULL join); colorName/optionLabels omit when absent.
func orderItemsDTO(items []sqlc.ListOrderItemsRow) ([]api.OrderItem, error) {
	out := make([]api.OrderItem, len(items))
	for i, it := range items {
		optionIDs := []openapi_types.UUID{}
		if len(it.OptionIds) > 0 {
			if err := json.Unmarshal(it.OptionIds, &optionIDs); err != nil {
				return nil, fmt.Errorf("order item %s: option_ids: %w", it.ID, err)
			}
		}
		name := it.ProductName
		dto := api.OrderItem{
			ProductId:   it.ProductID,
			ProductName: &name,
			OptionIds:   optionIDs,
			Quantity:    int(it.Quantity),
			UnitPrice:   it.UnitPrice,
			ColorName:   it.ColorName,
		}
		if it.ColorID.Valid {
			c := uuid.UUID(it.ColorID.Bytes)
			dto.ColorId = &c
		}
		if len(it.OptionLabels) > 0 {
			labels := it.OptionLabels
			dto.OptionLabels = &labels
		}
		// ADR-037 snapshots (part_colors / option_choices jsonb, denormalized WITH names at capture). Each
		// yields the wire id-pairs that reconstruct the selection AND the display labels ("Chao: Đỏ") the
		// admin detail renders straight — the names are frozen on the line, so no live catalog join. All
		// omit-when-empty, so a flat/legacy line's DTO stays byte-identical to the pre-configurator shape.
		pcSnap, err := partColorSnapshots(it.PartColors)
		if err != nil {
			return nil, fmt.Errorf("order item %s: part_colors: %w", it.ID, err)
		}
		if len(pcSnap) > 0 {
			ids := make([]api.PartColorSelection, len(pcSnap))
			labels := make([]string, len(pcSnap))
			for j, s := range pcSnap {
				ids[j] = api.PartColorSelection{PartId: s.PartID, ColorId: s.ColorID}
				labels[j] = partColorLabel(s)
			}
			dto.PartColors = &ids
			dto.PartColorLabels = &labels
		}
		ocSnap, err := optionChoiceSnapshots(it.OptionChoices)
		if err != nil {
			return nil, fmt.Errorf("order item %s: option_choices: %w", it.ID, err)
		}
		if len(ocSnap) > 0 {
			ids := make([]api.OptionChoiceSelection, len(ocSnap))
			labels := make([]string, len(ocSnap))
			for j, s := range ocSnap {
				ids[j] = api.OptionChoiceSelection{OptionId: s.OptionID, ChoiceId: s.ChoiceID}
				labels[j] = optionChoiceLabel(s)
			}
			dto.OptionChoices = &ids
			dto.OptionChoiceLabels = &labels
		}
		if it.Personalization != nil {
			dto.Personalization = &api.Personalization{
				Text:   it.Personalization.Text,
				ZoneId: it.Personalization.ZoneID,
			}
		}
		cs, err := costSnapshotDTO(it.CostSnapshot)
		if err != nil {
			return nil, fmt.Errorf("order item %s: cost_snapshot: %w", it.ID, err)
		}
		dto.CostSnapshot = cs // ADR-039 4c-2: frozen COGS; nil for an uncosted line (omit-when-empty)
		out[i] = dto
	}
	return out, nil
}

// costSnapshotDTO parses the order_items.cost_snapshot jsonb (ADR-039 4c-2) into the wire COGS snapshot, or
// nil when the column is NULL — a line not yet costed (unprinted, old order, or a best-effort rollup that
// failed). A margin read must treat nil as "chưa chốt", NOT ₫0 COGS (which would inflate margin). The stored
// keys are db.CostSnapshot's json tags, identical to api.CostSnapshot's, so a straight unmarshal maps them
// (the round-trip is pinned by the compute + DTO tests). A malformed blob (never written by the rollup) → 500.
func costSnapshotDTO(raw []byte) (*api.CostSnapshot, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var out api.CostSnapshot
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// partColorSnapshots unmarshals the order_items.part_colors jsonb into the DENORMALIZED snapshot slice
// (ADR-037: ids + the part/colour names frozen at capture). A nil/empty column yields a nil slice. Shared
// by the order-detail DTO (which derives both the wire id-pairs and the labels) and the print-queue card
// (labels only) — both read the frozen names, never a live catalog join.
func partColorSnapshots(raw []byte) ([]order.PartColorSnapshot, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var snap []order.PartColorSnapshot
	if err := json.Unmarshal(raw, &snap); err != nil {
		return nil, err
	}
	return snap, nil
}

// optionChoiceSnapshots unmarshals the order_items.option_choices jsonb into the denormalized snapshot
// slice (ADR-037: ids + option/choice labels frozen at capture). Nil/empty column → nil slice.
func optionChoiceSnapshots(raw []byte) ([]order.OptionChoiceSnapshot, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var snap []order.OptionChoiceSnapshot
	if err := json.Unmarshal(raw, &snap); err != nil {
		return nil, err
	}
	return snap, nil
}

// partColorLabel formats one part-colour snapshot as the display string "PartName: ColorName" (e.g.
// "Chao: Đỏ") — the storefront cart uses the same shape, so the admin detail, the print card and the cart
// read alike. Extends the P3-e single colorName / optionLabels display per named part.
func partColorLabel(s order.PartColorSnapshot) string {
	return s.PartName + ": " + s.ColorName
}

// optionChoiceLabel formats one picked-choice snapshot as "OptionLabel: ChoiceLabel" (e.g. "Kích thước: Lớn").
func optionChoiceLabel(s order.OptionChoiceSnapshot) string {
	return s.OptionLabel + ": " + s.ChoiceLabel
}

// statusHistoryDTO maps the appended statusHistory chain to the wire shape, parsing each event's
// ISO-8601 UTC `at` string to the contract's time.Time. Optional reason/refundProofUrl carry only
// when set (they are populated only for CANCELLED/REFUNDED).
func statusHistoryDTO(history []order.StatusEvent) ([]api.StatusEvent, error) {
	out := make([]api.StatusEvent, len(history))
	for i, ev := range history {
		at, err := time.Parse(time.RFC3339Nano, ev.At)
		if err != nil {
			return nil, fmt.Errorf("status event %d: parse at %q: %w", i, ev.At, err)
		}
		dto := api.StatusEvent{To: api.OrderStatus(ev.To), At: at, ByUser: ev.ByUser}
		if ev.From != nil {
			f := api.OrderStatus(*ev.From)
			dto.From = &f
		}
		if ev.Reason != "" {
			r := ev.Reason
			dto.Reason = &r
		}
		if ev.RefundProofURL != "" {
			p := ev.RefundProofURL
			dto.RefundProofUrl = &p
		}
		out[i] = dto
	}
	return out, nil
}
