import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { formatVnd, parseVnd, calcTotals, type TotalsInput } from '../src/money';

describe('money', () => {
  it('money.single_formatter — MNY-03: 390.000₫ shape (U+20AB, no whitespace)', () => {
    expect(formatVnd(390000)).toBe('390.000₫');
    expect(formatVnd(0)).toBe('0₫');
    expect(formatVnd(1000000)).toBe('1.000.000₫');
    expect(formatVnd(390000)).toContain('₫');
    expect(formatVnd(390000)).not.toMatch(/\s/);
    expect(() => formatVnd(390000.5)).toThrow(RangeError);
    expect(() => formatVnd(-1)).toThrow(RangeError);
  });

  it('money.single_formatter — round-trip parseVnd(formatVnd(n)) === n (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10 ** 12 }), (n) => {
        expect(parseVnd(formatVnd(n))).toBe(n);
      }),
    );
  });

  it('money.parts_sum_equals_total — MNY-01: subtotal + shippingFee === total, all int VND (property)', () => {
    const item = fc.record({
      unitPrice: fc.integer({ min: 0, max: 10 ** 7 }),
      quantity: fc.integer({ min: 1, max: 20 }),
      colorDelta: fc.integer({ min: 0, max: 10 ** 6 }),
      optionDeltas: fc.array(fc.integer({ min: 0, max: 10 ** 6 }), { maxLength: 4 }),
    });
    fc.assert(
      fc.property(
        fc.array(item, { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 0, max: 10 ** 7 }),
        (items, shippingFee) => {
          const t = calcTotals({ items, shippingFee });
          expect(t.subtotal + t.shippingFee).toBe(t.total);
          expect(Number.isInteger(t.total)).toBe(true);
          const expectedSub = items.reduce(
            (s, it) =>
              s +
              it.quantity *
                (it.unitPrice + it.colorDelta + it.optionDeltas.reduce((a, b) => a + b, 0)),
            0,
          );
          expect(t.subtotal).toBe(expectedSub);
        },
      ),
    );
  });

  it('money.rejects_client_total — MNY-02: a client-sent total is ignored; server recomputes', () => {
    const items = [{ unitPrice: 100000, quantity: 2 }];
    const sneaky = { items, shippingFee: 30000, total: 1 } as unknown as TotalsInput;
    const t = calcTotals(sneaky);
    expect(t.subtotal).toBe(200000);
    expect(t.total).toBe(230000);
  });

  it('rejects non-integer / negative money inputs', () => {
    expect(() => calcTotals({ items: [{ unitPrice: 1.5, quantity: 1 }], shippingFee: 0 })).toThrow(
      RangeError,
    );
    expect(() => calcTotals({ items: [{ unitPrice: 1000, quantity: 0 }], shippingFee: 0 })).toThrow(
      RangeError,
    );
    expect(() =>
      calcTotals({ items: [{ unitPrice: 1000, quantity: 1 }], shippingFee: -5 }),
    ).toThrow(RangeError);
  });
});
