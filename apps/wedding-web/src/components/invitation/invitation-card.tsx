'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import type { Invite, Wish } from '@/lib/types';
import type { SiteSettings } from '@/lib/site-settings';
import { CREAM, TAN_LIGHT, SCRIPT, SERIF } from './theme';
import { useMusic } from './use-music';
import { Reveal } from './reveal';
import { Hero } from './hero';
import { MusicButton } from './music-button';
import { Envelope } from './envelope';
import { Letter } from './letter';
import { Events } from './events';
import { Gallery } from './gallery';
import { Rsvp } from './rsvp';
import { Wishes } from './wishes';

// The whole invitation is one client tree: SSR still renders the initial HTML
// (guest label without flicker), and every section shares the reveal/music
// runtime. Fixed 393px composition — the desktop breakpoint scales the card as
// a unit via .invite-scale (globals.css), never reflows (§7 decision 1).
export function InvitationCard({
  guest,
  wishes,
  settings = {},
}: {
  guest: Invite | null;
  wishes: Wish[];
  settings?: SiteSettings;
}) {
  const t = useTranslations('footer');
  const music = useMusic(settings.musicUrl);
  const scaleRef = useRef<HTMLDivElement>(null);
  const dvhRef = useRef<HTMLDivElement>(null);

  // Music starts on first scroll (§2.10) — autoplay usually rejects, then the
  // one-time pointerdown retry inside useMusic picks it up on first tap.
  useEffect(() => {
    let done = false;
    const onScroll = () => {
      if (done) return;
      const sc = document.scrollingElement ?? document.documentElement;
      if (sc.scrollTop < 30) return;
      done = true;
      window.removeEventListener('scroll', onScroll);
      music.start();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
    // deps deliberately empty: bind once on mount; music.start reads refs, not state
  }, []);

  // Zoom scales the whole 393px canvas as a unit — set imperatively because
  // Next's CSS pipeline (Lightning CSS) silently drops any calc()/clamp()/max()
  // value for the `zoom` property, so this can't be expressed as plain CSS.
  // Below 1024px it's driven by viewport HEIGHT so the hero (fixed 852px tall
  // in design space) always fills exactly one screen. Measured off a hidden
  // `height: 100dvh` sentinel instead of `window.visualViewport.height` —
  // dvh is Safari's own live answer to "how tall is the visible area right
  // now" (toolbar shown or collapsed), whereas visualViewport's *first*
  // reading on load races the toolbar-settle animation with no reliable
  // follow-up resize, which was leaving a cream-colored gap under the hero
  // on some devices (e.g. iPhone 15 Pro Max). Below 1024px the static
  // @media tiers in globals.css are the pre-hydration fallback only — this
  // effect overrides them once JS runs.
  // At 1024px+ the page just scrolls (there's no "one screen" to fill), so
  // it's driven by viewport WIDTH instead — otherwise the card sat pinned at
  // its 1.25 floor on any wide-but-not-very-tall window and read as tiny on a
  // real desktop monitor. Target ~40% of window width, capped so it doesn't
  // balloon on ultrawide screens.
  // useLayoutEffect (not useEffect): runs synchronously before the browser
  // paints, so the JS-computed zoom replaces the static @media fallback
  // before the user ever sees it — useEffect fires after paint, which was
  // showing the wrong (pre-hydration) zoom for a beat then visibly snapping
  // to the correct one.
  useLayoutEffect(() => {
    const update = () => {
      const el = scaleRef.current;
      if (!el) return;
      const vw = window.innerWidth;
      if (vw >= 1024) {
        const targetWidth = Math.min(vw * 0.4, 760);
        el.style.zoom = String(Math.max(1.25, targetWidth / 393));
      } else {
        const vh = dvhRef.current?.getBoundingClientRect().height ?? window.innerHeight;
        el.style.zoom = String(vh / 852);
      }
      // Reveal only once the real zoom is applied — SSR/pre-hydration paints
      // with the static @media fallback (visually wrong) before any JS runs
      // at all, a gap useLayoutEffect can't close by itself; staying hidden
      // through that gap swaps "wrong zoom snaps to right zoom" for "briefly
      // blank, then correct", which reads as a normal load instead of a jump.
      el.style.visibility = 'visible';
    };
    update();
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, []);

  return (
    <>
      <MusicButton playing={music.playing} onToggle={music.toggle} />
      {/* Measurement-only: 100dvh tracks Safari's live toolbar state, read via ref above. */}
      <div
        ref={dvhRef}
        style={{ position: 'fixed', top: 0, height: '100dvh', width: 0, visibility: 'hidden' }}
      />
      <div
        ref={scaleRef}
        className="invite-scale"
        style={{
          minHeight: '100vh',
          display: 'flex',
          justifyContent: 'center',
          fontFamily: SERIF,
          visibility: 'hidden',
        }}
      >
        <div
          style={{
            position: 'relative',
            width: 393,
            maxWidth: '100vw',
            background: CREAM,
            overflow: 'hidden',
            boxShadow: '0 0 60px rgba(101,101,101,0.25)',
          }}
        >
          <Hero bgUrl={settings.heroUrl} />
          <Envelope />
          <Letter
            guestLabel={guest?.label ?? null}
            mapUrl={settings.mapUrl}
            mapsUrl={settings.mapsUrl}
          />
          <Events />
          <Gallery images={settings.gallery} />
          {/* RSVP only for a valid guest link — recommended §9 anonymous behavior. */}
          {guest ? <Rsvp guestId={guest.id} initial={guest.rsvp} /> : null}
          <Wishes
            guestId={guest?.id ?? null}
            guestLabel={guest?.label ?? null}
            initialWishes={wishes}
          />
          <div
            style={{
              padding: '52px 40px 48px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 20,
            }}
          >
            <Reveal style={{ fontFamily: SCRIPT, fontSize: 48, color: TAN_LIGHT }}>
              {t('thanks')}
            </Reveal>
            <Reveal
              style={{
                width: 22,
                height: 22,
                background: 'url(/invite/logo-mark.svg) center / contain no-repeat',
              }}
            />
          </div>
        </div>
      </div>
    </>
  );
}
