# Plan — Phase 3 · Admin (+ Admin Mobile) — full-fidelity build

> **Nguồn:** 3 vòng探索 read-only (backend surface · spec+designs · frontend reuse) + owner-lock 2026-07-10.
> **Khác phase trước:** xương sống đơn/tiền/auth **đã có sẵn** (Core slice 3 dựng auth+RBAC, dashboard, transition
> endpoints, settings/STK). Phase 3 = **FE-nặng** treo lên seam có sẵn + lấp handler đọc + 2 surface **greenfield**
> (Vật tư, Pet-Tag). **Owner chọn full-fidelity** (mọi màn trong `designs/`, drag-drop+SSE, editor có live-preview).
>
> **Nguồn chân lý vẫn là:** `/spec.md` (hành vi/dữ liệu) · `design-system.md` + `designs/Lumin Admin*.dc.html` (UI) ·
> `decisions.md` (ADR) · `conventions.md` (luật code). Plan chỉ xếp thứ tự + slice + done-gate.

## 0 · Bối cảnh + ranh giới

**Xương sống admin ĐÃ xong ở "Core slice 3" (PR-3a..k) — KHÔNG dựng lại:**
- **Auth + RBAC** (ADR-030): `internal/auth` + `internal/httpapi/{auth,middleware_auth}.go`. Self-issued JWT
  (`POST /auth/login` bcrypt → cookie `lumin_session` httpOnly+Secure+SameSite), middleware classify
  (`authRequired`/`authOwnerOnly`/`authOptional`/`authPublic`/`authCustomer`), Actor injection
  (`{ByUser=users.id, Role, At}` — role đọc lại từ DB, không tin claim), `requireOwner` cho cạnh owner-only.
- **Dashboard** (PR-3i/3j): `GET /admin/dashboard` + FE đầy đủ (`apps/admin` KPI/recent/todo, net-revenue payment-anchored HCM-day).
- **Order transitions** (PR-3h): `POST /orders/{id}/transitions` → `ConfirmPaymentTx` (owner-only, emit **đúng một** `order.paid`)
  cho reconcile→PAID; **mọi edge khác** qua `AdvanceStatusTx` (guard `internal/order` authoritative, RBAC + reason + refundProofUrl);
  trackingCode-on-SHIPPING đã hỗ trợ.
- **Settings/STK** (PR-3k): `GET /admin/settings` (owner+staff read) · `PATCH /admin/settings/bank-account`
  (**owner-only** + `UpdateBankAccountTx` audit-on-commit) · `GET /admin/reply-templates`.
- **FE spine dùng chung:** `@lumin/core` (formatter `formatVnd`/`formatVnDate*`/`formatVnNumber`/`formatVnRating`;
  state machine `canTransition`/`transition`/`TERMINAL_STATUSES`), `@lumin/ui` (Button/Input/Checkbox/Switch/Badge/Card/Avatar/
  IconButton/Tag/Rating/PriceTag), `@lumin/api-client` (openapi→`schema.gen.ts`, cookie-forward), `@lumin/tokens`
  (luminPreset). Sidebar `apps/admin/src/components/sidebar.tsx` **đã liệt kê cả 9 route** — thêm màn = thêm `page.tsx`,
  không đụng nav. Fetch pattern: `lib/<domain>-fetch.ts` (`cookies()` → `createApiClient` → `GET`, `no-store`);
  adapter thuần `lib/<domain>.ts`; test `node` env thuần-logic (không jsdom — render để Playwright Phase 5).

**Vậy Phase 3 = login-UI (thiếu!) + handler đọc admin + FE mọi màn + 2 surface greenfield.** `apps/admin` hiện **chỉ có
dashboard** (`app/page.tsx`) — **CHƯA có màn đăng nhập**: backend auth chạy nhưng không có đường lấy cookie qua UI →
`dang-nhap` là **P3-a, gate mọi thứ**. Endpoint admin hiện có **chỉ**: `/admin/dashboard`, `/admin/settings`,
`/admin/settings/bank-account`, `/admin/reply-templates` (xác nhận qua `openapi.yaml`).

**Ranh giới cứng — OUT of scope kể cả khi "everything" (roadmap de-scope, `plan.md` §Đừng-làm):**
- **Extension tự động hoá Meta / scrape DOM** (ADR-011) — Extension là Phase 4, assistive-only. Màn *"Cài đặt ›
  Extension"* trong design **phụ thuộc Extension chưa tồn tại** → P3 chỉ scaffold read-only/placeholder, handshake = Phase 4.
- **Đối soát ngân hàng tự động / webhook** (SePay/Casso) — Phase 5. Reconcile vẫn owner-xem-ảnh 1-chạm (ADR-010).
- **Hoá đơn điện tử tự động** — không phải lúc này (`compliance.md`).
- **Multi-sàn / fleet-scheduler in / ERP** — de-scoped.
- **CMS cho nội dung tĩnh** (refund policy text…) — giữ i18n static, thêm CMS khi shop sửa thường xuyên.
- **Push notification thật** (design mobile vẽ lock-screen banner) — Phase 5 (cần APNs/FCM + service-worker); P3 chỉ
  in-app badge/toast-inline.

**Luật xuyên suốt (must — mọi sub-PR):**
- **statusHistory:** mọi đổi `OrderStatus` qua transition guard `@lumin/core`/`internal/order` + append
  `{from,to,at,byUser,reason?}`; `reason` bắt buộc `CANCELLED`/`REFUNDED` (+`refundProofUrl`). FE **chỉ hiện next-state
  hợp lệ** (dùng `canTransition(from,to,role)`); BE re-validate (transition.go authoritative).
- **Tiền:** int VND, format **chỉ** qua `formatVnd` (`@lumin/core`); cấm `Intl`/`toLocaleString` ngoài core (ESLint).
  Tổng tính ở server (dashboard/detail chỉ hiển thị `total` đã tính).
- **i18n:** không hard-code — `apps/admin/src/messages/vi.ts` namespace mới mỗi màn (`orders.*`, `print.*`, `products.*`,
  `reviews.*`, `settings.*`, `materials.*`, `customers.*`, `categories.*`, `staff.*`, `petTag.*`); merge `core` đã sẵn.
- **prefers-reduced-motion:** tắt entrance + kanban drag-anim + progress-bar loop + SSE flash.
- **RBAC (`spec.md` §08, ADR-010 line 49):** `owner` toàn quyền; `staff` **KHÔNG** reconcile→PAID, **KHÔNG** →REFUNDED,
  **KHÔNG** sửa STK/settings/nhân-viên. FE ẩn/disable nút owner-only theo `Actor.Role`; BE `authOwnerOnly` là tường thật.
- **Mỗi màn đủ empty · loading · error** (không chỉ happy path — `spec.md` §03; reuse root `loading.tsx`/`error.tsx`).
- **a11y WCAG 2.2 AA:** hit ≥44px (admin-mobile ngón cái), focus-visible, contrast khoá; drag-drop **phải có** fallback
  bàn phím / nút "→ bước sau" (không chỉ chuột-kéo).
- **Visual-fidelity (ADR-027):** đối chiếu `designs/Lumin Admin - Hi-fi.dc.html` (desktop) · `Lumin Admin Mobile - Hi-fi.dc.html`
  · `Lumin Admin Wireframes.dc.html` trước mỗi màn. Admin Mobile = **cùng app responsive** (ADR-002), không tách codebase:
  desktop sidebar → mobile bottom-tab (5 tab: Tổng quan/Đơn/Hàng in/Đánh giá/Thêm) + sticky action-bar trong tầm ngón.
- **Audit + money-out:** đổi STK/settings-tiền ghi audit append-only (STK đã có `setting_bank_audit`); mọi cạnh
  money-out (REFUNDED, STK) owner-only + defense-in-depth.

## 1 · Quyết định chủ (lock 2026-07-10)

| # | Quyết định | Trạng thái |
|---|---|---|
| **D-P3-1 · Scope** | **EVERYTHING** — mọi màn trong `designs/Lumin Admin*`: 6 lõi `plan.md` (dashboard·đơn·hàng-đợi-in·sản-phẩm·đánh-giá·cài-đặt) **+** Danh mục · Khách hàng · Nhân viên/RBAC · Kênh chat · **Vật tư/Chi phí** · **Pet-Tag admin**. 2 cái cuối là **greenfield** (data-model mới). | ✅ LOCKED — user |
| **D-P3-2 · Hàng đợi in** | **Drag-drop (@dnd-kit) + SSE** (ADR-008), khớp hi-fi. Kèm fallback bàn-phím/nút cho a11y + admin-mobile. SSE qua cloudflared cần anti-buffer + heartbeat + tunnel smoke-test (`conventions.md` §Realtime). | ✅ LOCKED — user |
| **D-P3-3 · Editor sản phẩm** | **Full 2-cột + live storefront preview** (phone-mockup re-render khi đổi màu/option) khớp hi-fi. | ✅ LOCKED — user |
| **D-P3-4 · Login-first** | `P3-a` màn `/dang-nhap` + admin-route auth-redirect (unauth → login) **land TRƯỚC** mọi màn khác (không authenticate được thì không dùng được gì). Backend auth đã có. | ✅ LOCKED — default |
| **D-P3-5 · Upload — 2 đường** | **Ảnh** (QC photo · review reply-images · product gallery · category thumb): **reuse P2-c presigned-POST** (`internal/proofstore`, ≤10MB, content-type allowlist, host-pin). **Model 3D** (.glb/.stl/.3mf, thường >10MB): **presigned-PUT multipart** (ADR-005, part<100MB — CF-Tunnel chặn body>100MB) = **infra greenfield** (P2-c chỉ dựng đường POST-ảnh) → gate P3-j. | ✅ LOCKED — default |
| **D-P3-6 · QC photo trước SHIPPING** | INCLUDE (`plan.md` §Phase-3 gộp cải tiến). Lưu `orders.qc_photo_url` (migration 000014) — transition `→SHIPPING` yêu cầu `qcPhotoUrl` **+** `trackingCode` (đã có). Upload qua đường ảnh D-P3-5. | ✅ LOCKED — default |
| **D-P3-7 · Vật tư + Pet-Tag = greenfield, cuối** | Mỗi cái là **mini-feature** (data-model + migration + ADR + endpoint + FE), sequence **Track F cuối**. Pet-Tag admin **thực chất là build feature Pet-Tag NFC** (không chỉ 1 màn) → nên tách **feature-plan riêng** (`docs/plans/pet-tag.md`), plan này chỉ đặt chỗ. Vật tư (Spoolman-like) wire filament-deduct vào print-stage→PRINTING. | ✅ LOCKED — default |
| **D-P3-8 · Primitive thiếu = lazy** | Table = hand-roll `<table>` (dashboard đã làm) · Modal = native `<dialog>` · Select = native `<select>` (như checkout P2-d) · Toast = state inline empty/loading/error (không thêm lib) · drag-drop = **@dnd-kit** (1 dep, D-P3-2) · SSE = hook mỏng quanh `EventSource`. **Không** thêm Radix/Headless/react-beautiful-dnd. Extract lên `@lumin/ui` **chỉ khi** consumer thứ 2 cần. | ✅ LOCKED — ponytail |

## 2 · Backend / data-model gaps (lấp trước FE tiêu thụ)

> DB read/seam **phần lớn đã có** (agent-map). Cần: **handler đọc admin** (assemble DTO khác public-whitelist), vài
> **seam ghi** (review-publish, product/category/staff CRUD), **2 infra** (model-upload PUT, SSE), **2 greenfield** (Vật tư, Pet-Tag).

| Gap | PR | Seam/verify đã có hôm nay | Ghi chú |
|---|---|---|---|
| `GET /admin/orders` (list + filter status + paginate) | P3-b | `db.Orders.ByStatus` (newest-first) tồn tại; **chưa** có handler/DTO | Admin DTO ≠ public whitelist (PII khách, kênh, tổng, ngày). openapi additive + api-client regen **staged** |
| `GET /admin/orders/{id}` (detail đầy đủ) | P3-d | `db.Orders.ByID` + `Items` tồn tại | DTO: customer PII + items + proof url + statusHistory + note nội bộ. Không dùng `PublicOrderTimeline` |
| `orders.qc_photo_url` + `→SHIPPING` yêu cầu QC photo | P3-e | transition đã đòi trackingCode; **chưa** có cột qc_photo | **Migration 000014** (>head 000013, monotonic) + đọc trong transition guard SHIPPING |
| `GET /admin/print-queue` + `PATCH /admin/print-jobs/{id}` (stage) | P3-f | `db.Jobs.PrintJobsByStage` + `AdvancePrintStage` tồn tại | Handler + DTO (job→order→product). Stage enum `NEED_PRINT/PRINTING/PACKING/SHIPPED` |
| SSE `GET /admin/print-queue/stream` (ADR-008) | P3-g | **chưa** có SSE hạ tầng | `no-transform`+`identity`+`X-Accel-Buffering:no`+`http.Flusher`/event+heartbeat; **tunnel smoke-test**. Fallback poll |
| Model-upload presigned-PUT multipart (.glb) | P3-j | P2-c chỉ POST-ảnh ≤10MB | **Infra greenfield** (ADR-005 part<100MB). ADR upload-model + bucket/CORS |
| Product/color/option **write** + asset-job create/list | P3-j | `catalog.sql` chỉ `Insert*` (seed); `CreateAssetJobTx`+`AssetJobsByStatus` tồn tại | Thêm Update/Delete + `POST /admin/products` + color/option CRUD + `POST /admin/products/{id}/asset-jobs` |
| Review moderation: list-all-status + publish/hide + reply | P3-m | `catalog` chỉ `ListPublishedReviews` (public); **chưa** có seam admin | Thêm `ListReviewsByStatus` + `UpdateReviewStatusTx` (+reply). Không outbox (moderation nội bộ) |
| Settings write: shipping-rules + refund-policy + reply-template CRUD | P3-i | `Settings` repo read; STK write có audit | Thêm `PATCH /admin/settings/shipping-rules` + `.../refund-policy` + reply-template write. Audit? (quyết P3-i) |
| Categories write (Update/Delete/reorder) | P3-o | `InsertCategory` tồn tại | + `PATCH/DELETE /admin/categories` + reorder |
| Customers admin read (list/detail) | P3-p | `customers` table (PR-2d); **chưa** admin read | `GET /admin/customers` + detail. **Merge-duplicate = DEFER** (phức tạp, flag) |
| Staff invite/list/role | P3-q | `users` (role, password_hash) + `make seed-owner`; **chưa** invite flow | `GET/POST /admin/staff` + role. RBAC-matrix chỉ hiển thị (không cấu-hình-được — owner/staff cố định) |
| **Vật tư** (filament_spools/machine_hours/aux_costs/scrap) | P3-s | **GREENFIELD** — không table nào | Migration 000015+ + ADR data-model + endpoints + wire filament-deduct print-stage. Mini-feature |
| **Pet-Tag** (pet_tags/pet_profiles/encode/activate/lost) | P3-t | **GREENFIELD** — không table nào | Tách `docs/plans/pet-tag.md`. Mini-feature riêng, plan này đặt chỗ |

## 3 · Thứ tự sub-PR — theo track, dependency-sound

> **Track 0/A/B/C = "Done gate" của `plan.md` §Phase-3** (vận hành trọn vòng đơn từ Admin). D/E = lõi roadmap còn lại.
> **F = phần "everything" thêm** (greenfield-nặng, sequence cuối). Mọi FE land SAU seam BE nó tiêu thụ. Mỗi BE sub-PR:
> openapi additive + **api-client regen staged** (memory: oapi/sqlc stale-check so working-vs-index → `git add` codegen
> trước `make verify-go`) + `make verify-go` xanh + acceptance EARS+test-id (Go-gated `[ ]`, ADR-027).

### Track 0 — Foundation (gate tất cả)
| id | title | surface | dependsOn | done-when |
|---|---|---|---|---|
| **P3-a** | Màn `/dang-nhap` + admin-route auth-redirect | FE | — | Owner/staff nhập email+password → `POST /auth/login` set cookie → vào `/`; unauth chạm admin route → redirect login; logout xoá cookie; empty/loading/error (sai mật khẩu, mất mạng); i18n `auth.*`; **firstPR** |

### Track A — Đơn hàng (daily driver, giá trị cao nhất)
| id | title | surface | dependsOn | done-when |
|---|---|---|---|---|
| **P3-b** | BE `GET /admin/orders` (list + filter status + paginate) | BE | — | Admin DTO (mã/khách/SP/tổng/kênh/status/ngày); filter theo status; page; RBAC `authRequired`; openapi+regen staged; Go test |
| **P3-c** | FE `/don-hang` danh sách | FE | P3-b | Filter pills (Tất cả/Chờ XN/Đã TT/Đang in/Đang giao/Hoàn tất/Huỷ-Hoàn) + table + `OrderStatusBadge` + multi-select scaffold; empty/loading/error; native `<select>` filter; admin-mobile card-stack + vuốt/giữ; i18n `orders.*` |
| **P3-d** | BE `GET /admin/orders/{id}` (detail) | BE | — | DTO: customer PII + items + proofUrl + statusHistory + note; RBAC; regen staged; Go test |
| **P3-e** | FE `/don-hang/{id}` detail + **transition UI** + QC-photo gate | FE+BE | P3-d, P3-b | Progress 5-bước + items + khách + proof-viewer + note; **1-chạm confirm→PAID (owner-only)** + advance + **dialog huỷ (lý do radio)** + **dialog hoàn (lý do + refundProof upload)** qua `POST /orders/{id}/transitions`; **`→SHIPPING` đòi QC photo (D-P3-6, migration 000014) + trackingCode**; next-state từ `canTransition`; native `<dialog>`; sticky action-bar mobile; empty/loading/error |

> **⟢ sau Track A:** owner login → xem đơn → confirm/cancel/refund → advance — nửa vòng đơn chạy được.

### Track B — Hàng đợi in
| id | title | surface | dependsOn | done-when |
|---|---|---|---|---|
| **P3-f** | BE `GET /admin/print-queue` + `PATCH /admin/print-jobs/{id}` (stage) | BE | — | List job group theo stage (NEED_PRINT/PRINTING/PACKING/SHIPPED) + DTO (job→order→product); stage-advance qua `AdvancePrintStage`; regen staged; Go test (guard stage hợp lệ) |
| **P3-g** | BE SSE `GET /admin/print-queue/stream` (ADR-008) | BE | P3-f | Emit event khi stage đổi; `no-transform`/`identity`/`X-Accel-Buffering:no`/Flusher/heartbeat; **tunnel smoke-test**; fallback poll khi SSE fail |
| **P3-h** | FE `/hang-doi-in` kanban drag-drop + SSE | FE | P3-f, P3-g | 4 cột + **@dnd-kit** kéo↔stage (+ nút "→ bước sau" a11y/mobile fallback, D-P3-2) + SSE live; filament-warning badge (static tới Track F); reduced-motion tắt drag-anim; admin-mobile cột-vuốt; empty/loading/error |

### Track C — Cài đặt (STK owner-only đã có; lấp phần còn lại — cần để checkout không bị chặn)
| id | title | surface | dependsOn | done-when |
|---|---|---|---|---|
| **P3-i** | FE `/cai-dat` + BE shipping-rules/refund-policy/reply-template write | FE+BE | — | STK edit (owner-only, consume `PATCH bank-account`, staff thấy read-only + cảnh báo "chưa cấu hình STK ⇒ chặn checkout") + shipping-rules table CRUD + refund-policy edit + reply-templates CRUD ({tên}/{mã đơn}/{STK}); owner-gate BE thật; audit STK giữ nguyên; i18n `settings.*`; empty/loading/error |

> **⟢ Done gate `plan.md` §Phase-3 lõi = Track 0+A+B+C:** vận hành trọn vòng đơn từ Admin, responsive mobile.

### Track D — Sản phẩm
| id | title | surface | dependsOn | done-when |
|---|---|---|---|---|
| **P3-j** | BE product write + model-upload presign + asset-job | BE+infra | — | `GET/POST/PATCH/DELETE /admin/products` + color/option CRUD + `POST /admin/products/{id}/asset-jobs` (→`CreateAssetJobTx`) + `GET .../asset-jobs` (status); **model presigned-PUT multipart** (ADR-005, part<100MB — infra greenfield, D-P3-5) + ADR; regen staged; Go test |
| **P3-k** | FE `/san-pham` danh sách | FE | P3-j | Cards + search + tab (Tất cả/Đang bán/Nháp/Lưu trữ) + FAB "+"; empty/loading/error; i18n `products.*` |
| **P3-l** | FE `/san-pham/{id}` editor **full + live preview** (D-P3-3) | FE | P3-j, P3-k | 2-cột: form (tên/slug/mô tả/danh mục/status/giá/kích thước/**màu có tên**/**option**/**upload .glb → AssetJob** + gallery ảnh) · **preview phone-mockup re-render** khi đổi màu/option (reuse storefront product-view); upload-status (đang tải/lỗi/retry); validation per-field; empty/loading/error |

### Track E — Đánh giá
| id | title | surface | dependsOn | done-when |
|---|---|---|---|---|
| **P3-m** | BE review moderation | BE | — | `GET /admin/reviews?status=` (mọi status) + `PATCH /admin/reviews/{id}` (publish/hide) + reply; seam mới `ListReviewsByStatus`+`UpdateReviewStatusTx`; regen staged; Go test (non-leak) |
| **P3-n** | FE `/danh-gia` moderation | FE | P3-m | Cards (★ + khách + ngày + badge chờ) + tab (Chờ/Đã trả lời/Ẩn) + **reply modal** (native `<dialog>`) → "Lưu & công khai" + ẩn/xoá; `formatVnRating`; empty/loading/error; i18n `reviews.*` |

### Track F — "Everything" thêm (greenfield-nặng, sequence cuối)
| id | title | surface | dependsOn | done-when |
|---|---|---|---|---|
| **P3-o** | Danh mục `/danh-muc` (BE write + FE reorder) | BE+FE | — | `PATCH/DELETE /admin/categories` + reorder (thứ tự hiển thị) + FE list drag-reorder + editor (tên/mô tả/ảnh); empty/loading/error |
| **P3-p** | Khách hàng `/khach-hang` (BE read + FE) | BE+FE | — | `GET /admin/customers` list/detail (contact + social + lịch sử đơn + note); search; **merge-duplicate = DEFER** (flag §7); PDPL: chỉ owner/staff, không lộ ra ngoài; empty/loading/error |
| **P3-q** | Nhân viên/RBAC `/cai-dat/nhan-vien` | BE+FE | — | `GET/POST /admin/staff` invite + role (owner-only) + FE list + **RBAC matrix hiển thị** (owner/staff cố định — không cấu-hình-được); empty/loading/error |
| **P3-r** | Kênh chat + thông báo `/cai-dat/kenh` | FE | — | Toggle kênh (Mess/IG/TikTok = placeholder) + web-orders toggle (wire checkout gate) + notif in-app badge; **Extension-settings section = placeholder read-only** (handshake Phase 4); push thật = Phase 5 |
| **P3-s** | **Vật tư & chi phí** `/vat-tu` — GREENFIELD | BE+FE | (P3-h) | **ADR data-model + migration 000015+** (filament_spools/machine_hours/aux_costs/scrap) + endpoints + FE 4-tab (Filament/Giờ máy/Chi phí phụ/Hao hụt) + **wire filament-deduct vào print-stage→PRINTING** (badge "thiếu nhựa" thật); empty/loading/error. Mini-feature |
| **P3-t** | **Pet-Tag admin** `/pet-tag` — GREENFIELD | BE+FE | (feature-plan riêng) | ✅ **Feature-plan written → [`docs/plans/pet-tag.md`](pet-tag.md)** (Pet-Tag NFC: pet_tags/pet_profiles/encode/activate/lost + stage "Ghi chip NFC" + trang pet). Đã tách khỏi Phase-3; build theo slice t-1..t-5 có merge-gate riêng. Owner đã quyết 3 điểm (storefront-path / admin-mobile Web NFC / email-only) → t-1 (ADR + migration) unblocked |

## 4 · BLOCKERs

- **BLOCKER-A (gate P3-j/P3-l):** model-upload **KHÔNG** dùng được đường P2-c (POST-ảnh ≤10MB). .glb thường >10MB →
  **presigned-PUT multipart** (ADR-005 part<100MB vì CF-Tunnel chặn body>100MB). Đây là **infra greenfield** — cần ADR
  (bucket/CORS/host-pin/part-size) trước khi editor sản phẩm treo lên.
- **BLOCKER-B (gate P3-g/P3-h):** SSE qua cloudflared **phải** smoke-test qua **named tunnel** (buffer/timeout 100s/524 của
  CF ăn mất event nếu thiếu `no-transform`/`identity`/`X-Accel-Buffering:no`/Flusher/heartbeat — `conventions.md` §Realtime).
  Fallback poll (reuse hook P1-o) phải sẵn nếu SSE flaky trên box nhà.
- **BLOCKER-C (gate Track F Vật tư + Pet-Tag):** greenfield data-model → **ADR + migration** trước FE. Migration number
  **>head hiện tại (000013)** — monotonic, cấp số lúc land (memory `lumin-migration-numbering-monotonic`).
- **BLOCKER-D (gate P3-e):** QC-photo cần cột `orders.qc_photo_url` (migration 000014) + đọc trong guard `→SHIPPING`.
  Quyết: cột riêng (chọn) vs nhét jsonb. Cột riêng rõ hơn cho query "đơn thiếu QC".
- **BLOCKER-E (doc-drift, KHÔNG chặn code — spec-sync):** `conventions.md` §57 + `plan.md` §Phase-3 còn ghi **"Cloudflare
  Access trùm Admin"** nhưng **ADR-030 đã chốt self-issued JWT** (và auth **đã build** bằng JWT). Cần PR spec-sync sửa 2
  dòng đó về ADR-030 (CF Access không phải phụ-thuộc; nếu bật chỉ là lớp edge tuỳ-chọn). Không block P3 code (auth chạy đúng).

## 5 · Tightenings (fold vào PR liên quan)

- **RBAC FE ẩn ≠ tường:** FE ẩn/disable nút owner-only theo `Actor.Role` là **UX**, không phải bảo mật — BE `authOwnerOnly`
  + `requireOwner` là tường thật (đã có). spec-guardian soi mọi màn có cạnh money-out/config: staff **không** thấy được
  đường reconcile→PAID / →REFUNDED / STK / staff-invite.
- **next-state đúng nguồn (P3-e):** dropdown "Cập nhật trạng thái" build từ `canTransition(current, to, role)` của `@lumin/core`
  — **KHÔNG** hard-code danh sách (drift với guard). Terminal (COMPLETED/CANCELLED/REFUNDED) → không dropdown.
- **reason bắt buộc (P3-e):** dialog Huỷ/Hoàn **khoá submit** tới khi chọn lý do (mirror BE `OSM-03`); Hoàn thêm
  `refundProofUrl` (upload ảnh D-P3-5). FE nudge, BE 4xx là tường.
- **estimate/tổng chỉ đọc (P3-c/e):** admin hiển thị `total` server đã tính — **ZERO client-math**, `formatVnd` only.
- **codegen staged (mọi BE PR):** `make verify-go` oapi/sqlc stale-check diff working-vs-index → **`git add` api.gen.go +
  schema.gen.ts trước** khi chạy (memory `lumin-oapi-stale-check-needs-staged-regen`; tái diễn mỗi backend codegen sub-PR).
- **acceptance Go-gated `[ ]` (mọi BE PR):** EARS admin (list-RBAC, stage-guard, model-upload, review-publish-non-leak, QC-gate)
  append vào `acceptance.md` + test-id **giữ `[ ]`** — parser `packages/core` fail app-gate nếu `[x]` mà test-id không là TS
  test (memory `lumin-go-ears-stay-unchecked`).
- **SSE fallback poll (P3-h):** reuse `use-order-poll` (P1-o cadence/backoff/visibility-pause) làm fallback — không viết
  poller mới.
- **upload reuse (P3-e/l/n/o):** ảnh QC/review/gallery/category **cùng** `internal/proofstore` presigned-POST (P2-c) — 1 home,
  chỉ mở content-type allowlist + bucket-prefix; **đừng** dựng đường upload thứ 2 cho ảnh.
- **admin-mobile = cùng app (ADR-002):** responsive breakpoint, **KHÔNG** tách route/codebase. Bottom-tab 5 mục + sticky
  action-bar; drag-drop kanban có touch + nút fallback; vuốt-phải=advance-1-bước, giữ=multi-select, kéo-xuống=refresh.
- **filament-warning 2 pha (P3-h→P3-s):** P3-h badge "thiếu nhựa" **static/placeholder**; số thật + auto-deduct đến ở
  P3-s (Vật tư). Đừng chặn kanban chờ Vật tư.

## 6 · Open questions (quyết khi tới PR)

1. **Bulk-status modal (P3-c):** design vẽ "Đã chọn N đơn → Đổi trạng thái". Multi-order transition = N lần
   `POST /transitions` (client loop) hay endpoint bulk mới? *(mặc định: client loop N call, không endpoint mới — lazy;
   revisit nếu N lớn.)*
2. **Settings audit phạm vi (P3-i):** STK có `setting_bank_audit`. Shipping-rules/refund-policy có cần audit không?
   *(mặc định: không — chỉ STK là money-out cao-giá; revisit nếu cần trace đổi phí ship.)*
3. **RBAC matrix cấu-hình-được? (P3-q):** design vẽ ma trận owner/staff. `spec.md` §08 chốt owner/staff **cố định** →
   matrix chỉ **hiển thị**, không cho tick tuỳ biến. *(mặc định: hiển thị-only; custom-role = de-scope.)*
4. **SSE vs poll ở box nhà (P3-g/h):** nếu tunnel-buffering làm SSE flaky, có chấp nhận poll-only cho v1 không?
   *(mặc định: SSE có fallback poll; nếu smoke-test qua tunnel fail nhiều → ship poll-only, giữ SSE sau — ADR-008 cho phép.)*
5. **Pet-Tag tách plan (P3-t):** ✅ **RESOLVED — tách.** Feature-plan `docs/plans/pet-tag.md` written; là feature NFC
   đầy-đủ (4 entity + trang pet public + encode-stage), không phải 1 màn admin. Build đợi owner quyết 3 `[NEEDS CLARIFICATION]`.

## 7 · Nợ chất lượng của plan

- **Scope rất lớn (~20 sub-PR):** "everything" gấp ~3× lõi `plan.md`. Track 0/A/B/C là load-bearing (Done gate roadmap);
  D/E là lõi còn lại; F là greenfield-nặng. **Nếu ngân sách hụt**, cắt từ F ngược lên — F không chặn "vận hành vòng đơn".
- **Vật tư = Spoolman-like mini-ERP:** `plan.md` §Đừng-làm cấm "ERP/fleet-scheduler". P3-s phải giữ **nhỏ** (nhập cuộn
  nhựa + trừ tay/tự-động khi in + chi phí phụ + hao hụt) — **không** thành hệ quản-lý-kho đầy đủ. `ponytail:` ceiling: bảng
  phẳng + trừ-khi-print, nâng khi shop thật cần forecast.
- **Pet-Tag greenfield:** thực chất là feature NFC hoàn chỉnh (encode/activate/lost + trang pet public + stage in mới) →
  P3-t chỉ đặt chỗ; build thật ở feature-plan riêng, đừng để nó phình Phase-3.
- **Extension-settings phụ thuộc Phase 4:** màn "Cài đặt › Extension" trong design vẽ connection/staff-access nhưng
  Extension (Phase 4) chưa tồn tại → P3-r chỉ placeholder; handshake thật khi Phase 4 land.
- **Push notification thật = Phase 5:** design mobile vẽ lock-screen banner (APNs/FCM + service-worker). P3 chỉ in-app
  badge/toast-inline. `ponytail:` — thêm push khi có nhu cầu + hạ tầng notif.
- **Doc-drift CF-Access (BLOCKER-E):** sửa `conventions.md` §57 + `plan.md` §Phase-3 về ADR-030 (spec-sync PR nhỏ, dùng
  van `.allow-contract-edit` cho `conventions.md` vì nó hard-blocked — memory `contract-edit-deliberate`).
- **Live-preview editor (P3-l) = FE nặng:** re-render storefront product-view trong admin. `ponytail:` — reuse component
  storefront thật (đừng viết lại), preview = mount cùng `ProductCard`/product-view với state form.

## 8 · Done criteria

**Lõi (`plan.md` §Phase-3 — Track 0+A+B+C):** owner/staff **đăng nhập** (P3-a) → **dashboard** (đã có) → **xem đơn**
(list+filter, P3-c) → **chi tiết + đổi trạng thái** (1-chạm confirm→PAID owner-only, advance, **huỷ/hoàn có lý do bắt
buộc**, `→SHIPPING` đòi **QC photo + trackingCode**, P3-e) → **hàng đợi in kéo-thả + SSE** (P3-h) → **cài đặt STK
owner-only + audit** (P3-i, để checkout web không bị chặn). Mọi transition qua guard + statusHistory; tiền int-VND chỉ
`formatVnd`; RBAC owner/staff tường BE thật; mọi màn empty/loading/error; **responsive admin-mobile** (bottom-tab + sticky
action + touch kanban); visual-fidelity vs `designs/Lumin Admin*`.

**Full (D-P3-1 "everything"):** thêm sản phẩm (list+editor full+live-preview+model-upload→AssetJob, D/P3-j..l), đánh giá
(moderation+reply, E/P3-m..n), danh mục (P3-o), khách hàng (P3-p, merge defer), nhân viên/RBAC-hiển-thị (P3-q), kênh+thông
báo (P3-r, extension-placeholder), **Vật tư** (P3-s greenfield), **Pet-Tag** (P3-t → feature-plan riêng). Greenfield có ADR
+ migration (>000013). Xương sống slice-3 (auth/transition/dashboard/STK) **KHÔNG** bị chạm — chỉ invoke + treo FE.
