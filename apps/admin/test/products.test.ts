import { describe, expect, it } from 'vitest';
import type { components } from '@lumin/api-client';
import { countByTab, filterProducts, toProductCards } from '../src/lib/products';

// Docker-free unit tests for the pure product-list adapters (P3-k). Covers the wire→card mapping, the
// tab + search filter (incl. the accent-free-via-slug path), and the per-tab counts.

type AdminProductSummary = components['schemas']['AdminProductSummary'];

function summary(over: Partial<AdminProductSummary>): AdminProductSummary {
  return {
    id: 'id',
    slug: 'slug',
    name: 'name',
    basePrice: 0,
    categoryId: 'cat',
    status: 'active',
    images: [],
    reviewCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('toProductCards', () => {
  it('folds images[0] into coverImage and builds a lowercase name+slug search key', () => {
    const [row] = toProductCards([
      summary({ name: 'Đèn ngủ Mochi', slug: 'den-ngu-mochi', images: ['a.jpg', 'b.jpg'] }),
    ]);
    expect(row.coverImage).toBe('a.jpg');
    expect(row.searchKey).toBe('đèn ngủ mochi den-ngu-mochi');
  });

  it('leaves coverImage undefined when the product has no images', () => {
    expect(toProductCards([summary({ images: [] })])[0].coverImage).toBeUndefined();
  });

  it('maps an empty list to []', () => {
    expect(toProductCards([])).toEqual([]);
  });
});

describe('filterProducts', () => {
  const rows = toProductCards([
    summary({ id: '1', name: 'Đèn ngủ Mochi', slug: 'den-ngu-mochi', status: 'active' }),
    summary({ id: '2', name: 'Mèo Mập', slug: 'meo-map', status: 'draft' }),
    summary({ id: '3', name: 'Móc khóa Robo', slug: 'moc-khoa-robo', status: 'archived' }),
  ]);

  it('all + empty query returns everything', () => {
    expect(filterProducts(rows, 'all', '').map((r) => r.id)).toEqual(['1', '2', '3']);
  });

  it('filters to a single status tab', () => {
    expect(filterProducts(rows, 'draft', '').map((r) => r.id)).toEqual(['2']);
  });

  it('matches an accent-free query via the slug', () => {
    expect(filterProducts(rows, 'all', 'den').map((r) => r.id)).toEqual(['1']);
  });

  it('matches an accented query via the name', () => {
    expect(filterProducts(rows, 'all', 'mèo').map((r) => r.id)).toEqual(['2']);
  });

  it('combines tab + query (no cross-tab match)', () => {
    expect(filterProducts(rows, 'active', 'meo')).toEqual([]);
  });

  it('ignores surrounding whitespace in the query', () => {
    expect(filterProducts(rows, 'all', '  robo  ').map((r) => r.id)).toEqual(['3']);
  });
});

describe('countByTab', () => {
  it('counts all + each status in one pass', () => {
    const rows = toProductCards([
      summary({ status: 'active' }),
      summary({ status: 'active' }),
      summary({ status: 'draft' }),
    ]);
    expect(countByTab(rows)).toEqual({ all: 3, active: 2, draft: 1, archived: 0 });
  });

  it('is all-zero for an empty catalog', () => {
    expect(countByTab([])).toEqual({ all: 0, active: 0, draft: 0, archived: 0 });
  });
});
