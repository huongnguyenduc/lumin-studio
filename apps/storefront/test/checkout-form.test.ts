import { describe, it, expect } from 'vitest';
import {
  buildWebOrderInput,
  EMPTY_CHECKOUT_FORM,
  normalizePhone,
  personalizationAckMet,
  validateCheckoutForm,
  type CheckoutFormState,
  type ValidatedCheckout,
} from '../src/lib/checkout-form';
import { cartQuoteItems, type CartItem } from '../src/lib/cart';

// A fully-valid info form; each test overrides the field under exam. Mirrors the server's authoritative
// validate() (checkout.go intake.validate) — these assertions are the client half of that contract.
function form(partial: Partial<CheckoutFormState> = {}): CheckoutFormState {
  return {
    email: 'an@lumin.vn',
    name: 'Nguyễn An',
    phone: '0901234567',
    province: 'TP.HCM',
    ward: 'Phường Bến Nghé',
    street: '12 Nguyễn Huệ',
    note: '',
    ...partial,
  };
}

/** Assert the form is rejected with exactly `field: code`. */
function expectError(state: CheckoutFormState, field: string, code: string): void {
  const result = validateCheckoutForm(state);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.errors[field as keyof typeof result.errors]).toBe(code);
}

describe('normalizePhone', () => {
  it('strips all whitespace so a display-spaced number matches the server regex', () => {
    expect(normalizePhone('0901 234 567')).toBe('0901234567');
    expect(normalizePhone('  +84 90 123 4567 ')).toBe('+84901234567');
    expect(normalizePhone('0901234567')).toBe('0901234567');
  });
});

describe('validateCheckoutForm — happy path', () => {
  it('returns the normalized, server-shaped payload', () => {
    const result = validateCheckoutForm(
      form({ email: '  an@lumin.vn ', phone: '0901 234 567', note: '  giao giờ hành chính ' }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      customer: { name: 'Nguyễn An', phone: '0901234567', email: 'an@lumin.vn' },
      shippingAddress: { province: 'TP.HCM', ward: 'Phường Bến Nghé', street: '12 Nguyễn Huệ' },
      note: 'giao giờ hành chính',
    });
  });

  it('omits note when blank (optional); email always present', () => {
    const result = validateCheckoutForm(form({ note: '' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.customer.email).toBe('an@lumin.vn');
    expect('note' in result.value).toBe(false);
  });
});

describe('validateCheckoutForm — name (2–60 runes, trimmed)', () => {
  it('rejects under 2 runes and accepts the 2-rune boundary', () => {
    expectError(form({ name: 'A' }), 'name', 'nameInvalid');
    expect(validateCheckoutForm(form({ name: ' An ' })).ok).toBe(true); // trims to "An" = 2 runes
  });

  it('accepts 60 runes and rejects 61', () => {
    expect(validateCheckoutForm(form({ name: 'x'.repeat(60) })).ok).toBe(true);
    expectError(form({ name: 'x'.repeat(61) }), 'name', 'nameInvalid');
  });

  it('counts runes, not UTF-16 units (an astral char is ONE rune)', () => {
    // '𝐀' is a single code point but two UTF-16 units; 60 of them are 60 runes (ok), 120 by .length.
    expect(validateCheckoutForm(form({ name: '𝐀'.repeat(60) })).ok).toBe(true);
    expectError(form({ name: '𝐀'.repeat(61) }), 'name', 'nameInvalid');
  });
});

describe('validateCheckoutForm — phone (^(0|+84)\\d{9}$, whitespace-tolerant)', () => {
  it('accepts a 0-prefixed and a +84-prefixed number, with display spaces', () => {
    expect(validateCheckoutForm(form({ phone: '0912345678' })).ok).toBe(true);
    expect(validateCheckoutForm(form({ phone: '+84912345678' })).ok).toBe(true);
    expect(validateCheckoutForm(form({ phone: '0912 345 678' })).ok).toBe(true);
  });

  it('rejects wrong length, wrong prefix, and blank', () => {
    expectError(form({ phone: '091234567' }), 'phone', 'phoneInvalid'); // 9 digits
    expectError(form({ phone: '1912345678' }), 'phone', 'phoneInvalid'); // no 0/+84
    expectError(form({ phone: '' }), 'phone', 'phoneInvalid');
  });
});

describe('validateCheckoutForm — email (required, "contains @")', () => {
  it('rejects a malformed email and a blank one (required since 2026-07-20)', () => {
    expectError(form({ email: 'notanemail' }), 'email', 'emailInvalid');
    expectError(form({ email: '   ' }), 'email', 'emailRequired');
  });
});

describe('validateCheckoutForm — required address fields (trimmed non-empty)', () => {
  it('requires province, ward, and street', () => {
    expectError(form({ province: '' }), 'province', 'provinceRequired');
    expectError(form({ ward: '   ' }), 'ward', 'wardRequired');
    expectError(form({ street: '' }), 'street', 'streetRequired');
  });

  it('reports every field error at once', () => {
    const result = validateCheckoutForm({ ...EMPTY_CHECKOUT_FORM });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual([
      'email',
      'name',
      'phone',
      'province',
      'street',
      'ward',
    ]);
  });
});

describe('personalizationAckMet — ADR-012 dual-ack gate (mirrors checkout.go:241)', () => {
  it('never gates a cart with no engraving, whatever the flags', () => {
    expect(personalizationAckMet(false, false, false)).toBe(true);
    expect(personalizationAckMet(false, true, false)).toBe(true);
  });

  it('requires BOTH acks once the cart is personalized', () => {
    expect(personalizationAckMet(true, false, false)).toBe(false);
    expect(personalizationAckMet(true, true, false)).toBe(false);
    expect(personalizationAckMet(true, false, true)).toBe(false);
    expect(personalizationAckMet(true, true, true)).toBe(true);
  });
});

/** Minimal CartItem fixture; each test overrides the priced/engrave axes under exam. */
function cartItem(partial: Partial<CartItem> = {}): CartItem {
  return {
    key: 'k1',
    productId: 'p1',
    slug: 'den-ngu',
    name: 'Đèn ngủ',
    colorId: null,
    colorName: null,
    optionIds: [],
    optionLabels: [],
    partColors: [],
    partColorLabels: [],
    optionChoices: [],
    optionChoiceLabels: [],
    engrave: null,
    quantity: 1,
    selected: true,
    ...partial,
  };
}

const baseValidated: ValidatedCheckout = {
  customer: { name: 'Nguyễn An', phone: '0901234567' },
  shippingAddress: { province: 'TP.HCM', ward: 'Phường Bến Nghé', street: '12 Nguyễn Huệ' },
};

describe('buildWebOrderInput — POST /orders body (P2-f)', () => {
  it('maps a plain cart: web channel, customer/address/proof, priced items; no personalization/acks/note', () => {
    const items = [cartItem({ productId: 'p1', colorId: 'c1', optionIds: ['o1'], quantity: 2 })];
    // Even though the validated form carries a note, it must NOT reach the body — CreateWebOrderInput has
    // no `note` field (display-only, the deferred contract gap).
    const body = buildWebOrderInput(
      { ...baseValidated, note: 'giao giờ hành chính' },
      items,
      'https://garage.local/proof/x.jpg',
    );
    expect(body.channel).toBe('web');
    expect(body.customer).toEqual(baseValidated.customer);
    expect(body.shippingAddress).toEqual(baseValidated.shippingAddress);
    expect(body.paymentProofUrl).toBe('https://garage.local/proof/x.jpg');
    expect(body.items).toEqual([
      { productId: 'p1', colorId: 'c1', optionIds: ['o1'], quantity: 2 },
    ]);
    expect('personalizationAck' in body).toBe(false);
    expect('engraveEchoConfirmed' in body).toBe(false);
    expect('note' in body).toBe(false);
  });

  it('priced item fields come STRAIGHT from the quote mapping (order can never be priced differently)', () => {
    const items = [
      cartItem({ productId: 'p1', colorId: 'c1', optionIds: ['o1'], quantity: 2 }),
      cartItem({
        key: 'k2',
        productId: 'p2',
        optionIds: [],
        engrave: { optionId: 'eng', text: 'An' },
        quantity: 1,
      }),
    ];
    const priced = cartQuoteItems(items);
    const body = buildWebOrderInput(baseValidated, items, 'u');
    expect(body.items).toHaveLength(priced.length);
    // Each order item CONTAINS its quote line's priced fields verbatim (may add personalization on top).
    priced.forEach((line, i) => expect(body.items[i]).toMatchObject(line));
  });

  it('threads a parts/choices line’s partColors + optionChoices into the order body (ADR-037)', () => {
    const items = [
      cartItem({
        productId: 'p2',
        colorId: null,
        partColors: [{ partId: 'p-shade', colorId: 'c-red' }],
        optionChoices: [{ optionId: 'opt-size', choiceId: 'ch-m' }],
        quantity: 1,
      }),
    ];
    const body = buildWebOrderInput(baseValidated, items, 'u');
    expect(body.items[0]).toMatchObject({
      productId: 'p2',
      partColors: [{ partId: 'p-shade', colorId: 'c-red' }],
      optionChoices: [{ optionId: 'opt-size', choiceId: 'ch-m' }],
    });
    // A parts product sends no flat colorId (sending both 422s the server).
    expect('colorId' in body.items[0]).toBe(false);
  });

  it('an engraved line folds the engrave option into optionIds and carries personalization {text, zoneId=optionId}; acks forwarded 1:1', () => {
    const items = [
      cartItem({ optionIds: ['o1'], engrave: { optionId: 'eng-1', text: 'An' }, quantity: 1 }),
    ];
    const body = buildWebOrderInput(
      { ...baseValidated, personalizationAck: true, engraveEchoConfirmed: true },
      items,
      'u',
    );
    expect(body.items).toEqual([
      {
        productId: 'p1',
        optionIds: ['o1', 'eng-1'],
        quantity: 1,
        personalization: { text: 'An', zoneId: 'eng-1' },
      },
    ]);
    expect(body.personalizationAck).toBe(true);
    expect(body.engraveEchoConfirmed).toBe(true);
  });

  it('drops a tampered blank-text engrave (mirrors the server personalizationFrom trim)', () => {
    const items = [cartItem({ engrave: { optionId: 'eng-1', text: '   ' }, quantity: 1 })];
    const body = buildWebOrderInput(baseValidated, items, 'u');
    // The engrave option is still folded into optionIds (priced like the quote), but no personalization
    // content is sent — the server would trim the blank text to "none" anyway.
    expect(body.items[0]?.optionIds).toEqual(['eng-1']);
    expect(body.items[0] && 'personalization' in body.items[0]).toBe(false);
  });
});
