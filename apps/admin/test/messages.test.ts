import { describe, it, expect } from 'vitest';
import { messages } from '../src/messages';

/** Flatten every leaf string in the composed catalog to `[dotted.path, value]`. */
function collectStrings(value: unknown, path: string, out: Array<[string, string]>): void {
  if (typeof value === 'string') {
    out.push([path, value]);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      collectStrings(child, path ? `${path}.${key}` : key, out);
    }
  }
}

const leaves: Array<[string, string]> = [];
collectStrings(messages, '', leaves);

describe('admin i18n catalog', () => {
  it('has leaves to validate', () => {
    expect(leaves.length).toBeGreaterThan(0);
  });

  it('every message is a non-empty trimmed string', () => {
    const bad = leaves.filter(([, value]) => value.trim() === '');
    expect(bad, `empty messages: ${bad.map(([p]) => p).join(', ')}`).toEqual([]);
  });

  it('no message hard-codes a formatted price (money comes from @lumin/core formatVnd)', () => {
    // Thousand-grouped numbers like "390.000" / "1,234" — these must be rendered by formatVnd /
    // formatVnNumber, never frozen into copy (conventions §Tiền). Plain ranges like "3–5" are fine.
    const grouped = /\d{1,3}([.,]\d{3})+/;
    const offenders = leaves.filter(([, value]) => grouped.test(value));
    expect(
      offenders,
      `prices baked into copy: ${offenders.map(([p, v]) => `${p}="${v}"`).join(', ')}`,
    ).toEqual([]);
  });

  it('exposes the @lumin/core domain catalog under the `core` namespace', () => {
    expect(messages.core?.cart?.empty).toBeTruthy();
    expect(messages.core?.validation?.addressIncomplete).toBeTruthy();
  });
});
