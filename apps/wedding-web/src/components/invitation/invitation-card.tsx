'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import type { Invite, Wish } from '@/lib/types';
import type { EventData, SiteSettings } from '@/lib/site-settings';
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
  event = {},
}: {
  guest: Invite | null;
  wishes: Wish[];
  settings?: SiteSettings;
  event?: EventData;
}) {
  const t = useTranslations('footer');
  const music = useMusic(settings.musicUrl, settings.musicVolume);
  const scaleRef = useRef<HTMLDivElement>(null);

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
  // Two separate concerns, deliberately not fused into one factor:
  //   zoom  → how wide the card is. Below 1024px that's the full screen;
  //           above it, ~40% of window width capped at 500px, so the card
  //           doesn't read as tiny on a desktop monitor or run too wide on
  //           a large one.
  //   --invite-hero-h → how tall the hero is, in design-space px. Phones only;
  //           see the branch below for why desktop keeps the design default.
  // Every attempt to do both with a single zoom factor failed one way or the
  // other: height-driven left side margins (device width doesn't shrink when
  // Safari's toolbar shows, but height does), width-driven pushed the hero's
  // "save the date" under the toolbar, min(width,height) just picked which of
  // those two you got. Letting the hero's height flex is what makes both axes
  // fit at once, and it's safe because the hero's children are all anchored
  // to its top/bottom edges and its photo is `cover`.
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
      const vh = window.visualViewport?.height ?? window.innerHeight;
      if (vw >= 1024) {
        const zoom = Math.max(1.25, Math.min(vw * 0.4, 500) / 393);
        el.style.zoom = String(zoom);
        el.style.setProperty('--invite-hero-h', `${vh / zoom}px`);
        // The two requirements only conflict on desktop, and this is the way
        // out. A hero sized to exactly the viewport means the envelope's 178px
        // ride-up ALWAYS lands on the first screen — its white lace panels read
        // as a pale band across the bottom. Leaving the hero at its design
        // 852px pushes the overlap below the fold but then overshoots a desktop
        // window by ~250px, hiding "save the date". Clipping the overlapping
        // strip off the envelope buys both: hero is exactly one screen, and
        // nothing is painted over the photo. The cost is the flap no longer
        // bleeding over the photo — a decorative touch phones still get.
        el.style.setProperty('--invite-envelope-clip', '178px');
      } else {
        // Phones: fit the hero to the visible height so it's exactly one screen
        // whatever Safari's toolbar is doing. Real device aspects don't always
        // match the 393×852 Figma canvas closely enough to keep the envelope's
        // 178px overlap tucked inside the bottom gradient — clip it like desktop
        // so the invitation section never bleeds onto the photo.
        const zoom = vw / 393;
        el.style.zoom = String(zoom);
        el.style.setProperty('--invite-hero-h', `${vh / zoom}px`);
        el.style.setProperty('--invite-envelope-clip', '178px');
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
    // visualViewport resize matters on mobile Safari specifically: toolbar
    // show/hide doesn't always reliably fire a plain window 'resize'.
    window.visualViewport?.addEventListener('resize', update);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, []);

  return (
    <>
      <MusicButton
        playing={music.playing}
        onToggle={music.toggle}
        volume={music.volume}
        onVolumeChange={music.setVolume}
        volumeSupported={music.volumeSupported}
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
          <Hero bgUrl={settings.heroUrl} x={settings.heroX} y={settings.heroY} />
          {/* Figma 107:240: thư mời là frame 380px đặt ở x≈7 trong canvas 393 —
              chừa nền hở hai bên thay vì tràn mép. */}
          {/* marginBottom 80: khoảng thở giữa thư mời và section cards (Figma 2143→2222). */}
          <div style={{ padding: '0 6.75px', marginBottom: 80 }}>
            <Envelope />
            <Letter guestLabel={guest?.label ?? null} event={event} />
          </div>
          <Events event={event} />
          <Gallery
            images={settings.gallery}
            line1={settings.storyLine1}
            line2={settings.storyLine2}
            captions={[settings.storyCaption1, settings.storyCaption2, settings.storyCaption3]}
          />
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
