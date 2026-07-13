import { describe, expect, it } from 'vitest';
import { filterTemplates, foldVi } from '../src/lib/templates-view';

const T = [
  { title: 'Báo phí ship', body: 'Phí ship khu vực mình là {phí} nha.' },
  { title: 'Gửi STK / QR', body: 'Shop gửi STK: {stk}. Nội dung CK: tên + #đơn 🧡' },
  { title: 'Đặt cọc', body: 'Bạn đặt cọc giúp shop {cọc} nhé.' },
];

describe('foldVi', () => {
  it('drops diacritics and folds "đ" + case (so unaccented typing matches)', () => {
    expect(foldVi('Báo phí ship')).toBe('bao phi ship');
    expect(foldVi('Đặt Cọc')).toBe('dat coc');
  });
});

describe('filterTemplates', () => {
  it('matches without diacritics — Vietnamese staff type unaccented', () => {
    expect(filterTemplates(T, 'phi ship').map((t) => t.title)).toEqual(['Báo phí ship']);
  });

  it('is case-insensitive and folds "đ"', () => {
    expect(filterTemplates(T, 'DAT COC').map((t) => t.title)).toEqual(['Đặt cọc']);
  });

  it('matches the body, not just the title', () => {
    expect(filterTemplates(T, 'stk').map((t) => t.title)).toEqual(['Gửi STK / QR']);
  });

  it('a blank query returns everything, original order', () => {
    expect(filterTemplates(T, '   ').map((t) => t.title)).toEqual([
      'Báo phí ship',
      'Gửi STK / QR',
      'Đặt cọc',
    ]);
  });

  it('no match returns empty', () => {
    expect(filterTemplates(T, 'zzz')).toEqual([]);
  });
});
