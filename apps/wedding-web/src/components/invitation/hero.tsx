'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DARK, SCRIPT, TAN_LIGHT } from './theme';
import { Reveal } from './reveal';
import { OptimizedImg } from './optimized-img';
import type { ImgVariants } from '@/lib/site-settings';

// Hero (§2.1): full-bleed photo, logo mark + rotated ellipse borders, gradient,
// script "save the date", one-time scroll hint (localStorage). Music toggle
// lives in <MusicButton> — floats over the whole page, not just the hero.
export function Hero({
  bgUrl,
  x,
  y,
  img,
}: {
  bgUrl?: string;
  x?: number;
  y?: number;
  img?: ImgVariants;
}) {
  const t = useTranslations('hero');
  const [hint, setHint] = useState(false);
  const [hintOpacity, setHintOpacity] = useState(0);

  useEffect(() => {
    try {
      const force = new URLSearchParams(location.search).has('hint');
      if (!force && localStorage.getItem('hg_hint_seen')) return;
    } catch {
      return; /* storage blocked → no hint, fine */
    }
    const sc = document.scrollingElement ?? document.documentElement;
    const timer = setTimeout(() => {
      if (sc.scrollTop < 30) setHint(true);
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // two rAFs so the mount (opacity: 0) commits before the transition target
    // (opacity: 1) — a single rAF can still land in the same paint on some
    // browsers and skip the fade-in.
    if (!hint) return;
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setHintOpacity(1)));
    return () => cancelAnimationFrame(raf);
  }, [hint]);

  useEffect(() => {
    if (!hint) return;
    const onScroll = () => {
      const sc = document.scrollingElement ?? document.documentElement;
      if (sc.scrollTop < 30) return;
      window.removeEventListener('scroll', onScroll);
      try {
        localStorage.setItem('hg_hint_seen', '1');
      } catch {
        /* ignore */
      }
      setHintOpacity(0);
      setTimeout(() => setHint(false), 1000);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [hint]);

  return (
    // --invite-hero-h is set by InvitationCard's zoom effect below 1024px:
    // exactly the visible viewport height in design-space px, so the hero fills
    // one screen regardless of Safari's toolbar state. On a phone that lands on
    // ~852px anyway — the device aspect matches the Figma canvas — so the
    // envelope's overlap stays tucked inside the bottom gradient as designed.
    // Desktop keeps the 852px default (see the effect for why).
    <div
      style={{
        position: 'relative',
        height: 'var(--invite-hero-h, 852px)',
        overflow: 'hidden',
      }}
    >
      {/* Ảnh nền là phần tử LCP của trang ⇒ dùng <img> chứ không phải background:
          background-image không nhận srcSet (browser luôn tải đúng 1 khổ, thường là
          bản gốc) và trình duyệt cũng không ưu tiên tải sớm. Với <img> thì máy tự
          chọn khổ theo bề rộng màn + DPR (ADR-055). Cắt vẫn do CSS cover +
          object-position để đường fail-open (URL gốc) khung hình y hệt bản tối ưu. */}
      <OptimizedImg
        img={img}
        fallback={bgUrl ?? '/invite/hero.jpg'}
        sizes="100vw"
        alt=""
        hidden
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: `${x ?? 50}% ${y ?? 0}%`,
        }}
      />
      {/* Figma node 32:834 — oval stamp logo exported as one asset. */}
      <Reveal
        style={{
          position: 'absolute',
          top: 'calc(59px + env(safe-area-inset-top))',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 116,
          height: 128,
          background: 'url(/image/logo.svg) center / contain no-repeat',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          width: '100%',
          height: 130,
          background: `linear-gradient(0deg, ${DARK} 0%, rgba(59,47,39,0) 100%)`,
        }}
      />
      <Reveal
        style={{
          position: 'absolute',
          left: 0,
          bottom: 48,
          width: '100%',
          textAlign: 'center',
          fontFamily: SCRIPT,
          fontSize: 24,
          letterSpacing: '0.48px',
          color: TAN_LIGHT,
        }}
      >
        {t('saveTheDate')}
      </Reveal>
      {hint ? (
        <div
          className="invite-hint"
          style={{
            position: 'absolute',
            left: '50%',
            bottom: 14,
            zIndex: 3,
            width: 13,
            height: 21,
            borderRadius: 7,
            border: '1px solid rgba(255,251,248,0.55)',
            opacity: hintOpacity,
            transition: 'opacity 1.4s ease',
            pointerEvents: 'none',
          }}
        >
          <span className="invite-hint-dot" />
        </div>
      ) : null}
    </div>
  );
}
