'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { SpriteTurntable } from './sprite-turntable';
import type { Viewer3d } from '@/lib/viewer3d';

/** True when the browser can make a WebGL context (three.js needs it). One-shot, client-only. */
function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
  } catch {
    return false;
  }
}

/**
 * Live 3D viewer (P1-i, revised again for P1-j rev 2): the PDP's MAIN media tile, auto-loaded when
 * the browser has WebGL. Now a thin React shell over the imperative three.js wrapper in
 * `lib/viewer3d.ts` — <model-viewer> was replaced because REAL surface engraving (the typed text
 * projected onto the model as a decal at the admin-picked anchor) needs scene access that
 * model-viewer does not expose. The heavy module is still pulled via dynamic import so it stays out
 * of the initial JS bundle and only costs product pages that actually have a model. Orbit is
 * user-driven only — no autonomous motion, so prefers-reduced-motion is honoured by construction
 * (the a11y viewer-3D clause). When the browser lacks WebGL, the 360° sprite sheet (ADR-049) is the
 * fallback if the product has one, else `fallback` (the parent's static cover). `src` is the
 * product's `.glb` (the parent prefers the STRUCTURED glb so per-part recolor works); `partColors`
 * maps object name → hex for per-part recolor (f-3).
 */
export function Model3dViewer({
  src,
  productName,
  spriteSheetUrl,
  partColors,
  flatColorHex,
  engraveText,
  engraveAnchor,
  fallback,
}: {
  src: string;
  productName: string;
  spriteSheetUrl?: string;
  partColors?: Record<string, string>;
  /** FLAT (single-piece) product recolor: the picked colour's hex, applied to EVERY material of the
   *  model (a flat product has no part→object mapping, so the whole piece is the colour — mirrors what
   *  the printer does). Undefined for a parts product (partColors drives those) or before any pick. */
  flatColorHex?: string;
  /** Live engraving preview (P1-j rev 2): the typed text, projected onto the model's surface as a
   *  decal so it hugs curvature like a real engraving. Client-side only per the storefront rule (no
   *  server render per keystroke). Empty → none. */
  engraveText?: string;
  /** The admin-picked spot where that text sits (position + normal, model space, from the product).
   *  Undefined → the viewer's front-centre heuristic places it. */
  engraveAnchor?: {
    posX: number;
    posY: number;
    posZ: number;
    normX: number;
    normY: number;
    normZ: number;
  };
  /** Rendered while loading, on failure, and when the browser has neither WebGL nor a sprite —
   *  typically the parent's static cover image. */
  fallback?: React.ReactNode;
}) {
  const t = useTranslations('productDetail');
  const mountRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Viewer3d | null>(null);
  // null = undetermined (SSR/first paint — render the fallback, no hydration mismatch).
  const [webglOk, setWebglOk] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // WebGL is client-only; detect after mount, then dynamically load three + the wrapper and boot the
  // viewer into the mount node. A failed chunk OR a failed/corrupt .glb both land in `failed`.
  useEffect(() => {
    const ok = hasWebGL();
    setWebglOk(ok);
    if (!ok) return;
    let alive = true;
    let observer: ResizeObserver | null = null;
    import('@/lib/viewer3d')
      .then(({ Viewer3d }) => {
        if (!alive || !mountRef.current) return;
        const viewer = new Viewer3d(mountRef.current, () => alive && setFailed(true));
        viewerRef.current = viewer;
        observer = new ResizeObserver(() => viewer.resize());
        observer.observe(mountRef.current);
        void viewer.load(src).then(() => alive && setReady(true));
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      observer?.disconnect();
      viewerRef.current?.dispose();
      viewerRef.current = null;
    };
  }, [src]);

  // f-3 (ADR-052): recolor to the customer's picked colours — on load and on every selection change.
  useEffect(() => {
    if (ready) viewerRef.current?.setColors(partColors, flatColorHex);
  }, [ready, partColors, flatColorHex]);

  // Live engraving: retype → redraw the decal texture at the admin-picked anchor (or the heuristic).
  useEffect(() => {
    if (ready) viewerRef.current?.setServerAnchor(engraveAnchor ?? null);
  }, [ready, engraveAnchor]);
  useEffect(() => {
    if (ready) viewerRef.current?.setEngraveText(engraveText ?? '');
  }, [ready, engraveText]);

  // No WebGL → the 360° sprite sheet is the fallback (ADR-007/ADR-049): a self-turning turntable so a
  // WebGL-less browser still gets a rotating preview (stilled under reduced-motion). No sprite → the
  // parent's static cover (fallback). SSR / undetermined renders the fallback too (no hydration mismatch).
  if (webglOk !== true) {
    return webglOk === false && spriteSheetUrl ? (
      <SpriteTurntable
        src={spriteSheetUrl}
        alt={t('sprite360Alt', { name: productName })}
        active
        className="h-full w-full"
      />
    ) : (
      <>{fallback}</>
    );
  }

  return (
    <div className="relative h-full w-full">
      {/* The three.js canvas mounts here (imperatively). Hidden until the model is in so the cover
          below shows through while loading — no spinner flash, no layout shift. */}
      <div
        ref={mountRef}
        role="img"
        aria-label={t('view3dAlt', { name: productName })}
        className={'h-full w-full ' + (ready && !failed ? '' : 'invisible')}
      />
      {failed ? (
        // A broken chunk / corrupt .glb degrades to the static cover when the parent gave one — a shopper
        // with photos available should never stare at an error tile. role=alert only when there is nothing
        // better to show.
        <div className="absolute inset-0">
          {fallback ?? (
            <p
              role="alert"
              className="flex h-full w-full items-center justify-center px-4 text-center text-sm text-text-muted"
            >
              {t('view3dError')}
            </p>
          )}
        </div>
      ) : !ready ? (
        <div className="absolute inset-0">
          {fallback ?? (
            <p
              role="status"
              className="flex h-full w-full items-center justify-center text-sm text-text-muted"
            >
              {t('view3dLoading')}
            </p>
          )}
        </div>
      ) : (
        <>
          {/* Hi-fi drag hint, bottom-left of the running viewer. Decorative — the canvas is
              announced via its img role. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-3 left-3 font-mono text-[11px] text-text-muted"
          >
            {t('viewer3dCaption')}
          </span>
        </>
      )}
    </div>
  );
}
