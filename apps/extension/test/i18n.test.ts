import { describe, expect, it } from 'vitest';
import { vi as catalog } from '../src/i18n/vi';
import { t } from '../src/i18n';

describe('i18n vi catalog', () => {
  it('every message is a non-empty string', () => {
    for (const [key, value] of Object.entries(catalog)) {
      expect(value, key).toBeTypeOf('string');
      expect(value.trim().length, key).toBeGreaterThan(0);
    }
  });

  it('t() interpolates named vars', () => {
    expect(t('shell.greeting', { name: 'Mai' })).toContain('Mai');
  });

  it('t() leaves an unmatched placeholder intact', () => {
    expect(t('shell.greeting')).toContain('{name}');
  });

  it('t() returns the raw string when no vars are given', () => {
    expect(t('login.submit')).toBe(catalog['login.submit']);
  });
});
