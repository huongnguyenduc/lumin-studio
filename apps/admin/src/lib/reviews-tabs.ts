import type { components } from '@lumin/api-client';

type AdminReview = components['schemas']['AdminReview'];

// Client-side tab derivation for the review moderation page (/danh-gia, P3-n). The BE has NO 'pending'
// status — a review is only `published` or `hidden` (P3-m) — so the design's tabs are DERIVED from
// status + reply + images, not fetched per-status. A hidden review appears ONLY under `hidden` (so it
// stays reachable to un-hide — hiding without a way back would be a data trap); the other three tabs are
// published-only. `hasImage` cross-cuts pending/replied (a pending review with photos is in both).
export type ReviewTab = 'pending' | 'replied' | 'hasImage' | 'hidden';

export const REVIEW_TABS: readonly ReviewTab[] = ['pending', 'replied', 'hasImage', 'hidden'];

/** Whether a review belongs under `tab`. */
export function matchesReviewTab(review: AdminReview, tab: ReviewTab): boolean {
  if (tab === 'hidden') return review.status === 'hidden';
  if (review.status !== 'published') return false; // hidden reviews live only under the `hidden` tab
  switch (tab) {
    case 'pending':
      return !review.reply;
    case 'replied':
      return Boolean(review.reply);
    case 'hasImage':
      return review.images.length > 0;
  }
}

/** Per-tab counts for the tab badges (one pass; a review can count toward several tabs). */
export function reviewTabCounts(reviews: AdminReview[]): Record<ReviewTab, number> {
  const counts: Record<ReviewTab, number> = { pending: 0, replied: 0, hasImage: 0, hidden: 0 };
  for (const review of reviews) {
    for (const tab of REVIEW_TABS) {
      if (matchesReviewTab(review, tab)) counts[tab] += 1;
    }
  }
  return counts;
}
