import type { ProductDetailView } from './product-view';

// Pure, client-safe (no `server-only` import → runs in the node vitest env) builder for the schema.org
// Product + Offer JSON-LD injected into the product detail page (plan §3 P1-q / storefront rule §SEO).
// Kept out of the component so the SEO contract is unit-testable in test/product-jsonld.test.ts.

/** The shop's brand name as it appears in schema.org / Open Graph metadata — a proper noun, identical in
 *  every locale, so it is a constant (NOT translatable UI copy → not an i18n key). */
export const BRAND = 'Lumin Studio';

/** The subset of a product the JSON-LD needs — a Pick so a caller can pass the full ProductDetailView. */
export type ProductForJsonLd = Pick<
  ProductDetailView,
  'id' | 'name' | 'description' | 'basePrice' | 'images'
>;

/**
 * Build the schema.org Product + Offer JSON-LD for a product detail page.
 *
 * - availability = **PreOrder**: everything is made-to-order (no finished-goods stock), so the offer is a
 *   pre-order — never InStock (spec §01 made-to-order · plan §3 P1-q).
 * - **NO aggregateRating** even though the product carries a rating (plan §3 P1-q): review volume is tiny
 *   in Phase 1, and an AggregateRating over a handful of reviews reads as thin/spammy and risks a Google
 *   structured-data penalty. Add when review volume warrants it (a later PR).
 * - `price` is the **raw int-VND as a string** ("390000") with currency VND — schema.org wants the numeric
 *   price, NOT the human display format "390.000₫" (that is @lumin/core's formatVnd, for people). So this
 *   deliberately does not route through formatVnd (and never trips the no-Intl-outside-core ESLint gate).
 * - `image`: only ABSOLUTE (http[s]) photo URLs survive — a relative/empty src is an invalid schema image,
 *   and the catalog may hand back an empty images[] (product with no photo yet).
 *
 * Pure: `canonicalUrl` + `brand` are arguments, so no env / server-only dependency.
 */
export function buildProductJsonLd(
  product: ProductForJsonLd,
  canonicalUrl: string,
  brand: string = BRAND,
): Record<string, unknown> {
  const images = product.images.filter((src) => /^https?:\/\//i.test(src));
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    sku: product.id,
    // Omit the key entirely when there is no absolute image — an empty `image: []` is worse than absent.
    ...(images.length > 0 ? { image: images } : {}),
    brand: { '@type': 'Brand', name: brand },
    offers: {
      '@type': 'Offer',
      url: canonicalUrl,
      priceCurrency: 'VND',
      price: String(product.basePrice),
      availability: 'https://schema.org/PreOrder',
    },
  };
}

/** The route of the site-wide default OG card (app/opengraph-image.tsx). A relative path — Next resolves
 *  it to an absolute URL via the layout's metadataBase. */
export const DEFAULT_OG_IMAGE = '/opengraph-image';

/**
 * The `openGraph.images` list for a product detail page: the product's own cover photo when it is an
 * ABSOLUTE (http[s]) URL (the highest-value share image for the inbox/MXH channel), otherwise the site's
 * default branded OG card.
 *
 * NEVER returns an empty list. Next.js fully REPLACES the parent openGraph when a child segment sets one
 * (verified against next@15.5 — it does not deep-merge, and the root file-based OG card is only re-applied
 * to a segment that OWNS an opengraph-image file, which the [slug] leaf does not). So omitting `images`
 * here would strip the inherited default card and emit NO og:image at all — a photo-less product (empty
 * images[]) or one with only relative image URLs would share with a blank card. Falling back to the
 * default OG route keeps every product share carrying an image. Pure → unit-tested.
 */
export function productOgImages(cover: string | undefined): string[] {
  return cover && /^https?:\/\//i.test(cover) ? [cover] : [DEFAULT_OG_IMAGE];
}

/** Serialise a JSON-LD object for safe embedding in a `<script type="application/ld+json">` tag. Escapes
 *  every `<` to its unicode form so a `</script>` (or `<!--`) that appears inside admin-controlled product
 *  text (name / description) can never break out of the script element — the standard JSON-LD XSS guard.
 *  Pure → unit-tested alongside buildProductJsonLd. */
export function jsonLdScriptContent(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
