'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { formatVnd } from '@lumin/core';
import { IconButton } from '@lumin/ui';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';
import type { ProductCardView } from '@/lib/product-view';

const SLIDE_MS = 5000;
const SWIPE_FRACTION = 0.15; // fraction of the tile width a drag must cross to change slide
const DRAG_CLICK_THRESHOLD = 8; // px moved before a pointer gesture counts as a drag, not a click

/**
 * Home hero, rebuilt to the hi-fi: a featured-product carousel on the signature buttercream +
 * dotgrid banner — coral "✦ Nổi bật" pill top-left, the product shot centered, a white mini-card
 * bottom-left with the name + mono-coral price line, prev/next arrows, and the carousel dots.
 * Auto-advances every 5s but NEVER under prefers-reduced-motion (a11y rule: no autonomous motion),
 * and pauses on hover/focus/drag. Each slide navigates to its product page (a drag past the click
 * threshold suppresses that click so a swipe never also fires a navigation); dots and arrows are
 * real buttons.
 */
export function HeroCarousel({ products }: { products: ProductCardView[] }) {
  const t = useTranslations('hero');
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = useRef(false);

  const wrapRef = useRef<HTMLDivElement>(null);
  const pointerIdRef = useRef<number | null>(null);
  const startXRef = useRef(0);
  const draggedRef = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reducedMotion.current = mq.matches;
    const onChange = (event: MediaQueryListEvent) => {
      reducedMotion.current = event.matches;
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    if (products.length <= 1) return;
    const id = setInterval(() => {
      if (!paused && !reducedMotion.current) {
        setIndex((current) => (current + 1) % products.length);
      }
    }, SLIDE_MS);
    return () => clearInterval(id);
  }, [paused, products.length]);

  const count = products.length;
  const goTo = (next: number) => setIndex(((next % count) + count) % count);

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (count <= 1) return;
    pointerIdRef.current = e.pointerId;
    startXRef.current = e.clientX;
    draggedRef.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (pointerIdRef.current !== e.pointerId) return;
    if (Math.abs(e.clientX - startXRef.current) > DRAG_CLICK_THRESHOLD) draggedRef.current = true;
  }

  function endDrag(e: ReactPointerEvent<HTMLDivElement>) {
    if (pointerIdRef.current !== e.pointerId) return;
    pointerIdRef.current = null;
    const delta = e.clientX - startXRef.current;
    const width = wrapRef.current?.offsetWidth || 1;
    if (delta > width * SWIPE_FRACTION) goTo(index - 1);
    else if (delta < -width * SWIPE_FRACTION) goTo(index + 1);
  }

  const active = products[Math.min(index, products.length - 1)];
  if (!active) return null;

  return (
    <section
      aria-roledescription="carousel"
      aria-label={t('carouselLabel')}
      className="mx-auto w-full max-w-[1200px] px-4 py-6 md:px-6 md:py-8"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <div
        ref={wrapRef}
        className="relative h-[260px] touch-pan-y select-none overflow-hidden rounded-[20px] bg-surface-cream md:h-[280px]"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="lumin-dotgrid absolute inset-0 opacity-50" aria-hidden="true" />

        <Link
          href={`/san-pham/${active.slug}`}
          className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2"
          aria-label={active.name}
          onClickCapture={(e) => {
            // A swipe that crossed the click threshold shouldn't ALSO navigate — the pointerup that
            // ends the drag is immediately followed by a click event on this same link.
            if (draggedRef.current) {
              e.preventDefault();
              draggedRef.current = false;
            }
          }}
        >
          <span className="flex h-full items-center justify-center">
            {active.imageSrc ? (
              <img
                src={active.imageSrc}
                alt=""
                className="h-[200px] w-[200px] rounded-md object-cover shadow-lg transition-opacity duration-300 motion-reduce:transition-none"
              />
            ) : (
              <span
                aria-hidden="true"
                className="block h-[190px] w-[190px] rounded-[46%_54%_50%_50%/55%_46%_54%_45%] border-2 border-border-strong bg-accent-flame-soft shadow-lg"
              />
            )}
          </span>
        </Link>

        <span className="pointer-events-none absolute left-4 top-4 rounded-pill bg-primary px-3 py-1 font-mono text-[10px] font-bold uppercase tracking-wide text-on-primary">
          {t('featuredBadge')}
        </span>

        <div className="pointer-events-none absolute bottom-5 left-5 max-w-[75%] rounded-md bg-surface-card/90 px-4 py-2.5">
          <p className="truncate font-display text-lg font-bold text-text-strong md:text-2xl">
            {active.name}
          </p>
          <p className="truncate font-mono text-xs font-bold text-primary">
            {t('slideMeta', { price: formatVnd(active.basePrice) })}
          </p>
        </div>

        {count > 1 ? (
          <>
            <IconButton
              variant="soft"
              size="sm"
              label={t('prevSlideLabel')}
              onClick={() => goTo(index - 1)}
              className="absolute left-3 top-1/2 -translate-y-1/2 bg-surface-card/80 backdrop-blur-sm"
            >
              <ChevronLeftIcon className="h-5 w-5" />
            </IconButton>
            <IconButton
              variant="soft"
              size="sm"
              label={t('nextSlideLabel')}
              onClick={() => goTo(index + 1)}
              className="absolute right-3 top-1/2 -translate-y-1/2 bg-surface-card/80 backdrop-blur-sm"
            >
              <ChevronRightIcon className="h-5 w-5" />
            </IconButton>

            <div className="absolute bottom-5 right-5 flex items-center gap-1.5 md:left-1/2 md:right-auto md:-translate-x-1/2">
              {products.map((product, dotIndex) => (
                <button
                  key={product.id}
                  type="button"
                  aria-label={t('dotLabel', { name: product.name })}
                  aria-current={dotIndex === index || undefined}
                  onClick={() => setIndex(dotIndex)}
                  className={`h-2.5 rounded-pill border border-border-strong transition-all duration-150 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky ${
                    dotIndex === index ? 'w-6 bg-border-strong' : 'w-2.5 bg-surface-card/80'
                  }`}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
