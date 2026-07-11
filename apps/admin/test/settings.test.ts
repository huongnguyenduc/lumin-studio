import { describe, it, expect } from 'vitest';
import { extractVariables, isStkConfigured, shippingRulesOf } from '../src/lib/settings';

describe('isStkConfigured', () => {
  it('mirrors the checkout gate: true when bin + accountNumber are present', () => {
    expect(isStkConfigured({ bin: '970436', accountNumber: '123', accountName: 'LUMIN' })).toBe(
      true,
    );
    // accountName is save-required but not the payment gate, so its absence does not block checkout.
    expect(isStkConfigured({ bin: '970436', accountNumber: '123' })).toBe(true);
  });
  it('is false when bin or accountNumber is missing or blank', () => {
    expect(isStkConfigured(undefined)).toBe(false);
    expect(isStkConfigured({})).toBe(false);
    expect(isStkConfigured({ bin: '970436' })).toBe(false);
    expect(isStkConfigured({ bin: '  ', accountNumber: '123' })).toBe(false);
  });
});

describe('extractVariables', () => {
  it('returns unique {token} placeholders in first-seen order', () => {
    expect(extractVariables('Phí {phí}, giao {ngày}. Lại {phí}. CK {STK}')).toEqual([
      '{phí}',
      '{ngày}',
      '{STK}',
    ]);
  });
  it('returns [] when there are no tokens', () => {
    expect(extractVariables('không có biến nào')).toEqual([]);
  });
});

describe('shippingRulesOf', () => {
  it('returns the rules array, or [] when unset', () => {
    expect(
      shippingRulesOf({
        bankAccount: {},
        refundPolicy: '',
        updatedAt: '2026-01-01T00:00:00Z',
        shippingRules: [{ province: 'Hà Nội', fee: 30000 }],
      }),
    ).toHaveLength(1);
    expect(
      shippingRulesOf({ bankAccount: {}, refundPolicy: '', updatedAt: '2026-01-01T00:00:00Z' }),
    ).toEqual([]);
  });
});
