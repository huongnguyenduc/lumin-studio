import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  transition,
  canTransition,
  isAllowedEdge,
  initialStatusForChannel,
  replayStatus,
  TransitionError,
  ORDER_STATUSES,
  TERMINAL_STATUSES,
  type OrderStatus,
  type Role,
  type StatusEvent,
} from '../src/order-state';
import { StatusEventSchema } from '../src/schemas';

const AT = '2026-06-25T00:00:00.000Z';
const order = (status: OrderStatus, statusHistory: StatusEvent[] = []) => ({
  status,
  statusHistory,
});

// The complete spec §04 truth table: `from>to` → roles allowed. Absent key = forbidden edge.
const TRUTH: Record<string, Role[]> = {
  'PENDING_CONFIRM>PAID': ['owner'],
  'PENDING_CONFIRM>CANCELLED': ['owner', 'staff'],
  'PAID>PRINTING': ['owner', 'staff'],
  'PAID>CANCELLED': ['owner', 'staff'],
  'PAID>REFUNDED': ['owner'],
  'PRINTING>SHIPPING': ['owner', 'staff'],
  'PRINTING>CANCELLED': ['owner', 'staff'],
  'PRINTING>REFUNDED': ['owner'],
  'SHIPPING>COMPLETED': ['owner', 'staff', 'system'],
  'SHIPPING>CANCELLED': ['owner', 'staff'],
  'SHIPPING>REFUNDED': ['owner'],
};
const ROLES: Role[] = ['owner', 'staff', 'system'];

describe('order_state', () => {
  it('order_state.transition_table — OSM-01: valid edges accepted, invalid rejected', () => {
    // Structural edge set matches the spec table exactly.
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        expect(isAllowedEdge(from, to)).toBe(`${from}>${to}` in TRUTH);
      }
    }
    // Terminal statuses have no outgoing edge.
    for (const t of TERMINAL_STATUSES) {
      for (const to of ORDER_STATUSES) expect(isAllowedEdge(t, to)).toBe(false);
    }
    // Valid progress edges succeed (kills drop-edge / swap mutants).
    expect(
      transition(order('PENDING_CONFIRM'), 'PAID', { role: 'owner', byUser: 'u', at: AT }).status,
    ).toBe('PAID');
    expect(
      transition(order('PAID'), 'PRINTING', { role: 'owner', byUser: 'u', at: AT }).status,
    ).toBe('PRINTING');
    expect(
      transition(order('PRINTING'), 'SHIPPING', { role: 'owner', byUser: 'u', at: AT }).status,
    ).toBe('SHIPPING');
    // Invalid edges throw (kills allow-all / add-illegal / terminal-escape mutants).
    expect(() =>
      transition(order('PAID'), 'SHIPPING', { role: 'owner', byUser: 'u', at: AT }),
    ).toThrow(TransitionError); // skip-ahead
    expect(() =>
      transition(order('PRINTING'), 'PAID', { role: 'owner', byUser: 'u', at: AT }),
    ).toThrow(TransitionError); // backward
    expect(() =>
      transition(order('COMPLETED'), 'SHIPPING', { role: 'owner', byUser: 'u', at: AT }),
    ).toThrow(TransitionError); // terminal escape
    expect(() =>
      transition(order('CANCELLED'), 'PAID', { role: 'owner', byUser: 'u', at: AT, reason: 'x' }),
    ).toThrow(TransitionError);
  });

  it('order_state.appends_status_history — OSM-02: exactly one record appended, input untouched', () => {
    const o = order('PAID');
    const next = transition(o, 'PRINTING', { role: 'owner', byUser: 'u1', at: AT });
    expect(next.statusHistory).toHaveLength(1);
    expect(o.statusHistory).toHaveLength(0);
    expect(next.statusHistory[0]).toEqual({ from: 'PAID', to: 'PRINTING', at: AT, byUser: 'u1' });
  });

  it('order_state.cancel_refund_requires_reason — OSM-03: reason (+ refundProofUrl) required', () => {
    expect(() =>
      transition(order('PENDING_CONFIRM'), 'CANCELLED', { role: 'owner', byUser: 'u', at: AT }),
    ).toThrow(/lý do/);
    expect(() =>
      transition(order('PAID'), 'CANCELLED', { role: 'owner', byUser: 'u', at: AT, reason: '   ' }),
    ).toThrow(TransitionError);
    expect(
      transition(order('PAID'), 'CANCELLED', {
        role: 'owner',
        byUser: 'u',
        at: AT,
        reason: 'khách bỏ',
      }).status,
    ).toBe('CANCELLED');
    // REFUNDED additionally needs a refund proof.
    expect(() =>
      transition(order('PAID'), 'REFUNDED', {
        role: 'owner',
        byUser: 'u',
        at: AT,
        reason: 'lỗi shop',
      }),
    ).toThrow(/refundProofUrl/);
    const refunded = transition(order('PAID'), 'REFUNDED', {
      role: 'owner',
      byUser: 'u',
      at: AT,
      reason: 'lỗi shop',
      refundProofUrl: 'https://garage.lumin/r/1.jpg',
    });
    expect(refunded.status).toBe('REFUNDED');
    expect(refunded.statusHistory[0]).toMatchObject({
      to: 'REFUNDED',
      reason: 'lỗi shop',
      refundProofUrl: 'https://garage.lumin/r/1.jpg',
    });
  });

  it('order_state.reconcile_paid_owner_only — OSM-04: staff cannot reconcile → PAID or refund', () => {
    expect(() =>
      transition(order('PENDING_CONFIRM'), 'PAID', { role: 'staff', byUser: 's', at: AT }),
    ).toThrow(/không được phép/);
    expect(canTransition('PENDING_CONFIRM', 'PAID', 'staff')).toBe(false);
    expect(canTransition('PENDING_CONFIRM', 'PAID', 'owner')).toBe(true);
    expect(canTransition('PAID', 'REFUNDED', 'staff')).toBe(false);
    expect(canTransition('PAID', 'REFUNDED', 'owner')).toBe(true);
  });

  it('order_state.rbac_matrix — OSM-05: canTransition matches the spec table for every (from,to,role)', () => {
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        for (const role of ROLES) {
          const expected = (TRUTH[`${from}>${to}`] ?? []).includes(role);
          expect(canTransition(from, to, role)).toBe(expected);
        }
      }
    }
  });

  it('entry points per channel: web → PENDING_CONFIRM (needs proof), inbox → PAID', () => {
    expect(initialStatusForChannel('web', { hasPaymentProof: true })).toBe('PENDING_CONFIRM');
    expect(() => initialStatusForChannel('web', { hasPaymentProof: false })).toThrow(
      TransitionError,
    );
    expect(initialStatusForChannel('inbox', { hasPaymentProof: false })).toBe('PAID');
  });

  it('statusHistory.at must be Z-only UTC — guard + schema accept the same set (no numeric offset)', () => {
    const withAt = (at: string) =>
      transition(order('PAID'), 'PRINTING', { role: 'owner', byUser: 'u', at });
    // Canonical Z instant: accepted by the guard AND by StatusEventSchema.
    expect(withAt('2026-06-25T00:00:00.000Z').status).toBe('PRINTING');
    // A numeric offset (+07:00) is rejected by BOTH layers — they agree (review PR #4, finding #1).
    expect(() => withAt('2026-06-25T07:00:00+07:00')).toThrow(/ISO-8601 UTC/);
    expect(
      StatusEventSchema.safeParse({
        from: 'PAID',
        to: 'PRINTING',
        at: '2026-06-25T07:00:00+07:00',
        byUser: 'u',
      }).success,
    ).toBe(false);
    expect(
      StatusEventSchema.safeParse({
        from: 'PAID',
        to: 'PRINTING',
        at: '2026-06-25T00:00:00.000Z',
        byUser: 'u',
      }).success,
    ).toBe(true);
  });

  it('property — any reachable statusHistory replays back to the current status via valid edges', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            to: fc.constantFrom(...ORDER_STATUSES),
            role: fc.constantFrom<Role>('owner', 'staff', 'system'),
            withReason: fc.boolean(),
            withProof: fc.boolean(),
          }),
          { maxLength: 14 },
        ),
        (steps) => {
          let cur = order('PENDING_CONFIRM');
          let applied = 0;
          for (const s of steps) {
            try {
              cur = transition(cur, s.to, {
                role: s.role,
                byUser: 'u',
                at: AT,
                reason: s.withReason ? 'r' : undefined,
                refundProofUrl: s.withProof ? 'https://garage.lumin/r/x.jpg' : undefined,
              });
              applied += 1;
            } catch (e) {
              expect(e).toBeInstanceOf(TransitionError);
            }
          }
          expect(cur.statusHistory).toHaveLength(applied);
          if (applied > 0) expect(replayStatus(cur.statusHistory)).toBe(cur.status);
        },
      ),
    );
  });

  it('replayStatus — a creation event (from: null) at the head replays to the final status', () => {
    const history: StatusEvent[] = [
      { from: null, to: 'PENDING_CONFIRM', at: AT, byUser: 'system' },
      { from: 'PENDING_CONFIRM', to: 'PAID', at: AT, byUser: 'owner' },
    ];
    expect(replayStatus(history)).toBe('PAID');
  });
});
