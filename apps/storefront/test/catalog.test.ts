import { describe, it, expect } from 'vitest';
import { toProductCardView } from '../src/lib/product-view';
import type { components } from '@lumin/api-client';

type ApiCard = components['schemas']['ProductCard'];

/** A fully-populated API card; individual tests override single fields. */
function apiCard(overrides: Partial<ApiCard> = {}): ApiCard {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    slug: 'den-ngu-mochi',
    name: 'Đèn ngủ Mochi',
    basePrice: 290000,
    categoryId: '22222222-2222-2222-2222-222222222222',
    images: ['https://cdn.example/mochi-1.webp', 'https://cdn.example/mochi-2.webp'],
    ratingAvg: 4.8,
    reviewCount: 128,
    ...overrides,
  };
}

describe('toProductCardView', () => {
  it('projects the API card onto the narrow view (int-VND price passed through unformatted)', () => {
    expect(toProductCardView(apiCard())).toEqual({
      id: '11111111-1111-1111-1111-111111111111',
      slug: 'den-ngu-mochi',
      name: 'Đèn ngủ Mochi',
      basePrice: 290000,
      imageSrc: 'https://cdn.example/mochi-1.webp',
      rating: 4.8,
      reviewCount: 128,
    });
  });

  it('uses images[0] as the cover (ADR-007) and ignores the rest', () => {
    expect(toProductCardView(apiCard({ images: ['a.webp', 'b.webp', 'c.webp'] })).imageSrc).toBe(
      'a.webp',
    );
  });

  it('leaves imageSrc undefined (placeholder) when the product has no photo — never an empty src', () => {
    expect(toProductCardView(apiCard({ images: [] })).imageSrc).toBeUndefined();
    // An empty-STRING cover must also collapse to the placeholder, not pass through as src="".
    expect(toProductCardView(apiCard({ images: [''] })).imageSrc).toBeUndefined();
    expect(toProductCardView(apiCard({ images: ['', 'b.webp'] })).imageSrc).toBeUndefined();
  });

  it('normalises a null/absent rating to null (grid hides the Rating block)', () => {
    expect(toProductCardView(apiCard({ ratingAvg: null })).rating).toBeNull();
    expect(toProductCardView(apiCard({ ratingAvg: undefined })).rating).toBeNull();
  });

  it('passes a present rating through unchanged', () => {
    expect(toProductCardView(apiCard({ ratingAvg: 3.5 })).rating).toBe(3.5);
  });

  it('keeps a zero price (free/placeholder) as 0, not falsy-dropped', () => {
    expect(toProductCardView(apiCard({ basePrice: 0 })).basePrice).toBe(0);
  });
});
