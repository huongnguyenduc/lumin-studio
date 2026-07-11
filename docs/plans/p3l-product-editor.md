# P3-l — FE product editor `/san-pham/{id}` + `/san-pham/moi`

> Implementation plan for the Track-D product editor. Fills the two dead seams P3-k left
> (`card → /san-pham/{id}`, `+ Thêm → /san-pham/moi`).
>
> **⚠️ REFRAMED 2026-07-11 — this is now Stage 5 of an epic.** The owner chose to BUILD the four
> features §1 originally deferred, not cut them. So the FE editor is downstream of BE model work:
> **Stage 1** ADR-037 (parts + option sub-choices — DONE, see `docs/decisions.md` + spec §02) ·
> **Stage 2** BE parts/choices (catalog + pricing + order capture + storefront/print consumers) ·
> **Stage 3** BE 3D-alignment metadata · **Stage 4** P3-s material standards · **Stage 5** = THIS
> editor, consuming stages 1–4. The §1 "cuts" below are NO LONGER cuts — they're the stages above.
> §2–§8 (contract reuse, live-preview, create-flow, files) still describe the Stage-5 FE editor and
> will be refreshed once stages 2–4 land the endpoints it consumes.

## 0 · One-line
An owner-facing editor that creates/edits a product against the current catalog contract, with a
live customer-style preview — deliberately scoped to **what the API can store**, not the full
aspirational design.

## 1 · The design↔contract gap (READ FIRST)
`designs/Lumin Admin - Hi-fi.dc.html` (editor, screen 4) shows a far richer editor than the P3-j
data model supports. The contract is the wall; P3-l ships what it can back and defers the rest.

| Design shows | Contract reality | P3-l does |
|---|---|---|
| **Colors grouped under named PARTS** (Chao đèn / Đế / Nút bấm) | `Color` is a **flat** list per product `{name,hex,available,priceDelta}` — no "part" concept | **Flat color list.** Parts-hierarchy deferred (needs new table + migration + ADR) |
| **Options with enumerated sub-choices** (Kích thước → S/M/L rows w/ descriptions) | `Option` is a **single row** `{label,type,priceDelta,maxChars}` — no enumerated choice-set | **Flat option list**, one row each. Choice-sets deferred (data-model change) |
| **"Định mức vật tư in"** (filament weight / waste / consumption per size) | No such field anywhere | **Dropped** — this is **P3-s (Vật tư)** greenfield (migration 000015+, own ADR) |
| **3D alignment** (rotate X/Y/Z, default-view Front/Back/…, size slider, "lưu góc mặc định", part-highlight-on-model) | No contract field persists view/rotation; `model_ingest` worker normalizes geometry | **Dropped** — model section = upload + status + view only, no alignment knobs |
| Separate **"Xem trước"** customer screen | — | Covered by the inline live-preview column; full preview-mode deferred |

**These cuts are not optional at the FE layer** — building them means BE + migration + ADR work
that belongs to P3-s or a future data-model ADR. Documented so spec-guardian sees them as
deliberate. Each gets a `ponytail:` comment pointing at the upgrade path.

## 2 · Contract P3-l consumes (all merged: #73 P3-j-a, #74 P3-j-b)
Owner-only writes (BE `authOwnerOnly` = the real wall); owner+staff reads.

- `GET /admin/products/{id}` → full `Product` {…, `dimensions`, `material`, `model3dUrl`, `images[]`, `colors[]`, `options[]`, `status`}.
- `POST /admin/products` → `ProductInput` {slug, name, description?, categoryId, basePrice, dimensions{w,d,h}, material, images?, status} → 201 `Product` (empty colors/options).
- `PATCH /admin/products/{id}` → `ProductInput` → 200. **Excludes `model3d_url`** (worker-owned).
- `DELETE /admin/products/{id}` → 204, or **409 `PRODUCT_IN_USE`** (archive instead).
- Colors: `POST/PATCH/DELETE /admin/products/{id}/colors[/{colorId}]` — `ColorInput` {name, hex, available, priceDelta?}.
- Options: `POST/PATCH/DELETE /admin/products/{id}/options[/{optionId}]` — `OptionInput` {label, description?, type(text|choice), priceDelta?, maxChars?}.
- Model: `POST /admin/products/{id}/model-upload` (presigned **POST**, `model/gltf-binary|model/stl|model/3mf`, ≤100MB) → {uploadUrl, fields, finalUrl, maxBytes}.
- Asset job: `POST /admin/products/{id}/asset-jobs` — `AssetJobInput` {jobType(`model_ingest`|`sprite_render`), sourceModelUrl(**must be finalUrl, host-pinned**), sourceVersion(hex 8-128)} → 201 `AssetJob`.
- `GET /admin/products/{id}/asset-jobs` → `AssetJob[]` (status `queued|processing|ready|failed`).
- Category dropdown: **reuse public `GET /categories`** → `Category[]` {id,slug,name}.

### Validation (mirror BE, 400 field-map — FE nudges, BE is the wall)
name 1-200 · slug `^[a-z0-9]+(?:-[a-z0-9]+)*$` ≤200 · desc ≤10k · basePrice/priceDelta int-VND ≥0 ·
dims w/d/h>0 · material∈{PLA,PETG,recycled-PLA} · status∈{active,draft,archived} · hex `^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$` ·
option type∈{text,choice} · maxChars>0 or null.

## 3 · Reuse map (don't rewrite — ponytail §229)
- **RSC fetch cookie-forward**: clone `products-fetch.ts` → `product-detail-fetch.ts` (`GET /admin/products/{id}`) + `categories-fetch.ts`.
- **Server Actions**: mirror `order-actions.ts`/`settings-actions.ts` shape `{ok:true}|{ok:false;code}`.
- **Image upload**: reuse `upload-proof.ts` verbatim for gallery (`image/jpeg|png|webp`, `/checkout/payment-proof-upload`). `ponytail:` product images share the proofs bucket-prefix; dedicated admin image endpoint is a later refinement.
- **Model upload**: new `upload-model.ts` = `upload-proof.ts` with `model/*` types + the `/admin/products/{id}/model-upload` endpoint; after POST, compute `sourceVersion = SHA-256 hex` of the file via `crypto.subtle.digest` → enqueue asset-job.
- **Live preview 3D**: reuse storefront `Model3dViewer` (+`@google/model-viewer` — **1 new dep** in admin, already vetted in storefront v4.3.1). `EngraveField` reusable if we surface engraving preview. **NOT** `ProductDetail` (cart/router-coupled) — build a thin `product-preview.tsx` from draft state.
- **Form/feedback**: settings `BankAccountSection` template (`useState` fields + `useTransition` + `Feedback` "Đã lưu 🧡"). UI primitives: `Input`/`Button`/`Card`/`Badge`/`Switch`/`Checkbox` (`@lumin/ui`) + native `<select>`/`<textarea>`/native `<dialog>` (from `transition-dialog.tsx`).
- **Money**: `formatVnd` (`@lumin/core`) display only, raw int-VND inputs, ZERO client-math.
- **i18n**: extend `products.*` in `messages/vi.ts`.
- **RBAC**: FE hardcodes owner (P3-e/i precedent, no `/auth/me` until P3-q); BE owner-only is the wall.

## 4 · Live preview (honest version)
Storefront's product-view does **not** swap images per color (static gallery + on-demand 3D). So the
preview is a thin admin component reading **draft form state**: cover+thumbnails (images[]), name,
`formatVnd(basePrice)`, color swatches (click → highlight, show priceDelta), options list, dims/material,
and `Model3dViewer` on `model3dUrl` once the asset-job reaches `ready`. Selecting a color/option is
presentational (preview-local state). No per-color photo swap (neither does storefront).

## 5 · Decisions (confirm before build)
- **D1 — scope cuts (§1):** defer parts-hierarchy, option sub-choices, material-standards (P3-s), 3D-alignment. *Default: defer all 4; expanding any means BE+migration+ADR, out of FE-only P3-l.*
- **D2 — create flow:** `/san-pham/moi` collects **core fields only** → POST → redirect to `/san-pham/{id}` where colors/options/model become editable. *Default: yes (API grain = product is aggregate root, sub-resources need an id; avoids client-side multi-call partial-save).* Alt: one-shot orchestrated create.
- **D3 — sub-resource persistence:** colors/options save **immediately per row** (POST/PATCH/DELETE on edit), like P3-i reply-templates. *Default: yes (no client-diff/batch engine).* Core fields save via the main "Lưu sản phẩm" (PATCH); gallery images save with the product.
- **D4 — slicing:** **l-1** core CRUD + gallery (no new dep, ~10-12 files, fills the seams with a working create/edit) → **l-2** colors + options + model→asset-job + live preview (+1 dep, ~10 files). *Default: 2 slices (P3-j a/b precedent, keeps each PR reviewable).* Alt: one PR (~20 files, P3-e-sized).

## 6 · Known limitations (flag, not blockers)
- Category dropdown = public `GET /categories` → only categories with ≥1 **active** product; empty/draft-only categories won't appear, and a product whose current category isn't listed shows its `categoryId` as fallback. Full `GET /admin/categories` = **P3-o**. Fine for seeded data.
- Model preview renders `model3dUrl` (worker output) — raw pre-ingest `.glb` preview + `.stl/.3mf` (not glb) skipped; show processing status until `ready`. `ponytail:` add raw-preview if owners want instant feedback.
- Asset-job status = poll `GET .../asset-jobs` while `queued|processing` (reuse the P3-h poll cadence idea; no SSE for asset jobs).

## 7 · Files (l-1 / l-2, assuming D4=2-slice)
**l-1:** `lib/product-form.ts` (pure adapters wire↔form + validation) + `test/product-form.test.ts` · `lib/product-detail-fetch.ts` · `lib/categories-fetch.ts` · `lib/product-actions.ts` (create/update/delete Server Actions) · `components/product-editor.tsx` (core form client island) · `app/(app)/san-pham/moi/page.tsx` · `app/(app)/san-pham/[id]/{page,loading}.tsx` · reuse `upload-proof.ts` for gallery · `messages/vi.ts` (+`products.edit.*`) · `docs/acceptance.md` (FE `[ ]`).
**l-2:** `components/product-colors.tsx` · `components/product-options.tsx` · `components/product-model.tsx` (upload+asset-job+status) · `lib/upload-model.ts` + SHA-256 helper + test · `lib/color-actions.ts`/`option-actions.ts`/`asset-actions.ts` · `components/product-preview.tsx` (+ copy `model-3d-viewer.tsx`) · `apps/admin/package.json` (+`@google/model-viewer`) · `messages/vi.ts` (+colors/options/model) · acceptance rows.

## 8 · Done-when
Each slice: `pnpm verify` 6/6 (lint·typecheck·admin test·format) · `next build` green · empty/loading/error present ·
per-field validation mirrors BE · money `formatVnd` only · i18n keyed · reduced-motion respected ·
spec-guardian PASS · (l-1) create→edit→list→delete round-trips against real stack · (l-2) color/option CRUD +
model upload→asset-job→status + preview reflect edits live. `acceptance.md` FE rows stay `[ ]`.
