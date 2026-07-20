'use client';

import { useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { CREAM, INK } from './theme';

// Floating music toggle (§2.1 spec calls out "bottom-right", user asked for it
// to float over the whole page instead of scrolling away with the hero) —
// rendered as a sibling of `.invite-scale` (not nested inside it) so its
// `position: fixed` right/bottom offsets anchor to the real viewport corner
// instead of being distorted by the desktop `zoom` scale on the card.
export function MusicButton({
  playing,
  onToggle,
  volume,
  onVolumeChange,
}: {
  playing: boolean;
  onToggle: () => void;
  volume: number;
  onVolumeChange: (v: number) => void;
}) {
  const t = useTranslations('hero');
  const [showVolume, setShowVolume] = useState(false);
  const sliderStyle: CSSProperties = {
    position: 'fixed',
    right: 22,
    // sits directly above the 44px puck (bottom 27px) with a small gap.
    bottom: 'calc(27px + 44px + 10px + env(safe-area-inset-bottom))',
    zIndex: 20,
    width: 32,
    height: 96,
    borderRadius: 16,
    background: INK,
    boxShadow: '0 2px 12px rgba(59,47,39,0.35)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '10px 0',
    boxSizing: 'border-box',
    opacity: showVolume ? 1 : 0,
    pointerEvents: showVolume ? 'auto' : 'none',
    transition: 'opacity 0.25s ease',
  };
  return (
    <>
      <div style={sliderStyle}>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(volume * 100)}
          onChange={(e) => onVolumeChange(Number(e.target.value) / 100)}
          title={t('volumeLabel')}
          aria-label={t('volumeLabel')}
          style={{
            // vertical range: rotate a horizontal slider — broadest cross-browser support.
            writingMode: 'vertical-lr',
            direction: 'rtl',
            appearance: 'auto',
            accentColor: CREAM,
            width: 20,
            height: 76,
            cursor: 'pointer',
          }}
        />
      </div>
      <button
        type="button"
        onClick={onToggle}
        onPointerEnter={() => setShowVolume(true)}
        onPointerLeave={() => setShowVolume(false)}
        title={t('musicToggle')}
        aria-label={t('musicToggle')}
        aria-pressed={playing}
        className="invite-music-btn"
        style={{
          // Visual puck is 32px (§2.1); border-box + transparent border pads the
          // TAP target to 44px (a11y rule ≥44px) without changing the rendered size.
          position: 'fixed',
          right: 22,
          bottom: 'calc(27px + env(safe-area-inset-bottom))',
          zIndex: 20,
          width: 44,
          height: 44,
          borderRadius: 22,
          border: '6px solid transparent',
          boxSizing: 'border-box',
          padding: 0,
          background: INK,
          backgroundClip: 'padding-box',
          boxShadow: '0 2px 12px rgba(59,47,39,0.35)',
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
    </>
  );
}
