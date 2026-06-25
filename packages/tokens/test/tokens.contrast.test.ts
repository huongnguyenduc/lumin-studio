import { describe, it, expect } from 'vitest';
import { color, palette } from '../src/theme';

// WCAG 2.1 relative luminance + contrast ratio (conventions §A11y · WCAG 2.2 AA).
function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

describe('tokens contrast (WCAG 2.2 AA — conventions §A11y)', () => {
  it('primary action vs on-primary clears 4.5:1 (coral fix: flame-700, not flame-500)', () => {
    expect(contrast(color.primary, color.onPrimary)).toBeGreaterThanOrEqual(4.5);
  });

  it('white-on-flame-500 FAILS — this is exactly why --primary is flame-700', () => {
    expect(contrast(palette.flame500, palette.white)).toBeLessThan(4.5);
  });

  it('cocoa-900 on sun-500 clears 4.5:1 (the gold "pop" CTA pairing)', () => {
    expect(contrast(palette.cocoa900, palette.sun500)).toBeGreaterThanOrEqual(4.5);
  });

  it('body text on page surface clears 4.5:1', () => {
    expect(contrast(color.textBody, color.surfacePage)).toBeGreaterThanOrEqual(4.5);
  });

  it('strong text on card surface clears 4.5:1', () => {
    expect(contrast(color.textStrong, color.surfaceCard)).toBeGreaterThanOrEqual(4.5);
  });
});
