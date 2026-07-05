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

describe('storefront i18n catalog', () => {
  it('has leaves to validate', () => {
    expect(leaves.length).toBeGreaterThan(0);
  });

  it('every message is a non-empty trimmed string', () => {
    const bad = leaves.filter(([, value]) => value.trim() === '');
    expect(bad, `empty messages: ${bad.map(([p]) => p).join(', ')}`).toEqual([]);
  });

  it('no message hard-codes a formatted price (money comes from @lumin/core formatVnd)', () => {
    // Thousand-grouped numbers like "390.000" / "1,234" — these must be rendered by PriceTag /
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

describe('chinh-sach policy page (P2-h)', () => {
  const p = messages.chinhSach;

  it('declares the privacy-notice version matching core-api consentPolicyVersion', () => {
    // Must stay in sync with services/core-api/internal/httpapi/checkout.go `consentPolicyVersion`.
    // The consent + đổi-trả links in checkout (P2-d) point at this page; a drift means customers
    // consent under a version whose notice text they can't see (PDPL, compliance §2).
    expect(p.version).toBe('2026-01');
  });

  it('covers both required policy surfaces (return/exchange + PDPL what/why/retention/rights)', () => {
    // Return/exchange (Luật BVNTD 19/2023, ADR-012): personalized goods are non-returnable.
    expect(p.returns.personalized).toContain('không đổi trả');
    // PDPL privacy notice must state what we collect, why, how long, and the customer's rights.
    expect(Object.keys(p.privacy.collectItems).length).toBeGreaterThan(0);
    expect(Object.keys(p.privacy.rightsItems).length).toBeGreaterThan(0);
    expect(p.privacy.purpose.trim()).not.toBe('');
    expect(p.privacy.retention.trim()).not.toBe('');
  });
});
