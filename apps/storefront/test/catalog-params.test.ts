import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SORT,
  MAX_Q_LENGTH,
  PAGE_SIZE,
  buildCatalogHref,
  emptyStateKind,
  pageItems,
  parseCatalogParams,
  totalPages,
  type CatalogParams,
} from '../src/lib/catalog-params';

const BASE = '/danh-muc';

describe('parseCatalogParams', () => {
  it('defaults everything when the query is empty', () => {
    expect(parseCatalogParams({})).toEqual({
      category: undefined,
      q: undefined,
      sort: 'newest',
      page: 1,
    });
  });

  it('keeps a non-empty category, drops a blank/whitespace one', () => {
    expect(parseCatalogParams({ category: 'gadget' }).category).toBe('gadget');
    expect(parseCatalogParams({ category: '   ' }).category).toBeUndefined();
    expect(parseCatalogParams({ category: '' }).category).toBeUndefined();
  });

  it('trims q, drops it when blank, and keeps a real term', () => {
    expect(parseCatalogParams({ q: '  mèo  ' }).q).toBe('mèo');
    expect(parseCatalogParams({ q: '   ' }).q).toBeUndefined();
    expect(parseCatalogParams({ q: '' }).q).toBeUndefined();
  });

  it('truncates an over-long q to MAX_Q_LENGTH runes (never a value the endpoint would 400 on)', () => {
    const long = 'a'.repeat(MAX_Q_LENGTH + 50);
    expect(parseCatalogParams({ q: long }).q).toHaveLength(MAX_Q_LENGTH);
  });

  it('truncates by code point, not UTF-16 unit, so multi-byte chars are not split', () => {
    // '★' is a single code point; a string of them truncated to the limit stays a whole-star string.
    const stars = '★'.repeat(MAX_Q_LENGTH + 10);
    const parsed = parseCatalogParams({ q: stars }).q ?? '';
    expect(Array.from(parsed)).toHaveLength(MAX_Q_LENGTH);
    expect(parsed.endsWith('★')).toBe(true);
  });

  it('accepts every known sort and falls back to the default for an unknown one', () => {
    expect(parseCatalogParams({ sort: 'price_asc' }).sort).toBe('price_asc');
    expect(parseCatalogParams({ sort: 'rating' }).sort).toBe('rating');
    expect(parseCatalogParams({ sort: 'bogus' }).sort).toBe(DEFAULT_SORT);
    expect(parseCatalogParams({ sort: '' }).sort).toBe(DEFAULT_SORT);
  });

  it('clamps page to a ≥1 integer, defaulting a bad value to 1', () => {
    expect(parseCatalogParams({ page: '3' }).page).toBe(3);
    expect(parseCatalogParams({ page: '0' }).page).toBe(1);
    expect(parseCatalogParams({ page: '-2' }).page).toBe(1);
    expect(parseCatalogParams({ page: 'abc' }).page).toBe(1);
    expect(parseCatalogParams({ page: '2.9' }).page).toBe(2); // parseInt floors
  });

  it('takes the first value when a param is repeated (array)', () => {
    expect(parseCatalogParams({ category: ['gadget', 'den'] }).category).toBe('gadget');
    expect(parseCatalogParams({ q: ['mèo', 'cáo'] }).q).toBe('mèo');
  });
});

describe('buildCatalogHref', () => {
  const base: CatalogParams = { category: undefined, q: undefined, sort: 'newest', page: 1 };

  it('omits every default → a clean base URL', () => {
    expect(buildCatalogHref(BASE, base, {})).toBe('/danh-muc');
  });

  it('serialises only non-default values', () => {
    expect(buildCatalogHref(BASE, base, { category: 'gadget' })).toBe('/danh-muc?category=gadget');
    expect(buildCatalogHref(BASE, base, { sort: 'price_asc' })).toBe('/danh-muc?sort=price_asc');
    expect(buildCatalogHref(BASE, base, { q: 'mèo' })).toBe('/danh-muc?q=m%C3%A8o');
  });

  it('resets page to 1 when a filter dimension changes (page 3 of the old filter is meaningless)', () => {
    const onPage3: CatalogParams = { category: 'gadget', q: undefined, sort: 'newest', page: 3 };
    expect(buildCatalogHref(BASE, onPage3, { category: 'den' })).toBe('/danh-muc?category=den');
    expect(buildCatalogHref(BASE, onPage3, { sort: 'rating' })).toBe(
      '/danh-muc?category=gadget&sort=rating',
    );
  });

  it('preserves the page when only paging (page patch → no reset)', () => {
    const filtered: CatalogParams = { category: 'gadget', q: 'mèo', sort: 'rating', page: 1 };
    expect(buildCatalogHref(BASE, filtered, { page: 2 })).toBe(
      '/danh-muc?category=gadget&q=m%C3%A8o&sort=rating&page=2',
    );
  });

  it('clearing a filter (category → undefined) still resets the page', () => {
    const onPage2: CatalogParams = { category: 'gadget', q: undefined, sort: 'newest', page: 2 };
    // The "Tất cả" chip patches category:undefined — a change, so page drops back to 1 (clean base).
    expect(buildCatalogHref(BASE, onPage2, { category: undefined })).toBe('/danh-muc');
  });

  it('clearing the search keeps an active category (empty-state "clear search" CTA)', () => {
    const searched: CatalogParams = { category: 'gadget', q: 'mèo', sort: 'newest', page: 2 };
    expect(buildCatalogHref(BASE, searched, { q: undefined })).toBe('/danh-muc?category=gadget');
  });
});

describe('emptyStateKind', () => {
  it('search wins over an active category (a search miss is the more specific message)', () => {
    expect(emptyStateKind({ category: 'gadget', q: 'mèo' })).toBe('search');
    expect(emptyStateKind({ category: undefined, q: 'mèo' })).toBe('search');
  });

  it('filter when only a category is active', () => {
    expect(emptyStateKind({ category: 'gadget', q: undefined })).toBe('filter');
  });

  it('catalog when nothing is active (a bare catalog)', () => {
    expect(emptyStateKind({ category: undefined, q: undefined })).toBe('catalog');
  });
});

describe('totalPages', () => {
  it('is at least 1 even for zero results (an empty page is still page 1 of 1)', () => {
    expect(totalPages(0)).toBe(1);
  });

  it('ceils to whole pages of PAGE_SIZE', () => {
    expect(totalPages(PAGE_SIZE)).toBe(1);
    expect(totalPages(PAGE_SIZE + 1)).toBe(2);
    expect(totalPages(PAGE_SIZE * 3)).toBe(3);
  });
});

describe('pageItems', () => {
  it('lists every page when there are ≤ 7', () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('windows around the current page with ellipsis gaps when there are many pages', () => {
    // First + last + current±1, gaps collapsed to a single ellipsis marker.
    expect(pageItems(1, 20)).toEqual([1, 2, 'ellipsis', 20]);
    expect(pageItems(10, 20)).toEqual([1, 'ellipsis', 9, 10, 11, 'ellipsis', 20]);
    expect(pageItems(20, 20)).toEqual([1, 'ellipsis', 19, 20]);
  });

  it('never emits an ellipsis for a gap of exactly one page (no "1 … 3" for a single hidden page)', () => {
    // current=3 of 8 → {1,8,2,3,4}; between 4 and 8 there IS a gap, between 1 and 2 there is not.
    expect(pageItems(3, 8)).toEqual([1, 2, 3, 4, 'ellipsis', 8]);
    // The single-hidden-page cases the window itself creates: {1,3,4,5,20} would collapse page 2 to an
    // ellipsis — instead the number 2 is shown (leading side), and 19 on the trailing side.
    expect(pageItems(4, 20)).toEqual([1, 2, 3, 4, 5, 'ellipsis', 20]);
    expect(pageItems(17, 20)).toEqual([1, 'ellipsis', 16, 17, 18, 19, 20]);
  });
});
