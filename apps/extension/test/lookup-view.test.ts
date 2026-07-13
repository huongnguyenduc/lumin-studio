import { describe, expect, it } from 'vitest';
import type { OrderStatus } from '@lumin/core';
import {
  nextActions,
  parseOrderCode,
  progressSteps,
  reachedMilestoneIndex,
} from '../src/lib/lookup-view';

describe('parseOrderCode', () => {
  it('canonicalizes assorted paste shapes to "#LMN-NNNN" (zero-padded to 4)', () => {
    expect(parseOrderCode('#LMN-0042')).toBe('#LMN-0042');
    expect(parseOrderCode('LMN-0042')).toBe('#LMN-0042'); // no leading #
    expect(parseOrderCode('lmn-42')).toBe('#LMN-0042'); // lower-case, unpadded
    expect(parseOrderCode('LMN 1000')).toBe('#LMN-1000'); // space instead of dash
    expect(parseOrderCode('Đơn của em là #LMN-1234 nhé')).toBe('#LMN-1234'); // inside a chat line
    expect(parseOrderCode('#LMN-12345')).toBe('#LMN-12345'); // 5 digits: no truncation
  });

  it('returns null for text with no order code — including a pet-tag code (letter after LMN)', () => {
    expect(parseOrderCode('hello')).toBeNull();
    expect(parseOrderCode('')).toBeNull();
    expect(parseOrderCode('#LMN-T0001')).toBeNull(); // pet tag, not an order
    expect(parseOrderCode('1000')).toBeNull(); // bare digits, no LMN — too ambiguous to guess
  });
});

describe('progressSteps', () => {
  it('a PRINTING order: earlier milestones done, PRINTING current, later todo', () => {
    const history = [{ to: 'PENDING_CONFIRM' }, { to: 'PAID' }, { to: 'PRINTING' }] as {
      to: OrderStatus;
    }[];
    expect(progressSteps('PRINTING', history).map((s) => s.state)).toEqual([
      'done',
      'done',
      'current',
      'todo',
      'todo',
    ]);
  });

  it('a CANCELLED-from-PAID order: PAID still shows reached (done), nothing is "current"', () => {
    const history = [{ to: 'PENDING_CONFIRM' }, { to: 'PAID' }, { to: 'CANCELLED' }] as {
      to: OrderStatus;
    }[];
    expect(reachedMilestoneIndex(history)).toBe(1); // PAID; CANCELLED is off the track
    expect(progressSteps('CANCELLED', history).map((s) => s.state)).toEqual([
      'done',
      'done',
      'todo',
      'todo',
      'todo',
    ]);
  });
});

describe('nextActions', () => {
  it('hides owner-only edges from staff: PENDING_CONFIRM staff can only cancel, owner can also confirm', () => {
    expect(nextActions('PENDING_CONFIRM', 'staff')).toEqual([{ to: 'CANCELLED', kind: 'cancel' }]);
    expect(nextActions('PENDING_CONFIRM', 'owner')).toEqual([
      { to: 'PAID', kind: 'direct' },
      { to: 'CANCELLED', kind: 'cancel' },
    ]);
  });

  it('ship is deferred (needs a QC photo); refund is owner-only AND deferred (needs a proof)', () => {
    // PRINTING → SHIPPING (defer) + CANCELLED (cancel) for staff; owner also gets REFUNDED (defer).
    expect(nextActions('PRINTING', 'staff')).toEqual([
      { to: 'SHIPPING', kind: 'defer' },
      { to: 'CANCELLED', kind: 'cancel' },
    ]);
    expect(nextActions('PRINTING', 'owner')).toEqual([
      { to: 'SHIPPING', kind: 'defer' },
      { to: 'CANCELLED', kind: 'cancel' },
      { to: 'REFUNDED', kind: 'defer' },
    ]);
  });

  it('a terminal order offers nothing', () => {
    expect(nextActions('COMPLETED', 'owner')).toEqual([]);
    expect(nextActions('CANCELLED', 'owner')).toEqual([]);
    expect(nextActions('REFUNDED', 'owner')).toEqual([]);
  });
});
