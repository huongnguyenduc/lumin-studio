import { describe, it, expect } from 'vitest';
import { formatVnDate, formatVnNumber } from '../src/i18n/formatters';

describe('i18n formatters (vi-VN)', () => {
  it('formatVnDate pins Asia/Ho_Chi_Minh — a fixed UTC instant maps to one date, regardless of ambient TZ', () => {
    // 22:30Z = 05:30 the NEXT day in UTC+7. A non-pinned formatter would print 25/06 under TZ=UTC,
    // 26/06 under TZ=Asia/Ho_Chi_Minh — i.e. day-drift. Pinning makes both deterministic.
    expect(formatVnDate('2026-06-25T22:30:00.000Z')).toBe('26/06/2026');
    expect(formatVnDate('2026-06-25T00:00:00.000Z')).toBe('25/06/2026');
  });

  it('formatVnNumber groups integers with vi-VN separators', () => {
    expect(formatVnNumber(1234)).toBe('1.234');
    expect(formatVnNumber(0)).toBe('0');
  });
});
