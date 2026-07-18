// Typed token map — resolved values mirrored from tokens.css (source of truth /tokens/*.css).
// Consumed by the Tailwind preset and by tests. Keep in lockstep with tokens.css.

export const palette = {
  cream50: '#FFFBEF',
  cream100: '#FDF3D4',
  cream200: '#FFE9A4',
  cream300: '#F4D67E',
  cream400: '#EAC25A',
  cocoa900: '#492F10',
  cocoa800: '#432E12',
  cocoa700: '#5A411F',
  cocoa600: '#785B34',
  cocoa400: '#A98F63',
  cocoa200: '#D8C7A2',
  cocoa100: '#ECE0C6',
  flame100: '#FFE3D8',
  flame300: '#FFA98F',
  flame500: '#FF6B4A',
  flame600: '#F04E29',
  flame700: '#C93A1A',
  teal100: '#CDEFE9',
  teal300: '#6FD3C4',
  teal500: '#16B5A0',
  teal600: '#0E9384',
  teal700: '#0B7569',
  sky100: '#DCE8FF',
  sky300: '#9DBDFF',
  sky500: '#4C8DFF',
  sky600: '#2E6BE0',
  sky700: '#2253B8',
  sun100: '#FFEFC2',
  sun300: '#FFD668',
  sun500: '#FFC233',
  sun600: '#F2A60E',
  sun700: '#C9870A',
  danger100: '#FFD9D2',
  danger500: '#F0492B',
  danger600: '#D2371C',
  white: '#FFFFFF',
} as const;

// Semantic colors — the PRIMARY ramp diverges from /tokens/colors.css for WCAG 2.2 AA (see the
// tokens.css header): primary flame-500→flame-700, hover flame-600→flame-700, press flame-700→cocoa-900.
export const color = {
  textStrong: palette.cocoa900,
  textBody: palette.cocoa800,
  textMuted: palette.cocoa600,
  textSubtle: palette.cocoa400,
  textOnDark: palette.cream50,
  textOnAccent: palette.white,
  textLink: palette.sky600,
  surfacePage: palette.cream50,
  surfaceCard: palette.white,
  surfaceSunken: palette.cream100,
  surfaceCream: palette.cream200,
  surfaceBrand: palette.cocoa900,
  borderSubtle: '#EFE6CC',
  borderDefault: '#E3D5B0',
  borderStrong: palette.cocoa900,
  primary: palette.flame700, // a11y: source flame-500 (2.82:1 FAIL)
  primaryHover: palette.flame700, // a11y: source flame-600 fails too; == primary until UI hover layer
  primaryPress: palette.cocoa900, // pressed state (deep ink)
  onPrimary: palette.white,
  accentFlame: palette.flame500,
  accentTeal: palette.teal500,
  accentSky: palette.sky500,
  accentSun: palette.sun500,
  // Soft accent tints (the -100 ramp) — tinted backgrounds for soft Badge/Tag tones in packages/ui.
  accentFlameSoft: palette.flame100,
  accentTealSoft: palette.teal100,
  accentSkySoft: palette.sky100,
  accentSunSoft: palette.sun100,
  // Strong sky (sky-600) — a solid sky Badge needs a darker fill so white text clears AA 4.5:1
  // (white on sky-500 is only 3.2:1; on sky-600 it's ~4.9:1).
  accentSkyStrong: palette.sky600,
  // Danger ramp — mirrors tokens.css --danger-*. A11y (frontend-a11y-i18n §Contrast KHOÁ): the
  // action/danger semantic is danger-600 (#D2371C), NOT danger-500 — danger-500 fails AA as error text
  // on white (3.9:1) and as a solid fill under white text (3.7:1); danger-600 clears 4.5:1 both ways.
  // Soft = danger-100 tint (cocoa text).
  danger: palette.danger600,
  dangerSoft: palette.danger100,
  onDanger: palette.white,
  focusRing: palette.sky500,
} as const;

export const space = {
  0: '0',
  1: '4px',
  2: '8px',
  3: '12px',
  4: '16px',
  5: '20px',
  6: '24px',
  8: '32px',
  10: '40px',
  12: '48px',
  16: '64px',
  20: '80px',
  24: '96px',
  32: '128px',
} as const;

export const radius = {
  xs: '6px',
  sm: '10px',
  md: '16px',
  lg: '24px',
  xl: '32px',
  '2xl': '44px',
  pill: '999px',
} as const;

export const shadow = {
  sm: '0 1px 2px rgba(50, 32, 10, 0.08)',
  md: '0 4px 14px rgba(50, 32, 10, 0.10)',
  lg: '0 14px 36px rgba(50, 32, 10, 0.14)',
  xl: '0 28px 60px rgba(50, 32, 10, 0.18)',
  pop: `4px 4px 0 ${palette.cocoa900}`,
  popSm: `3px 3px 0 ${palette.cocoa900}`,
  popFlame: `4px 4px 0 ${palette.flame700}`,
} as const;

export const fontFamily = {
  display: "'Bricolage Grotesque', 'Arial Black', system-ui, sans-serif",
  body: "'Hanken Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'Space Mono', ui-monospace, 'SFMono-Regular', monospace",
} as const;

export const fontSize = {
  xs: '12px',
  sm: '14px',
  base: '16px',
  lg: '18px',
  xl: '20px',
  '2xl': '24px',
  '3xl': '30px',
  '4xl': '38px',
  '5xl': '48px',
  '6xl': '64px',
  '7xl': '84px',
} as const;

export const theme = { palette, color, space, radius, shadow, fontFamily, fontSize } as const;
export type Theme = typeof theme;
