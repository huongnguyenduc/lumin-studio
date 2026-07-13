import type { CSSProperties } from 'react';
import type { PetTheme } from './pet-page';

// The pet-page theme system (spec §10 "Theme trang pet", P3-t t-4c-2). Six pre-built brand colorways
// (no free picker) + a background style + a name font, applied on render as CSS custom properties on the
// page root: themed elements read `var(--pet-ink)` / `var(--pet-chip-bg)` etc. SAFETY IS NOT THEMED —
// the allergy warning, lost banner and emergency call keep their system tokens (they own solid coloured
// surfaces, so they stay readable on any palette, including Đêm cocoa's dark bg). This module is a plain
// (non-'use client') module so the server page AND the client theme sheet share one source of truth.

export type PaletteId = 'bo' | 'bac-ha' | 'cam-nang' | 'troi-xanh' | 'nang' | 'cocoa';
export type BackgroundId = 'dots' | 'plain' | 'paper' | 'image';
export type NameFontId = 'display' | 'mono';

export const PALETTE_IDS: readonly PaletteId[] = [
  'bo',
  'bac-ha',
  'cam-nang',
  'troi-xanh',
  'nang',
  'cocoa',
];
export const BACKGROUND_IDS: readonly BackgroundId[] = ['dots', 'plain', 'paper', 'image'];
export const NAME_FONT_IDS: readonly NameFontId[] = ['display', 'mono'];

// The editable theme the sheet holds (all fields resolved — the write always sends the full appearance).
export type ThemeForm = {
  palette: PaletteId;
  background: BackgroundId;
  bgImageUrl: string; // '' unless background=image
  bgOpacity: number; // 0..100, spec default 40
  nameFont: NameFontId;
};

export const DEFAULT_OPACITY = 40;
export const DEFAULT_THEME: ThemeForm = {
  palette: 'bo',
  background: 'plain',
  bgImageUrl: '',
  bgOpacity: DEFAULT_OPACITY,
  nameFont: 'display',
};

type Palette = {
  ink: string; // primary text (cocoa on light, cream on Đêm cocoa)
  muted: string; // secondary text — AA-safe on this palette's bg
  bg: string; // page background base
  chipBg: string; // chip fill
  chipBorder: string; // chip / badge border
  dark: boolean;
  swatch: readonly [string, string]; // [soft, strong] discs on the chooser
};

// Light palettes keep cocoa ink + a cocoa/accent border (spec §10 "Cocoa luôn là chữ & viền ở bảng sáng");
// Đêm cocoa flips ink→cream, accent→sun. `muted` is picked AA-safe (≥4.5:1) on each palette's bg so the
// @handle + meta stay readable — deliberately darker than the swatch disc (which is decorative, not text).
const PALETTES: Record<PaletteId, Palette> = {
  bo: {
    ink: '#492F10',
    muted: '#7C6233',
    bg: '#FFFBEF',
    chipBg: '#FFEFC2',
    chipBorder: '#FFC233',
    dark: false,
    swatch: ['#FFE9A4', '#FF6B4A'],
  },
  'bac-ha': {
    ink: '#492F10',
    muted: '#0B7569',
    bg: '#F2FBF9',
    chipBg: '#E7F6F2',
    chipBorder: '#6FD3C4',
    dark: false,
    swatch: ['#CFF0E9', '#16B5A0'],
  },
  'cam-nang': {
    ink: '#492F10',
    muted: '#A14A30',
    bg: '#FFF6F1',
    chipBg: '#FFF1EC',
    chipBorder: '#FFA98F',
    dark: false,
    swatch: ['#FFD9CC', '#FF6B4A'],
  },
  'troi-xanh': {
    ink: '#492F10',
    muted: '#2253B8',
    bg: '#F3F7FF',
    chipBg: '#DCE8FF',
    chipBorder: '#9DBDFF',
    dark: false,
    swatch: ['#DCE8FF', '#4C8DFF'],
  },
  nang: {
    ink: '#492F10',
    muted: '#7C6233',
    bg: '#FFFCF2',
    chipBg: '#FFEFC2',
    chipBorder: '#FFD668',
    dark: false,
    swatch: ['#FFEFC2', '#FFC233'],
  },
  cocoa: {
    ink: '#FFE9A4',
    muted: '#E8C98A',
    bg: '#32200A',
    chipBg: '#4A3414',
    chipBorder: '#FFC233',
    dark: true,
    swatch: ['#32200A', '#FFC233'],
  },
};

export function isPaletteId(v: unknown): v is PaletteId {
  return typeof v === 'string' && v in PALETTES;
}
export function isBackgroundId(v: unknown): v is BackgroundId {
  return v === 'dots' || v === 'plain' || v === 'paper' || v === 'image';
}
export function isNameFontId(v: unknown): v is NameFontId {
  return v === 'display' || v === 'mono';
}

// The chooser preview needs each palette's swatch discs + dark flag.
export function paletteSwatch(id: PaletteId): { swatch: readonly [string, string]; dark: boolean } {
  const p = PALETTES[id];
  return { swatch: p.swatch, dark: p.dark };
}

// themeFormFrom folds a loaded (loose, read-passthrough) PetTheme into the resolved sheet form, defaulting
// any unknown/absent field — so an unthemed page opens the sheet on the brand default.
export function themeFormFrom(theme: PetTheme | undefined): ThemeForm {
  if (!theme) return { ...DEFAULT_THEME };
  return {
    palette: isPaletteId(theme.palette) ? theme.palette : DEFAULT_THEME.palette,
    background: isBackgroundId(theme.background) ? theme.background : DEFAULT_THEME.background,
    bgImageUrl: safeImageUrl(theme.bgImageUrl) ?? '',
    bgOpacity: clampOpacity(theme.bgOpacity),
    nameFont: isNameFontId(theme.nameFont) ? theme.nameFont : DEFAULT_THEME.nameFont,
  };
}

// petThemeVars resolves a stored theme to the page-root style (bg + all --pet-* custom properties) plus the
// name font var. Lenient: an unknown palette/background falls back to the brand default (the WRITE validates
// the fixed choices; this READ never throws on a stray value).
export function petThemeVars(theme: PetTheme | undefined): {
  root: CSSProperties;
  nameFont: string;
} {
  const paletteId = isPaletteId(theme?.palette) ? (theme?.palette as PaletteId) : 'bo';
  const pal = PALETTES[paletteId];
  const background = isBackgroundId(theme?.background)
    ? (theme?.background as BackgroundId)
    : 'plain';
  const root = {
    ...bgLayers(pal, background, safeImageUrl(theme?.bgImageUrl), clampOpacity(theme?.bgOpacity)),
    '--pet-ink': pal.ink,
    '--pet-muted': pal.muted,
    '--pet-chip-bg': pal.chipBg,
    '--pet-chip-border': pal.chipBorder,
  } as CSSProperties;
  const nameFont = theme?.nameFont === 'mono' ? 'var(--font-space-mono)' : 'var(--font-bricolage)';
  return { root, nameFont };
}

// bgLayers computes the page background for a palette + style. `image` blends the owner's photo UNDER a
// palette-tinted overlay whose alpha = 1 − opacity (so opacity=40 → a 0.6 scrim: the image is faint, text
// stays readable — spec §10 "mờ · chữ dễ đọc"). dots/paper are cocoa-tint patterns (cream on Đêm cocoa).
function bgLayers(
  pal: Palette,
  bg: BackgroundId,
  imageUrl: string | undefined,
  opacity: number,
): CSSProperties {
  const dot = pal.dark ? 'rgba(255,233,164,0.16)' : 'rgba(73,47,16,0.10)';
  switch (bg) {
    case 'dots':
      return {
        backgroundColor: pal.bg,
        backgroundImage: `radial-gradient(${dot} 1.1px, transparent 1.1px)`,
        backgroundSize: '16px 16px',
      };
    case 'paper':
      return {
        backgroundColor: pal.bg,
        backgroundImage: `repeating-linear-gradient(0deg, ${dot} 0 1px, transparent 1px 4px), repeating-linear-gradient(90deg, ${dot} 0 1px, transparent 1px 4px)`,
        backgroundSize: '6px 6px',
      };
    case 'image': {
      if (!imageUrl) return { backgroundColor: pal.bg };
      const scrim = clamp01((100 - opacity) / 100);
      const rgb = hexToRgb(pal.bg);
      return {
        backgroundColor: pal.bg,
        backgroundImage: `linear-gradient(rgba(${rgb},${scrim}), rgba(${rgb},${scrim})), url("${imageUrl}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      };
    }
    case 'plain':
    default:
      return { backgroundColor: pal.bg };
  }
}

// safeImageUrl only lets an http(s) URL through as a CSS background — a bg image is owner-set, but this keeps
// a stray value from breaking out of the url("…") context (no quotes/parens/whitespace). Anything else → none.
export function safeImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const t = url.trim();
  if (!/^https?:\/\//i.test(t)) return undefined;
  if (/["'()\s]/.test(t)) return undefined;
  return t;
}

function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r},${g},${b}`;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

// clampOpacity normalizes a stored/loose bgOpacity to an integer 0..100, defaulting to 40 (spec §10).
export function clampOpacity(v: number | undefined): number {
  if (typeof v !== 'number' || Number.isNaN(v)) return DEFAULT_OPACITY;
  return Math.max(0, Math.min(100, Math.round(v)));
}

// themeToWire folds the resolved sheet form into the appearance write's theme shape: bgImageUrl is included
// ONLY for an image background (so switching away leaves no ghost URL — the server enforces this too).
export function themeToWire(form: ThemeForm): {
  palette: string;
  background: string;
  bgImageUrl?: string;
  bgOpacity: number;
  nameFont: string;
} {
  const image = form.background === 'image' && form.bgImageUrl.trim() !== '';
  return {
    palette: form.palette,
    background: form.background,
    bgOpacity: clampOpacity(form.bgOpacity),
    nameFont: form.nameFont,
    ...(image ? { bgImageUrl: form.bgImageUrl.trim() } : {}),
  };
}
