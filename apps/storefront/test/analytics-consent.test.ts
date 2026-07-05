import { describe, it, expect, afterEach } from 'vitest';
import { parseConsent, readConsent, umamiConfig } from '../src/lib/analytics-consent';

describe('parseConsent', () => {
  it('accepts only the two real decisions', () => {
    expect(parseConsent('granted')).toBe('granted');
    expect(parseConsent('denied')).toBe('denied');
  });

  it('treats null / empty / junk / legacy values as undecided (never assumes consent)', () => {
    for (const raw of [null, undefined, '', 'true', 'yes', 'GRANTED', '1', '{}']) {
      expect(parseConsent(raw)).toBeNull();
    }
  });
});

describe('readConsent', () => {
  it('returns null under SSR (no window) — never assumes consent server-side', () => {
    // vitest node env has no `window`, so this exercises the SSR-safe branch.
    expect(readConsent()).toBeNull();
  });
});

describe('umamiConfig', () => {
  const { NEXT_PUBLIC_UMAMI_SRC, NEXT_PUBLIC_UMAMI_WEBSITE_ID } = process.env;
  afterEach(() => {
    process.env.NEXT_PUBLIC_UMAMI_SRC = NEXT_PUBLIC_UMAMI_SRC;
    process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID = NEXT_PUBLIC_UMAMI_WEBSITE_ID;
  });

  it('is null unless BOTH vars are set (a half-config never loads a script)', () => {
    delete process.env.NEXT_PUBLIC_UMAMI_SRC;
    delete process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
    expect(umamiConfig()).toBeNull();

    process.env.NEXT_PUBLIC_UMAMI_SRC = 'https://umami.example/script.js';
    expect(umamiConfig()).toBeNull(); // src only

    delete process.env.NEXT_PUBLIC_UMAMI_SRC;
    process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID = 'abc-123';
    expect(umamiConfig()).toBeNull(); // id only
  });

  it('returns src + websiteId when both are set', () => {
    process.env.NEXT_PUBLIC_UMAMI_SRC = 'https://umami.example/script.js';
    process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID = 'abc-123';
    expect(umamiConfig()).toEqual({
      src: 'https://umami.example/script.js',
      websiteId: 'abc-123',
    });
  });
});
