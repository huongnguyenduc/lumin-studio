import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

// ---- Shipped CSS is the artifact apps consume (package.json exports ./tokens.css). The theme.ts
// assertions below alone do NOT protect it: someone could revert `--primary` to flame-500 in
// tokens.css and a theme-only test stays green. So we parse the real CSS, resolve the var() chain,
// and assert contrast on THAT — plus lockstep with theme.ts (conventions §A11y: khoá semantic alias).
const cssPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'tokens.css');
// Strip block comments first — the file header documents tokens like `--primary:` in prose, which
// would otherwise be mis-parsed as declarations. `[^;\n]+` keeps each match on its own line.
const css = readFileSync(cssPath, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const cssVars = new Map<string, string>();
for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;\n]+);/g)) {
  cssVars.set(m[1], m[2].trim());
}
/** Resolve a `--name` through its `var(--…)` chain down to a concrete hex (lowercased). */
function resolveCssVar(name: string, depth = 0): string {
  if (depth > 10) throw new Error(`var chain too deep / cyclic at ${name}`);
  const raw = cssVars.get(name);
  if (raw === undefined) throw new Error(`tokens.css thiếu ${name}`);
  const varRef = raw.match(/^var\((--[\w-]+)\)$/);
  if (varRef) return resolveCssVar(varRef[1], depth + 1);
  return raw.toLowerCase();
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

  // ---- The SHIPPED tokens.css (not just theme.ts) ----
  it('shipped tokens.css: all three primary states clear 4.5:1 against --on-primary', () => {
    const onPrimary = resolveCssVar('--on-primary');
    for (const state of ['--primary', '--primary-hover', '--primary-press'] as const) {
      expect(
        contrast(resolveCssVar(state), onPrimary),
        `${state} (${resolveCssVar(state)}) on ${onPrimary} fails AA 4.5:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('shipped tokens.css is in lockstep with theme.ts (so the theme-based tests transitively guard it)', () => {
    expect(resolveCssVar('--primary')).toBe(color.primary.toLowerCase());
    expect(resolveCssVar('--primary-hover')).toBe(color.primaryHover.toLowerCase());
    expect(resolveCssVar('--primary-press')).toBe(color.primaryPress.toLowerCase());
    expect(resolveCssVar('--on-primary')).toBe(color.onPrimary.toLowerCase());
  });
});
