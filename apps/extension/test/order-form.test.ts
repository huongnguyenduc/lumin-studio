import { describe, expect, it } from 'vitest';
import type { components } from '@lumin/api-client';
import {
  addressErrors,
  buildOrderItem,
  customerErrors,
  emptySelection,
  selectionComplete,
} from '../src/lib/order-form';

type Product = components['schemas']['Product'];
type Color = components['schemas']['Color'];
type Option = components['schemas']['Option'];

// Minimal fixtures — only the fields the pure logic reads (id/parts/colors/options); the rest of the
// Product schema is irrelevant here, so cast rather than fill 15 unused required fields.
function color(id: string, partId: string | null = null, available = true): Color {
  return { id, name: id, hex: '#000000', available, priceDelta: 0, partId } as unknown as Color;
}
function choiceOption(id: string, choiceIds: string[]): Option {
  return {
    id,
    label: id,
    description: '',
    type: 'choice',
    priceDelta: 0,
    maxChars: null,
    choices: choiceIds.map((cid) => ({
      id: cid,
      label: cid,
      description: '',
      priceDelta: 0,
      displayOrder: 0,
    })),
  } as unknown as Option;
}
function toggleOption(id: string): Option {
  return {
    id,
    label: id,
    description: '',
    type: 'choice',
    priceDelta: 0,
    maxChars: null,
    choices: [],
  } as unknown as Option;
}
function mkProduct(over: {
  parts?: { id: string; name: string; displayOrder: number }[];
  colors?: Color[];
  options?: Option[];
}): Product {
  return {
    id: 'p1',
    slug: 'p',
    name: 'P',
    colors: over.colors ?? [],
    options: over.options ?? [],
    parts: over.parts ?? [],
  } as unknown as Product;
}

describe('buildOrderItem', () => {
  it('flat product → colorId, no partColors, optionIds always present', () => {
    const p = mkProduct({ colors: [color('red'), color('blue')] });
    expect(buildOrderItem(p, { ...emptySelection(), colorId: 'red', quantity: 2 })).toEqual({
      productId: 'p1',
      quantity: 2,
      optionIds: [],
      colorId: 'red',
    });
  });

  it('parts product → one partColors entry per part, flat colorId omitted', () => {
    const p = mkProduct({
      parts: [
        { id: 'shade', name: 'Chao', displayOrder: 0 },
        { id: 'base', name: 'Đế', displayOrder: 1 },
      ],
      colors: [color('c1', 'shade'), color('c2', 'base')],
    });
    // Full toEqual proves the exact wire shape: no flat colorId AND no price field on a parts line.
    expect(
      buildOrderItem(p, {
        ...emptySelection(),
        colorId: 'ignored',
        partColorByPart: { shade: 'c1', base: 'c2' },
      }),
    ).toEqual({
      productId: 'p1',
      quantity: 1,
      optionIds: [],
      partColors: [
        { partId: 'shade', colorId: 'c1' },
        { partId: 'base', colorId: 'c2' },
      ],
    });
  });

  it('enumerated choice-option → optionChoices; toggle-option → optionIds; no price fields', () => {
    const p = mkProduct({ options: [choiceOption('size', ['m', 'l']), toggleOption('gift')] });
    expect(
      buildOrderItem(p, {
        ...emptySelection(),
        choiceByOption: { size: 'l' },
        toggleOptionIds: ['gift'],
      }),
    ).toEqual({
      productId: 'p1',
      quantity: 1,
      optionIds: ['gift'],
      optionChoices: [{ optionId: 'size', choiceId: 'l' }],
    });
  });
});

describe('selectionComplete', () => {
  it('flat product requires an available colour', () => {
    const p = mkProduct({ colors: [color('red'), color('sold', null, false)] });
    expect(selectionComplete(p, emptySelection())).toBe(false); // none picked
    expect(selectionComplete(p, { ...emptySelection(), colorId: 'sold' })).toBe(false); // unavailable
    expect(selectionComplete(p, { ...emptySelection(), colorId: 'red' })).toBe(true);
  });

  it('parts product requires one available colour per part', () => {
    const p = mkProduct({
      parts: [
        { id: 'shade', name: 'Chao', displayOrder: 0 },
        { id: 'base', name: 'Đế', displayOrder: 1 },
      ],
      colors: [color('c1', 'shade'), color('c2', 'base')],
    });
    expect(selectionComplete(p, { ...emptySelection(), partColorByPart: { shade: 'c1' } })).toBe(
      false,
    );
    expect(
      selectionComplete(p, { ...emptySelection(), partColorByPart: { shade: 'c1', base: 'c2' } }),
    ).toBe(true);
  });

  it('every enumerated choice-option must be picked; a bare product is complete', () => {
    const p = mkProduct({ options: [choiceOption('size', ['m', 'l'])] });
    expect(selectionComplete(p, emptySelection())).toBe(false);
    expect(selectionComplete(p, { ...emptySelection(), choiceByOption: { size: 'm' } })).toBe(true);
    expect(selectionComplete(mkProduct({}), emptySelection())).toBe(true);
  });
});

describe('customerErrors', () => {
  it('flags short name and bad phone; accepts +84 with spaces and empty email', () => {
    expect(customerErrors({ name: 'A', phone: '0901234567', email: '' }).name).toBe(true);
    expect(customerErrors({ name: 'Trần Mai', phone: '12345', email: '' }).phone).toBe(true);
    expect(customerErrors({ name: 'Trần Mai', phone: '+84 90 123 4567', email: '' })).toEqual({});
    expect(customerErrors({ name: 'Trần Mai', phone: '0901234567', email: 'bad' }).email).toBe(
      true,
    );
  });
});

describe('addressErrors', () => {
  it('requires province, ward, street (no district — ADR-017)', () => {
    expect(addressErrors({ province: '', ward: 'P.1', street: '1 Lê Lợi' }).province).toBe(true);
    expect(addressErrors({ province: 'HCM', ward: 'P.1', street: '1 Lê Lợi' })).toEqual({});
  });
});
