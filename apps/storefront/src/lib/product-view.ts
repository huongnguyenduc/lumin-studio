import type { components } from '@lumin/api-client';

// The plain, serialisable product shape the client grid renders. Deliberately a NARROW projection of
// the API `ProductCard` (drops categoryId + the full images[] tail) so this module has ZERO runtime
// imports — only an `import type`, which erases at build time. That is what keeps the server-only
// catalog client (createApiClient + CORE_API_URL, in ./catalog) out of the client bundle: the client
// `FeaturedProducts` imports this type, never ./catalog. Prices stay raw int-VND (formatted by
// PriceTag via @lumin/core at render — conventions §Tiền, never here).
export type ProductCardView = {
  id: string;
  slug: string;
  name: string;
  /** Starting price, int VND. Formatted downstream by PriceTag/@lumin/core — never pre-formatted. */
  basePrice: number;
  /** Card cover = images[0] (ADR-007 sprite-first). Undefined when the product has no photo yet →
   *  ProductCard falls back to its dotgrid placeholder. */
  imageSrc?: string;
  /** 360° sprite-sheet URL (ADR-049) — the card-hover turntable. Undefined until a `sprite_render` job
   *  has produced one; the card then shows the static cover only. */
  spriteSheetUrl?: string;
  /** Average rating, or null until the first review (ProductCard renders the Rating block only when
   *  non-null). */
  rating: number | null;
  reviewCount: number;
  /** Hex swatches, catalog (name) order — the tile's colour dots (hi-fi 02). `[]` when the product has
   *  no colours (the wire omits the field entirely for those). */
  colorSwatches: string[];
};

/** Project an API `ProductCard` onto the view the grid renders. Pure — unit-tested in
 *  test/catalog.test.ts. `images[0]` is the cover; an empty images[] yields `undefined` (placeholder),
 *  never an empty-string src that would render a broken image. */
export function toProductCardView(card: components['schemas']['ProductCard']): ProductCardView {
  return {
    id: card.id,
    slug: card.slug,
    name: card.name,
    basePrice: card.basePrice,
    // `|| undefined` collapses BOTH a missing cover (empty images[]) AND an empty-string URL to the
    // placeholder path — never an empty `src` that a stricter renderer (e.g. next/image) would reject.
    imageSrc: card.images[0] || undefined,
    // Empty-string / absent ⇒ no sprite yet → undefined (the card shows the static cover only).
    spriteSheetUrl: card.spriteSheetUrl || undefined,
    rating: card.ratingAvg ?? null,
    reviewCount: card.reviewCount,
    // Omitted on the wire (colourless product) ⇒ [] here, so the card just skips the dots row.
    colorSwatches: card.colorSwatches ?? [],
  };
}

/** A browsable catalog category (API `Category`) — the taxonomy the /danh-muc filter chips render and
 *  the value passed back as `?category={slug}`. Already a flat, serialisable shape, but projected through
 *  its own view type (and `toCategoryView`) so the client toolbar imports a plain type, never the
 *  api-client runtime, keeping the server-only catalog client out of the client bundle. */
export type CategoryView = {
  id: string;
  slug: string;
  name: string;
};

export function toCategoryView(category: components['schemas']['Category']): CategoryView {
  return { id: category.id, slug: category.slug, name: category.name };
}

/** A selectable print colour on the detail page. `available:false` renders a disabled swatch that can
 *  never enable the add-to-cart CTA — out-of-stock is per-colour (a filament run-out), not a
 *  product-level inventory count (made-to-order has none; spec §03). */
export type ColorView = {
  id: string;
  name: string;
  /** Swatch hex from the catalog. Used as a data-driven inline background — it is product DATA, not a
   *  design token, so it does not go through the Tailwind palette. */
  hex: string;
  available: boolean;
  /** Added price, int VND. Applied server-side by POST /price/quote (P1-b) when the cart/checkout land
   *  (P1-k); the detail page displays basePrice only — no client-side sum (conventions §Tiền: tổng
   *  tính ở server). */
  priceDelta: number;
  /** The named part this colour belongs to (ADR-037), or null for a flat product-level colour. A product
   *  with `parts` groups its colours by this id — the customer picks one colour per part; the server
   *  validates the colour ∈ its claimed part (ErrColorNotForPart). null = the legacy flat colour path. */
  partId: string | null;
};

/** One enumerated choice of a `choice` option (ADR-037) — e.g. size "M". The customer picks exactly one
 *  choice per choice-option that offers them; the option's own priceDelta is ignored (the choice's delta
 *  prices the line). displayOrder is dropped — the API returns choices pre-sorted. */
export type OptionChoiceView = {
  id: string;
  label: string;
  description: string;
  /** Added price, int VND (>= 0). Priced server-side by POST /price/quote — never summed here. */
  priceDelta: number;
};

/** A named part of a product (ADR-037) — e.g. "Chao đèn". `colors[]` belong to a part via
 *  `ColorView.partId`; the customer picks one colour per part. displayOrder is dropped (API pre-sorted). */
export type PartView = {
  id: string;
  name: string;
  /** The object/material name inside the 3D model this part maps to (f-2/ADR-051), or undefined when
   *  unmapped. The live viewer recolors that named material to the picked colour's hex (f-3). */
  modelObjectName?: string;
};

/** A customization option on the detail page (spec §02). Two kinds, mirroring the catalog `option_type`:
 *  - `text`  → an ENGRAVING field. `maxChars` is the rune limit the server enforces (pricing.validateEngrave,
 *              utf8.RuneCountInString); the client counter mirrors it (see engraveLength). null = no limit.
 *  - `choice` → a boolean ADD-ON toggle. The contract carries NO sub-values[] — a choice option is simply
 *              selected or not, adding its priceDelta. `maxChars` is irrelevant (kept null).
 *  `priceDelta` stays raw int-VND (applied server-side by POST /price/quote when the cart lands, P1-k). */
export type OptionView = {
  id: string;
  label: string;
  description: string;
  type: 'text' | 'choice';
  /** Added price, int VND (>= 0). Formatted downstream by PriceTag/@lumin/core — never summed here. */
  priceDelta: number;
  /** Engraving rune limit for a `text` option; null when no limit applies (or for a `choice` option). */
  maxChars: number | null;
  /** Enumerated choices for a `choice` option (ADR-037). Empty = a legacy boolean toggle priced by this
   *  option's own `priceDelta`; non-empty = the customer picks exactly one choice (priced by the choice's
   *  delta, the option base ignored). Always `[]` for a `text` option. */
  choices: OptionChoiceView[];
};

/** The product-detail view the client component renders. A narrow, serialisable projection of the API
 *  `Product`: it drops status. `options[]` IS surfaced (P1-j: engrave field + choice add-on
 *  toggles) and `model3dUrl` is surfaced (P1-i: on-demand model-viewer). `import type` only above keeps
 *  this module client-safe, so the server-only catalog client (./catalog) is never pulled into the client
 *  bundle. Money stays raw int-VND — formatted by PriceTag/@lumin/core at render, never here. */
export type ProductDetailView = {
  id: string;
  slug: string;
  name: string;
  /** Category id — the detail page resolves it against the (cached) categories list to render the
   *  hi-fi breadcrumb "Trang chủ / {danh mục} / {tên SP}". */
  categoryId: string;
  /** Markdown-as-text (spec §02); rendered as plain paragraphs in P1-h (rich rendering not in scope). */
  description: string;
  /** Starting price, int VND. Formatted downstream by PriceTag/@lumin/core — never pre-formatted. */
  basePrice: number;
  material: string;
  /** `.glb` URL for the on-demand 3D viewer (P1-i), or undefined when the product has no model yet.
   *  Empty-string collapses to undefined (same guard as imageSrc) so the "Xem 3D" button never mounts
   *  model-viewer with an empty src. */
  model3dUrl?: string;
  /** `.glb` URL of the STRUCTURED derivative (f-4/ADR-052) — named objects/materials preserved, so the live
   *  viewer can recolor each part by object name (f-3). Undefined until a model_ingest produced one; the viewer
   *  loads it in preference to model3dUrl (falls back to the fused glb, where per-part recolor is a no-op). */
  model3dStructuredUrl?: string;
  /** 360° sprite-sheet URL (ADR-049) — the model-viewer's no-WebGL fallback. Undefined until a
   *  `sprite_render` job has produced one; the viewer then just hides on a WebGL-less browser (as before). */
  spriteSheetUrl?: string;
  /** Owner-saved default camera pose for the 3D viewer (ADR-038). Undefined = auto-frame. */
  model3dView?: components['schemas']['Model3dView'];
  /** Owner-picked surface point where a customer's engraving text is projected onto the 3D model
   *  (position + outward normal, model space). Undefined = no anchor picked in admin → the viewer falls
   *  back to its front-centre heuristic. */
  engraveAnchor?: components['schemas']['EngraveAnchor'];
  /** Bounding size in mm, shown "w × d × h mm" (spec §02). */
  dimensions: { w: number; d: number; h: number };
  /** Gallery: cover (images[0]) first, then the rest. Empty-string entries dropped; `[]` when the
   *  product has no photo yet → the component shows its dotgrid placeholder. */
  images: string[];
  colors: ColorView[];
  /** Customization options: `text` engrave fields + `choice` add-ons — a toggle when `choices` is empty,
   *  an enumerated picker when non-empty (ADR-037). `[]` when none. */
  options: OptionView[];
  /** Named parts (ADR-037), each grouping a subset of `colors[]` via `ColorView.partId`. Empty = a
   *  single-piece product priced by the flat `colorId`; non-empty = the customer picks one colour per
   *  part (partColors) and the flat colorId is not used. */
  parts: PartView[];
  /** Average rating, or null until the first review (the detail hides the Rating block when null). */
  rating: number | null;
  reviewCount: number;
};

/** Project an API `Product` onto the detail view. Pure — unit-tested in test/product-detail-view.test.ts.
 *  Same empty-string image guard as `toProductCardView` (a broken `src=""` never reaches <img>). */
export function toProductDetailView(product: components['schemas']['Product']): ProductDetailView {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    categoryId: product.categoryId,
    description: product.description,
    basePrice: product.basePrice,
    material: product.material,
    // Empty string ⇒ no model → undefined (mirrors imageSrc), so the viewer button never mounts on an empty src.
    model3dUrl: product.model3dUrl || undefined,
    // Structured glb (f-4): empty/absent ⇒ undefined; the viewer prefers it when present (per-part recolor).
    model3dStructuredUrl: product.model3dStructuredUrl || undefined,
    // Empty-string / absent ⇒ no sprite yet → undefined (the viewer then has no no-WebGL fallback).
    spriteSheetUrl: product.spriteSheetUrl || undefined,
    model3dView: product.model3dView,
    engraveAnchor: product.engraveAnchor,
    dimensions: { w: product.dimensions.w, d: product.dimensions.d, h: product.dimensions.h },
    // Drop empty-string URLs (broken src never reaches <img>) AND de-duplicate — the contract makes no
    // uniqueness guarantee, and a repeated photo would produce a duplicate React key / doubled thumbnail
    // (indexOf === i keeps the first occurrence only).
    images: product.images.filter((src, i) => src !== '' && product.images.indexOf(src) === i),
    colors: product.colors.map((c) => ({
      id: c.id,
      name: c.name,
      hex: c.hex,
      available: c.available,
      priceDelta: c.priceDelta,
      // openapi partId is nullable + optional (a flat product's colours omit it); collapse to null.
      partId: c.partId ?? null,
    })),
    options: product.options.map((o) => ({
      id: o.id,
      label: o.label,
      description: o.description,
      type: o.type,
      priceDelta: o.priceDelta,
      // openapi maxChars is `nullable` (and only meaningful for a text option); collapse absent/null to null.
      maxChars: o.maxChars ?? null,
      // `?? []` guards the SSG/ISR boundary — a page cached before the 2a deploy could lack the field.
      choices: (o.choices ?? []).map((ch) => ({
        id: ch.id,
        label: ch.label,
        description: ch.description,
        priceDelta: ch.priceDelta,
      })),
    })),
    // Same SSG/ISR guard as choices; a flat product has `parts: []`. modelObjectName (f-2) drives the live
    // viewer recolor; empty-string/absent collapses to undefined (unmapped part → keeps its default colour).
    parts: (product.parts ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      modelObjectName: p.modelObjectName || undefined,
    })),
    rating: product.ratingAvg ?? null,
    reviewCount: product.reviewCount,
  };
}

/** The shop's public reply to a review (API `ReviewReply`) — null on the parent until the shop replies
 *  (no Phase-1 write path populates it yet). `at` stays a raw ISO instant, formatted at render by
 *  @lumin/core `formatVnDate` (never here — MNY-03: no Intl outside core). */
export type ReviewReplyView = {
  body: string;
  /** ISO-8601 UTC when the reply was posted. Formatted downstream by formatVnDate. */
  at: string;
};

/** One published product review as the storefront renders it (API `Review`). The reviewer's identity
 *  is DELIBERATELY absent — the contract omits it (PDPL: reviews carry a nullable customer_id and guests
 *  may review, so a name would be public PII), so this view has no author/name/avatar field and the
 *  section renders none. `body` may be empty (a star-only review). `createdAt`/`reply.at` stay raw ISO
 *  instants, formatted at render by @lumin/core `formatVnDate`. Pure projection → unit-tested. */
export type ReviewView = {
  id: string;
  /** Star rating 1–5 (spec §02). */
  rating: number;
  /** The review text; may be empty (the section then renders stars + date only). */
  body: string;
  /** Reviewer photos; `[]` when none. Empty-string URLs dropped + de-duplicated (same guard as the
   *  product gallery — a broken `src=""` or a doubled photo never reaches <img>). */
  images: string[];
  /** The shop's public reply, or null until the shop has replied. */
  reply: ReviewReplyView | null;
  /** ISO-8601 UTC when the review was posted. Formatted downstream by formatVnDate. */
  createdAt: string;
};

/** Project an API `Review` onto the view the reviews section renders. Pure — unit-tested in
 *  test/product-reviews.test.ts. Drops empty-string image URLs and de-duplicates (same rationale as
 *  toProductDetailView.images: a broken/repeated photo never reaches <img> or a duplicate React key).
 *  A null/absent `reply` collapses to null so the component's `reply != null` guard is unambiguous. */
export function toReviewView(review: components['schemas']['Review']): ReviewView {
  return {
    id: review.id,
    rating: review.rating,
    body: review.body,
    images: review.images.filter((src, i) => src !== '' && review.images.indexOf(src) === i),
    reply: review.reply ? { body: review.reply.body, at: review.reply.at } : null,
    createdAt: review.createdAt,
  };
}

/**
 * Parse the `?reviewsPage=` URL param into a safe 1-based page number, the way parseCatalogParams
 * bounds `page`: a non-numeric / < 1 / fractional value collapses to 1, so the reviews fetch can never
 * ask the endpoint for a page it would 400 on. A repeated param (`?reviewsPage=2&reviewsPage=3`) takes
 * the first, matching a single browser field. Pure → unit-testable. (An out-of-range-but-valid page —
 * e.g. page 9 of a 2-page product — is caught by the page, which redirects to the last page.)
 */
export function parseReviewsPage(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

/** Render a Dimensions triple as the spec's "w × d × h mm" display string (spec §02). Kept out of JSX
 *  so the "×"/"mm" notation isn't a hard-coded literal in the component, and stays unit-testable. Values
 *  are small mm integers → plain interpolation (no grouping/Intl needed). */
export function formatDimensions(dim: { w: number; d: number; h: number }): string {
  return `${dim.w} × ${dim.d} × ${dim.h} mm`;
}

/** Whether a colour can be picked — false when the filament is out of stock (spec §03). */
export function isColorSelectable(color: Pick<ColorView, 'available'>): boolean {
  return color.available;
}

/**
 * The add-to-cart lock (spec §03 / plan §3 P1-h): the CTA stays disabled until the customer has picked
 * a colour that is actually in stock. Pure so the invariant is unit-testable in the node vitest env
 * (no DOM). A `selectedColorId` that isn't in `colors`, or one whose colour is unavailable, keeps the
 * CTA locked. A product with NO colours has nothing to pick, so the lock does not apply (the eventual
 * cart Selection carries an optional colorId).
 */
export function canAddToCart(
  selectedColorId: string | null,
  colors: ReadonlyArray<Pick<ColorView, 'id' | 'available'>>,
): boolean {
  if (colors.length === 0) return true;
  if (selectedColorId === null) return false;
  const selected = colors.find((c) => c.id === selectedColorId);
  return selected !== undefined && selected.available;
}

/**
 * Count an engraving the way the SERVER does, so the client's live counter and over-limit block predict
 * POST /price/quote's 422 exactly (plan §3 P1-j: rune-accurate, KHÔNG `.length`). The server measures
 * `utf8.RuneCountInString` on the RAW text (it does NOT normalise) — i.e. it counts Unicode CODE POINTS.
 * The faithful mirror is therefore `Array.from(text).length`: `Array.from` iterates by code point, so for
 * the SAME string it equals the server's rune count exactly — NFC or NFD, BMP or non-BMP. `str.length`
 * (UTF-16 code units) would over-count a non-BMP char as 2; grapheme clusters (`Intl.Segmenter`) would
 * under-count a decomposed/emoji sequence. Deliberately NOT NFC-normalising: the server does not either,
 * so normalising here would make the client MORE lenient than the server for pasted decomposed (NFD) input
 * — the exact case parity must hold for. Counting the raw string keeps the block and the server 422 in
 * lockstep today, independent of what P1-k serialises onto the wire (user-confirmed 2026-07-04).
 */
export function engraveLength(text: string): number {
  return Array.from(text).length;
}

/**
 * Whether an engraving fits a text option's rune limit — mirrors pricing.validateEngrave. A blank /
 * whitespace-only text is ALWAYS fine (no engraving requested; the server treats `TrimSpace == ""` as
 * none). A null `maxChars` means the option sets no limit. Otherwise the RAW text (trailing spaces
 * included, exactly as the server counts) must be within the limit. Pure → unit-testable.
 */
export function isEngraveWithinLimit(text: string, maxChars: number | null): boolean {
  if (text.trim() === '') return true;
  if (maxChars === null) return true;
  return engraveLength(text) <= maxChars;
}

/**
 * The full detail-page add-to-cart gate: the colour lock (canAddToCart) AND every engraving within its
 * option's limit. An over-limit engraving keeps the CTA locked so the client never lets a customer add
 * something the server would 422; a blank engraving never blocks (it is optional). Kept separate from
 * `canAddToCart` so the colour-only invariant (SF-03) stays intact and independently tested. Pure.
 */
export function canAddToCartWithOptions(
  selectedColorId: string | null,
  colors: ReadonlyArray<Pick<ColorView, 'id' | 'available'>>,
  engraveEntries: ReadonlyArray<{ text: string; maxChars: number | null }>,
): boolean {
  if (!canAddToCart(selectedColorId, colors)) return false;
  return engraveEntries.every((e) => isEngraveWithinLimit(e.text, e.maxChars));
}

/**
 * The pre-selected flat colour when the detail page opens (user decision 2026-07-17: default = the FIRST
 * available colour, so the live 3D viewer is coloured from the start). Null when the product has no
 * selectable colour (all out of stock / colourless) — the CTA lock then behaves as before. Pure → tested.
 */
export function defaultFlatColorId(
  colors: ReadonlyArray<Pick<ColorView, 'id' | 'available'>>,
): string | null {
  return colors.find((c) => c.available)?.id ?? null;
}

/**
 * The pre-selected {partId → colorId} map for a parts product (same 2026-07-17 decision, per part): each
 * part starts on its FIRST available colour. A part with no available colour is simply absent from the
 * map (its swatch group starts unpicked and keeps the CTA locked — mirrors allPartsSelected). Pure → tested.
 */
export function defaultPartColors(
  parts: ReadonlyArray<Pick<PartView, 'id'>>,
  colors: ReadonlyArray<Pick<ColorView, 'id' | 'partId' | 'available'>>,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const part of parts) {
    const first = colors.find((c) => c.partId === part.id && c.available);
    if (first) map[part.id] = first.id;
  }
  return map;
}

/** The colours belonging to a named part (ADR-037): `partId === part.id`. Flat colours (partId null) are
 *  never grouped under a part. Used both to render a part's swatch set and to validate a per-part pick. */
export function colorsForPart(colors: ReadonlyArray<ColorView>, partId: string): ColorView[] {
  return colors.filter((c) => c.partId === partId);
}

/**
 * The `{ objectName → hex }` recolor map the live 3D viewer applies (f-3, ADR-052 structured glb): for each
 * part that maps to a model object (modelObjectName) AND has a colour picked, the selected colour's hex. A
 * part with no modelObjectName, or with no selection yet, is skipped — that mesh keeps its baked colour (an
 * unmapped part never turns grey). Keyed by object name because model-viewer addresses materials by name
 * (getMaterialByName). Pure → unit-tested. Returns `{}` before the customer has picked anything.
 */
export function partColorsForViewer(
  parts: ReadonlyArray<Pick<PartView, 'id' | 'modelObjectName'>>,
  colors: ReadonlyArray<Pick<ColorView, 'id' | 'hex'>>,
  partColorByPart: Readonly<Record<string, string>>,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (!part.modelObjectName) continue;
    const colorId = partColorByPart[part.id];
    if (colorId === undefined) continue;
    const color = colors.find((c) => c.id === colorId);
    if (color) map[part.modelObjectName] = color.hex;
  }
  return map;
}

/**
 * Whether every named part has an IN-STOCK colour picked that belongs to that part (ADR-037). Mirrors the
 * server's per-part membership + availability (ErrMissingPartColor / ErrColorNotForPart / an unavailable
 * colour) so a parts product's CTA never unlocks on a selection POST /price/quote would 422. A product
 * with no parts trivially passes here — the flat colour lock (canAddToCart) applies to it instead. Pure.
 */
export function allPartsSelected(
  parts: ReadonlyArray<Pick<PartView, 'id'>>,
  colors: ReadonlyArray<Pick<ColorView, 'id' | 'partId' | 'available'>>,
  partColorByPart: Readonly<Record<string, string>>,
): boolean {
  return parts.every((p) => {
    const colorId = partColorByPart[p.id];
    if (colorId === undefined) return false;
    const c = colors.find((x) => x.id === colorId);
    return c !== undefined && c.partId === p.id && c.available;
  });
}

/**
 * Whether every choice-option that OFFERS choices has one picked (ADR-037, ErrOptionNeedsChoice). Options
 * with no choices (legacy toggles) and text options trivially pass — they are not enumerated. Pure.
 */
export function allChoicesSelected(
  options: ReadonlyArray<{
    id: string;
    type: OptionView['type'];
    choices: ReadonlyArray<{ id: string }>;
  }>,
  choiceByOption: Readonly<Record<string, string>>,
): boolean {
  return options.every((o) => {
    if (o.type !== 'choice' || o.choices.length === 0) return true;
    const choiceId = choiceByOption[o.id];
    return choiceId !== undefined && o.choices.some((ch) => ch.id === choiceId);
  });
}

/**
 * The full configurator add-to-cart gate (ADR-037): the colour lock — per-part when the product has
 * parts (allPartsSelected), else the flat lock (canAddToCart) — AND every enumerated choice-option picked
 * (allChoicesSelected) AND every engraving within its limit. One pure function so the whole invariant is
 * unit-testable and the component can never let a shopper add a selection the server would 422. A flat
 * product with no parts and no enumerated choices reduces exactly to canAddToCartWithOptions.
 */
export function canAddConfiguredToCart(input: {
  parts: ReadonlyArray<Pick<PartView, 'id'>>;
  colors: ReadonlyArray<Pick<ColorView, 'id' | 'partId' | 'available'>>;
  options: ReadonlyArray<{
    id: string;
    type: OptionView['type'];
    choices: ReadonlyArray<{ id: string }>;
  }>;
  selectedColorId: string | null;
  partColorByPart: Readonly<Record<string, string>>;
  choiceByOption: Readonly<Record<string, string>>;
  engraveEntries: ReadonlyArray<{ text: string; maxChars: number | null }>;
}): boolean {
  const colorOk =
    input.parts.length > 0
      ? allPartsSelected(input.parts, input.colors, input.partColorByPart)
      : canAddToCart(input.selectedColorId, input.colors);
  return (
    colorOk &&
    allChoicesSelected(input.options, input.choiceByOption) &&
    input.engraveEntries.every((e) => isEngraveWithinLimit(e.text, e.maxChars))
  );
}

// === 360° sprite sheet (ADR-049) — the fixed grid shared with the render worker (pysrc/render.py). ===

/** Frames per turntable + the sheet's column count. FIXED shared constants: the render worker tiles to
 *  exactly this grid, so the sprite-sheet URL alone describes its layout (no metadata field). Changing
 *  them means re-rendering existing products — keep in lockstep with SPRITE_FRAMES/SPRITE_COLS there. */
export const SPRITE_FRAMES = 24;
export const SPRITE_COLS = 6;
export const SPRITE_ROWS = Math.ceil(SPRITE_FRAMES / SPRITE_COLS); // 4

/**
 * The CSS background-position for one frame of the sprite-sheet grid (ADR-049). With the element sized to
 * one tile and `background-size: (SPRITE_COLS*100)% (SPRITE_ROWS*100)%`, percentage positioning lands frame
 * `n` exactly on its tile: column `n % COLS` at `col/(COLS-1)*100%`, row `floor(n / COLS)` at
 * `row/(ROWS-1)*100%`. `frame` is clamped into range so a bad index never scrolls off the sheet. Pure →
 * unit-tested; SpriteTurntable steps `frame` over time (respecting prefers-reduced-motion).
 */
export function spriteFrameCss(frame: number): {
  backgroundPositionX: string;
  backgroundPositionY: string;
} {
  const n = Math.max(0, Math.min(Math.trunc(frame), SPRITE_FRAMES - 1));
  const col = n % SPRITE_COLS;
  const row = Math.floor(n / SPRITE_COLS);
  const x = SPRITE_COLS > 1 ? (col / (SPRITE_COLS - 1)) * 100 : 0;
  const y = SPRITE_ROWS > 1 ? (row / (SPRITE_ROWS - 1)) * 100 : 0;
  return { backgroundPositionX: `${x}%`, backgroundPositionY: `${y}%` };
}
