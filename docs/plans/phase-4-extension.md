# Browser Extension — feature-plan (Phase 4)

> **Behavior source of truth = [`/spec.md` §Extension](../../spec.md) (the 4-screen table) + [`plan.md` §Phase 4](../plan.md).**
> This plan grounds them against the real codebase, sequences the build into merge-gated slices, and
> names the decisions the owner locked **before** any code slice starts.
>
> **Hard guardrail = [ADR-011](../decisions.md) (assistive-only).** The extension **never** reads or writes
> the Meta DOM (scrape/inject = Meta Platform Terms violation → existential sales-account ban). It **only**
> calls the core-api BFF. The hi-fi design (`designs/Lumin Extension - Hi-fi.dc.html`) predates ADR-011 and
> shows the *full-automation* vision (auto-scan chat, auto-fill from FB profile, inject into compose box) —
> **all of that is out**; see §3.

## 0 · One-line
A Chrome **MV3 side-panel** (`chrome.sidePanel`, docks beside Messenger/IG) that lets staff/owner, **by hand**,
create an inbox order (born `PAID`), look up an order by pasted code + do a quick status update, and copy a
reply template — talking **only** to the BFF. No DOM contact. **Money-free, migration-free, outbox-free.**

## 1 · What already exists (de-risks — DON'T rebuild)

The BFF is ~90% ready. Only **one** new endpoint (staff lookup-by-code) + **one** auth change (accept Bearer).

| Need | Reality in repo | Consequence |
|---|---|---|
| **Staff login** | **BUILT** — `POST /auth/login` (email+password) → `bcrypt` verify → HS256 JWT in `lumin_session` httpOnly cookie (`SameSite=Strict`); `POST /auth/logout` clears it. Middleware maps `sub`→`users.role`→`order.Role`. | Reuse login. **But** `SameSite=Strict` + no CORS ⇒ an extension can't reuse the cookie cross-site → **Bearer** handshake (D1 / ADR-043). |
| **Create inbox order** (born PAID) | **BUILT** — `POST /orders` `channel=inbox` (auth-optional route + **staff/owner gate in handler** → `403` if no actor). Totals computed **server-side**; body sending `total`/`subtotal`/`unitPrice` is rejected `400`. | Reuse verbatim. Extension form → this endpoint. Actor = the logged-in staff (from Bearer). |
| **Order detail** | **BUILT** — `GET /admin/orders/{id}` (by **uuid**), full internal projection (PII, money, proof, `statusHistory`). | Reuse for the lookup card **once we have the id**. |
| **Lookup by code** (`#LMN-…`) | **❌ MISSING** — staff paste a *code*, not a uuid. Only public `GET /orders/lookup?code=&phone=` (needs phone) exists. | **New**: `GET /admin/orders?code=` filter (or `GET /admin/orders/by-code/{code}`), owner+staff. Small. Slice **e-3**. |
| **Quick status update** | **BUILT** — `POST /orders/{id}/transitions` (`to`+`reason?`+`refundProofUrl?`+`trackingCode?`+`qcPhotoUrl?`), RBAC-gated (`→PAID`/`→REFUNDED` owner-only). | Reuse. Valid next-states come from **`canTransition(current, to, role)` in `@lumin/core`** — same source as admin P3-e. Zero re-implemented state math. |
| **Reply templates** | **BUILT** — `GET /admin/reply-templates` (owner+staff read); `{token}` vars derived server-side. | Reuse (read-only in the extension; CRUD stays in Admin P3-i). Slice **e-4**. |
| **Money formatter** | **BUILT** — `formatVnd` in `@lumin/core`. | Extension shows server `total` only (`formatVnd`), **zero client math** (conventions always-must #2). |
| **Design tokens / primitives** | **BUILT** — `@lumin/tokens` (Tailwind preset) + `@lumin/ui` (Button/Badge/Input…). | Extension is a Vite+React app that imports them. No new token set. |

## 2 · Owner decisions — RESOLVED 2026-07-13 (e-1 unblocked)

| # | Decision | Choice |
|---|---|---|
| **D1 · Auth handshake** | How the MV3 extension authenticates to the BFF (ADR-030 left this "Mở"). | **Bearer token via login** → **ADR-043.** Extension calls `POST /auth/login` itself; login **also returns the JWT in the response body**; extension stores it in `chrome.storage.local` (extension-sandboxed, not web-reachable); sends `Authorization: Bearer <jwt>` on every call. Middleware accepts **Bearer OR cookie**; `host_permissions` on the core-api origin handles CORS. Admin SPA stays **cookie-only** (unchanged). Rejected: pairing-code (more infra, no need yet — revisit if per-device revocation is wanted), cookie-reuse (SameSite/3p-cookie fragile). |
| **D2 · v1 scope** | How much lands in the first push. | **Create-order + Lookup first.** Order: `e-1` shell+auth → `e-2` create → `e-3` lookup (the plan's "Done" = *tạo đơn inbox + tra đơn từ panel*) → `e-4` reply-templates + toolbar as **follow-up**. |
| **D3 · Panel surface** | Content-script injection vs native side panel. | **Native MV3 side panel** (`chrome.sidePanel`, Chrome 114+). An extension page docked beside the tab — **cannot** touch Meta DOM by construction (strongest ADR-011 posture). No content scripts. `host_permissions` = **core-api origin only** (not messenger.com/instagram.com). |
| **D4 · Assistive-only reconciliation** | Design shows auto-scan/auto-fill/inject. | **All dropped** (ADR-011). Manual entry + **paste** the code + **copy-to-clipboard**. Same 4 screens, "auto" affordances become manual. See §3. |

## 3 · Design ⇄ ADR-011 reconciliation (deliberate deviations from the hi-fi)

The hi-fi is the visual/copy reference (layout, tokens, Vietnamese strings — **keep these**). These *behaviors* are replaced:

| Hi-fi shows (❌ Meta-DOM) | Extension does (✅ BFF-only) |
|---|---|
| Auto-scan chat for order code (`TÌM THẤY` badge) | Staff **pastes** the code/link into an input; we parse `#LMN-xxxx` / `…/o/LMxxxx` client-side |
| Auto-fill name/phone/address from chat (`● tự nhận` / `● tự lưu`) | Staff **types** them (or pastes). No red "auto-detected" fields |
| Auto-fill product/variant from conversation | Staff **picks** product + variants from the catalog (fetched from BFF) |
| "Chèn trạng thái vào chat" / "Chèn ↵" (inject into compose box) | **Copy to clipboard** — staff pastes into Messenger themselves |
| "Đang ở: google.com — ngoài phạm vi" domain guard | Optional friendly hint from `chrome.tabs` active-tab URL (a permission read, **not** DOM scraping). Purely cosmetic; can drop |

Kept from the design: 382px panel, tab nav (Tạo đơn / Tra cứu / Mẫu), colors (`#492F10` brown, `#FF6B4A` action, status-badge palette), all Vietnamese copy, empty/error states, toolbar popup quick-actions.

## 4 · Build slices (each = one user-merge-gate PR — mirrors the Pet-Tag / ADR-039 cadence)

| # | Slice | Surface | Depends | Done-when |
|---|---|---|---|---|
| **e-1** | **Shell + build tooling + auth (Bearer)** | Ext + BE | — | **New app `apps/extension`** (Vite + `@crxjs/vite-plugin` + React, MV3 side panel); pnpm-workspace + Turbo `build`→`dist/**` + ESLint(jsx-a11y/i18next) + tsconfig wired; imports `@lumin/tokens`/`@lumin/core`/`@lumin/ui`; `messages/vi.ts` + tiny `t()` (vi-only, no next-intl runtime). **BE (ADR-043):** auth middleware accepts `Authorization: Bearer` **or** cookie; `POST /auth/login` returns `token` in body (Admin cookie path untouched). Screens: **Login** (email+pw → store token) + **Standby/domain-hint** + toolbar popup shell. Done: load-unpacked → log in → token in `chrome.storage.local` → an authed call (e.g. `GET /admin/reply-templates`) returns 200. empty/loading/error(wrong-pw, offline) |
| **e-2** | **Quick-create inbox order** (highest value) | Ext | e-1 | Screen "Tạo đơn": manual form — customer name/phone (regex mirror BE `^(0\|\+84)\d{9}$`)/address (province/ward/street, **no district** ADR-017); product picker + variants (color=part id, options=optionId→choiceId) from catalog fetch; qty; staff note. → `POST /orders {channel:inbox}` → server total → toast **"Đã tạo đơn #LMN-xxxx 🎉"**. Money = server `total` via `formatVnd`, **zero client math**. Validation mirrors BE; empty/loading/error(missing field, product unavailable, no-shipping-rule) |
| **e-3** | **Order lookup + quick status update** | Ext + BE | e-1 | **BE:** new **staff lookup-by-code** (`GET /admin/orders?code=` or `/by-code/{code}`, owner+staff, Go test). Ext screen "Tra cứu": paste code/link → parse → fetch order → detail card + 5-step progress + **valid transitions from `canTransition`** (role from token) → `POST /orders/{id}/transitions` (reason dialog for CANCELLED, refundProof for REFUNDED — reuse admin dialog logic) → **copy status message to clipboard**. empty/not-found/error |
| **e-4** *(follow-up)* | **Reply templates + toolbar polish** | Ext | e-1 | Screen "Mẫu": `GET /admin/reply-templates` → list + client search → **copy-to-clipboard** (vars left as `{tên}`/`{mã đơn}`/`{STK}` for staff to fill; no server categories → **drop the Chat/CK filter tabs**, ponytail). Toolbar popup quick-actions (Tạo đơn / Tra cứu / Mẫu deep-links). "Thêm mẫu" = link to Admin (CRUD stays there) |

**Sequencing:** e-1 → e-2 → e-3 → (e-4 later). e-2 has no BE dependency (ship first for a fast win); e-3 carries the one BE addition.

## 5 · Global constraints that bite here
- **ADR-011 is load-bearing, not advisory.** No content script on Meta domains; no `document`/DOM access to chat; `host_permissions` = core-api origin only. Any reviewer flag here is a **blocker**.
- **Sentence case, warm voice, "chúng mình/bạn"** (CLAUDE.md §6). VND `315.000₫`. i18n keys from the start (`messages/vi.ts`), no hard-coded strings (ESLint i18next armed globally).
- **`prefers-reduced-motion`** honored (toasts, panel transitions).
- **statusHistory** is written **server-side** by the transition endpoint — the extension never fabricates it; it just POSTs the transition. Money/state stay on the server.
- **a11y:** panel is a real DOM UI → ≥44px touch targets, `role`/`aria` on tabs+switches, AA contrast (the `#FF6B4A`-on-white action button needs a contrast check — mirror the token flame-700 fix, conventions §A11y).
- **Bearer token = secret in `chrome.storage.local`.** Never log it; clear on logout; short TTL from the same issuer config.

## 6 · Out of scope (defer — `ponytail:` upgrade paths)
- **Any chat auto-detection / auto-fill / compose-injection** — ADR-011, permanent (not deferred — *forbidden*). If volume ever forces automation: Zalo OA / Messenger official API (ADR-011 fallback), never DOM.
- **Payment-receipt verification panel** (design's "Xác nhận CK") — inbox orders are born PAID (staff already checked money), so no in-extension reconcile. Defer.
- **Pairing-code auth** (D1 alt) — build only if per-device revocation becomes a need.
- **Camera QR scan** (plan.md "quét paste/camera") — paste covers v1; camera = `e-4`+ if asked.
- **Instagram/TikTok deep-links in toolbar** — cosmetic; add when the shop actually runs those channels.

## 7 · Cross-refs
- Behavior: [`/spec.md` §Extension](../../spec.md) (4-screen table), §04 state machine (shared enum).
- Guardrail: [ADR-011](../decisions.md) (assistive-only) · auth handshake → **ADR-043** (written at e-1).
- Reuse: `@lumin/core` (`canTransition`, `formatVnd`) · `@lumin/tokens` · `@lumin/ui` · `POST /orders` (P2) · `/admin/orders*` (P3-b/d) · `/orders/{id}/transitions` (P3-e) · `/admin/reply-templates` (P3-i).
- Design: `designs/Lumin Extension - Hi-fi.dc.html` + `…Wireframes.dc.html` (visual/copy only — behaviors per §3).
