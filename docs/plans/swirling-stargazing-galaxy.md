# Plan — Trang admin quản lý domain (subdomain khách trên *.luminstudio.vn)

## Context

Hiện nay mỗi site khách (kiểu `giangvahieu.luminstudio.vn`) được thêm **thủ công**: sửa Ingress YAML + thêm host trong Cloudflare dashboard theo runbook. Mục tiêu: một trang trong `apps/admin` để owner thêm/xoá subdomain và hệ thống **tự provision** — bấm thêm là core-api tạo Ingress traefik trong ns `prod`, site live ngay (DNS giải quyết một lần bằng wildcard record thủ công). Target trỏ tới chọn từ danh sách Service đang chạy trong ns `prod` (đã chốt với user).

## Quyết định thiết kế (ponytail — DB-less)

- **Ingress LÀ source of truth, không có bảng DB** — không migration, không sqlc, không drift DB↔cluster. List = list Ingress theo label; audit = annotation `luminstudio.vn/created-by` + timestamps của k8s. Thêm bảng chỉ khi cần history/soft-delete sau này.
- **Một Ingress object mỗi domain**: tên `lumin-domain-<sub>`, label `app.kubernetes.io/managed-by: lumin-core-api`. Xoá = delete object, sạch. Spec mirror `infra/k8s/wedding.yaml:119-140` (annotation `traefik.ingress.kubernetes.io/router.entrypoints: web`, `ingressClassName: traefik`, KHÔNG tls — TLS ở Cloudflare).
- **client-go** với `rest.InClusterConfig()`; interface nhỏ + fake cho test; ngoài cluster (local dev) → client nil → các endpoint này trả 503 sạch.
- **Owner-only** cả 4 operation (bề mặt hạ tầng, staff không đụng).
- **Cloudflare: KHÔNG tích hợp API** — một dòng runbook: tạo wildcard `*.luminstudio.vn` CNAME → tunnel, làm tay một lần.

## Các bước

### 1. core-api — package kube (mới)
`services/core-api/internal/kube/kube.go`:

```go
type Client interface {
    ListIngresses(ctx) ([]Domain, error)          // filter label managed-by
    CreateIngress(ctx, sub, svc string, port int32, createdBy string) error
    DeleteIngress(ctx, sub string) error
    ListServices(ctx) ([]ServiceTarget, error)    // tên + ports trong ns prod
}
```

Impl thật wrap `kubernetes.Interface`; khởi tạo ở main từ `InClusterConfig()`, lỗi → log + nil. Fake map-backed cho test. `go get k8s.io/client-go` (+api, apimachinery).

### 2. core-api — API
- `services/core-api/openapi.yaml` (mẫu reply-templates ~1268):
  - `GET /admin/domains` → `listDomains`
  - `POST /admin/domains` → `createDomain` (body: `subdomain`, `targetService`, `targetPort`)
  - `DELETE /admin/domains/{subdomain}` → `deleteDomain`
  - `GET /admin/domains/targets` → `listDomainTargets`
- `make oapi` (nhớ `git add` codegen trước `make verify-go` — gotcha stale-check).
- `services/core-api/internal/httpapi/domains.go`: handler mỏng, giữ `kube.Client` trên server struct; nil → 503 qua envelope. **Validation server-side** (trust boundary): lowercase, regex `^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`, reserved set `{www, admin, api, s3, assets, wedding-assets, giangvahieu}` → 400; đã tồn tại → 409; delete từ chối tên không mang label managed-by (chỉ đụng `lumin-domain-*`).
- `middleware_auth.go` classify(): 4 operationId → case `authOwnerOnly`.
- ⚠️ Gotcha ARM: nếu selftest CI grep tên seam, kiểm tra `guard.test.sh` sau khi thêm symbol mới.

### 3. RBAC + deploy
Append vào `infra/k8s/core-api.yaml`: `ServiceAccount core-api` + `Role` (ns prod; `ingresses`: create/get/list/delete; `services`: get/list) + `RoleBinding`; thêm `serviceAccountName: core-api` vào podspec. Deploy workflow đã apply file này — không sửa workflow.

### 4. apps/admin
- Regen `packages/api-client` từ openapi (chạy `pnpm --filter @lumin/storefront typecheck` trực tiếp nếu schema đổi — gotcha Turbo cache; ở đây chỉ additive nên ít rủi ro).
- `src/lib/domains-fetch.ts` + `src/lib/domains-actions.ts` — copy y hình `settings-fetch.ts`/`settings-actions.ts` (adminClient + cookie forward + no-store; `'use server'` + `codeFor(status)`, map 503 → key "cluster unavailable").
- `src/app/(app)/ten-mien/page.tsx` (server fetch domains + targets) + `src/components/domains-view.tsx` (client: bảng domain, form thêm với input subdomain + select target từ Services, xoá có confirm — hand-built, @lumin/ui primitives, đủ empty/loading/error).
- `src/components/sidebar.tsx`: thêm item `/ten-mien`; `src/messages/vi.ts`: key `nav` + section `domains` (label, lỗi reserved/duplicate/cluster-unavailable) — sentence case, không hard-code text. Test unit đặt trong `apps/admin/test/` (gotcha vitest include).

### 5. Docs
- `infra/k8s/README.md`: runbook mới — one-time wildcard CF record; thêm/xoá subdomain từ giờ qua admin `/ten-mien`.
- `docs/decisions.md`: **ADR-054** — core-api được cấp k8s API ns-scoped (SA+Role), Ingress per-domain là source of truth (DB-less), owner-only. ⚠️ File edit-guarded — cần valve `.allow-contract-edit`, trình text + xin opt-in riêng, không bundle.

## Tests
`internal/httpapi/domains_test.go` với fake client: create happy path · subdomain sai/reserved → 400 · duplicate → 409 · delete tên không managed → từ chối · nil client → 503 · staff → 403. Admin: messages test + view test cơ bản.

## Verification
- **Local**: `make oapi && go test ./...` (core-api); admin `pnpm build` + test; chạy admin với local core-api → trang `/ten-mien` render trạng thái 503/"cluster unavailable" sạch (không cluster).
- **Box-gated** (sau deploy): `kubectl -n prod get sa,role,rolebinding | grep core-api` → thêm domain `test-web` trong admin → `kubectl -n prod get ingress lumin-domain-test-web` → (sau wildcard DNS) `curl https://test-web.luminstudio.vn` → xoá trong admin → ingress biến mất.

## Skipped (thêm khi cần)
Bảng DB/history · custom domain khách tự mang · Cloudflare API · TLS/cert-manager · reconcile job · status enum.
