'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CREAM, DARK, SCRIPT, TAN_LIGHT } from './theme';
import { Reveal } from './reveal';

// Hero (§2.1): full-bleed photo, logo mark + rotated ellipse borders, gradient,
// script "save the date", one-time scroll hint (localStorage). Music toggle
// lives in <MusicButton> — floats over the whole page, not just the hero.
export function Hero({ bgUrl }: { bgUrl?: string }) {
  const t = useTranslations('hero');
  const [hint, setHint] = useState(false);
  const [hintOpacity, setHintOpacity] = useState(1);

  useEffect(() => {
    try {
      const force = new URLSearchParams(location.search).has('hint');
      if (force || !localStorage.getItem('hg_hint_seen')) setHint(true);
    } catch {
      /* storage blocked → no hint, fine */
    }
  }, []);

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
    // --invite-hero-h is set by InvitationCard's zoom effect on <1024px
    // screens: exactly the visible viewport height in design-space px, so
    // the hero fills one screen at full width regardless of Safari's
    // toolbar state. 852px (the Figma design height) is the SSR/desktop
    // fallback. Children stay top/bottom-anchored, photo is `cover` — the
    // flexible height never distorts the composition.
    <div
      style={{
        position: 'relative',
        height: 'var(--invite-hero-h, 852px)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `url(${bgUrl ?? '/invite/hero.jpg'}) 50% 0 / cover no-repeat`,
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
          background: 'url(/invite/logo-oval.svg) center / contain no-repeat',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          width: '100%',
          height: 170,
          // Resolves to CREAM at the very bottom row, so the hero dissolves
          // into the cream section under it instead of ending on a hard
          // dark-to-cream line. DARK peaks at 24% — just below the "save the
          // date" baseline (bottom: 48) — so the text keeps its contrast.
          background: `linear-gradient(0deg, ${CREAM} 0%, ${DARK} 24%, rgba(59,47,39,0) 100%)`,
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
            bottom: 108,
            zIndex: 3,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 7,
            opacity: hintOpacity,
            transition: 'opacity 0.9s ease',
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              fontSize: 10,
              letterSpacing: '0.24em',
              textTransform: 'uppercase',
              color: 'rgba(255,251,248,0.9)',
              textShadow: '0 1px 8px rgba(59,47,39,0.5)',
              whiteSpace: 'nowrap',
            }}
          >
            {t('scrollHint')}
          </span>
          <span
            style={{
              width: 8,
              height: 8,
              borderRight: '1.5px solid rgba(255,251,248,0.9)',
              borderBottom: '1.5px solid rgba(255,251,248,0.9)',
              transform: 'rotate(45deg)',
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
