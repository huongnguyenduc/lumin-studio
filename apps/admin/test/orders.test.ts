import { describe, it, expect } from 'vitest';
import type { components } from '@lumin/api-client';
import {
  parseStatusFilter,
  productLabel,
  toOrderRows,
  pageCount,
  buildOrdersHref,
} from '../src/lib/orders';

type AdminOrderSummary = components['schemas']['AdminOrderSummary'];

const summary = (over: Partial<AdminOrderSummary> = {}): AdminOrderSummary => ({
  id: '11111111-1111-4111-8111-111111111111',
  code: '#LMN-1000',
  customerName: 'Nguyễn An',
  firstItemName: 'Đèn Mochi',
  itemCount: 1,
  channel: 'web',
  status: 'PRINTING',
  total: 445_000,
  createdAt: '2026-06-18T02:00:00Z',
  ...over,
});

describe('parseStatusFilter', () => {
  it('passes through a known status', () => {
    expect(parseStatusFilter('PAID')).toBe('PAID');
  });
  it('drops the filter for undefined, empty, or junk (a bad URL shows all, not a 400)', () => {
    expect(parseStatusFilter(undefined)).toBeUndefined();
    expect(parseStatusFilter('')).toBeUndefined();
    expect(parseStatusFilter('paid')).toBeUndefined(); // case-sensitive vs the enum
    expect(parseStatusFilter('NONSENSE')).toBeUndefined();
  });
});

describe('productLabel', () => {
  it('is just the item name for a single-item order', () => {
    expect(productLabel('Đèn Mochi', 1)).toBe('Đèn Mochi');
  });
  it('appends "+N" (the OTHER lines) for a multi-item order', () => {
    expect(productLabel('Đèn Mochi', 2)).toBe('Đèn Mochi +1');
    expect(productLabel('Kệ Origami', 4)).toBe('Kệ Origami +3');
  });
});

describe('toOrderRows', () => {
  it('maps the wire summary to the row shape (rename + productLabel), keeps enums raw', () => {
    const rows = toOrderRows({
      items: [summary({ itemCount: 3 })],
      page: 1,
      pageSize: 20,
      total: 1,
    });
    expect(rows).toEqual([
      {
        id: '11111111-1111-4111-8111-111111111111',
        code: '#LMN-1000',
        customer: 'Nguyễn An',
        productLabel: 'Đèn Mochi +2',
        channel: 'web',
        status: 'PRINTING',
        total: 445_000,
        createdAt: '2026-06-18T02:00:00Z',
      },
    ]);
  });
  it('yields [] for an empty page (→ the table empty-state branch)', () => {
    expect(toOrderRows({ items: [], page: 1, pageSize: 20, total: 0 })).toEqual([]);
  });
});

describe('pageCount', () => {
  it('divides and rounds up, flooring at 1', () => {
    expect(pageCount(0, 20)).toBe(1); // empty is still one page
    expect(pageCount(20, 20)).toBe(1); // exact
    expect(pageCount(21, 20)).toBe(2); // spillover
    expect(pageCount(128, 20)).toBe(7);
  });
});

describe('buildOrdersHref', () => {
  it('omits defaults so page 1 / no filter is the bare path', () => {
    expect(buildOrdersHref({})).toBe('/don-hang');
    expect(buildOrdersHref({ page: 1 })).toBe('/don-hang');
    expect(buildOrdersHref({ status: 'PAID' })).toBe('/don-hang?status=PAID');
  });
  it('carries status + page when both are set', () => {
    expect(buildOrdersHref({ status: 'PRINTING', page: 3 })).toBe(
      '/don-hang?status=PRINTING&page=3',
    );
  });
});
