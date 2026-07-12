'use client';

import { useRef, useState, useTransition, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { formatVnDate } from '@lumin/core';
import { Badge, Button, Card, Rating } from '@lumin/ui';
import type { components } from '@lumin/api-client';
import { moderateReview, type ReviewWriteCode } from '@/lib/reviews-actions';
import { REVIEW_TABS, matchesReviewTab, reviewTabCounts, type ReviewTab } from '@/lib/reviews-tabs';

type AdminReview = components['schemas']['AdminReview'];
type ReviewModeration = components['schemas']['ReviewModeration'];

const REPLY_MAX = 2000; // mirrors the BE reply cap (runes) — the server is the wall

/**
 * "Đánh giá" (/danh-gia, P3-n) — the review moderation screen. The shop replies to reviews and hides/shows
 * them. Every review is fetched once (published + hidden); the tabs (chờ trả lời / đã trả lời / có ảnh / đã
 * ẩn) FILTER the list client-side — the BE has no 'pending' status, so each tab is derived from
 * status + reply + images (reviews-tabs.ts), and a hidden review sits only under "đã ẩn" so it's reachable
 * to un-hide. Reply/hide/show are owner AND staff (spec §08 — staff kiểm duyệt); router.refresh() re-reads
 * the RSC list after each write. No money on this screen (reviews carry no ₫).
 */
export function ReviewsView({ reviews }: { reviews: AdminReview[] }) {
  const t = useTranslations('reviews');
  const [tab, setTab] = useState<ReviewTab>('pending');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const counts = reviewTabCounts(reviews);
  const shown = reviews.filter((review) => matchesReviewTab(review, tab));

  function onTabKeyDown(e: KeyboardEvent, idx: number) {
    const last = REVIEW_TABS.length - 1;
    let next: number;
    if (e.key === 'ArrowRight') next = idx === last ? 0 : idx + 1;
    else if (e.key === 'ArrowLeft') next = idx === 0 ? last : idx - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    else return;
    e.preventDefault();
    setTab(REVIEW_TABS[next]);
    tabRefs.current[next]?.focus();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-text-strong">
          {t('title')} <span className="font-mono text-sm text-text-muted">· {reviews.length}</span>
        </h1>
        <p className="mt-1 max-w-prose text-sm text-text-muted">{t('hint')}</p>
      </div>

      <div className="flex flex-col gap-4">
        <div
          role="tablist"
          aria-label={t('tabsLabel')}
          className="flex flex-wrap gap-2 border-b border-border-subtle"
        >
          {REVIEW_TABS.map((key, idx) => {
            const active = tab === key;
            return (
              <button
                key={key}
                ref={(el) => {
                  tabRefs.current[idx] = el;
                }}
                role="tab"
                id={`reviews-tab-${key}`}
                aria-selected={active}
                aria-controls="reviews-panel"
                tabIndex={active ? 0 : -1}
                onClick={() => setTab(key)}
                onKeyDown={(e) => onTabKeyDown(e, idx)}
                className={`-mb-px min-h-[44px] rounded-t-lg border-2 border-b-0 px-4 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2 ${
                  active
                    ? 'border-border-strong bg-primary text-on-primary'
                    : 'border-transparent text-text-muted hover:text-text-strong'
                }`}
              >
                {t(`tabs.${key}`)}{' '}
                <span className="font-mono text-xs">{t('tabCount', { count: counts[key] })}</span>
              </button>
            );
          })}
        </div>

        <div
          role="tabpanel"
          id="reviews-panel"
          aria-labelledby={`reviews-tab-${tab}`}
          tabIndex={0}
          className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
        >
          {shown.length === 0 ? (
            <Card elevation="md" className="px-5 py-12 text-center text-sm text-text-muted">
              {reviews.length === 0 ? t('emptyAll') : t('emptyTab')}
            </Card>
          ) : (
            <ul className="flex flex-col gap-3">
              {shown.map((review) => (
                <ReviewCard key={review.id} review={review} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/** One moderation card: reviewer + product + stars + date, the review body/photos, the shop reply (read-only
 *  once posted or a composer when still pending), and a hide/show control. Owns its own reply draft + write
 *  transition + error. */
function ReviewCard({ review }: { review: AdminReview }) {
  const t = useTranslations('reviews');
  const router = useRouter();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<ReviewWriteCode | null>(null);
  const [pending, startTransition] = useTransition();

  const published = review.status === 'published';
  const name = review.customerName ?? t('guest');
  const trimmed = draft.trim();
  const replyTooLong = [...trimmed].length > REPLY_MAX;
  const canPost = trimmed.length > 0 && !replyTooLong;

  function run(body: ReviewModeration) {
    setError(null);
    startTransition(async () => {
      const res = await moderateReview(review.id, body);
      if (res.ok) router.refresh();
      else setError(res.code);
    });
  }

  return (
    <li>
      <Card elevation="md" className="flex flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="mt-0.5 h-9 w-9 shrink-0 rounded-full border border-border-strong bg-surface-sunken"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-text-strong">
              <span className="font-semibold">{name}</span>
              <span className="font-mono text-xs text-text-muted"> · {review.productName}</span>
            </p>
            <div className="mt-0.5 flex items-center gap-2">
              <Rating
                value={review.rating}
                size="sm"
                label={t('ratingLabel', { value: review.rating })}
              />
              <time dateTime={review.createdAt} className="font-mono text-xs text-text-muted">
                {formatVnDate(review.createdAt)}
              </time>
            </div>
          </div>
          {review.reply ? <Badge tone="teal">{t('badgeReplied')}</Badge> : null}
          {!published ? <Badge tone="neutral">{t('badgeHidden')}</Badge> : null}
        </div>

        {review.body ? (
          <p className="whitespace-pre-line text-sm text-text-body">{review.body}</p>
        ) : null}

        {review.images.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {review.images.map((src, i) => (
              <li key={src}>
                {/* Arbitrary shop-photo hosts → a plain <img> (no next/image remotePatterns), matching the
                    storefront review gallery. */}
                <img
                  src={src}
                  alt={t('photoAlt', { index: i + 1 })}
                  loading="lazy"
                  className="h-14 w-14 rounded-md border border-border-subtle object-cover"
                />
              </li>
            ))}
          </ul>
        ) : null}

        {/* Existing reply (read-only) — mirrors the storefront reply block the customer sees. */}
        {review.reply ? (
          <div className="ml-1 rounded-md border-l-2 border-accent-teal bg-surface-sunken px-3 py-2">
            <p className="text-sm font-semibold text-accent-teal">{t('replyLabel')}</p>
            <p className="mt-1 whitespace-pre-line text-sm text-text-body">{review.reply.body}</p>
            <time
              dateTime={review.reply.at}
              className="mt-1 block font-mono text-xs text-text-muted"
            >
              {formatVnDate(review.reply.at)}
            </time>
          </div>
        ) : null}

        {/* Reply composer — only when published & not yet replied. Sending status:published means replying a
            hidden review would also re-publish, but a hidden review shows "hiện lại" (not this composer). */}
        {published && !review.reply ? (
          <div className="flex flex-col gap-2">
            <label htmlFor={`reply-${review.id}`} className="sr-only">
              {t('replyFieldLabel', { name })}
            </label>
            <textarea
              id={`reply-${review.id}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t('replyPlaceholder')}
              rows={2}
              className="w-full resize-y rounded-lg border border-border-strong bg-surface-card px-3 py-2 text-sm text-text-body placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky"
            />
            <div className="flex items-center justify-end gap-2">
              {replyTooLong ? (
                <span role="alert" className="mr-auto text-sm text-danger">
                  {t('replyTooLong', { max: REPLY_MAX })}
                </span>
              ) : null}
              <Button
                size="sm"
                onClick={() => run({ status: 'published', reply: trimmed })}
                disabled={!canPost || pending}
              >
                {pending ? t('posting') : t('postReply')}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          {error ? (
            <span role="alert" className="text-sm text-danger">
              {t(`formError.${error}`)}
            </span>
          ) : null}
          {published ? (
            <button
              type="button"
              onClick={() => run({ status: 'hidden' })}
              disabled={pending}
              className="ml-auto min-h-[44px] rounded-pill px-3 text-sm text-text-muted hover:bg-surface-sunken disabled:opacity-50"
            >
              {t('hide')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => run({ status: 'published' })}
              disabled={pending}
              className="ml-auto min-h-[44px] rounded-pill px-3 text-sm font-semibold text-accent-teal hover:bg-surface-sunken disabled:opacity-50"
            >
              {t('show')}
            </button>
          )}
        </div>
      </Card>
    </li>
  );
}
