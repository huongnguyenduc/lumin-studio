import { describe, it, expect } from 'vitest';
import {
  clampOpacity,
  DEFAULT_THEME,
  isBackgroundId,
  isPaletteId,
  petThemeVars,
  safeImageUrl,
  themeFormFrom,
  themeToWire,
} from '../src/lib/pet-theme';

describe('themeFormFrom', () => {
  it('returns the brand default for an unthemed page', () => {
    expect(themeFormFrom(undefined)).toEqual(DEFAULT_THEME);
  });

  it('resolves a stored theme + clamps/validates each field', () => {
    const form = themeFormFrom({
      palette: 'cocoa',
      background: 'image',
      bgImageUrl: 'https://garage.example/bg.jpg',
      bgOpacity: 250,
      nameFont: 'mono',
    });
    expect(form.palette).toBe('cocoa');
    expect(form.background).toBe('image');
    expect(form.bgOpacity).toBe(100); // clamped
    expect(form.nameFont).toBe('mono');
  });

  it('falls back on an unknown palette/background/font', () => {
    const form = themeFormFrom({ palette: 'neon', background: 'wave', nameFont: 'comic' });
    expect(form.palette).toBe(DEFAULT_THEME.palette);
    expect(form.background).toBe(DEFAULT_THEME.background);
    expect(form.nameFont).toBe(DEFAULT_THEME.nameFont);
  });
});

describe('petThemeVars', () => {
  it('defaults to the bo palette (cocoa ink) with the Bricolage name font', () => {
    const v = petThemeVars(undefined);
    expect((v.root as Record<string, string>)['--pet-ink']).toBe('#492F10');
    expect(v.nameFont).toBe('var(--font-bricolage)');
  });

  it('flips ink to cream + font to mono for Đêm cocoa', () => {
    const v = petThemeVars({ palette: 'cocoa', nameFont: 'mono' });
    const root = v.root as Record<string, string>;
    expect(root['--pet-ink']).toBe('#FFE9A4');
    expect(root.backgroundColor).toBe('#32200A');
    expect(v.nameFont).toBe('var(--font-space-mono)');
  });

  it('blends a safe image bg under a scrim (opacity 40 → 0.6 overlay)', () => {
    const root = petThemeVars({
      palette: 'bac-ha',
      background: 'image',
      bgImageUrl: 'https://garage.example/bo.jpg',
      bgOpacity: 40,
    }).root as Record<string, string>;
    expect(root.backgroundImage).toContain('url("https://garage.example/bo.jpg")');
    expect(root.backgroundImage).toContain('0.6)'); // 1 − 40/100
    expect(root.backgroundSize).toBe('cover');
  });

  it('drops an unsafe image url (no url() injection) → plain colour bg', () => {
    const root = petThemeVars({
      palette: 'bo',
      background: 'image',
      bgImageUrl: 'https://x/a.jpg") ; background: url(javascript:evil',
    }).root as Record<string, string>;
    expect(root.backgroundImage).toBeUndefined();
    expect(root.backgroundColor).toBe('#FFFBEF');
  });
});

describe('themeToWire', () => {
  it('keeps bgImageUrl only for an image background', () => {
    const withImage = themeToWire({
      palette: 'bo',
      background: 'image',
      bgImageUrl: 'https://g/bg.jpg',
      bgOpacity: 40,
      nameFont: 'display',
    });
    expect(withImage.bgImageUrl).toBe('https://g/bg.jpg');

    const plain = themeToWire({
      palette: 'bo',
      background: 'dots',
      bgImageUrl: 'https://g/ghost.jpg', // stale — must be dropped
      bgOpacity: 40,
      nameFont: 'display',
    });
    expect(plain.bgImageUrl).toBeUndefined();
  });
});

describe('helpers', () => {
  it('clampOpacity bounds + defaults', () => {
    expect(clampOpacity(undefined)).toBe(40);
    expect(clampOpacity(-5)).toBe(0);
    expect(clampOpacity(150)).toBe(100);
    expect(clampOpacity(37.6)).toBe(38);
  });

  it('safeImageUrl only passes clean http(s) urls', () => {
    expect(safeImageUrl('https://g/a.jpg')).toBe('https://g/a.jpg');
    expect(safeImageUrl('http://g/a.jpg')).toBe('http://g/a.jpg');
    expect(safeImageUrl('javascript:alert(1)')).toBeUndefined();
    expect(safeImageUrl('https://g/a.jpg") x')).toBeUndefined(); // quote/space → rejected
    expect(safeImageUrl(undefined)).toBeUndefined();
  });

  it('type guards', () => {
    expect(isPaletteId('bac-ha')).toBe(true);
    expect(isPaletteId('neon')).toBe(false);
    expect(isBackgroundId('paper')).toBe(true);
    expect(isBackgroundId('wave')).toBe(false);
  });
});
