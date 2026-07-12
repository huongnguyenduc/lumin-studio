import { describe, it, expect } from 'vitest';
import type { components } from '@lumin/api-client';
import { matchesReviewTab, reviewTabCounts } from '../src/lib/reviews-tabs';

type AdminReview = components['schemas']['AdminReview'];

// Pure tab-derivation tests (Docker-free) for the review moderation page (/danh-gia, P3-n). The BE has no
// 'pending' status; the FE derives tabs from status + reply + images. This pins that logic — especially
// that a hidden review is isolated to the `hidden` tab (never leaks into pending/replied/hasImage).

function review(over: Partial<AdminReview>): AdminReview {
  return {
    id: 'r1',
    productId: 'p1',
    productName: 'Đèn ngủ Mochi',
    rating: 5,
    body: 'Đẹp lắm',
    images: [],
    status: 'published',
    createdAt: '2026-07-10T00:00:00Z',
    ...over,
  };
}

const reply = { body: 'Cảm ơn bạn nhé 🧡', at: '2026-07-11T00:00:00Z' };

describe('matchesReviewTab', () => {
  it('pending = published & no reply', () => {
    const r = review({});
    expect(matchesReviewTab(r, 'pending')).toBe(true);
    expect(matchesReviewTab(r, 'replied')).toBe(false);
  });

  it('replied = published & has reply', () => {
    const r = review({ reply });
    expect(matchesReviewTab(r, 'replied')).toBe(true);
    expect(matchesReviewTab(r, 'pending')).toBe(false);
  });

  it('hasImage = published & images non-empty (cross-cuts pending/replied)', () => {
    const r = review({ images: ['a.jpg'] });
    expect(matchesReviewTab(r, 'hasImage')).toBe(true);
    expect(matchesReviewTab(r, 'pending')).toBe(true);
  });

  it('a hidden review is isolated to the hidden tab', () => {
    const r = review({ status: 'hidden', images: ['a.jpg'], reply });
    expect(matchesReviewTab(r, 'hidden')).toBe(true);
    expect(matchesReviewTab(r, 'pending')).toBe(false);
    expect(matchesReviewTab(r, 'replied')).toBe(false);
    expect(matchesReviewTab(r, 'hasImage')).toBe(false);
  });
});

describe('reviewTabCounts', () => {
  it('counts each tab (a review may count toward several)', () => {
    const counts = reviewTabCounts([
      review({ id: '1' }), // pending
      review({ id: '2', images: ['x.jpg'] }), // pending + hasImage
      review({ id: '3', reply }), // replied
      review({ id: '4', status: 'hidden' }), // hidden
    ]);
    expect(counts).toEqual({ pending: 2, replied: 1, hasImage: 1, hidden: 1 });
  });
});
