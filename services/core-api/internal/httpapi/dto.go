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
// It reads the item lines and the customer for the given (already-committed) order row on the
// pool. Shared by the transition handler (3h) and, when it lands, the checkout handler (3g).
func (s *Server) assembleOrderDTO(ctx context.Context, row sqlc.Order) (api.Order, error) {
	items, err := db.NewOrders(s.pool).Items(ctx, row.ID)
	if err != nil {
		return api.Order{}, fmt.Errorf("assemble order %s: items: %w", row.ID, err)
	}
	cust, err := db.NewIdentity(s.pool).CustomerByID(ctx, row.CustomerID)
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
func toOrderDTO(row sqlc.Order, items []sqlc.OrderItem, cust sqlc.Customer) (api.Order, error) {
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

// orderItemsDTO maps each persisted line to its wire shape. option_ids is a jsonb array of uuid
// strings; a nil/empty column yields a non-nil empty slice so the JSON renders `[]`, not `null`.
func orderItemsDTO(items []sqlc.OrderItem) ([]api.OrderItem, error) {
	out := make([]api.OrderItem, len(items))
	for i, it := range items {
		optionIDs := []openapi_types.UUID{}
		if len(it.OptionIds) > 0 {
			if err := json.Unmarshal(it.OptionIds, &optionIDs); err != nil {
				return nil, fmt.Errorf("order item %s: option_ids: %w", it.ID, err)
			}
		}
		dto := api.OrderItem{
			ProductId: it.ProductID,
			OptionIds: optionIDs,
			Quantity:  int(it.Quantity),
			UnitPrice: it.UnitPrice,
		}
		if it.ColorID.Valid {
			c := uuid.UUID(it.ColorID.Bytes)
			dto.ColorId = &c
		}
		if it.Personalization != nil {
			dto.Personalization = &api.Personalization{
				Text:   it.Personalization.Text,
				ZoneId: it.Personalization.ZoneID,
			}
		}
		out[i] = dto
	}
	return out, nil
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
