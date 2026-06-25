import { Bricolage_Grotesque, Hanken_Grotesk, Space_Mono } from 'next/font/google';

// Self-hosted design-system fonts (next/font/google downloads + serves them — no runtime Google
// request). The `vietnamese` subset is REQUIRED so diacritics (ế/ữ/ợ) aren't tofu (conventions §A11y).
// Each exposes a CSS variable consumed by tailwind.config.ts → `font-display`/`font-body`/`font-mono`.
// NOTE: the canonical body font is "Hanken Grotesk" (design-system.md/tokens write it "Grotesque" —
// that misspelling is why it looked unavailable before).
export const fontDisplay = Bricolage_Grotesque({
  subsets: ['latin', 'vietnamese'],
  variable: '--font-bricolage',
  display: 'swap',
});

export const fontBody = Hanken_Grotesk({
  subsets: ['latin', 'vietnamese'],
  variable: '--font-hanken',
  display: 'swap',
});

// Space Mono has no `vietnamese` subset (latin only) — only used for prices/codes (ASCII).
export const fontMono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-space-mono',
  display: 'swap',
});
