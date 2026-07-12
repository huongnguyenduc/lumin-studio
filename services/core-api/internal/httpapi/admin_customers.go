package httpapi

import (
	"context"
	"encoding/json"

	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// admin_customers.go — the customers surface (P3-p, Khách hàng). Two reads: the roster with per-customer
// order aggregates, and one customer's full profile (contact + addresses + order history). Both are
// authRequired (classify default — owner AND staff): staff need customer contact to fulfil orders, but
// PDPL keeps the PII behind the admin gate (never public). Read-only this slice — merge-duplicate (the
// design's 12b) and the internal note (needs a column + write) are deferred. Money stays raw int-VND
// (always-must #2); the FE's @lumin/core formatVnd renders it.

// GetAdminCustomers handles GET /admin/customers (P3-p): every customer with their order roll-up (count,
// total spent, last order), most-recently-active first. Not paginated — a made-to-order shop's base is
// small; the FE searches the whole set in memory (mirrors the products list). The read is actor-
// independent (any admin sees the same roster). Money (totalSpent) stays raw int-VND (always-must #2).
func (s *Server) GetAdminCustomers(ctx context.Context, _ api.GetAdminCustomersRequestObject) (api.GetAdminCustomersResponseObject, error) {
	rows, err := db.NewIdentity(s.pool).ListAdminCustomers(ctx)
	if err != nil {
		return nil, err
	}
	return api.GetAdminCustomers200JSONResponse(adminCustomersDTO(rows)), nil
}

// GetAdminCustomer handles GET /admin/customers/{id} (P3-p): one customer's full profile — contact,
// saved addresses, summed lifetime spend, and order history (newest first). An unknown id is
// db.ErrNotFound → 404 (mapError, no leak). The two reads (the customer, then their orders) share ctx so
// a client disconnect / timeout cancels both.
func (s *Server) GetAdminCustomer(ctx context.Context, request api.GetAdminCustomerRequestObject) (api.GetAdminCustomerResponseObject, error) {
	cust, err := db.NewIdentity(s.pool).CustomerByID(ctx, request.Id)
	if err != nil {
		return nil, err // ErrNotFound → 404; any other db fault → 500 (mapError, no leak)
	}
	orders, err := db.NewOrders(s.pool).ByCustomer(ctx, request.Id)
	if err != nil {
		return nil, err
	}
	dto, err := adminCustomerDetailDTO(cust, orders)
	if err != nil {
		return nil, err // malformed stored addresses jsonb (never written by the seams) → 500 (logged)
	}
	return api.GetAdminCustomer200JSONResponse(dto), nil
}

// adminCustomersDTO maps the aggregate rows to the wire roster. Pure (no I/O) so the row→DTO slot wiring
// is pinned by a Docker-free unit test. A nil/empty result yields a non-nil empty slice so the JSON
// renders `[]`, not `null` (spec §03). Money (totalSpent) stays raw int-VND (always-must #2).
func adminCustomersDTO(rows []sqlc.ListAdminCustomersRow) []api.AdminCustomer {
	out := make([]api.AdminCustomer, len(rows))
	for i, r := range rows {
		c := api.AdminCustomer{
			Id:           r.ID,
			Name:         r.Name,
			Phone:        r.Phone,
			Email:        emailPtr(r.Email),
			SocialHandle: r.SocialHandle,
			OrderCount:   int(r.OrderCount),
			TotalSpent:   r.TotalSpent, // raw int-VND, never formatted server-side (always-must #2)
		}
		if r.LastOrderAt.Valid {
			t := r.LastOrderAt.Time
			c.LastOrderAt = &t
		}
		out[i] = c
	}
	return out
}

// adminCustomerDetailDTO assembles one customer's wire profile from the stored row + their orders. Pure
// (no I/O) for a Docker-free unit test. The stored addresses jsonb is decoded to the wire Address[] (may
// be empty); totalSpent is summed HERE (server-side, all statuses) so the FE never does money math; the
// orders are the compact history rows (code/total/status/date), already newest-first from ByCustomer.
func adminCustomerDetailDTO(c sqlc.Customer, orders []sqlc.Order) (api.AdminCustomerDetail, error) {
	addrs, err := decodeAddresses(c.Addresses)
	if err != nil {
		return api.AdminCustomerDetail{}, err
	}
	hist := make([]api.AdminCustomerOrder, len(orders))
	var totalSpent int64
	for i, o := range orders {
		hist[i] = api.AdminCustomerOrder{
			Id:        o.ID,
			Code:      o.Code,
			Status:    api.OrderStatus(o.Status),
			Total:     o.Total, // raw int-VND (always-must #2)
			CreatedAt: o.CreatedAt.Time,
		}
		totalSpent += o.Total // server-side sum → the FE never sums money itself (always-must #2)
	}
	return api.AdminCustomerDetail{
		Id:           c.ID,
		Name:         c.Name,
		Phone:        c.Phone,
		Email:        emailPtr(c.Email),
		SocialHandle: c.SocialHandle,
		CreatedAt:    c.CreatedAt.Time,
		TotalSpent:   totalSpent,
		Addresses:    addrs,
		Orders:       hist,
	}, nil
}

// decodeAddresses unmarshals the customer's stored addresses jsonb (order.Address[]) into the wire
// Address[]. A NULL/empty column yields a non-nil empty slice (JSON `[]`, not `null`, spec §03). The
// addresses are written only by the checkout seams, so a decode failure is a 500 (corrupt store), never
// client input.
func decodeAddresses(raw []byte) ([]api.Address, error) {
	if len(raw) == 0 {
		return []api.Address{}, nil
	}
	var stored []order.Address
	if err := json.Unmarshal(raw, &stored); err != nil {
		return nil, err
	}
	out := make([]api.Address, len(stored))
	for i, a := range stored {
		out[i] = addressDTO(a)
	}
	return out, nil
}

// emailPtr converts a stored optional email (*string) to the wire optional Email (*openapi_types.Email).
func emailPtr(s *string) *openapi_types.Email {
	if s == nil {
		return nil
	}
	e := openapi_types.Email(*s)
	return &e
}
