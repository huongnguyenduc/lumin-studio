import { describe, it, expect } from 'vitest';
import {
  buildTimeline,
  isPollableStatus,
  normalizeLookupInput,
  PROGRESS_STATUSES,
  type TimelineData,
} from '../src/lib/order-lookup-view';

// A timeline payload with milestones reached up to (and including) `status`, each stamped so we can
// assert the `at` mapping. Close states (CANCELLED/REFUNDED) append after the last progress reached.
function timeline(
  partial: Partial<TimelineData> & { status: TimelineData['status'] },
): TimelineData {
  return {
    code: '#LMN-1000',
    milestones: [],
    createdAt: '2026-06-25T00:00:00.000Z',
    ...partial,
  };
}

describe('buildTimeline — happy path frontier', () => {
  it('marks earlier steps done, the current status current, and later steps upcoming', () => {
    const model = buildTimeline(
      timeline({
        status: 'PRINTING',
        milestones: [
          { status: 'PENDING_CONFIRM', at: '2026-06-25T01:00:00.000Z' },
          { status: 'PAID', at: '2026-06-25T02:00:00.000Z' },
          { status: 'PRINTING', at: '2026-06-25T03:00:00.000Z' },
        ],
      }),
    );
    expect(model.steps.map((s) => s.state)).toEqual([
      'done', // PENDING_CONFIRM
      'done', // PAID
      'current', // PRINTING
      'upcoming', // SHIPPING
      'upcoming', // COMPLETED
    ]);
    expect(model.closeState).toBeNull();
  });

  it('carries the reached timestamp on each done/current step and null on upcoming steps', () => {
    const model = buildTimeline(
      timeline({
        status: 'PAID',
        milestones: [
          { status: 'PENDING_CONFIRM', at: '2026-06-25T01:00:00.000Z' },
          { status: 'PAID', at: '2026-06-25T02:00:00.000Z' },
        ],
      }),
    );
    expect(model.steps[0].at).toBe('2026-06-25T01:00:00.000Z');
    expect(model.steps[1].at).toBe('2026-06-25T02:00:00.000Z');
    expect(model.steps[2].at).toBeNull(); // PRINTING — not reached
  });

  it('the first status makes step 0 current and everything after upcoming', () => {
    const model = buildTimeline(
      timeline({
        status: 'PENDING_CONFIRM',
        milestones: [{ status: 'PENDING_CONFIRM', at: '2026-06-25T01:00:00.000Z' }],
      }),
    );
    expect(model.steps[0].state).toBe('current');
    expect(model.steps.slice(1).every((s) => s.state === 'upcoming')).toBe(true);
  });

  it('COMPLETED marks the final step current and all prior steps done', () => {
    const model = buildTimeline(
      timeline({
        status: 'COMPLETED',
        milestones: PROGRESS_STATUSES.map((status, i) => ({
          status,
          at: `2026-06-25T0${i + 1}:00:00.000Z`,
        })),
      }),
    );
    expect(model.steps.slice(0, 4).every((s) => s.state === 'done')).toBe(true);
    expect(model.steps[4].state).toBe('current');
    expect(model.closeState).toBeNull();
  });
});

describe('buildTimeline — close states', () => {
  it('CANCELLED after PAID freezes progress at what was reached (no current step) and adds a close banner', () => {
    const model = buildTimeline(
      timeline({
        status: 'CANCELLED',
        milestones: [
          { status: 'PENDING_CONFIRM', at: '2026-06-25T01:00:00.000Z' },
          { status: 'PAID', at: '2026-06-25T02:00:00.000Z' },
          { status: 'CANCELLED', at: '2026-06-25T03:00:00.000Z' },
        ],
      }),
    );
    expect(model.steps.map((s) => s.state)).toEqual([
      'done', // PENDING_CONFIRM
      'done', // PAID
      'upcoming', // PRINTING — never reached
      'upcoming', // SHIPPING
      'upcoming', // COMPLETED
    ]);
    expect(model.steps.some((s) => s.state === 'current')).toBe(false);
    expect(model.closeState).toEqual({ status: 'CANCELLED', at: '2026-06-25T03:00:00.000Z' });
  });

  it('REFUNDED surfaces a refunded close banner with its instant', () => {
    const model = buildTimeline(
      timeline({
        status: 'REFUNDED',
        milestones: [
          { status: 'PENDING_CONFIRM', at: '2026-06-25T01:00:00.000Z' },
          { status: 'PAID', at: '2026-06-25T02:00:00.000Z' },
          { status: 'PRINTING', at: '2026-06-25T03:00:00.000Z' },
          { status: 'REFUNDED', at: '2026-06-25T04:00:00.000Z' },
        ],
      }),
    );
    expect(model.closeState).toEqual({ status: 'REFUNDED', at: '2026-06-25T04:00:00.000Z' });
    expect(model.steps[2].state).toBe('done'); // PRINTING was reached before the refund
  });
});

describe('buildTimeline — tracking code', () => {
  it('surfaces a non-empty tracking code', () => {
    const model = buildTimeline(timeline({ status: 'SHIPPING', trackingCode: 'GHN123456' }));
    expect(model.trackingCode).toBe('GHN123456');
  });

  it('treats a missing or blank tracking code as null (never renders an empty row)', () => {
    expect(buildTimeline(timeline({ status: 'PAID' })).trackingCode).toBeNull();
    expect(
      buildTimeline(timeline({ status: 'SHIPPING', trackingCode: '  ' })).trackingCode,
    ).toBeNull();
  });
});

describe('isPollableStatus', () => {
  it('polls while the order is still moving', () => {
    for (const status of ['PENDING_CONFIRM', 'PAID', 'PRINTING', 'SHIPPING'] as const) {
      expect(isPollableStatus(status), status).toBe(true);
    }
  });

  it('stops polling on a terminal status', () => {
    for (const status of ['COMPLETED', 'CANCELLED', 'REFUNDED'] as const) {
      expect(isPollableStatus(status), status).toBe(false);
    }
  });
});

describe('normalizeLookupInput', () => {
  it('trims and upper-cases the code, trims the phone', () => {
    expect(normalizeLookupInput('  #lmn-1000 ', ' 0912 345 678 ')).toEqual({
      code: '#LMN-1000',
      phone: '0912 345 678',
    });
  });

  it('returns null when either field is blank (nothing to look up)', () => {
    expect(normalizeLookupInput('', '0912345678')).toBeNull();
    expect(normalizeLookupInput('#LMN-1000', '   ')).toBeNull();
    expect(normalizeLookupInput('  ', '  ')).toBeNull();
  });
});
