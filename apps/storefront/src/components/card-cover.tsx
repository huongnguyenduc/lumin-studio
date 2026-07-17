'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SpriteTurntable } from './sprite-turntable';

/** How long the intent must hold — hover (PC) or the tile resting in view (touch) — before the swap. */
const DWELL_MS = 1200;
/** How long the sprite plays before the cover returns to the real photo. */
const PLAY_MS = 3000;

/**
 * The catalog-card cover tile (ADR-049 / storefront rule "hover / dừng-2s → 360° sprite"). The static
 * shop photo (images[0]) is ALWAYS the first thing shown. Holding intent for DWELL_MS — pointer hover on a
 * hover-capable device, or the tile resting ~fully in view on a touch device — swaps to the 360° sprite,
 * which rocks gently for ~3s and then yields back to the photo (one cycle per hover/entry; leaving or
 * scrolling out cancels immediately). A tiny client island so CatalogCard itself stays a server
 * component. No sprite / no photo falls back to exactly the static img / dotgrid the card showed
 * before. Under prefers-reduced-motion the sprite still swaps in but stays on frame 0
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
  const [active, setActive] = useState(false);
  const dwellTimer = useRef<ReturnType<typeof setTimeout>>();
  const playTimer = useRef<ReturnType<typeof setTimeout>>();

  // Shared dwell→play→revert cycle for BOTH triggers: 2s of held intent starts the sprite, 3s of
  // sprite hands back to the photo. Stable identities (refs only) so the IO effect can depend on them.
  const begin = useCallback(() => {
    clearTimeout(dwellTimer.current);
    clearTimeout(playTimer.current);
    dwellTimer.current = setTimeout(() => {
      setActive(true);
      playTimer.current = setTimeout(() => setActive(false), PLAY_MS);
    }, DWELL_MS);
  }, []);
  const cancel = useCallback(() => {
    clearTimeout(dwellTimer.current);
    clearTimeout(playTimer.current);
    setActive(false);
  }, []);

  useEffect(() => {
    // The sprite is already "preloaded ngầm" (hi-fi 02) — it mounts opacity-0, so the browser fetches
    // it up front.
    if (!spriteSheetUrl) return;
    const el = ref.current;
    if (!el) return;

    if (window.matchMedia('(hover: hover)').matches) {
      // HOVER path. The listeners go on the surrounding card ([data-card-root]), NOT this div: the
      // catalog card's stretched link draws an ::after overlay across the whole tile, so the pointer's
      // hit target over the image is the <a> — this div never receives enter/leave itself.
      const root = el.closest('[data-card-root]') ?? el;
      root.addEventListener('pointerenter', begin);
      root.addEventListener('pointerleave', cancel);
      return () => {
        root.removeEventListener('pointerenter', begin);
        root.removeEventListener('pointerleave', cancel);
        cancel();
      };
    }

    // TOUCH path: the tile resting ~fully in view is the "intent".
    const io = new IntersectionObserver(([entry]) => (entry.isIntersecting ? begin() : cancel()), {
      threshold: 0.9,
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancel();
    };
  }, [spriteSheetUrl, begin, cancel]);

  return (
    <div
      ref={ref}
      className="relative aspect-square overflow-hidden rounded-md border border-border-subtle bg-surface-sunken"
    >
      {imageSrc && !active ? (
        // Plain <img> (matches product-detail): shop photos are remote content-hash URLs served immutable
        // via Cloudflare (storefront rule §CWV). Alt is the product name.
        <img src={imageSrc} alt={name} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        // While the sprite plays, the layer under it is the dotgrid — not the shop photo — so the
        // transparent sprite frames read against the pattern, not a ghost of the real image.
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
