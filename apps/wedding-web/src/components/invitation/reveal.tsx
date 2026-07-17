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

  return (
    <div
      ref={ref}
      style={{
        ...style,
        ...(animate
          ? {
              opacity: shown ? 1 : 0,
              transform: shown ? 'none' : 'translateY(26px)',
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
