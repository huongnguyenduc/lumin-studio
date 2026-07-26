import { beforeEach, describe, expect, it, vi } from 'vitest';
import { storedToken } from '@/lib/guest-identity';

describe('guest identity storage', () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
  });

  it('returns an empty token before identity resolution', () => {
    expect(storedToken()).toBe('');
  });

  it('survives storage-blocked browsers instead of throwing', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
    });
    expect(storedToken()).toBe('');
  });
});
