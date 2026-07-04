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
