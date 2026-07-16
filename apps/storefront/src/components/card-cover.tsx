'use client';

import { useEffect, useRef, useState } from 'react';
import { SpriteTurntable } from './sprite-turntable';

/** Hi-fi 02 "dừng 2s → 360°": how long the tile must rest in view (touch devices) before the swap. */
const DWELL_MS = 2000;

/**
 * The catalog-card cover tile: the static shop photo (images[0]) by default, with the 360° sprite
 * turntable overlaid when the product has one (ADR-049 / storefront rule "hover (PC) / dừng-2s
 * (mobile) → 360° sprite"). On a hover-capable device the swap rides pointer hover; on a touch device
 * (no hover) the hi-fi 02 behaviour applies — the tile resting ~fully in view for 2s swaps to the
 * sprite, scrolling it out swaps back. A tiny client island so CatalogCard itself stays a server
 * component. No sprite / no photo falls back to exactly the static img / dotgrid the card showed
 * before. Under prefers-reduced-motion the turntable still fades in but stays on frame 0
 * (SpriteTurntable's gate) — a still 360° cover, no autonomous motion (a11y rule).
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
  const ref = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [dwelled, setDwelled] = useState(false);

  useEffect(() => {
    // Hover devices use the pointer handlers; the dwell timer is the TOUCH path only. The sprite is
    // already "preloaded ngầm" (hi-fi 02) — it mounts opacity-0, so the browser fetches it up front.
    if (!spriteSheetUrl || window.matchMedia('(hover: hover)').matches) return;
    const el = ref.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(
      ([entry]) => {
        clearTimeout(timer);
        if (entry.isIntersecting) timer = setTimeout(() => setDwelled(true), DWELL_MS);
        else setDwelled(false);
      },
      { threshold: 0.9 },
    );
    io.observe(el);
    return () => {
      clearTimeout(timer);
      io.disconnect();
    };
  }, [spriteSheetUrl]);

  const active = hovered || dwelled;

  return (
    <div
      ref={ref}
      className="relative aspect-square overflow-hidden rounded-md border border-border-subtle bg-surface-sunken"
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
          active={active}
          className={`absolute inset-0 transition-opacity duration-150 motion-reduce:transition-none ${
            active ? 'opacity-100' : 'opacity-0'
          }`}
        />
      ) : null}
    </div>
  );
}
