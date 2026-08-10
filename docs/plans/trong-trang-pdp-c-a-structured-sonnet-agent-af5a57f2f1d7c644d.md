# PDP Redesign Plan — "hiển thị đẹp hơn và dễ mua hơn"

Repo: /Users/duchuong/lumin-studio · storefront PDP = `apps/storefront/src/app/san-pham/[slug]/page.tsx` + `src/components/product-detail.tsx` (489L) + `product-configurator.tsx` + `color-swatches.tsx` + `product-reviews.tsx`. Hi-fi reference: `designs/Lumin Storefront - Hi-fi.dc.html` (mobile PDP ~L400-435, desktop ~L845-865). i18n: `apps/storefront/src/messages/vi.ts` (`productDetail` block, L109+).

Decisions locked: full redesign, multi-PR; delete MobileColorBar entirely (keep only full ColorSwatches in configurator).

Ponytail stance: reorder + restyle existing JSX; zero new components; one prop added (`children` on ProductDetail). No server/API changes in any PR (deferred list at bottom).

---

## PR 1 — Sticky CTA bar fixed + MobileColorBar removed (the bug-fix PR)

All in `product-detail.tsx`.

1. **Delete `MobileColorBar` + `SwatchRow`** (~L391-489) and the call at ~L291, plus the now-unused imports (`ColorView`, `colorsForPart`, `isColorSelectable`, `ConfiguratorState` if unreferenced). Kills bug (1) wholesale: 32px swatches, clipped ring, missing focus-visible.
   - i18n: NO key removals — `selectColorLabel`/`colorUnavailableLabel` are still used by `product-configurator.tsx:167`.
2. **Restyle the sticky bar** (~L286) to the hi-fi solid footer, fixing the ~16px see-through gap (bar `bottom-[76px]` vs nav ~60px):
   - `sticky bottom-[60px] z-30 -mx-4 border-t-2 border-border-default bg-surface-card px-4 pb-3.5 pt-[11px] md:static md:m-0 md:border-0 md:bg-transparent md:p-0` (hi-fi: solid #fff, border-top 2px #EFE6CC, padding 11px 16px 14px). Verify the exact bottom offset against rendered BottomNav height in the browser (min-h-[56px], real ~60px); tune once with devtools. Check token names against `packages/ui` luminPreset before using (`bg-surface-card` / `border-border-default` exist in current file, safe).
   - Drop `bg-surface-page/95 backdrop-blur-sm`.
3. **Hi-fi "Tổng / price" block** in the bar (mobile): left column `<p mono 10px uppercase>Tổng</p>` + `<PriceTag amount={product.basePrice}/>`, CTA fills the rest. Money rule: show BASE price only (server computes totals; never multiply price × qty client-side). When any option carries a delta (`cfg.anyPriceDelta`) or qty > 1, prefix with "từ" so the number is honest.
   - i18n adds to `vi.ts` `productDetail`: `stickyTotalLabel: 'Tổng'`, `stickyFromPrice: 'từ'` (or one key `stickyPrice: '{from, select, true {từ } other {}}{price}'` — simpler: two keys, compose in JSX).
   - Existing `priceNote` key already explains deltas — keep.
4. Keep QuantityStepper + IconButton/Button/pop CTA layout as-is (hit targets already ≥44 via size="lg").

**Risks/gotchas:** ESLint PostToolUse hook blocks on transient unused-import errors — delete MobileColorBar, its call site, and imports in ONE edit sequence. `bottom-[60px]` is a magic number coupling to BottomNav; add a comment pointing at bottom-nav.tsx.

**Verify:** `pnpm turbo run typecheck --filter=@lumin/storefront` (run directly per-filter, Turbo cache gotcha), `pnpm turbo run lint --filter=@lumin/storefront`, vitest storefront filter. Browser smoke: local stack, mobile 375px — scroll PDP, confirm no gap between bar and nav, bar solid with border-top, color picking only via configurator swatches. Screenshots: 1 mobile + 1 desktop vs hi-fi in PR body.

---

## PR 2 — Section reorder to hi-fi + specs as dl (the "đẹp hơn" PR)

All in `product-detail.tsx` (JSX moves, no logic changes).

1. **Reorder info column to hi-fi mobile order:** eyebrow → name → price+rating → ConfiguratorFields (Màu, Khắc tên, vị trí chips) → qty+CTA bar → description → specs. Concretely: move the `<p>{product.description}</p>` block (~L268) from above `ConfiguratorFields` to below the sticky-bar div. Configurator-first shortens tap-to-buy on mobile; description stays above specs.
2. **Specs: chips → key/value `<dl>` with dividers** (hi-fi "Thông số" list). Replace the `<ul>` chip markup (~L356-379) with a `<dl class="divide-y divide-border-subtle">` of rows: `<div class="flex justify-between py-2.5"><dt mono uppercase muted/><dd font-semibold text-strong/></div>` for Chất liệu / Kích thước / In trong. Keep the lead-time row visually distinct (teal accent text on the dd) as the made-to-order trust signal.
   - i18n: reuses `specsHeading`, `specMaterial`, `specDimensions`, `leadTimeLabel`, `leadTimeValue`. No new keys.
3. **Trust signal (cheap):** add one shipping-estimate row to the same dl: `shippingLabel: 'Giao hàng'`, `shippingValue: 'Giao toàn quốc · 2–4 ngày sau in'` (confirm copy with owner; pure i18n, no data change). Lead time already covered by leadTime row.
4. **Selected-swatch emphasis** in `color-swatches.tsx`: hi-fi selected swatch is larger with a double halo (`box-shadow 0 0 0 3px #fff, 0 0 0 5px #492F10`). Map to tokens: selected → `scale-110 ring-2 ring-border-strong ring-offset-2 ring-offset-surface-card` (or shadow via existing token utilities — check preset; NO raw hex). Wrap the scale in a `motion-safe:transition-transform` so prefers-reduced-motion is respected. Keep 44px hit target.

**Risks:** moving description changes desktop too — hi-fi desktop (~L845-865) also reads name→price→options→CTA→description, so one order serves both; verify against the hi-fi desktop frame before committing. dl divider token: confirm `divide-border-subtle` compiles (bare/unknown tokens silently no-op — grep `packages/ui` preset first).

**Verify:** same typecheck/lint/vitest filters; browser smoke mobile+desktop; screenshot pair vs hi-fi mobile PDP (~L400-435) and desktop (~L845-865) in PR body.

---

## PR 3 — Reviews inside the article + sticky CTA persists (the "dễ mua hơn" PR)

Problem: `ProductReviews` renders as a sibling AFTER `<ProductDetail>` in `page.tsx:100`, so the sticky bar (scoped to the article) unsticks before the shopper reaches reviews — exactly where buy intent peaks.

1. **`product-detail.tsx`:** accept `children?: ReactNode`; render `{children}` inside the `<article>`, after the two-column flex div. The sticky bar lives in the info column whose flex parent stretches — verify in-browser that the bar stays pinned through the reviews block; if the info column's height doesn't extend (flex siblings stretch, it should), move the sticky bar div to be a direct child of the `<article>` instead (still one file).
2. **`page.tsx`:** nest `<ProductReviews …/>` as children of `<ProductDetail>`; delete the sibling render. Keep `#reviews` anchor semantics (redirect at page.tsx:88 relies on it) — confirm `product-reviews.tsx` owns the `id="reviews"`.
3. i18n: none.

**Risks:** desktop `md:sticky top-24` media column now shares a taller container — the model stays pinned longer, which is desirable, but check it doesn't overlap the footer. Reviews section heading levels: it likely uses `h2`; now inside `<article>` under the `h1` — fine, but glance at it.

**Verify:** typecheck/lint/vitest; browser: mobile scroll to bottom of reviews with CTA bar still visible; deep-link `?reviewsPage=2#reviews` still lands correctly; screenshots (mobile long-scroll + desktop) vs hi-fi.

---

## Deferred (server/API — do NOT do now)

- **Live total in sticky bar** (base + option deltas × qty): needs `POST /price/quote` on the PDP. Server-authoritative money rule forbids client math; a debounced quote call per selection change is a real feature — separate spec'd PR if "từ {basePrice}" proves insufficient.
- **Per-option price-delta labels** ("+20.000₫" on choice pills): data likely already in view; but rendering deltas next to a base price invites clients summing mentally vs server totals — cheap to add later in configurator pills if owner wants; keep out of scope.
- **AggregateRating JSON-LD** once ratings are trusted (product-jsonld comment says "no AggregateRating yet").

## Cross-PR conventions checklist
- Semantic tokens only; grep the luminPreset in `packages/ui` before introducing any class not already in these files.
- All copy via `vi.ts` `productDetail` block; keys added: `stickyTotalLabel`, `stickyFromPrice` (PR1), `shippingLabel`, `shippingValue` (PR2). Keys removed: none.
- Money only via `formatVnd`/`PriceTag` (@lumin/core). No client-side multiplication.
- Each PR body: 1 mobile + 1 desktop screenshot vs the hi-fi frames (visual-fidelity rule).
- Sequence edits so no intermediate state has unused imports (ESLint PostToolUse hook blocks).

## Critical Files for Implementation
- /Users/duchuong/lumin-studio/apps/storefront/src/components/product-detail.tsx
- /Users/duchuong/lumin-studio/apps/storefront/src/app/san-pham/[slug]/page.tsx
- /Users/duchuong/lumin-studio/apps/storefront/src/messages/vi.ts
- /Users/duchuong/lumin-studio/apps/storefront/src/components/color-swatches.tsx
- /Users/duchuong/lumin-studio/apps/storefront/src/components/product-reviews.tsx
