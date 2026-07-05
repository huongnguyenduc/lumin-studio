import { describe, it, expect } from 'vitest';
import {
  formatVnDate,
  formatVnDateTime,
  formatVnNumber,
  formatVnRating,
} from '../src/i18n/formatters';

describe('i18n formatters (vi-VN)', () => {
  it('formatVnDate pins Asia/Ho_Chi_Minh — a fixed UTC instant maps to one date, regardless of ambient TZ', () => {
    // 22:30Z = 05:30 the NEXT day in UTC+7. A non-pinned formatter would print 25/06 under TZ=UTC,
    // 26/06 under TZ=Asia/Ho_Chi_Minh — i.e. day-drift. Pinning makes both deterministic.
    expect(formatVnDate('2026-06-25T22:30:00.000Z')).toBe('26/06/2026');
    expect(formatVnDate('2026-06-25T00:00:00.000Z')).toBe('25/06/2026');
  });

  it('formatVnDateTime pins Asia/Ho_Chi_Minh and adds a 24-hour clock — deterministic date · time', () => {
    // 02:20Z = 09:20 the same day in UTC+7.
    expect(formatVnDateTime('2026-06-25T02:20:00.000Z')).toBe('25/06/2026 · 09:20');
    // 22:30Z crosses midnight in the shop's zone → 05:30 the NEXT day (same day-drift guard as above).
    expect(formatVnDateTime('2026-06-25T22:30:00.000Z')).toBe('26/06/2026 · 05:30');
    // Midnight UTC = 07:00 local — a zero-padded 24-hour time, never a 12-hour AM/PM rendering.
    expect(formatVnDateTime('2026-06-25T00:00:00.000Z')).toBe('25/06/2026 · 07:00');
  });

  it('formatVnNumber groups integers with vi-VN separators', () => {
    expect(formatVnNumber(1234)).toBe('1.234');
    expect(formatVnNumber(0)).toBe('0');
  });

  it('formatVnRating caps a fractional average at one decimal with a vi-VN comma separator', () => {
    // A raw AVG() on the wire (format: float) can carry many decimals — cap at one, rounded.
    expect(formatVnRating(4.6667)).toBe('4,7');
    expect(formatVnRating(4.9)).toBe('4,9');
    // A whole rating drops the decimal (never "5,0").
    expect(formatVnRating(5)).toBe('5');
    expect(formatVnRating(0)).toBe('0');
  });
});
