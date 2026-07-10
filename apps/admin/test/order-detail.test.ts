import { describe, it, expect } from 'vitest';
import type { OrderStatus } from '@lumin/core';
import {
  reachedMilestoneIndex,
  progressSteps,
  availableTransitions,
  transitionKind,
} from '../src/lib/order-detail';

// Pure-adapter tests (Docker-free). The progress track and the offered transitions are the branchy
// bits of the order-detail page — pin them so a state-machine or milestone change is caught here, not
// in the browser.

const hist = (...tos: OrderStatus[]) => tos.map((to) => ({ to }));

describe('reachedMilestoneIndex', () => {
  it('is 0 for a fresh PENDING_CONFIRM order', () => {
    expect(reachedMilestoneIndex(hist('PENDING_CONFIRM'))).toBe(0);
  });
  it('tracks the furthest milestone walked', () => {
    expect(reachedMilestoneIndex(hist('PENDING_CONFIRM', 'PAID', 'PRINTING'))).toBe(2);
  });
  it('remembers how far a cancelled order got (close state is off the track)', () => {
    expect(reachedMilestoneIndex(hist('PENDING_CONFIRM', 'PAID', 'CANCELLED'))).toBe(1);
  });
});

describe('progressSteps', () => {
  it('marks the current milestone current, the rest todo, for a fresh order', () => {
    const steps = progressSteps('PENDING_CONFIRM', hist('PENDING_CONFIRM'));
    expect(steps.map((s) => s.state)).toEqual(['current', 'todo', 'todo', 'todo', 'todo']);
  });
  it('marks passed milestones done and the current one current mid-flight', () => {
    const steps = progressSteps('PRINTING', hist('PENDING_CONFIRM', 'PAID', 'PRINTING'));
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'current', 'todo', 'todo']);
  });
  it('marks every step done when COMPLETED (final milestone is not "current")', () => {
    const steps = progressSteps(
      'COMPLETED',
      hist('PENDING_CONFIRM', 'PAID', 'PRINTING', 'SHIPPING', 'COMPLETED'),
    );
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'done', 'done', 'done']);
  });
  it('shows the reached milestones done and none current for a close state', () => {
    const steps = progressSteps('CANCELLED', hist('PENDING_CONFIRM', 'PAID', 'CANCELLED'));
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'todo', 'todo', 'todo']);
  });
});

describe('transitionKind', () => {
  it('maps each target to its affordance', () => {
    expect(transitionKind('PAID')).toBe('confirm');
    expect(transitionKind('SHIPPING')).toBe('ship');
    expect(transitionKind('CANCELLED')).toBe('cancel');
    expect(transitionKind('REFUNDED')).toBe('refund');
    expect(transitionKind('PRINTING')).toBe('advance');
    expect(transitionKind('COMPLETED')).toBe('advance');
  });
});

describe('availableTransitions', () => {
  it('offers the owner every edge incl. the owner-only ones (confirm/refund)', () => {
    expect(availableTransitions('PENDING_CONFIRM', 'owner')).toEqual([
      { to: 'PAID', kind: 'confirm' },
      { to: 'CANCELLED', kind: 'cancel' },
    ]);
    expect(availableTransitions('PAID', 'owner')).toEqual([
      { to: 'PRINTING', kind: 'advance' },
      { to: 'CANCELLED', kind: 'cancel' },
      { to: 'REFUNDED', kind: 'refund' },
    ]);
    expect(availableTransitions('PRINTING', 'owner')).toEqual([
      { to: 'SHIPPING', kind: 'ship' },
      { to: 'CANCELLED', kind: 'cancel' },
      { to: 'REFUNDED', kind: 'refund' },
    ]);
  });

  it('hides the owner-only edges from staff (no →PAID reconcile, no →REFUNDED)', () => {
    expect(availableTransitions('PENDING_CONFIRM', 'staff')).toEqual([
      { to: 'CANCELLED', kind: 'cancel' },
    ]);
    expect(availableTransitions('PAID', 'staff')).toEqual([
      { to: 'PRINTING', kind: 'advance' },
      { to: 'CANCELLED', kind: 'cancel' },
    ]);
  });

  it('offers nothing from a terminal status', () => {
    expect(availableTransitions('COMPLETED', 'owner')).toEqual([]);
    expect(availableTransitions('CANCELLED', 'owner')).toEqual([]);
    expect(availableTransitions('REFUNDED', 'owner')).toEqual([]);
  });
});
