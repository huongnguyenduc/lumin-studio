'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CREAM, DARK, INK, SCRIPT, TAN_LIGHT } from './theme';
import { Reveal } from './reveal';

// Hero (§2.1): full-bleed photo, logo mark + rotated ellipse borders, gradient,
// script "save the date", music toggle, one-time scroll hint (localStorage).
export function Hero({
  playing,
  onToggleMusic,
  bgUrl,
}: {
  playing: boolean;
  onToggleMusic: () => void;
  bgUrl?: string;
}) {
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
    <div style={{ position: 'relative', height: 852, overflow: 'hidden' }}>
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
          top: 59,
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
      <button
        type="button"
        onClick={onToggleMusic}
        title={t('musicToggle')}
        aria-label={t('musicToggle')}
        aria-pressed={playing}
        className="invite-music-btn"
        style={{
          // Visual puck is 32px (§2.1); border-box + transparent border pads the
          // TAP target to 44px (a11y rule ≥44px) without changing the rendered size.
          position: 'absolute',
          right: 22,
          bottom: 27,
          width: 44,
          height: 44,
          borderRadius: 22,
          border: '6px solid transparent',
          boxSizing: 'border-box',
          padding: 0,
          background: INK,
          backgroundClip: 'padding-box',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
        }}
      >
        <span
          style={{
            // speaker.png is a solid black glyph on transparent — a CSS mask
            // recolors it to CREAM (matching the pause-bars/slash below);
            // mixBlendMode:'screen' with a BLACK source is a no-op (screen
            // blend with black never lightens anything), which is why the
            // glyph never actually appeared.
            position: 'absolute',
            width: 16,
            height: 16,
            background: CREAM,
            WebkitMaskImage: 'url(/invite/speaker.png)',
            maskImage: 'url(/invite/speaker.png)',
            WebkitMaskSize: 'contain',
            maskSize: 'contain',
            WebkitMaskRepeat: 'no-repeat',
            maskRepeat: 'no-repeat',
            WebkitMaskPosition: 'center',
            maskPosition: 'center',
            opacity: playing ? 0 : 1,
            transition: 'opacity 0.6s ease',
          }}
        />
        <span
          style={{
            position: 'absolute',
            display: 'flex',
            gap: 3,
            opacity: playing ? 1 : 0,
            transition: 'opacity 0.6s ease',
          }}
        >
          <span style={{ width: 3, height: 11, borderRadius: 1, background: CREAM }} />
          <span style={{ width: 3, height: 11, borderRadius: 1, background: CREAM }} />
        </span>
        <span
          style={{
            position: 'absolute',
            width: 20,
            height: 1,
            background: CREAM,
            transform: 'rotate(-45deg)',
            opacity: playing ? 0 : 1,
            transition: 'opacity 0.6s ease',
          }}
        />
      </button>
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
