import { describe, it, expect } from 'vitest';
import {
  canAddToCart,
  canAddToCartWithOptions,
  engraveLength,
  formatDimensions,
  isColorSelectable,
  isEngraveWithinLimit,
  toProductDetailView,
} from '../src/lib/product-view';
import type { components } from '@lumin/api-client';

type ApiProduct = components['schemas']['Product'];
type ApiColor = components['schemas']['Color'];
type ApiOption = components['schemas']['Option'];

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

function option(overrides: Partial<ApiOption> = {}): ApiOption {
  return {
    id: 'o0000000-0000-0000-0000-000000000001',
    label: 'Khắc tên',
    description: 'Khắc tên riêng lên đèn.',
    type: 'text',
    priceDelta: 0,
    maxChars: 20,
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
      options: [],
      rating: 4.8,
      reviewCount: 128,
    });
  });

  it('surfaces options[], mapping each field and collapsing an absent maxChars to null', () => {
    const view = toProductDetailView(
      apiProduct({
        options: [
          option({ id: 'o1', label: 'Khắc tên', type: 'text', priceDelta: 0, maxChars: 12 }),
          // A choice add-on: no maxChars in the payload → collapses to null (irrelevant for choice).
          option({
            id: 'o2',
            label: 'Đế gỗ',
            description: 'Thêm đế gỗ.',
            type: 'choice',
            priceDelta: 100000,
            maxChars: null,
          }),
        ],
      }),
    );
    expect(view.options).toEqual([
      {
        id: 'o1',
        label: 'Khắc tên',
        description: 'Khắc tên riêng lên đèn.',
        type: 'text',
        priceDelta: 0,
        maxChars: 12,
      },
      {
        id: 'o2',
        label: 'Đế gỗ',
        description: 'Thêm đế gỗ.',
        type: 'choice',
        priceDelta: 100000,
        maxChars: null,
      },
    ]);
  });

  it('collapses an undefined maxChars (property absent) to null', () => {
    const view = toProductDetailView(
      apiProduct({ options: [option({ id: 'o1', maxChars: undefined })] }),
    );
    expect(view.options[0].maxChars).toBeNull();
  });

  it('surfaces a non-empty model3dUrl and collapses an empty one to undefined', () => {
    expect(
      toProductDetailView(apiProduct({ model3dUrl: 'https://cdn.example/mochi.glb' })).model3dUrl,
    ).toBe('https://cdn.example/mochi.glb');
    // Empty string ⇒ no model ⇒ undefined, so the viewer button never mounts model-viewer on an empty src.
    expect(toProductDetailView(apiProduct({ model3dUrl: '' })).model3dUrl).toBeUndefined();
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

describe('engraveLength (mirrors the server rune count, plan §3 P1-j)', () => {
  it('counts plain ASCII by character', () => {
    expect(engraveLength('')).toBe(0);
    expect(engraveLength('Minh')).toBe(4);
  });

  it('counts a precomposed (NFC) code point as one, matching the server', () => {
    expect(engraveLength('B\u00E9')).toBe(2); // 'é' = U+00E9, one code point
    expect(engraveLength('Nguy\u1EC5n')).toBe(6); // 'ễ' = U+1EC5, one code point
  });

  it('counts DECOMPOSED (NFD) input by RAW code point, matching the un-normalised server', () => {
    // "e" + combining acute U+0301 = 2 code points. The server counts the raw runes (no NFC normalise)
    // as 2, so the client must count 2 too — NOT collapse to 1 (that would under-count vs the 422).
    const nfd = 'e\u0301';
    expect(nfd.length).toBe(2);
    expect(engraveLength(nfd)).toBe(2);
  });

  it('counts a non-BMP char as ONE code point, not two UTF-16 units (unlike .length)', () => {
    const emoji = '\u{1F600}';
    expect(emoji.length).toBe(2); // the .length trap the plan warns against
    expect(engraveLength(emoji)).toBe(1); // Go's utf8.RuneCountInString would also see 1
  });
});

describe('isEngraveWithinLimit (mirrors pricing.validateEngrave)', () => {
  it('treats blank / whitespace-only text as always fine (no engraving requested)', () => {
    expect(isEngraveWithinLimit('', 4)).toBe(true);
    expect(isEngraveWithinLimit('   ', 4)).toBe(true);
  });

  it('accepts any length when the option sets no limit (null maxChars)', () => {
    expect(isEngraveWithinLimit('a very long engraving indeed', null)).toBe(true);
  });

  it('allows text up to and including the limit', () => {
    expect(isEngraveWithinLimit('Minh', 4)).toBe(true);
    expect(isEngraveWithinLimit('Minh', 12)).toBe(true);
  });

  it('rejects text over the limit', () => {
    expect(isEngraveWithinLimit('Minhh', 4)).toBe(false);
  });

  it('counts trailing spaces toward the limit, exactly as the server does', () => {
    expect(isEngraveWithinLimit('Minh ', 4)).toBe(false); // "Minh " is 5 runes
  });
});

describe('canAddToCartWithOptions (colour lock AND every engraving within its limit)', () => {
  const colors = [
    { id: 'a', available: true },
    { id: 'b', available: false },
  ];

  it('stays locked whenever the colour lock is shut, regardless of engraving', () => {
    expect(canAddToCartWithOptions(null, colors, [])).toBe(false);
    expect(canAddToCartWithOptions('b', colors, [{ text: 'Minh', maxChars: 12 }])).toBe(false);
  });

  it('unlocks with an in-stock colour and no options', () => {
    expect(canAddToCartWithOptions('a', colors, [])).toBe(true);
  });

  it('unlocks when every engraving is within its limit', () => {
    expect(canAddToCartWithOptions('a', colors, [{ text: 'Minh', maxChars: 12 }])).toBe(true);
  });

  it('re-locks when any engraving is over its limit', () => {
    expect(canAddToCartWithOptions('a', colors, [{ text: 'Minhh', maxChars: 4 }])).toBe(false);
  });

  it('never blocks on a blank engraving (engraving is optional)', () => {
    expect(canAddToCartWithOptions('a', colors, [{ text: '   ', maxChars: 4 }])).toBe(true);
  });

  it('still gates on engraving when the product has no colours', () => {
    expect(canAddToCartWithOptions(null, [], [{ text: 'Minh', maxChars: 12 }])).toBe(true);
    expect(canAddToCartWithOptions(null, [], [{ text: 'Minhh', maxChars: 4 }])).toBe(false);
  });

  it('requires ALL engravings within limit (one over is enough to lock)', () => {
    expect(
      canAddToCartWithOptions('a', colors, [
        { text: 'ok', maxChars: 12 },
        { text: 'way too long', maxChars: 3 },
      ]),
    ).toBe(false);
  });
});
