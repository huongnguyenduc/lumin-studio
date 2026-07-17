import { describe, expect, it } from 'vitest';
import { locale, messages } from '../src/messages';

// Catalog invariant: every leaf is a non-empty string — an empty key would render
// blank UI silently (mirrors apps/storefront/test/messages.test.ts).
function leaves(node: unknown, path: string): Array<[string, unknown]> {
  if (typeof node === 'object' && node !== null) {
    return Object.entries(node).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  }
  return [[path, node]];
}

describe('message catalog', () => {
  it('locale is vi', () => {
    expect(locale).toBe('vi');
  });

  it('every leaf is a non-empty string', () => {
    for (const [path, value] of leaves(messages, '')) {
      expect(typeof value, path).toBe('string');
      expect((value as string).trim().length, path).toBeGreaterThan(0);
    }
  });
});
