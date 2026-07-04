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
  /** Average rating, or null until the first review (ProductCard renders the Rating block only when
   *  non-null). */
  rating: number | null;
  reviewCount: number;
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
    rating: card.ratingAvg ?? null,
    reviewCount: card.reviewCount,
  };
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
};

/** The product-detail view the client component renders. A narrow, serialisable projection of the API
 *  `Product`: it drops categoryId, options[], model3dUrl and status (option/engrave pickers are P1-j,
 *  the 360° model viewer is P1-i). `import type` only above keeps this module client-safe, so the
 *  server-only catalog client (./catalog) is never pulled into the client bundle. Money stays raw
 *  int-VND — formatted by PriceTag/@lumin/core at render, never here. */
export type ProductDetailView = {
  id: string;
  slug: string;
  name: string;
  /** Markdown-as-text (spec §02); rendered as plain paragraphs in P1-h (rich rendering not in scope). */
  description: string;
  /** Starting price, int VND. Formatted downstream by PriceTag/@lumin/core — never pre-formatted. */
  basePrice: number;
  material: string;
  /** Bounding size in mm, shown "w × d × h mm" (spec §02). */
  dimensions: { w: number; d: number; h: number };
  /** Gallery: cover (images[0]) first, then the rest. Empty-string entries dropped; `[]` when the
   *  product has no photo yet → the component shows its dotgrid placeholder. */
  images: string[];
  colors: ColorView[];
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
    description: product.description,
    basePrice: product.basePrice,
    material: product.material,
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
    })),
    rating: product.ratingAvg ?? null,
    reviewCount: product.reviewCount,
  };
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
