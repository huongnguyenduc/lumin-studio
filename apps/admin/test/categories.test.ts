import { describe, it, expect } from 'vitest';
import {
  validateCategoryInput,
  slugify,
  CATEGORY_NAME_MAX,
  CATEGORY_SLUG_MAX,
  CATEGORY_DESC_MAX,
} from '../src/lib/categories-form';

// Pure-validation tests (Docker-free) for the categories page (/danh-muc, P3-o): the client field rules that
// mirror the BE cleanCategoryInput. The browser render + CRUD round-trip are a later Playwright gate; this
// pins the branchy validation. slugify itself is covered in product-form.test.ts (re-exported here).

describe('validateCategoryInput', () => {
  it('accepts a valid name + slug', () => {
    expect(validateCategoryInput({ name: 'Đèn để bàn', slug: 'den-de-ban' })).toEqual({});
  });

  it('trims before checking (surrounding whitespace is not a value)', () => {
    expect(validateCategoryInput({ name: '  Đèn  ', slug: '  den  ' })).toEqual({});
  });

  it('flags a blank name and a blank slug as required', () => {
    expect(validateCategoryInput({ name: '   ', slug: '' })).toEqual({
      name: 'required',
      slug: 'required',
    });
  });

  it('flags a bad slug shape (uppercase/spaces/underscore) as slug', () => {
    expect(validateCategoryInput({ name: 'ok', slug: 'Den De_Ban' }).slug).toBe('slug');
    expect(validateCategoryInput({ name: 'ok', slug: '-den-' }).slug).toBe('slug');
  });

  it('flags an over-long name / slug as tooLong (counted by code point)', () => {
    const longName = 'a'.repeat(CATEGORY_NAME_MAX + 1);
    expect(validateCategoryInput({ name: longName, slug: 'ok' }).name).toBe('tooLong');
    const longSlug = 'a'.repeat(CATEGORY_SLUG_MAX + 1);
    expect(validateCategoryInput({ name: 'ok', slug: longSlug }).slug).toBe('tooLong');
  });

  it('validates description only when present (edit passes it, create omits it)', () => {
    // Omitted (create path) → never a description error, even for an empty draft.
    expect(validateCategoryInput({ name: 'ok', slug: 'ok' }).description).toBeUndefined();
    // Within cap → valid; over cap → tooLong (counted by code point).
    expect(
      validateCategoryInput({ name: 'ok', slug: 'ok', description: 'ánh ấm' }).description,
    ).toBeUndefined();
    const longDesc = 'a'.repeat(CATEGORY_DESC_MAX + 1);
    expect(
      validateCategoryInput({ name: 'ok', slug: 'ok', description: longDesc }).description,
    ).toBe('tooLong');
  });
});

describe('slugify (re-exported for the category dialog)', () => {
  it('folds Vietnamese diacritics into a URL-safe slug', () => {
    expect(slugify('Đèn để bàn')).toBe('den-de-ban');
  });
});
