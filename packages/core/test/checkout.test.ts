import { describe, it, expect } from 'vitest';
import { initialStatusForChannel, TransitionError } from '../src/order-state';
import { CreateWebOrderInput } from '../src/schemas';

const customer = { name: 'Bơ Sữa', phone: '0901234567' };
const shippingAddress = {
  province: 'TP. Hồ Chí Minh',
  ward: 'Phường Bến Nghé',
  street: '12 Lê Lợi',
};
const baseInput = {
  channel: 'web' as const,
  customer,
  shippingAddress,
  items: [{ productId: 'p1', quantity: 1, unitPrice: 390000 }],
  paymentProofUrl: 'https://garage.lumin/proof/abc.jpg',
};

describe('checkout', () => {
  it('checkout.no_order_before_proof — CHK-01: no web order before a payment proof is attached', () => {
    expect(() => initialStatusForChannel('web', { hasPaymentProof: false })).toThrow(
      TransitionError,
    );
    const noProof = { channel: 'web' as const, customer, shippingAddress, items: baseInput.items };
    expect(CreateWebOrderInput.safeParse(noProof).success).toBe(false);
  });

  it('checkout.creates_order_on_proof — CHK-02: with proof, order starts at PENDING_CONFIRM', () => {
    expect(initialStatusForChannel('web', { hasPaymentProof: true })).toBe('PENDING_CONFIRM');
    expect(CreateWebOrderInput.safeParse(baseInput).success).toBe(true);
    // inbox channel enters straight at PAID (staff self-verified the transfer).
    expect(initialStatusForChannel('inbox', { hasPaymentProof: false })).toBe('PAID');
  });

  it('checkout.personalized_requires_ack — CHK-03: personalized item needs no-return ack + engrave echo', () => {
    const personalized = {
      ...baseInput,
      items: [
        {
          productId: 'p1',
          quantity: 1,
          unitPrice: 390000,
          personalization: { text: 'Bơ', zoneId: 'collar' },
        },
      ],
    };
    // Missing both acks → rejected.
    expect(CreateWebOrderInput.safeParse(personalized).success).toBe(false);
    // ADR-012 requires BOTH halves before payment, so either ack alone is still rejected.
    expect(
      CreateWebOrderInput.safeParse({ ...personalized, personalizationAck: true }).success,
    ).toBe(false);
    expect(
      CreateWebOrderInput.safeParse({ ...personalized, engraveEchoConfirmed: true }).success,
    ).toBe(false);
    // No-return ack + engrave-echo confirmation → accepted.
    expect(
      CreateWebOrderInput.safeParse({
        ...personalized,
        personalizationAck: true,
        engraveEchoConfirmed: true,
      }).success,
    ).toBe(true);
  });

  it('rejects malformed phone / incomplete address', () => {
    expect(
      CreateWebOrderInput.safeParse({ ...baseInput, customer: { name: 'A', phone: '123' } })
        .success,
    ).toBe(false);
    expect(
      CreateWebOrderInput.safeParse({
        ...baseInput,
        shippingAddress: { province: 'X', ward: '', street: 'Y' },
      }).success,
    ).toBe(false);
  });
});
