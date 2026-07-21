'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useDialogFocus } from '@/lib/use-dialog-focus';
import { OptimizedImg } from './optimized-img';
import type { ImgVariants } from '@/lib/site-settings';
import { CREAM, INK } from './theme';

// Full-screen zoomable/pannable view of the venue map image. Opened by tapping
// the small map on the invitation (the static thumbnail is too small to read).
// Wheel / pinch to zoom, drag to pan once zoomed, double-tap toggles 1×↔2.5×.
// Escape or the scrim closes. Motion respects prefers-reduced-motion via the
// global CSS transition kill-switch (globals.css), so no per-transform guard.
const MIN = 1;
const MAX = 5;

type View = { scale: number; x: number; y: number };
const RESET: View = { scale: 1, x: 0, y: 0 };

const btn = {
  // ≥44px tap target (a11y rule) — this is the public touch surface.
  width: 44,
  height: 44,
  borderRadius: 22,
  border: 'none',
  padding: 0,
  background: 'rgba(255,251,248,0.14)',
  color: CREAM,
  fontSize: 20,
  lineHeight: 1,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
} as const;

export function MapLightbox({
  src,
  img,
  alt,
  mapsUrl,
  onClose,
}: {
  src: string;
  /** Khổ lớn (≤1600px) — đủ nét ở mức zoom tối đa 5× của khung này. */
  img?: ImgVariants;
  alt: string;
  mapsUrl?: string;
  onClose: () => void;
}) {
  const t = useTranslations('letter');
  const [view, setView] = useState<View>(RESET);
  const viewRef = useRef(view);
  viewRef.current = view;
  const frameRef = useRef<HTMLDivElement>(null);
  const dialogRef = useDialogFocus<HTMLDivElement>(true); // mounted only while open
  // Active pointers for drag (1) / pinch (2).
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);
  const moved = useRef(false);

  const clamp = (s: number) => Math.min(MAX, Math.max(MIN, s));

  // Zoom around a viewport point (px relative to frame centre) so the spot under
  // the cursor/fingers stays put.
  const zoomAt = useCallback((nextScale: number, cx: number, cy: number) => {
    setView((v) => {
      const s = clamp(nextScale);
      const k = s / v.scale;
      // p = point in image space currently under (cx,cy): cx = x + p*scale.
      const x = cx - (cx - v.x) * k;
      const y = cy - (cy - v.y) * k;
      return s === MIN ? RESET : { scale: s, x, y };
    });
  }, []);

  const framePoint = (clientX: number, clientY: number) => {
    const r = frameRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: clientX - r.left - r.width / 2, y: clientY - r.top - r.height / 2 };
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === '+' || e.key === '=') setView((v) => ({ ...v, scale: clamp(v.scale + 0.5) }));
      if (e.key === '-') {
        const s = clamp(viewRef.current.scale - 0.5);
        setView((v) => (s === MIN ? RESET : { ...v, scale: s }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onWheel = (e: React.WheelEvent) => {
    const p = framePoint(e.clientX, e.clientY);
    zoomAt(viewRef.current.scale - e.deltaY * 0.002 * viewRef.current.scale, p.x, p.y);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: viewRef.current.scale };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = framePoint((a.x + b.x) / 2, (a.y + b.y) / 2);
      zoomAt(pinchStart.current.scale * (dist / pinchStart.current.dist), mid.x, mid.y);
      moved.current = true;
      return;
    }
    if (viewRef.current.scale <= MIN) return; // no pan at 1× — let the scrim take the click
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) moved.current = true;
    setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    // "Click the backdrop to close": released on the frame itself (beside the
    // image), no drag/pinch, last pointer up. Handled on pointer-up rather than
    // onClick so the frame stays a plain (non-interactive) pan/zoom surface.
    const backdrop = e.target === e.currentTarget;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    if (backdrop && !moved.current && pointers.current.size === 0) onClose();
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      tabIndex={-1}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 70,
        background: 'rgba(32,26,21,0.94)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      <div
        ref={frameRef}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(e) => {
          const p = framePoint(e.clientX, e.clientY);
          zoomAt(viewRef.current.scale > MIN ? MIN : 2.5, p.x, p.y);
        }}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          touchAction: 'none',
          cursor: view.scale > MIN ? 'grab' : 'zoom-in',
        }}
      >
        <OptimizedImg
          img={img}
          fallback={src}
          sizes="92vw"
          alt={alt}
          draggable={false}
          style={{
            maxWidth: '92vw',
            maxHeight: '86vh',
            objectFit: 'contain',
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transformOrigin: 'center center',
            transition: 'transform 0.12s ease-out',
            userSelect: 'none',
            boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
          }}
        />
      </div>

      {/* Controls — above the scrim. */}
      <button
        type="button"
        onClick={onClose}
        aria-label={t('mapClose')}
        className="invite-lb-btn"
        style={{ ...btn, position: 'absolute', top: 14, right: 14 }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
          <path d="M1 1 L11 11 M11 1 L1 11" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
      <div
        style={{
          position: 'absolute',
          bottom: 'calc(20px + env(safe-area-inset-bottom))',
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <button
          type="button"
          onClick={() =>
            setView((v) =>
              clamp(v.scale - 0.5) === MIN ? RESET : { ...v, scale: clamp(v.scale - 0.5) },
            )
          }
          aria-label={t('mapZoomOut')}
          className="invite-lb-btn"
          style={btn}
        >
          −
        </button>
        <button
          type="button"
          onClick={() => setView((v) => ({ ...v, scale: clamp(v.scale + 0.5) }))}
          aria-label={t('mapZoomIn')}
          className="invite-lb-btn"
          style={btn}
        >
          +
        </button>
        {mapsUrl ? (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="invite-lb-btn"
            style={{
              ...btn,
              width: 'auto',
              padding: '0 16px',
              fontSize: 12,
              letterSpacing: '0.04em',
              textDecoration: 'none',
              color: INK,
              background: CREAM,
            }}
          >
            {t('openMaps')}
          </a>
        ) : null}
      </div>
    </div>
  );
}
