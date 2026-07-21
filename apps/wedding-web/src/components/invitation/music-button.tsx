'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { CREAM, INK } from './theme';

// Floating music toggle (§2.1 spec calls out "bottom-right", user asked for it
// to float over the whole page instead of scrolling away with the hero) —
// rendered as a sibling of `.invite-scale` (not nested inside it) so its
// `position: fixed` right/bottom offsets anchor to the real viewport corner
// instead of being distorted by the desktop `zoom` scale on the card.
//
// Desktop volume slider — three bugs fixed vs the first pass:
//  1. It used to vanish the instant you moved off the puck toward it (show was
//     toggled by the puck's own pointer-enter/leave, with a gap between). Now
//     puck + slider live in ONE hover container and the slider's padded box
//     overlaps the puck's top edge, so the cursor never crosses a dead gap.
//  2. It wasn't centered on the puck (32px slider vs 44px puck, both right:22).
//     Now the slider is centered on the container/puck.
//  3. It didn't announce itself when music began. Now it auto-shows for a few
//     seconds the moment playback starts.
// Touch devices (no hover) get the plain toggle only.
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
  const [canHover, setCanHover] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [autoShow, setAutoShow] = useState(false);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasPlaying = useRef(playing);

  useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    const sync = () => setCanHover(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  // Music just started → reveal the slider briefly so the guest can dial it down.
  useEffect(() => {
    if (playing && !wasPlaying.current && canHover) {
      setAutoShow(true);
      if (autoTimer.current) clearTimeout(autoTimer.current);
      autoTimer.current = setTimeout(() => setAutoShow(false), 3600);
    }
    wasPlaying.current = playing;
  }, [playing, canHover]);

  useEffect(
    () => () => {
      if (autoTimer.current) clearTimeout(autoTimer.current);
    },
    [],
  );

  const show = canHover && (hovering || autoShow);

  const popoverStyle: CSSProperties = {
    position: 'absolute',
    left: '50%',
    bottom: '100%',
    transform: `translateX(-50%) ${show ? 'translateY(0)' : 'translateY(6px)'}`,
    // Transparent bottom bridge overlaps the puck so moving the cursor from the
    // puck up to the slider never leaves the hover container.
    paddingBottom: 12,
    opacity: show ? 1 : 0,
    pointerEvents: show ? 'auto' : 'none',
    transition: 'opacity 0.22s ease, transform 0.22s ease',
  };

  return (
    <div
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => setHovering(false)}
      style={{
        position: 'fixed',
        right: 22,
        bottom: 'calc(27px + env(safe-area-inset-bottom))',
        zIndex: 20,
        width: 44,
        height: 44,
      }}
    >
      {canHover ? (
        <div aria-hidden={!show} style={popoverStyle}>
          <div
            style={{
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
            }}
          >
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
        </div>
      ) : null}

      <button
        type="button"
        onClick={onToggle}
        title={t('musicToggle')}
        aria-label={t('musicToggle')}
        aria-pressed={playing}
        className="invite-music-btn"
        style={{
          // Visual puck is 32px (§2.1); border-box + transparent border pads the
          // TAP target to 44px (a11y rule ≥44px) without changing the rendered size.
          position: 'absolute',
          inset: 0,
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
    </div>
  );
}
