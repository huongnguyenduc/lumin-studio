import { describe, it, expect } from 'vitest';
import {
  canAddToCart,
  formatDimensions,
  isColorSelectable,
  toProductDetailView,
} from '../src/lib/product-view';
import type { components } from '@lumin/api-client';

type ApiProduct = components['schemas']['Product'];
type ApiColor = components['schemas']['Color'];

function color(overrides: Partial<ApiColor> = {}): ApiColor {
  return {
    id: 'c0000000-0000-0000-0000-000000000001',
    name: 'Kem sữa',
    hex: '#F3E9D2',
    available: true,
    priceDelta: 0,
    ...overrides,
  };
}

/** A fully-populated API product; individual tests override single fields. */
function apiProduct(overrides: Partial<ApiProduct> = {}): ApiProduct {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    slug: 'den-ngu-mochi',
    name: 'Đèn ngủ Mochi',
    description: 'Đèn ngủ in 3D, ánh sáng ấm.',
    categoryId: '22222222-2222-2222-2222-222222222222',
    basePrice: 290000,
    dimensions: { w: 180, d: 180, h: 240 },
    material: 'rPLA',
    model3dUrl: '',
    images: ['https://cdn.example/mochi-1.webp', 'https://cdn.example/mochi-2.webp'],
    colors: [color()],
    options: [],
    status: 'active',
    ratingAvg: 4.8,
    reviewCount: 128,
    createdAt: '2026-06-01T00:00:00Z',
    ...overrides,
  };
}

describe('toProductDetailView', () => {
  it('projects the API product onto the detail view (int-VND price passed through unformatted)', () => {
    expect(toProductDetailView(apiProduct())).toEqual({
      id: '11111111-1111-1111-1111-111111111111',
      slug: 'den-ngu-mochi',
      name: 'Đèn ngủ Mochi',
      description: 'Đèn ngủ in 3D, ánh sáng ấm.',
      basePrice: 290000,
      material: 'rPLA',
      dimensions: { w: 180, d: 180, h: 240 },
      images: ['https://cdn.example/mochi-1.webp', 'https://cdn.example/mochi-2.webp'],
      colors: [
        {
          id: 'c0000000-0000-0000-0000-000000000001',
          name: 'Kem sữa',
          hex: '#F3E9D2',
          available: true,
          priceDelta: 0,
        },
      ],
      rating: 4.8,
      reviewCount: 128,
    });
  });

  it('drops empty-string image URLs so a broken src never reaches <img>', () => {
    expect(toProductDetailView(apiProduct({ images: [] })).images).toEqual([]);
    expect(toProductDetailView(apiProduct({ images: [''] })).images).toEqual([]);
    expect(toProductDetailView(apiProduct({ images: ['', 'b.webp'] })).images).toEqual(['b.webp']);
  });

  it('de-duplicates image URLs (keeps first occurrence) so gallery keys stay unique', () => {
    expect(
      toProductDetailView(apiProduct({ images: ['a.webp', 'b.webp', 'a.webp'] })).images,
    ).toEqual(['a.webp', 'b.webp']);
  });

  it('normalises a null/absent rating to null (detail hides the Rating block)', () => {
    expect(toProductDetailView(apiProduct({ ratingAvg: null })).rating).toBeNull();
    expect(toProductDetailView(apiProduct({ ratingAvg: undefined })).rating).toBeNull();
  });

  it('keeps a zero price as 0, not falsy-dropped', () => {
    expect(toProductDetailView(apiProduct({ basePrice: 0 })).basePrice).toBe(0);
  });

  it('preserves each colour’s availability and priceDelta (drives out-of-stock + the lock)', () => {
    const view = toProductDetailView(
      apiProduct({
        colors: [
          color({ id: 'a', available: true, priceDelta: 15000 }),
          color({ id: 'b', available: false, priceDelta: 0 }),
        ],
      }),
    );
    expect(view.colors).toEqual([
      { id: 'a', name: 'Kem sữa', hex: '#F3E9D2', available: true, priceDelta: 15000 },
      { id: 'b', name: 'Kem sữa', hex: '#F3E9D2', available: false, priceDelta: 0 },
    ]);
  });
});

describe('isColorSelectable', () => {
  it('is true only for an in-stock colour', () => {
    expect(isColorSelectable({ available: true })).toBe(true);
    expect(isColorSelectable({ available: false })).toBe(false);
  });
});

describe('canAddToCart (the add-to-cart lock, spec §03 / plan §3)', () => {
  const colors = [
    { id: 'a', available: true },
    { id: 'b', available: false },
  ];

  it('stays locked until a colour is chosen', () => {
    expect(canAddToCart(null, colors)).toBe(false);
  });

  it('unlocks once an in-stock colour is selected', () => {
    expect(canAddToCart('a', colors)).toBe(true);
  });

  it('stays locked on an out-of-stock colour (out-of-stock can never unlock the CTA)', () => {
    expect(canAddToCart('b', colors)).toBe(false);
  });

  it('stays locked for a colour id not in the product', () => {
    expect(canAddToCart('missing', colors)).toBe(false);
  });

  it('does not apply when the product has no colours (nothing to pick)', () => {
    expect(canAddToCart(null, [])).toBe(true);
  });
});

describe('formatDimensions', () => {
  it('renders the spec "w × d × h mm" string', () => {
    expect(formatDimensions({ w: 180, d: 180, h: 240 })).toBe('180 × 180 × 240 mm');
  });
});
