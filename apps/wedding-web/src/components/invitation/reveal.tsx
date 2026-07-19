'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

// Scroll-reveal per HANDOFF §2.11: start hidden 26px low, one-shot reveal at 12%
// visibility (rootMargin -6%), optional stagger delay. prefers-reduced-motion →
// no animation, content shows immediately (improvement over the prototype).
export function Reveal({
  delay = 0,
  style,
  children,
}: {
  delay?: number;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(true);
      return;
    }
    setAnimate(true);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShown(true);
            io.unobserve(e.target);
          }
        }
      },
      // Huge TOP margin: an element the user has already scrolled PAST counts as
      // intersecting, so a fast scroll that skips the viewport in one frame can't
      // strand it invisible (the prototype has this latent bug). Bottom -6% keeps
      // the designed reveal point when entering from below.
      { threshold: 0.12, rootMargin: '10000px 0px -6% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // A caller's own `transform` (e.g. translateX(-50%) to center) must combine
  // with the reveal's translateY, not be replaced by it — otherwise a
  // centered element loses its centering once revealed.
  const base = style?.transform ? `${style.transform} ` : '';
  return (
    <div
      ref={ref}
      style={{
        ...style,
        ...(animate
          ? {
              opacity: shown ? 1 : 0,
              transform: shown ? (style?.transform ?? 'none') : `${base}translateY(26px)`,
              transition: 'opacity 1.1s ease-out, transform 1.25s cubic-bezier(0.22,0.61,0.36,1)',
              transitionDelay: `${delay}ms`,
            }
          : undefined),
      }}
    >
      {children}
    </div>
  );
}

// GrowLine: same scroll-trigger as Reveal, but draws the line top-to-bottom
// (scaleY from a fixed transformOrigin) instead of fading — for a connector
// line that should feel like it flows down into what follows (events §2.4).
export function GrowLine({ style, background }: { style?: CSSProperties; background: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(true);
      return;
    }
    setAnimate(true);
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShown(true);
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: '10000px 0px -6% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // The IntersectionObserver watches THIS outer div, which keeps its full
  // flex-resolved size — the scaleY animation lives on an inner absolutely
  // positioned child instead. Animating the observed element itself would
  // collapse its box to zero height, and a zero-area target never crosses a
  // >0 intersection threshold: the reveal would permanently deadlock hidden.
  return (
    <div ref={ref} aria-hidden style={{ ...style, position: 'relative' }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background,
          transformOrigin: 'top',
          ...(animate
            ? {
                transform: shown ? 'scaleY(1)' : 'scaleY(0)',
                transition: 'transform 1.7s cubic-bezier(0.22,0.61,0.36,1)',
              }
            : { transform: 'scaleY(1)' }),
        }}
      />
    </div>
  );
}
