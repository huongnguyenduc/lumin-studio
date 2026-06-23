# Plan triển khai feature — `<tên feature>`

> **Template** (B1 / ADR-025, mượn khung `writing-plans` của Superpowers, may đo cho Lumin).
> Copy file này thành `docs/plans/<feature>.md` (hoặc dán vào plan mode) **trước khi viết code nhiều-file**.
> Khác với [`plan.md`](../plan.md) (roadmap theo phase) và [`active-context.md`](../active-context.md) (focus đang chạy):
> file này là **hợp đồng triển khai một feature** — đủ chi tiết để một phiên khác (hoặc subagent) cài đúng mà không cần hỏi lại.
> **Advisory** (không phải gate). Nhưng nếu rời plan mode mà còn `[NEEDS CLARIFICATION]` ⇒ chưa đủ điều kiện code (`agent-harness.md` §Kỷ luật).

---

## 0. Tóm tắt
- **Mục tiêu (1 câu):** `<feature làm được gì cho khách/shop>`
- **Surface chạm:** `[ ] Storefront  [ ] Admin  [ ] Admin Mobile  [ ] Extension`  ·  **BFF/core:** `[ ] core-api (Go)  [ ] packages/core  [ ] asset-worker (Rust)`
- **ADR liên quan (đọc trước, đừng relitigate):** `<ADR-0xx, ADR-0yy>` — [`decisions.md`](../decisions.md)
- **Spec nguồn:** `/spec.md §<…>`  ·  **Acceptance id sẽ phủ:** `<OSM-0x, MNY-0x, CHK-0x…>` ([`acceptance.md`](../acceptance.md))

## 1. Global constraints (verbatim — KHÔNG diễn giải lại)
> Dán **nguyên văn** ràng buộc luôn-đúng + giá trị spec đặc thù của feature. Mục đích: mỗi task đọc được luật mà không
> phải nhớ. Đây là copy của [`conventions.md`](../conventions.md) — nếu thấy mâu thuẫn, `conventions.md` thắng.

**Luôn-đúng (4 luật always-must + nền):**
- **statusHistory:** mọi đổi `OrderStatus` đi qua transition guard của `packages/core` và **append** `statusHistory{from,to,at,byUser,reason?}`; `reason` bắt buộc cho `CANCELLED`/`RETURNED`.
- **Tiền:** lưu **int VND** (không thập phân); `subtotal/shippingFee/total` **tính ở server**, không tin total client; format qua **một** formatter `packages/core` → `390.000₫` (U+20AB, không space). Không gọi `Intl.NumberFormat`/`toLocaleString` ngoài `core`.
- **i18n:** không hard-code chuỗi UI — `next-intl` ICU, default `vi`, tách khoá từ commit đầu.
- **prefers-reduced-motion:** tắt entrance + dừng loop (viewer 3D, Cat Peek).
- **Nền:** thời gian ISO-8601 UTC · sentence case, giọng ấm-mộc ("chúng mình/bạn") · mỗi màn đủ **empty·loading·error** · a11y WCAG 2.2 AA (contrast khoá, hit ≥44px, focus-visible).

**Đặc thù feature này (dán giá trị spec — kích thước, enum, ngưỡng, copy):**
```
<vd: maxChars khắc = 20 · channel ∈ {web, inbox, zalo} · phí ship theo province · QR memo KHÔNG bắt buộc …>
```

## 2. Interfaces — Consumes / Produces (chữ ký liên-task)
> **Điểm cốt lõi của template.** Liệt kê **chữ ký chính xác** mà task này *tiêu thụ* (đã có) và *tạo ra* (task sau dựa vào).
> Để các task ghép được mà không đoán type. Ghi đúng tên file + signature thật, không mô tả mơ hồ.

| Loại | Tên / signature | Consumes (đã có ở) | Produces (task tạo) |
|---|---|---|---|
| Type/Zod | `<OrderDraft = z.infer<…>>` | `packages/core/<…>` | `<…>` |
| API route | `<POST /orders → 201 {orderId}>` | `<…>` | `<…>` |
| Event/outbox | `<order.created v1 {orderId, channel}>` | `domain-core.md` | `<…>` |
| UI prop | `<<PriceTag amount: number (int VND)>>` | `packages/ui` | `<…>` |

## 3. Bản đồ file (tạo / sửa theo surface)
```
packages/core/…        <tạo|sửa — gì>
services/core-api/…    <…>
apps/web/…             <…>
apps/admin/…           <…>
```

## 4. Tasks (mỗi task: kết thúc là code chạy được + test xanh)
> Thứ tự = phụ thuộc (core trước, surface sau). Mỗi task **độc lập commit được**. Áp luật **No-Placeholders** (§5).

### Task 1 — `<tên>`
- **Files:** `<…>`
- **Interfaces:** Consumes `<…>` · Produces `<…>` (khớp §2)
- **TDD (RED→GREEN):** viết test trước → `<test id / mô tả>` (đỏ) → cài logic tới khi xanh. Bất biến lõi (statusHistory/money/reconcile-owner-only) **phải có assertion**, không `.skip`.
- **Acceptance:** tick `<OSM-0x>` ở [`acceptance.md`](../acceptance.md) **chỉ khi** test id liên kết pass.
- **Done:** `<điều kiện quan sát được — không phải "code xong">`

### Task 2 — `<…>`
- *(lặp khung trên)*

## 5. No-Placeholders (luật)
- **Không** `// TODO`, `return null /* stub */`, mock-thay-logic, hay "để sau" trong path đã khai báo Done.
- **Không** hardcode `input→output` khớp y nguyên fixture test để qua green-gate (special-casing — `conventions.md` §Toàn vẹn test; literal output chỉ hợp lệ ở `packages/core`).
- Mỗi task rời tay là **chạy được + test xanh**; nửa-vời thì tách thành task nhỏ hơn, đừng để stub lẫn trong "done".

## 6. Self-review vs spec (chạy TRƯỚC khi gọi spec-guardian)
- [ ] Phủ đủ `spec.md §<…>` đã liệt kê ở §0? Không lặng lẽ bỏ nhánh nào?
- [ ] Mọi type/route/event **khớp §2 Interfaces** (không lệch signature giữa producer↔consumer)?
- [ ] 4 luật always-must (§1) còn đúng ở **mọi** file chạm? (statusHistory append · money qua core formatter · i18n key · reduced-motion)
- [ ] Mỗi màn UI mới có **empty·loading·error** (không chỉ happy path)?
- [ ] Acceptance id đã tick đều có test **pass thật** (không `.skip`, không special-case)?
- [ ] RBAC: staff không reconcile→PAID / không sửa STK ở luồng này?
- [ ] Đã cập nhật [`active-context.md`](../active-context.md) (focus · ledger task · lần verify xanh)?

> Xong self-review → gọi **spec-guardian** (compliance) và, nếu muốn ý kiến design, **oracle** — xem `agent-harness.md` §Reviewer (hai verdict tách riêng).
