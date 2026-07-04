import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { formatVnDate, formatVnNumber, formatVnRating } from '@lumin/core';
import { Rating } from '@lumin/ui';
import { totalPages } from '@/lib/catalog-params';
import type { ReviewView } from '@/lib/product-view';

export type ProductReviewsProps = {
  /** Product slug — the base for the pager's `?reviewsPage=` links (server-rendered navigation). */
  slug: string;
  /** The published reviews on the current page (newest first), already projected to the view. */
  reviews: ReviewView[];
  /** Total published reviews across all pages (drives the pager + the summary count). */
  total: number;
  /** 1-based current page (echoed from the endpoint). */
  page: number;
  /** Items per page (echoed from the endpoint) — the page-count math uses this exact value. */
  pageSize: number;
  /** The product's denormalised average rating (0–5), or null before the first review. The reviews
   *  endpoint returns no aggregate, so the summary star average comes from the product (the same source
   *  as the rating shown at the top of the detail page — one screen, one number). */
  productRating: number | null;
};

/**
 * Reviews section on the product detail page (/san-pham/{slug}, P1-m). A server component — it has no
 * client interactivity: pagination is server-rendered `<Link>`s driven by `?reviewsPage=` (URL is the
 * single source of truth, keyboard-safe, works with JS off), matching the catalog-browse pager.
 *
 * The reviewer's IDENTITY is deliberately never rendered — the contract omits it (PDPL: reviews carry a
 * nullable customer_id and guests may review, so a name/avatar would be public PII). The hi-fi mock
 * shows a name + avatar + "✓ Đã mua" badge; those are intentionally dropped here (documented deviation),
 * so a review is stars + date + body + optional photos + an optional shop reply.
 *
 * States (conventions §State — the screen's loading/error live on the route: loading.tsx skeleton +
 * error.tsx retry; this section owns EMPTY): `total === 0` → a friendly empty note (no "write a review"
 * CTA — reviews are read-only in Phase 1). Dates and counts are formatted ONLY via @lumin/core
 * (formatVnDate / formatVnNumber) — never Intl here (MNY-03, ESLint-enforced).
 */
export function ProductReviews({
  slug,
  reviews,
  total,
  page,
  pageSize,
  productRating,
}: ProductReviewsProps) {
  const t = useTranslations('productReviews');
  const pageCount = totalPages(total, pageSize);

  // `?reviewsPage=1` is omitted so page 1 stays the clean `/san-pham/{slug}#reviews` (mirrors the catalog
  // pager dropping `page=1`). The `#reviews` fragment lands the reader back at this section after a page
  // change rather than at the top of the product.
  const reviewsHref = (target: number): string => {
    const base = `/san-pham/${encodeURIComponent(slug)}`;
    return target <= 1 ? `${base}#reviews` : `${base}?reviewsPage=${target}#reviews`;
  };

  return (
    <section
      id="reviews"
      aria-labelledby="reviews-heading"
      className="mx-auto w-full max-w-[1200px] scroll-mt-24 px-4 pb-12 md:px-6"
    >
      <h2
        id="reviews-heading"
        className="font-display text-xl font-bold text-text-strong md:text-2xl"
      >
        {t('heading')}
      </h2>

      {total === 0 ? (
        <div className="mt-4 rounded-lg border border-border-default bg-surface-sunken px-4 py-8 text-center">
          <p className="text-text-body">{t('empty')}</p>
          <p className="mt-1 text-sm text-text-muted">{t('emptyHint')}</p>
        </div>
      ) : (
        <>
          {/* Summary — big average + stars + count. The average comes from the product denorm (the
              reviews endpoint carries no aggregate); guarded so a count-without-average denorm lag still
              renders the count line rather than an empty "0". */}
          <div className="mt-4 flex items-center gap-4 rounded-lg border border-border-default bg-surface-sunken px-4 py-3">
            {productRating != null ? (
              <span className="font-display text-3xl font-bold leading-none tabular-nums text-text-strong">
                {formatVnRating(productRating)}
              </span>
            ) : null}
            <div className="flex flex-col gap-1">
              {productRating != null ? (
                // The label uses formatVnRating (like the visible number above), so the screen-reader
                // announcement matches the on-screen average to one decimal — never the raw multi-decimal
                // float (e.g. "4,7 trên 5 sao", not "4,667"). Mirrors the summaryCount pre-format below.
                <Rating
                  value={productRating}
                  size="sm"
                  label={t('ratingLabel', { value: formatVnRating(productRating) })}
                />
              ) : null}
              <span className="text-sm text-text-muted">
                {t('summaryCount', { count: formatVnNumber(total) })}
              </span>
            </div>
          </div>

          {/* Review list. No headings inside a card (heading order stays h1 → h2), so each review is a
              plain list item: rating + date, then optional body, photos, and shop reply. */}
          <ul className="mt-4 flex flex-col gap-3">
            {reviews.map((review) => (
              <li
                key={review.id}
                className="rounded-lg border border-border-default bg-surface-card p-4"
              >
                <div className="flex items-center gap-3">
                  <Rating
                    value={review.rating}
                    size="sm"
                    label={t('ratingLabel', { value: review.rating })}
                  />
                  <time dateTime={review.createdAt} className="font-mono text-xs text-text-muted">
                    {formatVnDate(review.createdAt)}
                  </time>
                </div>

                {review.body ? (
                  <p className="mt-2 whitespace-pre-line text-text-body">{review.body}</p>
                ) : null}

                {review.images.length > 0 ? (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {review.images.map((src, i) => (
                      <li key={src}>
                        {/* Arbitrary shop-photo hosts → a plain <img> (no next/image remotePatterns to
                            maintain), matching the product gallery. */}
                        <img
                          src={src}
                          alt={t('photoAlt', { index: i + 1 })}
                          loading="lazy"
                          className="h-20 w-20 rounded-md border border-border-default object-cover"
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}

                {review.reply ? (
                  <div className="mt-3 rounded-md border-l-2 border-accent-teal bg-surface-sunken px-3 py-2">
                    <p className="text-sm font-semibold text-accent-teal">{t('replyLabel')}</p>
                    <p className="mt-1 whitespace-pre-line text-sm text-text-body">
                      {review.reply.body}
                    </p>
                    <time
                      dateTime={review.reply.at}
                      className="mt-1 block font-mono text-xs text-text-muted"
                    >
                      {formatVnDate(review.reply.at)}
                    </time>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>

          {/* Pager — prev/next (newest reviews are page 1, so "Cũ hơn" pages back in time). Disabled ends
              render as muted, non-interactive spans so focus never lands on a dead control. */}
          {pageCount > 1 ? (
            <nav
              aria-label={t('pagerLabel')}
              className="mt-6 flex items-center justify-center gap-4 text-sm"
            >
              {page > 1 ? (
                <Link
                  href={reviewsHref(page - 1)}
                  className="rounded-md px-3 py-2 font-medium text-text-strong underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
                >
                  {t('pagerNewer')}
                </Link>
              ) : (
                <span aria-disabled="true" className="px-3 py-2 text-text-muted opacity-50">
                  {t('pagerNewer')}
                </span>
              )}

              <span aria-current="page" className="font-mono text-text-muted tabular-nums">
                {t('pagerPosition', { page, total: pageCount })}
              </span>

              {page < pageCount ? (
                <Link
                  href={reviewsHref(page + 1)}
                  className="rounded-md px-3 py-2 font-medium text-text-strong underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
                >
                  {t('pagerOlder')}
                </Link>
              ) : (
                <span aria-disabled="true" className="px-3 py-2 text-text-muted opacity-50">
                  {t('pagerOlder')}
                </span>
              )}
            </nav>
          ) : null}
        </>
      )}
    </section>
  );
}
