import { describe, it, expect } from 'vitest';
import {
  allChoicesSelected,
  allPartsSelected,
  canAddConfiguredToCart,
  canAddToCart,
  canAddToCartWithOptions,
  colorsForPart,
  partColorsForViewer,
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
    choices: [],
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
    parts: [],
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
      categoryId: '22222222-2222-2222-2222-222222222222',
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
          partId: null,
        },
      ],
      options: [],
      parts: [],
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
        choices: [],
      },
      {
        id: 'o2',
        label: 'Đế gỗ',
        description: 'Thêm đế gỗ.',
        type: 'choice',
        priceDelta: 100000,
        maxChars: null,
        choices: [],
      },
    ]);
  });

  it('collapses an undefined maxChars (property absent) to null', () => {
    const view = toProductDetailView(
      apiProduct({ options: [option({ id: 'o1', maxChars: undefined })] }),
    );
    expect(view.options[0].maxChars).toBeNull();
  });

  it('surfaces parts, colour.partId, and option.choices (ADR-037)', () => {
    const view = toProductDetailView(
      apiProduct({
        parts: [
          { id: 'p-shade', name: 'Chao đèn', displayOrder: 0 },
          { id: 'p-base', name: 'Đế', displayOrder: 1 },
        ],
        colors: [color({ id: 'c1', partId: 'p-shade' }), color({ id: 'c2', partId: null })],
        options: [
          option({
            id: 'o1',
            type: 'choice',
            maxChars: null,
            choices: [
              { id: 'ch-s', label: 'S', description: '', priceDelta: 0, displayOrder: 0 },
              {
                id: 'ch-m',
                label: 'M',
                description: '12×9 cm',
                priceDelta: 40000,
                displayOrder: 1,
              },
            ],
          }),
        ],
      }),
    );
    expect(view.parts).toEqual([
      { id: 'p-shade', name: 'Chao đèn' },
      { id: 'p-base', name: 'Đế' },
    ]);
    expect(view.colors.map((c) => c.partId)).toEqual(['p-shade', null]);
    expect(view.options[0].choices).toEqual([
      { id: 'ch-s', label: 'S', description: '', priceDelta: 0 },
      { id: 'ch-m', label: 'M', description: '12×9 cm', priceDelta: 40000 },
    ]);
  });

  it('surfaces a non-empty model3dUrl and collapses an empty one to undefined', () => {
    expect(
      toProductDetailView(apiProduct({ model3dUrl: 'https://cdn.example/mochi.glb' })).model3dUrl,
    ).toBe('https://cdn.example/mochi.glb');
    // Empty string ⇒ no model ⇒ undefined, so the viewer button never mounts model-viewer on an empty src.
    expect(toProductDetailView(apiProduct({ model3dUrl: '' })).model3dUrl).toBeUndefined();
  });

  it('surfaces a non-empty model3dStructuredUrl and collapses an empty one to undefined (f-4)', () => {
    expect(
      toProductDetailView(
        apiProduct({ model3dStructuredUrl: 'https://cdn.example/mochi_structured.glb' }),
      ).model3dStructuredUrl,
    ).toBe('https://cdn.example/mochi_structured.glb');
    expect(
      toProductDetailView(apiProduct({ model3dStructuredUrl: '' })).model3dStructuredUrl,
    ).toBeUndefined();
  });

  it('surfaces a part’s modelObjectName and collapses an empty one to undefined (f-2/f-3)', () => {
    const view = toProductDetailView(
      apiProduct({
        parts: [
          { id: 'p-shade', name: 'Chao đèn', displayOrder: 0, modelObjectName: 'Chao đèn' },
          { id: 'p-base', name: 'Đế', displayOrder: 1, modelObjectName: '' },
        ],
      }),
    );
    expect(view.parts[0].modelObjectName).toBe('Chao đèn');
    expect(view.parts[1].modelObjectName).toBeUndefined();
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
      {
        id: 'a',
        name: 'Kem sữa',
        hex: '#F3E9D2',
        available: true,
        priceDelta: 15000,
        partId: null,
      },
      { id: 'b', name: 'Kem sữa', hex: '#F3E9D2', available: false, priceDelta: 0, partId: null },
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

// --- ADR-037 configurator gates ---------------------------------------------------------------------

const partColors = [
  { id: 'c-shade-red', partId: 'p-shade', available: true },
  { id: 'c-shade-out', partId: 'p-shade', available: false },
  { id: 'c-base-red', partId: 'p-base', available: true },
  { id: 'c-flat', partId: null, available: true },
];
const parts = [{ id: 'p-shade' }, { id: 'p-base' }];

describe('colorsForPart (ADR-037)', () => {
  it('returns only the colours whose partId matches; flat (null) colours never group', () => {
    const colors = [
      { id: 'a', name: '', hex: '', available: true, priceDelta: 0, partId: 'p-shade' },
      { id: 'b', name: '', hex: '', available: true, priceDelta: 0, partId: 'p-base' },
      { id: 'c', name: '', hex: '', available: true, priceDelta: 0, partId: null },
    ];
    expect(colorsForPart(colors, 'p-shade').map((c) => c.id)).toEqual(['a']);
    expect(colorsForPart(colors, 'p-base').map((c) => c.id)).toEqual(['b']);
  });
});

describe('allPartsSelected (mirrors the server per-part membership + availability)', () => {
  it('true only when every part has an in-stock colour that belongs to it', () => {
    expect(
      allPartsSelected(parts, partColors, { 'p-shade': 'c-shade-red', 'p-base': 'c-base-red' }),
    ).toBe(true);
  });

  it('false when a part is unpicked', () => {
    expect(allPartsSelected(parts, partColors, { 'p-shade': 'c-shade-red' })).toBe(false);
  });

  it('false when a picked colour is out of stock', () => {
    expect(
      allPartsSelected(parts, partColors, { 'p-shade': 'c-shade-out', 'p-base': 'c-base-red' }),
    ).toBe(false);
  });

  it('false on a cross-part colour (colour of another part) — blocks the 422', () => {
    // c-base-red belongs to p-base, assigned to p-shade → rejected.
    expect(
      allPartsSelected(parts, partColors, { 'p-shade': 'c-base-red', 'p-base': 'c-base-red' }),
    ).toBe(false);
  });

  it('true for a product with no parts (the flat lock applies instead)', () => {
    expect(allPartsSelected([], partColors, {})).toBe(true);
  });
});

describe('allChoicesSelected (mirrors ErrOptionNeedsChoice)', () => {
  const options = [
    { id: 'o-size', type: 'choice' as const, choices: [{ id: 'ch-s' }, { id: 'ch-m' }] },
    { id: 'o-toggle', type: 'choice' as const, choices: [] }, // legacy toggle → trivially passes
    { id: 'o-text', type: 'text' as const, choices: [] },
  ];

  it('true when every enumerated option has a valid pick', () => {
    expect(allChoicesSelected(options, { 'o-size': 'ch-m' })).toBe(true);
  });

  it('false when an enumerated option is unpicked', () => {
    expect(allChoicesSelected(options, {})).toBe(false);
  });

  it('false when the pick is not one of the option’s choices', () => {
    expect(allChoicesSelected(options, { 'o-size': 'ch-xl' })).toBe(false);
  });
});

describe('canAddConfiguredToCart (the full ADR-037 gate)', () => {
  const flatColors = [
    { id: 'a', partId: null, available: true },
    { id: 'b', partId: null, available: false },
  ];

  it('reduces to the flat colour lock for a product with no parts / no enumerated choices', () => {
    expect(
      canAddConfiguredToCart({
        parts: [],
        colors: flatColors,
        options: [],
        selectedColorId: 'a',
        partColorByPart: {},
        choiceByOption: {},
        engraveEntries: [],
      }),
    ).toBe(true);
    expect(
      canAddConfiguredToCart({
        parts: [],
        colors: flatColors,
        options: [],
        selectedColorId: null,
        partColorByPart: {},
        choiceByOption: {},
        engraveEntries: [],
      }),
    ).toBe(false);
  });

  it('locks a parts product until every part coloured AND every enumerated choice picked', () => {
    const options = [{ id: 'o-size', type: 'choice' as const, choices: [{ id: 'ch-m' }] }];
    const base = {
      parts,
      colors: partColors,
      options,
      selectedColorId: null,
      engraveEntries: [] as { text: string; maxChars: number | null }[],
    };
    // Parts done, choice missing → locked.
    expect(
      canAddConfiguredToCart({
        ...base,
        partColorByPart: { 'p-shade': 'c-shade-red', 'p-base': 'c-base-red' },
        choiceByOption: {},
      }),
    ).toBe(false);
    // Both done → unlocked.
    expect(
      canAddConfiguredToCart({
        ...base,
        partColorByPart: { 'p-shade': 'c-shade-red', 'p-base': 'c-base-red' },
        choiceByOption: { 'o-size': 'ch-m' },
      }),
    ).toBe(true);
  });

  it('still gates on an over-limit engraving for a fully-configured parts product', () => {
    expect(
      canAddConfiguredToCart({
        parts,
        colors: partColors,
        options: [],
        selectedColorId: null,
        partColorByPart: { 'p-shade': 'c-shade-red', 'p-base': 'c-base-red' },
        choiceByOption: {},
        engraveEntries: [{ text: 'too long', maxChars: 3 }],
      }),
    ).toBe(false);
  });
});

describe('partColorsForViewer (f-3 live-viewer recolor map, ADR-052)', () => {
  const parts = [
    { id: 'p-shade', modelObjectName: 'Chao đèn' },
    { id: 'p-base', modelObjectName: 'Đế' },
    { id: 'p-nomap', modelObjectName: undefined }, // an unmapped part — never recolours
  ];
  const colors = [
    { id: 'c-red', hex: '#C93A1A' },
    { id: 'c-blue', hex: '#1A4FC9' },
  ];

  it('maps each mapped+picked part to its colour hex, keyed by object name', () => {
    expect(partColorsForViewer(parts, colors, { 'p-shade': 'c-red', 'p-base': 'c-blue' })).toEqual({
      'Chao đèn': '#C93A1A',
      Đế: '#1A4FC9',
    });
  });

  it('returns {} before anything is picked', () => {
    expect(partColorsForViewer(parts, colors, {})).toEqual({});
  });

  it('skips a part with no modelObjectName (an unmapped part keeps its baked colour, never grey)', () => {
    expect(partColorsForViewer(parts, colors, { 'p-nomap': 'c-red', 'p-shade': 'c-blue' })).toEqual(
      {
        'Chao đèn': '#1A4FC9',
      },
    );
  });

  it('skips a selection whose colour id is unknown (defensive — no crash, no entry)', () => {
    expect(partColorsForViewer(parts, colors, { 'p-shade': 'c-gone' })).toEqual({});
  });
});
