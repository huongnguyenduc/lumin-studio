import { describe, it, expect } from 'vitest';
import type { components } from '@lumin/api-client';
import {
  emptyDraft,
  draftFromProduct,
  draftToInput,
  validateDraft,
  slugify,
  serverFieldErrors,
  type ProductDraft,
} from '../src/lib/product-form';

// Pure-adapter tests (Docker-free) for the product editor l-1: the wire⇄draft mapping, the money/dimension
// parse, and the client field rules that mirror the BE (admin_products.go). The browser render is a later
// Playwright gate; this pins the branchy money/validation bits.

const valid: ProductDraft = {
  name: 'Đèn ngủ Mochi',
  slug: 'den-ngu-mochi',
  description: 'Đèn ngủ ấm',
  categoryId: '11111111-1111-1111-1111-111111111111',
  basePrice: '290000',
  dimW: '180',
  dimD: '180',
  dimH: '240',
  material: 'PLA',
  status: 'active',
  images: [],
  productType: 'standard',
};

describe('validateDraft', () => {
  it('passes a complete valid draft', () => {
    expect(validateDraft(valid)).toEqual({});
  });
  it('flags a missing name / category', () => {
    expect(validateDraft({ ...valid, name: '  ' }).name).toBe('required');
    expect(validateDraft({ ...valid, categoryId: '' }).categoryId).toBe('required');
  });
  it('flags a bad slug shape (mirrors the BE regex)', () => {
    expect(validateDraft({ ...valid, slug: 'Đèn Ngủ' }).slug).toBe('slug');
    expect(validateDraft({ ...valid, slug: '-bad-' }).slug).toBe('slug');
    expect(validateDraft({ ...valid, slug: '' }).slug).toBe('required');
  });
  it('flags a non-integer / negative base price and a non-positive dimension', () => {
    expect(validateDraft({ ...valid, basePrice: '1.5' }).basePrice).toBe('int');
    expect(validateDraft({ ...valid, basePrice: '-5' }).basePrice).toBe('int');
    expect(validateDraft({ ...valid, basePrice: '' }).basePrice).toBe('int');
    expect(validateDraft({ ...valid, dimH: '0' }).dimH).toBe('positive');
    expect(validateDraft({ ...valid, dimW: 'abc' }).dimW).toBe('positive');
  });
  it('flags an over-long name and an unknown material', () => {
    expect(validateDraft({ ...valid, name: 'x'.repeat(201) }).name).toBe('tooLong');
    expect(validateDraft({ ...valid, material: 'wood' }).material).toBe('invalid');
  });
});

describe('draft ⇄ wire round-trip', () => {
  it('maps a wire Product to a draft and back to an equivalent input', () => {
    const product = {
      id: 'p1',
      slug: 'den-ngu-mochi',
      name: 'Đèn ngủ Mochi',
      description: 'Đèn ngủ ấm',
      categoryId: 'cat-1',
      basePrice: 290000,
      dimensions: { w: 180, d: 180, h: 240 },
      material: 'PETG',
      model3dUrl: '',
      images: ['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg'],
      colors: [],
      options: [],
      parts: [],
      status: 'active',
      reviewCount: 0,
      createdAt: '2026-07-01T00:00:00Z',
    } as unknown as components['schemas']['Product'];

    const input = draftToInput(draftFromProduct(product));
    expect(input).toEqual({
      slug: 'den-ngu-mochi',
      name: 'Đèn ngủ Mochi',
      description: 'Đèn ngủ ấm',
      categoryId: 'cat-1',
      basePrice: 290000,
      dimensions: { w: 180, d: 180, h: 240 },
      material: 'PETG',
      status: 'active',
      images: ['https://cdn.example/a.jpg', 'https://cdn.example/b.jpg'],
      productType: 'standard',
    });
  });
  it('preserves a Pet Tag (nfc_tag) product through the round-trip', () => {
    const product = {
      id: 'p1',
      slug: 'the-nfc-pet',
      name: 'Thẻ Pet Tag',
      description: '',
      categoryId: 'cat-1',
      basePrice: 150000,
      dimensions: { w: 30, d: 30, h: 5 },
      material: 'PETG',
      model3dUrl: '',
      images: [],
      colors: [],
      options: [],
      parts: [],
      status: 'active',
      reviewCount: 0,
      createdAt: '2026-07-01T00:00:00Z',
      productType: 'nfc_tag',
    } as unknown as components['schemas']['Product'];

    expect(draftFromProduct(product).productType).toBe('nfc_tag');
    expect(draftToInput(draftFromProduct(product)).productType).toBe('nfc_tag');
  });
  it('a fresh draft defaults to a PLA draft product with no images', () => {
    expect(emptyDraft('cat-9')).toMatchObject({
      categoryId: 'cat-9',
      material: 'PLA',
      status: 'draft',
      images: [],
    });
  });
});

describe('slugify', () => {
  it('folds Vietnamese diacritics and đ, dash-joins the rest', () => {
    expect(slugify('Đèn ngủ Mochi')).toBe('den-ngu-mochi');
    expect(slugify('  Kệ / Giá sách  ')).toBe('ke-gia-sach');
    expect(slugify('Ốp lưng 2 mặt')).toBe('op-lung-2-mat');
  });
});

describe('serverFieldErrors', () => {
  it('reads a surviving server slug 400 as a duplicate, dimensions onto width', () => {
    expect(serverFieldErrors({ slug: 'x' })).toEqual({ slug: 'taken' });
    expect(serverFieldErrors({ dimensions: 'x' })).toEqual({ dimW: 'invalid' });
    expect(serverFieldErrors({ categoryId: 'x', unknown: 'y' })).toEqual({ categoryId: 'invalid' });
  });
});
