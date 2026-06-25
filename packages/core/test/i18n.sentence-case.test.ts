import { describe, it, expect } from 'vitest';
import { vi } from '../src/i18n/vi';

function collect(node: unknown, out: string[] = []): string[] {
  if (typeof node === 'string') out.push(node);
  else if (node && typeof node === 'object') for (const v of Object.values(node)) collect(v, out);
  return out;
}

describe('i18n catalog (vi) — sentence case (conventions §Giọng & chữ)', () => {
  const strings = collect(vi);

  it('catalog is non-empty', () => {
    expect(strings.length).toBeGreaterThan(0);
  });

  it('no ALL-CAPS sentences (no run of 4+ uppercase letters, incl. Vietnamese diacritics)', () => {
    // \p{Lu} catches uppercase across scripts — ASCII [A-Z]{4,} missed e.g. ALL-CAPS "ƯU ĐÃI".
    for (const s of strings) expect(s, s).not.toMatch(/\p{Lu}{4,}/u);
  });

  it('no message is entirely uppercase', () => {
    for (const s of strings) {
      const letters = s.replace(/[^A-Za-zÀ-ỹ]/g, '');
      if (letters.length > 1) expect(s === s.toUpperCase(), s).toBe(false);
    }
  });
});
