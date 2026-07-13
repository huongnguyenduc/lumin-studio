# Pet Tag NFC — feature-plan (P3-t)

> **Split confirmed** (phase-3-admin open-Q #5, default = tách). Pet Tag is a **full greenfield feature**
> — new product type, 4 entities, a public per-pet page, an NFC-encode print stage, activation +
> onboarding, PDPL location-sharing — **not one admin screen**. So it lives here, not inside Phase-3
> (`plan.md` §7: *"đừng để nó phình Phase-3"*). P3-t within Phase-3 is **just this doc + the cross-ref**.
>
> **Behavior source of truth = [`/spec.md` §10](../../spec.md).** This plan does **not** re-transcribe it —
> it grounds §10 against the real codebase, sequences the build into merge-gated slices, and names the
> decisions that need the owner **before** any code slice starts. Read §10 first.

## 0 · One-line
A 3D-printed NFC pet ID tag: bought as a normal storefront product, then **tap-to-open a per-pet page**
(`/t/{shortId}`) with 3 view-states + a lost-mode rescue switch. Admin gets an NFC-encode print stage and
a tag roster.

- **Surfaces:** ✅ Storefront (product + pet page + onboarding) · ✅ Admin (encode stage + `/pet-tag`) · ✅ Admin Mobile (encode + tag tab) · ⬜ Extension
- **BFF/core:** ✅ core-api (Go) — 4 new tables + endpoints · ⬜ packages/core (no OrderStatus change — tag lifecycle is **separate** from §04) · ⬜ asset-worker
- **ADR to write:** **ADR-04x — Pet Tag data model + NFC-encode stage + pet-page routing** (slice t-1; formalizes spec §10 "Quyết định đã chốt"). None to relitigate yet.
- **Spec:** `/spec.md §10` · **Design:** `designs/Lumin Pet Tag - Hi-fi.dc.html` (pet page) · `designs/Lumin Admin*- Hi-fi.dc.html` #9 (encode stage + tag roster)

## 1 · What already exists (de-risks — DON'T rebuild)
Grounded against the tree, not the spec's assumptions. Two would-be blockers are already handled:

| Need | Reality in repo | Consequence |
|---|---|---|
| **Customer login** (activation = "login → tag auto-attaches") | **BUILT** — P1-r/P1-s: realm-isolated storefront-customer session JWT (`customerAuth`/`WithCustomerAuth`, `CustomerCookieName`, `internal/auth`), **email+password** login at `/tai-khoan/dang-nhap` (`login-form.tsx` → `loginCustomer` Server Action). | Reuse verbatim. **No Google OAuth** exists → spec's "Google/email" ships **email-only**; Google = separate build, deferred (see D2). |
| **NFC-encode print stage** | **Schema anticipated it** — `000006_jobs.up.sql:19-20`: *"Pet Tag's future NFC-encode stage has no order-status twin (a later `ALTER TYPE print_stage ADD VALUE`)"*. Enum today = `NEED_PRINT/PRINTING/PACKING/SHIPPED`. | Add one enum value between `PRINTING` and `PACKING`, **only for `nfc_tag`** products. Kanban (P3-h) renders columns from stages → touches `groupByStage`/`nextStage`/`print-board.tsx`. |
| **Public capability-token route** | Precedent: `/o/[handle]` = order tracking deep-link (P2-g, bearer-token, `robots:noindex`). | Pet page `/t/{shortId}` is the same shape (public, per-record, noindex). Reuse the pattern. |
| **Image upload** | `internal/proofstore` presigned-POST (P2-c), reused by QC/review/gallery (phase-3 §194). | Pet photo + gallery + theme bg reuse it — **don't** build a 2nd upload path. |
| **Migration head** | **000022** (`000022_category_menu_fields`). Plan's stale BLOCKER-C says "000013". | Pet Tag migrations = **000023+**, numbered **at land** (monotonic, memory `lumin-migration-numbering-monotonic`). |
| **product_type** | No enum/column yet — greenfield. | `ALTER products ADD COLUMN product_type` + enum `standard\|nfc_tag`; default `standard` so every existing product is untouched. |

## 2 · Owner decisions — RESOLVED 2026-07-12 (t-1 unblocked)
All three gating decisions locked to the lazy default. To be recorded in ADR-04x (slice t-1).

- **D1 — pet page URL:** ✅ **Storefront path now.** Serve `/t/{shortId}` on the **existing storefront app** + current Cloudflare tunnel — no new deploy/infra. Reserve `lumin.pet` and rewrite at the edge later. (`ponytail:` domain is an edge-rewrite when bought, not an app.)
- **D2 — NFC encode:** ✅ **Admin-mobile Web NFC** (Chrome Android) from the responsive admin app — no companion app, no USB reader. **+ manual `chip_uid` entry fallback** so a reader/phone workflow still records the encode.
- **D3 — activation login:** ✅ **Email-only** (reuse P1-r email+password session). Google OAuth **deferred** — the tag auto-attaches to whatever session mints, so Google is a later add-provider with no rework.
- **D4 — lost-scan notification transport.** *Default (ADR-013 email-first):* notify owner by **email + in-app**; `lost_events` stores raw `{lat,lng}` + an OpenStreetMap link. Reverse-geocode to "{khu vực}" + static map image = **deferred** (`ponytail:` add on request; keep in-country per ADR for PDPL). Geolocation collected **only on finder consent, once** (spec §10, PDPL).

## 3 · Data model — ✅ BUILT in t-1 (migration `000023_pet_tag`, ADR-040)
**3 tables + one product column + 3 enums.** All money-free (Pet Tag has **no** money path — it's sold via the
normal `Order`/`PriceItem` server-authoritative flow; the tag lifecycle carries no amounts).

```
products      + product_type  standard|nfc_tag  (enum, default 'standard'; every existing product = standard)
pet_tags      id, code(#LMN-Txxxx) uq, short_id uq (routing key /t/{shortId}), order_item_id→order_items,
              status UNENCODED|ENCODED|ACTIVATED, chip_uid?, owner_account_id?→customers(SET NULL),
              encoded_at?, activated_at?, created_at
pet_profiles  id, tag_id→pet_tags(uq,CASCADE), owner_account_id→customers(CASCADE), handle(uq slug),
              pet_name(1..40), species(dog|cat|other), breed?, age?, weight?, photo_url?, bio?,
              gallery/favorites/medical/owner_contact/socials/theme/blocks (jsonb), lost_mode(default false),
              created_at, updated_at
lost_events   id, tag_id→pet_tags(CASCADE), scanned_at, finder_location(jsonb)?, owner_notified_at?
```
- **Tag status is a NEW enum** (`pet_tag_status` UNENCODED/ENCODED/ACTIVATED), **parallel to and separate from OrderStatus §04** — the order still runs `PENDING_CONFIRM→…→COMPLETED`. No `packages/core` OrderStatus change, no `statusHistory`.
- `owner_account_id` → the **storefront customer** (P1-r account). On `pet_tags` it's set at login (activation 2a, before the profile exists); on `pet_profiles` it's the page owner (one account → many pets — direct query + edit-auth).
- **Normalization vs spec §10 (documented in ADR-040):** (a) `ProfileBlock[]` is the `blocks` **jsonb** column, not its own table — blocks are only ever loaded with the whole profile, same as gallery/socials/medical/theme; (b) no `pet_tags.profile_id` back-pointer — the 1-1 link is `pet_profiles.tag_id UNIQUE` (avoids a circular FK); (c) the chip URL is **derived** from `short_id`, not stored twice (only `chip_uid`, the hardware UID, is stored). `ponytail:` promote a jsonb field to a table only if we ever query inside it.

## 4 · Build slices (each = one user-merge-gate PR — mirrors ADR-039/P3-l epic cadence)
Sequenced by dependency. **BLOCKER-C: t-1 (ADR + migration) lands before any FE consumes it.**

| # | Slice | Surface | Depends | Done-when |
|---|---|---|---|---|
| **t-1** ✅ | **ADR + data model** | BE | — | **DONE** — ADR-040 · migration `000023_pet_tag` (product_type enum+col; pet_tags; pet_profiles w/ blocks jsonb; lost_events; +pet_tag_status/pet_species enums) · sqlc models regen · `make verify-go` green (incl up/down/up round-trip). No endpoints yet |
| **t-2** ✅ | **NFC-encode print stage** | BE + Admin | t-1, P3-h | **DONE** — ADR-041 · migration `000024` (`print_stage` +`NFC_ENCODE` between PRINTING↔PACKING, isolated ADD VALUE, no-op down) + `000025` (`pet_tag_code_seq`) · kanban **5th column** + product-aware `nextStage` (standard skips NFC_ENCODE) · **dual-mode `POST /admin/print-jobs/{id}/encode`** (no chipUid = mint tag + return URL to burn; chipUid = write `chip_uid`+`encoded_at` → `ENCODED` + advance →PACKING) · tag **minted at encode** (get-or-create by order_item; no order→print_job wiring yet) · encode sheet (Web NFC write + manual chip_uid, empty/loading/error) · `PET_TAG_BASE_URL` config |
| **t-3** | **Activation + onboarding** | Storefront | t-1, P1-r auth | pet page route `/t/{shortId}` · scan `ENCODED` → **reuse email login** → tag auto-attaches (`owner_account_id`) → 2-step profile → tag `ACTIVATED` + `PetProfile` created · **PDPL consent point 1** (pet+owner PII) · empty/loading/404/save-error |
| **t-4** | **Pet page: 3 states + lost mode** | Storefront | t-3 | 1 URL · 3 view-states routed by **auth + lostMode** (owner-edit / stranger-home / stranger-lost) · lost banner + allergy warning + **phone mask→full-on-lost** · finder geolocation **send-once** → `LostEvent` + notify owner (D4) · **consent point 2** · theme (5 colorway + cocoa; **safety colors never themed**) · WYSIWYG in-place edit + separate reorder mode · reduced-motion |
| **t-5** | **Admin Pet Tag roster** | Admin + Mobile | t-1 | `/pet-tag` (+ admin-mobile "Thêm" tab, design #9): list tags, **filter by 3 statuses**, show `chip_uid`/url/owner @handle/lost-status. New admin nav seam. Reuse admin list patterns. empty/loading/error |
| **t-6** | **Analytics + PDPL finalize** | both | t-3, t-4 | Umami events (§10: `pettag_scanned`/`pet_activated`/`lostmode_toggled`/`finder_location_shared`/`pet_profile_edited`/`pet_theme_changed`) · `LostEvent` geo **retention** job · phone-mask helper · **skill `vn-compliance` pass** (consent log/replay at both points). May fold into t-3/t-4 |

`ponytail:` t-6 is a checklist, not necessarily its own PR — fold the events/consent into t-3/t-4 if they're small. Keep the count honest: t-1..t-5 are the real gates.

## 5 · Global constraints that bite here
- **statusHistory:** untouched — Pet Tag adds **no** OrderStatus transition. The tag-status enum is a separate lifecycle; if it ever needs an audit trail, that's a `pet_tags` history, **not** `statusHistory`.
- **Money:** none. Pet Tag is sold via the existing product/order flow; the tag/profile carry no amounts. Don't add a money column.
- **i18n:** all copy keyed (`petTag.*`) — spec §10 has the Vietnamese microcopy verbatim.
- **PDPL (blocking):** public pet page → data-minimize. Phone **masked** in public/home state, full only on `lostMode=true` or to owner. Finder location: **consent-gated, once, retention-bound, deletable**. Consent logged at 2 points. **Must run skill `vn-compliance`** before t-3/t-4 ship (spec §10 ⚠️).
- **a11y:** hit ≥44px (one-handed mobile), reduced-motion on the toggle/sheet/entrance, safety colors (allergy/emergency) never overridden by theme.

## 6 · Out of scope (defer — `ponytail:` upgrade paths)
- Google OAuth (D3) · separate `lumin.pet` deploy (D1) · reverse-geocode + static map (D4) · companion NFC app / USB-reader flow beyond the manual `chip_uid` fallback (D2) · reminder/vaccination scheduling · multi-language pet page (vi-only, keys ready) · AggregateRating/reviews on the pet page.

## 7 · Cross-refs
- Roadmap slot: [`phase-3-admin.md`](phase-3-admin.md) P3-t (Track F) · BLOCKER-C · open-Q #5 (resolved: split).
- Behavior/data: [`/spec.md §10`](../../spec.md). Compliance: [`compliance.md`](../compliance.md) + skill `vn-compliance`.
- Reuse: customer auth P1-r · print stage P3-h · upload `proofstore` P2-c · public-token route `/o/[handle]` P2-g.
