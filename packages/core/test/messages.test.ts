import { describe, it, expect } from 'vitest';
import { vi } from '../src/i18n/vi';
import { ORDER_STATUSES } from '../src/order-state';

// The order-status catalog (vi.orderStatus) is the single source of shopper-facing status names,
// consumed by the guest tracker (P1-o) and the customer account (P1-s). It MUST stay 1:1 with the
// OrderStatus enum: a new status without a label would render blank on the timeline, and a stray label
// signals a renamed/removed status. This is the "armed messages.test" the Phase-1 plan (§5) calls for.
describe('i18n order-status labels', () => {
  const labels = vi.orderStatus as Record<string, string>;

  it('every OrderStatus has a non-empty label (a new status without copy fails here)', () => {
    for (const status of ORDER_STATUSES) {
      const label = labels[status];
      expect(label, `missing orderStatus label for ${status}`).toBeTruthy();
      expect(label.trim(), `blank orderStatus label for ${status}`).not.toBe('');
    }
  });

  it('has no orphan label without a matching status (catalog stays 1:1 with the enum)', () => {
    const known = new Set<string>(ORDER_STATUSES);
    for (const key of Object.keys(labels)) {
      expect(known.has(key), `orderStatus.${key} has no matching OrderStatus`).toBe(true);
    }
  });
});
