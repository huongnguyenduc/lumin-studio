import { fetchAdminReviews } from '@/lib/reviews-fetch';
import { ReviewsView } from '@/components/reviews-view';

/**
 * Reviews route (Đánh giá, /danh-gia, P3-n). Async server component: fetches every review as an admin
 * moderation card (GET /admin/reviews) forwarding the session cookie, and hands them to the client
 * ReviewsView (which owns the tabs + reply/hide/show). A fetch failure is caught by (app)/error.tsx
 * (retry); loading is ./loading.tsx (skeleton). `no-store` keeps the list live after a moderation write.
 */
export default async function ReviewsPage() {
  const reviews = await fetchAdminReviews();
  return <ReviewsView reviews={reviews} />;
}
