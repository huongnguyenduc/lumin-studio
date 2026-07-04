import { describe, expect, it } from 'vitest';
import {
  MAX_LINES,
  MAX_QUANTITY,
  addItem,
  buildCartItem,
  cartCount,
  cartLineKey,
  cartQuoteItems,
  cartSignature,
  removeItem,
  sanitizeCart,
  setItemQuantity,
  type CartItem,
} from '../src/lib/cart';
import type { ProductDetailView } from '../src/lib/product-view';

// A product with two colours (one unavailable), a choice add-on, and an engravable text option.
const product: ProductDetailView = {
  id: 'prod-1',
  slug: 'den-ngu-mochi',
  name: 'Đèn ngủ Mochi',
  description: 'Ấm và mềm.',
  basePrice: 290_000,
  material: 'rPLA',
  dimensions: { w: 120, d: 120, h: 160 },
  images: ['https://cdn.example/mochi.jpg', 'https://cdn.example/mochi-2.jpg'],
  colors: [
    { id: 'col-cam', name: 'Cam', hex: '#FF6B4A', available: true, priceDelta: 0 },
    { id: 'col-xanh', name: 'Xanh', hex: '#4C8DFF', available: false, priceDelta: 20_000 },
  ],
  options: [
    {
      id: 'opt-glow',
      label: 'Đế phát sáng',
      description: '',
      type: 'choice',
      priceDelta: 40_000,
      maxChars: null,
    },
    {
      id: 'opt-khac',
      label: 'Khắc tên',
      description: '',
      type: 'text',
      priceDelta: 30_000,
      maxChars: 12,
    },
  ],
  rating: 4.8,
  reviewCount: 12,
};

/** A minimal cart item builder for the reducer tests (buildCartItem is exercised separately). */
function item(overrides: Partial<CartItem> = {}): CartItem {
  return {
    key: overrides.key ?? 'k1',
    productId: 'prod-1',
    slug: 'den-ngu-mochi',
    name: 'Đèn ngủ Mochi',
    imageSrc: 'https://cdn.example/mochi.jpg',
    colorId: 'col-cam',
    colorName: 'Cam',
    optionIds: [],
    optionLabels: [],
    engrave: null,
    quantity: 1,
    ...overrides,
  };
}

describe('cartLineKey', () => {
  it('is stable and independent of option order', () => {
    expect(cartLineKey('p', 'c', ['b', 'a'], 't')).toBe(cartLineKey('p', 'c', ['a', 'b'], 't'));
  });

  it('separates different engraving text and null colour', () => {
    expect(cartLineKey('p', 'c', [], 'An')).not.toBe(cartLineKey('p', 'c', [], 'Bo'));
    expect(cartLineKey('p', null, [], null)).toBe('p|||');
  });
});

describe('buildCartItem', () => {
  it('snapshots colour + choice add-ons and keeps engraving off optionIds', () => {
    const built = buildCartItem(product, {
      colorId: 'col-cam',
      choiceIds: ['opt-glow'],
      engraveTexts: { 'opt-khac': 'An' },
    });
    expect(built.colorId).toBe('col-cam');
    expect(built.colorName).toBe('Cam');
    expect(built.optionIds).toEqual(['opt-glow']); // choice only
    expect(built.optionLabels).toEqual(['Đế phát sáng']);
    expect(built.engrave).toEqual({ optionId: 'opt-khac', text: 'An' });
    expect(built.imageSrc).toBe('https://cdn.example/mochi.jpg');
    expect(built.quantity).toBe(1);
  });

  it('treats a blank engraving as no engraving', () => {
    const built = buildCartItem(product, {
      colorId: 'col-cam',
      choiceIds: [],
      engraveTexts: { 'opt-khac': '   ' },
    });
    expect(built.engrave).toBeNull();
    expect(built.optionIds).toEqual([]);
  });

  it('handles no colour selected', () => {
    const built = buildCartItem(product, { colorId: null, choiceIds: [], engraveTexts: {} });
    expect(built.colorId).toBeNull();
    expect(built.colorName).toBeNull();
  });

  it('gives the same configuration the same key (so re-adds merge)', () => {
    const a = buildCartItem(product, {
      colorId: 'col-cam',
      choiceIds: ['opt-glow'],
      engraveTexts: { 'opt-khac': 'An' },
    });
    const b = buildCartItem(product, {
      colorId: 'col-cam',
      choiceIds: ['opt-glow'],
      engraveTexts: { 'opt-khac': 'An' },
    });
    expect(a.key).toBe(b.key);
    // A different engraving is a different line.
    const c = buildCartItem(product, {
      colorId: 'col-cam',
      choiceIds: ['opt-glow'],
      engraveTexts: { 'opt-khac': 'Bo' },
    });
    expect(c.key).not.toBe(a.key);
  });
});

describe('addItem', () => {
  it('merges the same key, summing quantities', () => {
    const one = item({ key: 'k1', quantity: 2 });
    const next = addItem([one], item({ key: 'k1', quantity: 3 }));
    expect(next).toHaveLength(1);
    expect(next[0].quantity).toBe(5);
  });

  it('appends a distinct key', () => {
    const next = addItem([item({ key: 'k1' })], item({ key: 'k2' }));
    expect(next.map((i) => i.key)).toEqual(['k1', 'k2']);
  });

  it('clamps a merged quantity to MAX_QUANTITY', () => {
    const next = addItem(
      [item({ key: 'k1', quantity: MAX_QUANTITY })],
      item({ key: 'k1', quantity: 5 }),
    );
    expect(next[0].quantity).toBe(MAX_QUANTITY);
  });

  it('does not exceed MAX_LINES', () => {
    const full = Array.from({ length: MAX_LINES }, (_, i) => item({ key: `k${i}` }));
    const next = addItem(full, item({ key: 'overflow' }));
    expect(next).toHaveLength(MAX_LINES);
    expect(next.some((i) => i.key === 'overflow')).toBe(false);
  });

  it('does not mutate the input array', () => {
    const input = [item({ key: 'k1' })];
    addItem(input, item({ key: 'k2' }));
    expect(input).toHaveLength(1);
  });
});

describe('setItemQuantity', () => {
  it('removes the line at quantity 0 (decrement-at-1)', () => {
    const next = setItemQuantity([item({ key: 'k1', quantity: 1 })], 'k1', 0);
    expect(next).toEqual([]);
  });

  it('removes on a negative quantity too', () => {
    expect(setItemQuantity([item({ key: 'k1' })], 'k1', -3)).toEqual([]);
  });

  it('clamps above the max', () => {
    const next = setItemQuantity([item({ key: 'k1' })], 'k1', MAX_QUANTITY + 10);
    expect(next[0].quantity).toBe(MAX_QUANTITY);
  });

  it('leaves other lines untouched', () => {
    const next = setItemQuantity([item({ key: 'k1' }), item({ key: 'k2', quantity: 4 })], 'k1', 2);
    expect(next.find((i) => i.key === 'k2')?.quantity).toBe(4);
    expect(next.find((i) => i.key === 'k1')?.quantity).toBe(2);
  });
});

describe('removeItem', () => {
  it('drops the matching key', () => {
    expect(removeItem([item({ key: 'k1' }), item({ key: 'k2' })], 'k1').map((i) => i.key)).toEqual([
      'k2',
    ]);
  });
});

describe('cartQuoteItems', () => {
  it('folds the engrave option into optionIds and omits a null colour', () => {
    const line = cartQuoteItems([
      item({
        key: 'k1',
        colorId: null,
        optionIds: ['opt-glow'],
        engrave: { optionId: 'opt-khac', text: 'An' },
        quantity: 2,
      }),
    ])[0];
    expect(line).toEqual({
      productId: 'prod-1',
      optionIds: ['opt-glow', 'opt-khac'],
      quantity: 2,
    });
    expect('colorId' in line).toBe(false);
  });

  it('carries colorId when present and preserves order', () => {
    const items = [
      item({ key: 'k1', colorId: 'col-cam' }),
      item({ key: 'k2', colorId: 'col-xanh' }),
    ];
    const quote = cartQuoteItems(items);
    expect(quote.map((q) => q.colorId)).toEqual(['col-cam', 'col-xanh']);
  });
});

describe('cartSignature / cartCount', () => {
  it('signature changes when a quantity changes', () => {
    const a = cartSignature([item({ key: 'k1', quantity: 1 })]);
    const b = cartSignature([item({ key: 'k1', quantity: 2 })]);
    expect(a).not.toBe(b);
  });

  it('counts total physical items', () => {
    expect(cartCount([item({ key: 'k1', quantity: 2 }), item({ key: 'k2', quantity: 3 })])).toBe(5);
  });
});

describe('sanitizeCart', () => {
  it('returns [] for a non-array', () => {
    expect(sanitizeCart('nope')).toEqual([]);
    expect(sanitizeCart(null)).toEqual([]);
  });

  it('drops malformed entries and keeps valid ones', () => {
    const raw = [
      item({ key: 'good' }),
      { key: 'missing-fields' },
      { ...item({ key: 'bad-qty' }), quantity: 'x' },
      42,
    ];
    const out = sanitizeCart(raw);
    expect(out.map((i) => i.key)).toEqual(['good']);
  });

  it('re-clamps an out-of-range persisted quantity', () => {
    const out = sanitizeCart([{ ...item({ key: 'k1' }), quantity: 9999 }]);
    expect(out[0].quantity).toBe(MAX_QUANTITY);
  });

  it('coerces a malformed engrave to null', () => {
    const out = sanitizeCart([{ ...item({ key: 'k1' }), engrave: { optionId: 'x' } }]);
    expect(out[0].engrave).toBeNull();
  });
});
