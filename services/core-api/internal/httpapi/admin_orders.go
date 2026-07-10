package httpapi

import (
	"context"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/api"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// Admin orders list paging bounds (P3-b). oapi-codegen binds the query params' Go types but does NOT
// enforce their schema minimum/maximum, so these are the RUNTIME gate (same stance as the catalog list's
// pageParams). The endpoint is authenticated (owner/staff) and low-traffic (one shop), so the cap is
// generous-but-bounded; maxAdminOffset bounds the OFFSET so a huge page number can never overflow the
// int32 OFFSET into a negative SQL value — a page beyond it is an empty page, not an error.
const (
	adminOrdersDefaultPageSize = 20
	adminOrdersMaxPageSize     = 50
	maxAdminOrdersOffset       = 100_000
)

// GetAdminOrders handles GET /admin/orders (P3-b): the admin orders table read. It is authRequired
// (classify default — owner AND staff view), so the auth middleware guarantees a resolved actor in
// context; the read itself is actor-independent (the orders list is not per-user). It returns one page of
// order summaries — the INTERNAL projection carrying the customer name, channel and total that the public
// PublicOrderTimeline whitelist omits (ADR-032) — newest first, optionally filtered to a single status.
// Money (total) stays raw int-VND (always-must #2); status/channel cross the wire as enums for the client
// to map to i18n labels (always-must #3). r.Context() propagates into both reads so a client disconnect /
// timeout cancels them.
func (s *Server) GetAdminOrders(ctx context.Context, request api.GetAdminOrdersRequestObject) (api.GetAdminOrdersResponseObject, error) {
	badRequest := api.GetAdminOrders400JSONResponse{BadRequestJSONResponse: api.BadRequestJSONResponse(envelope(codeValidation))}

	page, pageSize, ok := adminOrdersPageParams(request.Params.Page, request.Params.PageSize)
	if !ok {
		// page < 1, pageSize < 1, or pageSize > max — a request-shape violation (400), enforced here
		// because oapi-codegen does not honor the schema minimum/maximum. Bounds the LIMIT before any read.
		return badRequest, nil
	}
	status, ok := adminOrdersStatusFilter(request.Params.Status)
	if !ok {
		// A status value outside the OrderStatus enum. Reject with 400 rather than pass it to the query
		// (the `::order_status` cast would then fail as a 500) or silently drop the filter (which would
		// list every order — a surprising, wrong result for a caller that asked to narrow).
		return badRequest, nil
	}

	// Clamp the OFFSET before the multiply can overflow (mirrors the catalog list): a page far beyond any
	// real order history is an empty page, so cap the offset rather than let (page-1)*pageSize wrap
	// negative into the SQL OFFSET. The comparison avoids the multiply.
	offset := maxAdminOrdersOffset
	if page-1 <= maxAdminOrdersOffset/pageSize {
		offset = (page - 1) * pageSize
	}

	rows, total, err := db.NewOrders(s.pool).AdminList(ctx, db.AdminOrderFilter{
		Status: status,
		Limit:  int32(pageSize),
		Offset: int32(offset),
	})
	if err != nil {
		return nil, err // db error → mapError → 500, no leak
	}

	return api.GetAdminOrders200JSONResponse(api.AdminOrderList{
		Items:    adminOrderSummariesDTO(rows),
		Page:     page,
		PageSize: pageSize,
		Total:    int(total),
	}), nil
}

// GetAdminOrder handles GET /admin/orders/{id} (P3-d): the order-detail read behind the admin orders
// table. It is authRequired (classify default — owner AND staff view), so the middleware guarantees a
// resolved actor; the read is actor-independent (any admin sees any order). It returns the FULL internal
// Order — customer PII, line items, shipping address, money, payment/refund proof, internal note, tracking
// code, and the complete statusHistory (actor + reason) — the projection the public PublicOrderTimeline
// whitelist deliberately omits (ADR-032). An unknown id is db.ErrNotFound → 404 (mapError, no leak). Status
// changes are NOT made here; they go through POST /orders/{id}/transitions (RBAC-gated). r.Context()
// propagates into both reads so a client disconnect / timeout cancels them.
func (s *Server) GetAdminOrder(ctx context.Context, request api.GetAdminOrderRequestObject) (api.GetAdminOrderResponseObject, error) {
	row, err := db.NewOrders(s.pool).ByID(ctx, request.Id)
	if err != nil {
		return nil, err // ErrNotFound → 404; any other db fault → 500 (mapError, no leak)
	}
	// assembleOrderDTO reads the items + customer and builds the same nested Order every order-returning
	// endpoint responds with — the internal detail (PII/items/proof/note/statusHistory), not a new shape.
	dto, err := assembleOrderDTO(ctx, s.pool, row)
	if err != nil {
		return nil, err // malformed stored `at` (never written by the seams) → 500 (logged)
	}
	return api.GetAdminOrder200JSONResponse(dto), nil
}

// adminOrdersPageParams applies the defaults for the omitted (nil) page/pageSize params and validates them
// against the admin bounds — the runtime enforcement oapi-codegen skips. It returns ok=false for page < 1,
// pageSize < 1, or pageSize > adminOrdersMaxPageSize (all 400 VALIDATION at the call site).
func adminOrdersPageParams(pageP, sizeP *int) (page, pageSize int, ok bool) {
	page, pageSize = 1, adminOrdersDefaultPageSize
	if pageP != nil {
		page = *pageP
	}
	if sizeP != nil {
		pageSize = *sizeP
	}
	if page < 1 || pageSize < 1 || pageSize > adminOrdersMaxPageSize {
		return 0, 0, false
	}
	return page, pageSize, true
}

// adminOrdersStatusFilter maps the optional status query param to the domain filter. nil → nil (all
// statuses, "Tất cả"). A present value must be a known OrderStatus (validated against order.Statuses,
// since oapi-codegen binds the enum's Go type but does not check membership) — a bad token is ok=false
// (400), never a silently-ignored filter. The returned *order.Status feeds the query's nullable predicate.
func adminOrdersStatusFilter(s *api.OrderStatus) (*order.Status, bool) {
	if s == nil {
		return nil, true
	}
	st := order.Status(*s)
	for _, valid := range order.Statuses {
		if st == valid {
			return &st, true
		}
	}
	return nil, false
}

// adminOrderSummariesDTO maps the admin list rows to the wire summaries. Split from the I/O (pure) so the
// row→DTO slot wiring — which joined field lands in which slot — is pinned by a Docker-free unit test.
// Money stays raw int-VND (never formatted server-side, always-must #2); status/channel widen the domain
// enums to their wire types. A nil/empty result yields a non-nil empty slice so the JSON renders `[]`, not
// `null` (spec §03 zero-state).
func adminOrderSummariesDTO(rows []sqlc.ListAdminOrdersRow) []api.AdminOrderSummary {
	out := make([]api.AdminOrderSummary, len(rows))
	for i, r := range rows {
		out[i] = api.AdminOrderSummary{
			Id:            r.ID,
			Code:          r.Code,
			CustomerName:  r.CustomerName,
			FirstItemName: r.FirstItemName, // never NULL: every order has ≥1 item (CreateOrderTx)
			ItemCount:     int(r.ItemCount),
			Channel:       api.Channel(r.Channel),
			Status:        api.OrderStatus(r.Status),
			Total:         r.Total, // raw int-VND, never formatted server-side (always-must #2)
			CreatedAt:     r.CreatedAt.Time,
		}
	}
	return out
}
