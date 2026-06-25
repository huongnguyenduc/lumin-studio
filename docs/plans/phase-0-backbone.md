# Plan triển khai — Phase 0 backbone (`packages/tokens` + `packages/core` + arm harness)

> **Status: DONE (slice này)** trên nhánh `feat/phase-0-backbone` — `pnpm verify` rc=0 · guard.test 139/0 ·
> osm-mutation 22/0. Bản ghi triển khai (ADR-027 plansDirectory). Khung: [`../templates/implementation-plan.md`](../templates/implementation-plan.md).

## 0. Tóm tắt
- **Mục tiêu:** dựng nền monorepo + xương sống miền dùng chung 4 bề mặt, và **arm** mọi gate harness gắn với `packages/core`.
- **Surface chạm:** core/BFF — `[x] packages/core` `[x] packages/tokens`. (UI/app/services: phase sau.)
- **ADR liên quan:** ADR-010 (pay-then-confirm/owner-only) · ADR-017 (bỏ district) · ADR-019 (một formatter tiền) · ADR-020/021 (stack + harness) · ADR-027 (mutation→money, property-test, plan/PR).
- **Spec nguồn:** `/spec.md §02` (data model) · `§04` (state machine) · `§05` (microcopy). **Acceptance phủ:** OSM-01..05 · MNY-01..03 · CHK-01..03 (đã tick `[x]`).

## 1. Global constraints (verbatim — `docs/conventions.md`)
- **statusHistory:** mọi đổi `OrderStatus` qua transition guard `packages/core` + append đúng một `{from,to,at,byUser,reason?}`; `reason` bắt buộc `CANCELLED`/`REFUNDED`; `REFUNDED` kèm `refundProofUrl`.
- **Tiền:** int VND; `subtotal/shippingFee/total` tính ở server, không tin total client; một formatter `packages/core` → `390.000₫` (U+20AB, không space); cấm `Intl.NumberFormat`/`toLocaleString` ngoài core (ESLint).
- **i18n:** không hard-code chuỗi; default `vi`, tách khoá từ commit đầu.
- **A11y:** primary action KHÔNG trắng-trên-flame-500 (FAIL 2.82:1) → dùng **flame-700** (5.12:1) / cocoa-on-sun; khoá semantic alias. ISO-8601 UTC · sentence case · reduced-motion.

**Giá trị spec đặc thù (khoá):** xem bảng transition `spec.md §04` (đã cài đúng trong `order-state.ts`). Address = `{province, ward, street}` (no district). channel = `web | inbox` (zalo hoãn về data-model task).

## 2. Interfaces — Produces
| Loại | Signature | File |
|---|---|---|
| Enum/guard | `OrderStatus·Role·Channel·TERMINAL_STATUSES·canTransition·transition·initialStatusForChannel·replayStatus·TransitionError` | `packages/core/src/order-state.ts` |
| Money | `formatVnd·parseVnd·calcTotals` (sole Intl site) | `packages/core/src/money.ts` |
| Zod | `OrderSchema·OrderItemSchema·AddressSchema·CustomerSchema·CreateWebOrderInput·StatusEventSchema·channelEnum·orderStatusEnum·roleEnum·intVnd` | `packages/core/src/schemas.ts` |
| i18n | `vi·messages·defaultLocale` · `formatVnDate·formatVnNumber` | `packages/core/src/i18n/*` |
| Theme | `theme·palette·color·space·radius·shadow·fontFamily·fontSize·luminPreset` + `tokens.css` | `packages/tokens/src/*` |

## 3. Bản đồ file (đã tạo)
```
package.json·pnpm-workspace.yaml·turbo.json·tsconfig.base.json·eslint.config.mjs·.prettierrc·.prettierignore
packages/tokens/{package.json,tsconfig.json,vitest.config.ts,src/{tokens.css,theme.ts,preset.ts,index.ts},test/tokens.contrast.test.ts}
packages/core/{package.json,tsconfig.json,vitest.config.ts,src/{order-state.ts,money.ts,schemas.ts,i18n/{vi.ts,formatters.ts},index.ts},
  test/{order-state,money,checkout,i18n.sentence-case,acceptance.ledger}.test.ts}
```
Sửa: `tests/harness/osm-mutation.test.sh` (real-arm OSM+money) · `docs/acceptance.md` (tick `[x]`) · `docs/active-context.md`.

## 4. Tasks (đã làm — mỗi task code chạy + test xanh)
1. Monorepo skeleton — root scripts (`verify`=lint+typecheck+test+format:check; `typecheck`/`test` qua turbo). ESLint Intl-ban (override exempt `packages/core/**`). ✅
2. `packages/tokens` — copy token verbatim + a11y primary fix (flame-700) + Tailwind preset + contrast test. ✅
3. order-state — bảng §04 + RBAC + statusHistory; anchor `#EDGES/#GUARDMATCH/#GUARDCALL/#REASON/#HISTORY` cho mutation gate; OSM-01..05 + property replay. ✅
4. money — `formatVnd/parseVnd/calcTotals`; anchor `#GROUP/#SUBTOTAL/#TOTAL`; MNY-01..03 + round-trip + sum==total property. ✅
5. schemas + i18n — Zod (no district, int VND, CHK-03 ack) + vi catalog + sentence-case test. ✅
6. `acceptance.ledger.test.ts` — parse `docs/acceptance.md`; `[x]` ⇒ ref test phải resolve; pin OSM-02/MNY-03. ✅
7. Arm `osm-mutation.test.sh` — real-mutation-arm: mutate file nguồn → assert test ĐỎ → restore (skip rõ khi vắng node_modules). ✅

## 5. No-placeholders
Không stub/TODO trong path "done". Literal output chỉ ở `packages/core`. Mục hoãn (test:e2e, ui, apps, services, GPU) **không tạo** — không stub.

## 6. Verification
`pnpm install` → `pnpm verify` (rc=0) → `bash tests/harness/guard.test.sh` (139/0) → `bash tests/harness/osm-mutation.test.sh` (22/0). Review: spec-guardian (compliance) + adversarial reviewers (state-machine vs §04, money, harness-green, contract). Commit/PR để chủ quyết.

## Self-review vs spec
- [x] Phủ §04 transition table (mọi from×to×role) + §02 data model (subset backbone) + §05 microcopy keys.
- [x] 4 luật always-must đúng ở mọi file (statusHistory append · money một-formatter · i18n key · — reduced-motion ở tokens.css).
- [x] Acceptance OSM/MNY/CHK tick có test pass thật (không skip/special-case); mutation gate chứng minh test ràng buộc.
- [x] RBAC: staff không reconcile→PAID / không refund (OSM-04/05).
- [ ] UI visual-fidelity — N/A slice này (chưa có màn UI); áp khi `packages/ui`/apps land.
