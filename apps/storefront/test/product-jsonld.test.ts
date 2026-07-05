import { describe, it, expect } from 'vitest';
import {
  BRAND,
  DEFAULT_OG_IMAGE,
  buildProductJsonLd,
  jsonLdScriptContent,
  productOgImages,
  type ProductForJsonLd,
} from '../src/lib/product-jsonld';

function product(overrides: Partial<ProductForJsonLd> = {}): ProductForJsonLd {
  return {
    id: 'p0000000-0000-0000-0000-000000000001',
    name: 'Đèn ngủ mèo',
    description: 'Đèn in 3D, ánh sáng ấm.',
    basePrice: 390000,
    images: ['https://cdn.lumin.vn/a.jpg'],
    ...overrides,
  };
}

const URL = 'https://luminstudio.vn/san-pham/den-ngu-meo';

describe('buildProductJsonLd', () => {
  it('emits a schema.org Product + Offer with the canonical url', () => {
    const ld = buildProductJsonLd(product(), URL);
    expect(ld['@context']).toBe('https://schema.org');
    expect(ld['@type']).toBe('Product');
    expect(ld.name).toBe('Đèn ngủ mèo');
    expect(ld.sku).toBe('p0000000-0000-0000-0000-000000000001');
    expect(ld.brand).toEqual({ '@type': 'Brand', name: BRAND });
    const offer = ld.offers as Record<string, unknown>;
    expect(offer['@type']).toBe('Offer');
    expect(offer.url).toBe(URL);
  });

  it('uses PreOrder availability (made-to-order, never InStock)', () => {
    const offer = buildProductJsonLd(product(), URL).offers as Record<string, unknown>;
    expect(offer.availability).toBe('https://schema.org/PreOrder');
  });

  it('emits the RAW int-VND price + VND currency, never the formatVnd display form', () => {
    const offer = buildProductJsonLd(product({ basePrice: 390000 }), URL).offers as Record<
      string,
      unknown
    >;
    // schema.org wants the numeric price as a string — NOT "390.000₫".
    expect(offer.price).toBe('390000');
    expect(offer.priceCurrency).toBe('VND');
    expect(offer.price).not.toContain('₫');
    expect(offer.price).not.toContain('.');
  });

  it('never emits aggregateRating in Phase 1 (thin-review penalty risk)', () => {
    const ld = buildProductJsonLd(product(), URL);
    expect(ld).not.toHaveProperty('aggregateRating');
    expect(ld.offers).not.toHaveProperty('aggregateRating');
  });

  it('keeps only absolute image URLs, and omits the image key when none are absolute', () => {
    // Mixed: one absolute, one relative, one empty → only the absolute survives.
    const mixed = buildProductJsonLd(
      product({ images: ['https://cdn.lumin.vn/a.jpg', '/relative.jpg', ''] }),
      URL,
    );
    expect(mixed.image).toEqual(['https://cdn.lumin.vn/a.jpg']);

    // No absolute image → key absent entirely (an empty image:[] is invalid schema).
    const none = buildProductJsonLd(product({ images: ['/relative.jpg', ''] }), URL);
    expect(none).not.toHaveProperty('image');
  });
});

describe('productOgImages', () => {
  it('uses the product cover when it is an absolute URL', () => {
    expect(productOgImages('https://cdn.lumin.vn/a.jpg')).toEqual(['https://cdn.lumin.vn/a.jpg']);
    expect(productOgImages('http://cdn.lumin.vn/a.jpg')).toEqual(['http://cdn.lumin.vn/a.jpg']);
  });

  it('falls back to the default OG card for a relative / empty / missing cover (never []), so the share card is never blank', () => {
    // Next fully REPLACES the parent openGraph, so an empty list would strip the inherited default card.
    expect(productOgImages('/relative.jpg')).toEqual([DEFAULT_OG_IMAGE]);
    expect(productOgImages('//protocol-relative.jpg')).toEqual([DEFAULT_OG_IMAGE]);
    expect(productOgImages('')).toEqual([DEFAULT_OG_IMAGE]);
    expect(productOgImages(undefined)).toEqual([DEFAULT_OG_IMAGE]);
    expect(productOgImages('/relative.jpg')).not.toHaveLength(0);
  });
});

describe('jsonLdScriptContent', () => {
  it('escapes < so admin text cannot break out of the <script> element', () => {
    const ld = buildProductJsonLd(product({ name: 'Đèn </script><script>alert(1)</script>' }), URL);
    const html = jsonLdScriptContent(ld);
    // No literal `</script>` (or any `<`) survives → the script element can never be closed early.
    expect(html).not.toContain('</script>');
    expect(html).not.toContain('<');
    expect(html).toContain('\\u003c/script>');
    // Still valid JSON once parsed (the escape is a JSON-legal unicode escape).
    expect(() => JSON.parse(html)).not.toThrow();
    expect((JSON.parse(html) as { name: string }).name).toContain('</script>');
  });
});
