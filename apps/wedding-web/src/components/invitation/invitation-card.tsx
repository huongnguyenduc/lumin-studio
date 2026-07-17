'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import type { Invite, Wish } from '@/lib/types';
import type { SiteSettings } from '@/lib/site-settings';
import { CREAM, TAN_LIGHT, SCRIPT, SERIF } from './theme';
import { useMusic } from './use-music';
import { Reveal } from './reveal';
import { Hero } from './hero';
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

  return (
    <div
      className="invite-scale"
      style={{
        minHeight: '100vh',
        display: 'flex',
        justifyContent: 'center',
        fontFamily: SERIF,
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
        <Hero playing={music.playing} onToggleMusic={music.toggle} bgUrl={settings.heroUrl} />
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
  );
}
