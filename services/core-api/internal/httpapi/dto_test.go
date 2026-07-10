package httpapi

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/db/sqlc"
	"github.com/huongnguyenduc/lumin-studio/services/core-api/internal/order"
)

// toOrderDTO is a pure mapping (no I/O), so it is exercised Docker-free with a hand-built spine.

func strp(s string) *string { return &s }

// A fully-populated order round-trips into the nested contract DTO with every field mapped:
// nested customer/items/statusHistory, denormalized proofs, tracking code, and int-VND money left
// raw (never formatted here — always-must #2).
func TestToOrderDTOFullMapping(t *testing.T) {
	orderID := uuid.New()
	productID := uuid.New()
	colorID := uuid.New()
	optID := uuid.New()
	created := time.Date(2026, 7, 1, 8, 0, 0, 0, time.UTC)
	paidAt := time.Date(2026, 7, 1, 9, 30, 0, 0, time.UTC)
	pendingStatus := order.PendingConfirm

	row := sqlc.Order{
		ID:                 orderID,
		Code:               "#LMN-1000",
		Channel:            order.ChannelWeb,
		Status:             order.Paid,
		CustomerID:         uuid.New(),
		ShippingAddress:    order.Address{Province: "Hà Nội", Ward: "Cửa Nam", Street: "12 Lý Thường Kiệt"},
		Subtotal:           390_000,
		ShippingFee:        30_000,
		Total:              420_000,
		PaymentProofUrl:    strp("https://cdn/x.jpg"),
		PaymentConfirmedAt: pgtype.Timestamptz{Time: paidAt, Valid: true},
		TrackingCode:       strp("VN123"),
		QcPhotoUrl:         strp("https://cdn/qc.jpg"),
		Note:               strp("giao giờ hành chính"),
		CreatedAt:          pgtype.Timestamptz{Time: created, Valid: true},
		StatusHistory: []order.StatusEvent{
			{From: nil, To: order.PendingConfirm, At: "2026-07-01T08:00:00Z", ByUser: "customer"},
			{From: &pendingStatus, To: order.Paid, At: "2026-07-01T09:30:00Z", ByUser: uuid.NewString()},
		},
	}
	items := []sqlc.ListOrderItemsRow{{
		ID:              uuid.New(),
		OrderID:         orderID,
		ProductID:       productID,
		ColorID:         pgtype.UUID{Bytes: colorID, Valid: true},
		OptionIds:       []byte(`["` + optID.String() + `"]`),
		Personalization: &order.Personalization{Text: "An", ZoneID: "base"},
		Quantity:        2,
		UnitPrice:       195_000,
		ProductName:     "Đèn nấm",
		ColorName:       strp("Cam"),
		OptionLabels:    []string{"Size M"},
	}}
	email := "an@lumin.vn"
	cust := sqlc.Customer{Name: "Nguyễn An", Phone: "0901234567", Email: &email}

	dto, err := toOrderDTO(row, items, cust)
	if err != nil {
		t.Fatalf("toOrderDTO: %v", err)
	}

	if dto.Id != orderID || dto.Code != "#LMN-1000" || string(dto.Status) != "PAID" || string(dto.Channel) != "web" {
		t.Fatalf("scalar mismatch: %+v", dto)
	}
	if dto.Subtotal != 390_000 || dto.ShippingFee != 30_000 || dto.Total != 420_000 {
		t.Fatalf("money mismatch: %+v", dto)
	}
	if dto.TrackingCode == nil || *dto.TrackingCode != "VN123" {
		t.Fatalf("tracking = %v, want VN123", dto.TrackingCode)
	}
	if dto.QcPhotoUrl == nil || *dto.QcPhotoUrl != "https://cdn/qc.jpg" {
		t.Fatalf("qcPhotoUrl = %v, want https://cdn/qc.jpg", dto.QcPhotoUrl)
	}
	if dto.PaymentConfirmedAt == nil || !dto.PaymentConfirmedAt.Equal(paidAt) {
		t.Fatalf("paymentConfirmedAt = %v, want %v", dto.PaymentConfirmedAt, paidAt)
	}
	if !dto.CreatedAt.Equal(created) {
		t.Fatalf("createdAt = %v, want %v", dto.CreatedAt, created)
	}
	if dto.ShippingAddress.Province != "Hà Nội" || dto.ShippingAddress.Ward != "Cửa Nam" {
		t.Fatalf("address mismatch: %+v", dto.ShippingAddress)
	}
	if dto.Customer.Name != "Nguyễn An" || dto.Customer.Email == nil || string(*dto.Customer.Email) != email {
		t.Fatalf("customer mismatch: %+v", dto.Customer)
	}

	if len(dto.Items) != 1 {
		t.Fatalf("items len = %d, want 1", len(dto.Items))
	}
	it := dto.Items[0]
	if it.ProductId != productID || it.Quantity != 2 || it.UnitPrice != 195_000 {
		t.Fatalf("item scalar mismatch: %+v", it)
	}
	if it.ColorId == nil || *it.ColorId != colorID {
		t.Fatalf("colorId = %v, want %v", it.ColorId, colorID)
	}
	if len(it.OptionIds) != 1 || it.OptionIds[0] != optID {
		t.Fatalf("optionIds = %v, want [%v]", it.OptionIds, optID)
	}
	if it.Personalization == nil || it.Personalization.Text != "An" || it.Personalization.ZoneId != "base" {
		t.Fatalf("personalization mismatch: %+v", it.Personalization)
	}
	if it.ProductName == nil || *it.ProductName != "Đèn nấm" {
		t.Fatalf("productName = %v, want Đèn nấm", it.ProductName)
	}
	if it.ColorName == nil || *it.ColorName != "Cam" {
		t.Fatalf("colorName = %v, want Cam", it.ColorName)
	}
	if it.OptionLabels == nil || len(*it.OptionLabels) != 1 || (*it.OptionLabels)[0] != "Size M" {
		t.Fatalf("optionLabels = %v, want [Size M]", it.OptionLabels)
	}

	if len(dto.StatusHistory) != 2 {
		t.Fatalf("statusHistory len = %d, want 2", len(dto.StatusHistory))
	}
	if dto.StatusHistory[0].From != nil {
		t.Fatalf("genesis From = %v, want nil", dto.StatusHistory[0].From)
	}
	if dto.StatusHistory[1].From == nil || string(*dto.StatusHistory[1].From) != "PENDING_CONFIRM" {
		t.Fatalf("second event From mismatch: %+v", dto.StatusHistory[1])
	}
	if !dto.StatusHistory[1].At.Equal(time.Date(2026, 7, 1, 9, 30, 0, 0, time.UTC)) {
		t.Fatalf("event At parse mismatch: %v", dto.StatusHistory[1].At)
	}
}

// An empty/nil option_ids column maps to a non-nil empty slice (so JSON renders `[]`, not `null`),
// a missing color/personalization stays nil, and a nil customer email stays nil.
func TestToOrderDTOEmptyOptionalsRenderCleanly(t *testing.T) {
	row := sqlc.Order{
		ID: uuid.New(), Code: "#LMN-1001", Channel: order.ChannelInbox, Status: order.PendingConfirm,
		StatusHistory: []order.StatusEvent{{From: nil, To: order.Paid, At: "2026-07-01T08:00:00.500Z", ByUser: uuid.NewString()}},
	}
	items := []sqlc.ListOrderItemsRow{{ID: uuid.New(), ProductID: uuid.New(), ProductName: "x", OptionIds: nil, Quantity: 1, UnitPrice: 10}}

	dto, err := toOrderDTO(row, items, sqlc.Customer{Name: "x", Phone: "0900000000"})
	if err != nil {
		t.Fatalf("toOrderDTO: %v", err)
	}
	if dto.Items[0].OptionIds == nil {
		t.Fatal("optionIds is nil, want non-nil empty slice ([] not null)")
	}
	if len(dto.Items[0].OptionIds) != 0 {
		t.Fatalf("optionIds = %v, want empty", dto.Items[0].OptionIds)
	}
	if dto.Items[0].ColorId != nil || dto.Items[0].Personalization != nil {
		t.Fatalf("unset color/personalization not nil: %+v", dto.Items[0])
	}
	if dto.Items[0].ProductName == nil || *dto.Items[0].ProductName != "x" {
		t.Fatalf("productName = %v, want x", dto.Items[0].ProductName)
	}
	if dto.Items[0].ColorName != nil || dto.Items[0].OptionLabels != nil {
		t.Fatalf("unset colorName/optionLabels not nil: %+v", dto.Items[0])
	}
	if dto.Customer.Email != nil {
		t.Fatalf("email = %v, want nil", dto.Customer.Email)
	}
	if dto.TrackingCode != nil || dto.PaymentConfirmedAt != nil || dto.QcPhotoUrl != nil {
		t.Fatalf("unset tracking/paidAt/qc not nil: %+v", dto)
	}
}

// A malformed stored `at` surfaces as an error (never written by the seams, which validate via
// order.Transition) — proving the mapper fails loud instead of panicking.
func TestToOrderDTORejectsMalformedTimestamp(t *testing.T) {
	row := sqlc.Order{
		ID: uuid.New(), Code: "#LMN-1002", Channel: order.ChannelWeb, Status: order.PendingConfirm,
		StatusHistory: []order.StatusEvent{{To: order.PendingConfirm, At: "not-a-time", ByUser: "customer"}},
	}
	if _, err := toOrderDTO(row, nil, sqlc.Customer{}); err == nil {
		t.Fatal("toOrderDTO with malformed at = nil err, want parse error")
	}
}
