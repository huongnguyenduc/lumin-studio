'use client';

import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from './lib/cn';
import { Card } from './Card';
import { Badge, type BadgeTone } from './Badge';
import { Rating } from './Rating';
import { PriceTag } from './PriceTag';
import { IconButton } from './IconButton';
import { Button } from './Button';

// HOUSE-STYLE REFERENCE (see Button.tsx): forwardRef to the real DOM node (the Card root), `className`
// through cn() LAST so callers can override, semantic token utilities only (bg-surface-sunken,
// text-text-strong …) — never raw hex. Money/number formatting lives ENTIRELY inside the leaf
// primitives (PriceTag/Rating already go through @lumin/core) — this composer never touches Intl
// (ADR-019, ESLint-enforced). NO hard-coded copy: every label (title, addLabel, favLabel, ratingLabel,
// badge.label) is a prop; the only literals are decorative glyphs in the leaves.
export interface ProductCardProps extends HTMLAttributes<HTMLDivElement> {
  /** Product name (i18n string from the call site). Clamped to two lines. */
  title: string;
  /** Optional product image; falls back to a `.lumin-dotgrid` placeholder when omitted. */
  imageSrc?: string;
  /** Alt text for the image; defaults to `title` when not supplied. */
  imageAlt?: string;
  /** Current price in int VND — formatted by PriceTag via @lumin/core. */
  price: number;
  /** Optional struck original price in int VND. */
  compareAt?: number;
  /** Optional merch pill over the image (e.g. "Mới", "Sắp hết"). */
  badge?: { label: string; tone?: BadgeTone };
  /** Optional rating 0–5; the Rating block only renders when provided. */
  rating?: number;
  /** Optional review count, grouped by @lumin/core inside Rating. */
  reviewCount?: number;
  /** aria-label for the Rating group (i18n string passed to Rating's `label`). */
  ratingLabel?: string;
  /** Whether the product is favourited (drives the fav button's `aria-pressed`). */
  faved?: boolean;
  /** Toggle handler for the fav IconButton. */
  onToggleFav?: () => void;
  /** Required accessible name for the fav IconButton (i18n at the call site). */
  favLabel: string;
  /** Add-to-cart handler for the primary Button. */
  onAdd?: () => void;
  /** Visible label for the add-to-cart Button (i18n at the call site). */
  addLabel: string;
  /** Optional link to the product detail page; wraps the title when present. */
  href?: string;
}

/**
 * Merchandising tile that composes the finished leaf primitives — image + fav IconButton + optional
 * Badge, the title, an optional Rating with review count, a PriceTag, and a full-width add-to-cart
 * Button (design-system.md §Component "ProductCard"). The outer surface is a `pop` Card; ref forwards
 * to that Card root. All money/number formatting is delegated to PriceTag/Rating (no Intl here).
 */
export const ProductCard = forwardRef<HTMLDivElement, ProductCardProps>(function ProductCard(
  {
    className,
    title,
    imageSrc,
    imageAlt,
    price,
    compareAt,
    badge,
    rating,
    reviewCount,
    ratingLabel,
    faved,
    onToggleFav,
    favLabel,
    onAdd,
    addLabel,
    href,
    ...props
  },
  ref,
) {
  return (
    <Card
      ref={ref}
      elevation="pop"
      className={cn(
        // Visual lift only — deliberately NOT `interactive`: the tile is navigated via the stretched
        // title link below, so the Card must not become a role="button" wrapping its own link + buttons
        // (that nesting is invalid + a focusable dead control for AT). See the PR-6 review.
        'group relative flex flex-col gap-3 p-3',
        'transition-transform duration-150 ease-out hover:-translate-x-px hover:-translate-y-px motion-reduce:transform-none',
        className,
      )}
      {...props}
    >
      <div className="relative aspect-square overflow-hidden rounded-md bg-surface-sunken">
        {imageSrc ? (
          <img src={imageSrc} alt={imageAlt ?? title} className="h-full w-full object-cover" />
        ) : (
          <div className="lumin-dotgrid h-full w-full" aria-hidden="true" />
        )}

        {badge ? (
          <div className="absolute left-2 top-2">
            <Badge tone={badge.tone}>{badge.label}</Badge>
          </div>
        ) : null}

        <IconButton
          variant="soft"
          size="sm"
          label={favLabel}
          aria-pressed={faved}
          onClick={onToggleFav}
          className="absolute right-2 top-2 z-10 shadow-md"
        >
          {faved ? '♥' : '♡'}
        </IconButton>
      </div>

      <h3 className="line-clamp-2 font-display font-semibold leading-tight text-text-strong">
        {href ? (
          // Stretched link: the ::after overlay makes the whole card navigate to the product, while the
          // fav/add buttons (z-10) stay independently clickable — one link, no nested button-role.
          <a
            href={href}
            className={cn(
              "rounded-sm after:absolute after:inset-0 after:content-['']",
              'hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-sky focus-visible:ring-offset-2',
            )}
          >
            {title}
          </a>
        ) : (
          title
        )}
      </h3>

      {rating != null ? (
        <Rating value={rating} count={reviewCount} label={ratingLabel} size="sm" />
      ) : null}

      <PriceTag amount={price} compareAt={compareAt} />

      <Button onClick={onAdd} className="relative z-10 w-full">
        {addLabel}
      </Button>
    </Card>
  );
});
