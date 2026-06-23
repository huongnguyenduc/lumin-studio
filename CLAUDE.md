# Lumin Studio — Gói bàn giao cho Claude Code

> Đọc file này TRƯỚC. Nó là điểm vào: giải thích gói gồm gì, đọc theo thứ tự nào,
> và cách lên kế hoạch implementation. Mọi đường dẫn dưới đây là tương đối so với
> thư mục này.

## 1. Bối cảnh 1 dòng
Lumin Studio là cửa hàng **thiết kế & in 3D đèn / đồ trang trí theo đơn** (made-to-order,
không tồn kho thành phẩm). Hệ thống gồm 4 bề mặt chạy trên **một bộ trạng thái đơn duy nhất**:
Storefront (web khách) · Admin (desktop) · Admin Mobile · Browser Extension (bán qua inbox MXH).

## 2. Các file trong gói này

| File / thư mục | Là gì | Dùng để |
|---|---|---|
| `CLAUDE.md` | File này | Orientation + cách lập plan |
| `spec.md` | **Spec đầy đủ** (kiến trúc, data model, luồng, state, order status, validation, responsive, hành vi, auth, quyết định) | Nguồn chân lý về HÀNH VI & DỮ LIỆU |
| `design-system.md` | Token (màu/type/spacing/radius/shadow) + danh sách component + cách load | Nguồn chân lý về GIAO DIỆN |
| `Cat Peek - Behavior Spec.md` | Spec tính năng "2 con mèo nhút nhát" | Tính năng phụ, bật giai đoạn sau |
| `tokens/*.css` | File token GỐC (machine-readable) | Copy giá trị chính xác; đừng đoán hex/spacing |
| `designs/*.dc.html` | Các bản thiết kế **hi-fi + wireframe** (HTML) | Tham chiếu HÌNH ẢNH — xem layout/spacing thực tế |

## 3. Các file `.dc.html` là gì — đọc kỹ
Các file trong `designs/` là **bản thiết kế tham chiếu viết bằng HTML** — prototype thể hiện
*ý đồ* về giao diện và hành vi, **KHÔNG phải code production để copy y nguyên**. Nhiệm vụ là
**dựng lại các thiết kế này trong codebase thật** (React/Vue/Next/SwiftUI/native… tuỳ dự án),
dùng đúng pattern & thư viện của codebase đó. Nếu dự án chưa có codebase, hãy chọn framework
phù hợp nhất rồi implement.

> Mức độ: **High-fidelity** cho các file `*- Hi-fi.dc.html` (màu/type/spacing/tương tác đã chốt —
> dựng pixel-perfect bằng thư viện sẵn có của codebase). **Low-fidelity** cho các file
> `*Wireframes.dc.html` (chỉ là cấu trúc & luồng — lấy làm guide layout, áp design system để style).

Cách "đọc" một file thiết kế hiệu quả: mở trong trình duyệt để xem, và đọc source HTML để lấy
giá trị thật (màu, px, copy). Source dùng inline styles nên đọc trực tiếp được. Bỏ qua phần
khung `<x-dc>` / `support.js` / `<helmet>` — đó là runtime của môi trường thiết kế, không liên
quan tới app thật.

## 4. Thứ tự đọc đề xuất
1. `CLAUDE.md` (file này) — nắm tổng thể.
2. `spec.md` §01 Kiến trúc → §04 Order status — hiểu hệ thống & state machine *trước khi* code.
3. `design-system.md` — nạp token & component vào đầu.
4. `designs/` — mở từng màn hi-fi đối chiếu với spec khi implement.
5. `spec.md` §05–§09 — validation, responsive, hành vi, auth, quyết định đã chốt.

## 5. Cách lập plan implementation (gợi ý)
- **Bước nền:** dựng design tokens từ `tokens/*.css` thành theme của codebase (CSS vars /
  Tailwind config / styled-system). Dựng các primitive component khớp `design-system.md`
  (Button, Card, Badge, Tag, Input, Switch, ...).
- **Bước lõi:** model dữ liệu theo `spec.md §02`; cài **OrderStatus state machine** (`spec.md §04`)
  như một module dùng chung cho cả 4 bề mặt — đây là xương sống, làm sớm.
- **Theo bề mặt:** Storefront → Admin → Admin Mobile → Extension. Mỗi màn dựng đủ
  `empty · loading · error` (xem bảng state ở `spec.md §03`), không chỉ happy path.
- **Cuối:** analytics events (`spec.md §08`), Cat Peek (tuỳ chọn, giai đoạn sau).

## 6. Quy ước bắt buộc (đừng vi phạm)
- **Sentence case** mọi nơi, không ALL-CAPS cho câu. Giọng văn: ấm, mộc, xưng "chúng mình / bạn".
- Tiền tệ **VND** mặc định, định dạng `390.000₫`. Spec kỹ thuật dùng mono: `180 × 180 × 240 mm`.
- Số tiền lưu là **int VND** (không thập phân); thời gian ISO-8601 UTC. Tổng tiền tính ở **server**.
- Tiếng Việt là ngôn ngữ chính nhưng **tách khoá chuỗi i18n từ đầu** (default `vi`), không hard-code text.
- Mọi lần đổi trạng thái đơn phải ghi `statusHistory {from, to, at, byUser, reason?}`.
- Tôn trọng `prefers-reduced-motion` cho mọi animation.

## 7. Tài liệu triển khai — đọc khi bắt tay code
Quá trình thiết kế hệ thống đã sinh ra bộ tài liệu kỹ thuật trong **[`docs/`](docs/)**. Khi implement, **bắt đầu từ [`docs/README.md`](docs/README.md)** — nó là router ("đang làm X → đọc Y") và chỉ thứ tự đọc.

| File | Dùng để |
|---|---|
| `docs/README.md` | Index + router, đọc đầu tiên |
| `docs/architecture.md` | Hệ gồm gì, chạy ở đâu, dữ liệu chảy thế nào |
| `docs/decisions.md` | **ADR log — vì sao chốt vậy. Đọc trước khi định đổi; đừng relitigate.** |
| `docs/conventions.md` | **Luật bắt buộc khi viết code** (tiền, i18n, statusHistory, a11y, mitigations) |
| `docs/plan.md` | Plan theo phase + "done" là gì |
| `docs/operations.md` | Deploy / CI-CD / backup / observability / GPU (WSL2) |
| `docs/compliance.md` | Nghĩa vụ pháp lý VN (online.gov.vn, PDPL, đổi trả, hoá đơn) |

> `spec.md` + `design-system.md` + `tokens/` vẫn là nguồn chân lý về **hành vi/dữ liệu** và **giao diện**; `docs/` là tầng **triển khai** xây trên đó.

## 8. Tầng điều khiển agent (harness) — đã bật
Repo có tầng "điều khiển" để mọi phiên Claude ít lệch: luật theo bề mặt **tự load** từ `.claude/rules/*.md` (theo file đang chạm), **hooks** trong `.claude/hooks/` chặn lệnh huỷ diệt / format-lint tự động / chặn dừng tới khi test xanh, và reviewer **`spec-guardian`** soi diff theo `docs/decisions.md`+`docs/conventions.md`. Chi tiết + stack lint/test đã chốt: [`docs/agent-harness.md`](docs/agent-harness.md) (ADR-020/021). Hooks tự no-op tới khi Phase 0 dựng tool.
