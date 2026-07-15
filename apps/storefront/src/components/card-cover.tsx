'use client';

import { useState } from 'react';
import { SpriteTurntable } from './sprite-turntable';

/**
 * The catalog-card cover tile: the static shop photo (images[0]) by default, with the 360° sprite
 * turntable overlaid ON HOVER when the product has one (ADR-049 / storefront rule "hover → 360° sprite").
 * A tiny client island so CatalogCard itself stays a server component — only the hover interaction needs
 * JS. No sprite / no photo falls back to exactly the static img / dotgrid the card showed before. Under
 * prefers-reduced-motion the turntable still fades in on hover but stays on frame 0 (SpriteTurntable's gate)
 * — a still 360° cover, no autonomous motion (a11y rule).
 */
export function CardCover({
  imageSrc,
  spriteSheetUrl,
  name,
  spriteAlt,
}: {
  imageSrc?: string;
  spriteSheetUrl?: string;
  name: string;
  spriteAlt: string;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="relative aspect-square overflow-hidden rounded-md bg-surface-sunken"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      {imageSrc ? (
        // Plain <img> (matches product-detail): shop photos are remote content-hash URLs served immutable
        // via Cloudflare (storefront rule §CWV). Alt is the product name.
        <img src={imageSrc} alt={name} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <div className="lumin-dotgrid h-full w-full" aria-hidden="true" />
      )}
      {spriteSheetUrl ? (
        <SpriteTurntable
          src={spriteSheetUrl}
          alt={spriteAlt}
          active={hovered}
          className={`absolute inset-0 transition-opacity duration-150 motion-reduce:transition-none ${
            hovered ? 'opacity-100' : 'opacity-0'
          }`}
        />
      ) : null}
    </div>
  );
}
