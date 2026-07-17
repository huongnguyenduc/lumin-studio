import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { INK, TAN, TERRACOTTA, CREAM_2, CREAM, RING, SCRIPT } from './theme';
import { Reveal } from './reveal';

const laceV: CSSProperties = {
  position: 'absolute',
  top: 0,
  bottom: 0,
  width: 6,
  background: 'url(/invite/lace-v.png) repeat-y',
  backgroundSize: '6px auto',
};
const label600: CSSProperties = {
  fontWeight: 600,
  fontSize: 14,
  textTransform: 'uppercase',
  color: INK,
  textAlign: 'center',
};
const timeText: CSSProperties = {
  fontWeight: 600,
  fontSize: 18,
  textTransform: 'uppercase',
  color: INK,
};
const divider: CSSProperties = { width: 1, height: 34, background: TAN };
const timelineRow: CSSProperties = { display: 'flex', gap: 36, alignItems: 'center' };
const timelineText: CSSProperties = {
  fontSize: 12,
  lineHeight: 1.5,
  textTransform: 'uppercase',
  color: INK,
};

// Letter (§2.3): the invitation text framed by vertical lace strips, closed by
// two horizontal lace strips. guestLabel = personalized salutation (SSR).
export function Letter({
  guestLabel,
  mapUrl,
  mapsUrl,
}: {
  guestLabel: string | null;
  mapUrl?: string;
  mapsUrl?: string;
}) {
  const t = useTranslations('letter');
  return (
    <div style={{ position: 'relative', padding: '42px 40px 0' }}>
      <div style={{ ...laceV, left: 0 }} />
      <div style={{ ...laceV, left: 6 }} />
      <div style={{ ...laceV, right: 0 }} />
      <div style={{ ...laceV, right: 6 }} />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <Reveal style={label600}>{t('invite')}</Reveal>
        <Reveal
          delay={120}
          style={{
            marginTop: 16,
            fontFamily: SCRIPT,
            fontSize: 22,
            lineHeight: 1.3,
            color: TERRACOTTA,
            textAlign: 'center',
            textTransform: 'capitalize',
          }}
        >
          {guestLabel ?? t('anonymousGuest')}
        </Reveal>
        <Reveal delay={200} style={{ ...label600, marginTop: 36 }}>
          {t('toAttend')}
        </Reveal>
        <Reveal
          style={{ marginTop: 20, display: 'flex', flexDirection: 'column', alignItems: 'center' }}
        >
          <span
            style={{ fontFamily: SCRIPT, fontSize: 42, lineHeight: 1.3, color: INK, zIndex: 1 }}
          >
            {t('bride')}
          </span>
          <img
            src="/invite/rings.png"
            alt={t('ringsAlt')}
            style={{ width: 66, height: 66, margin: '-14px 0 -23px' }}
          />
          <span style={{ fontFamily: SCRIPT, fontSize: 42, lineHeight: 1.3, color: INK }}>
            {t('groom')}
          </span>
        </Reveal>
        <Reveal style={{ marginTop: 36, display: 'flex', alignItems: 'center', gap: 20 }}>
          <span style={timeText}>{t('time')}</span>
          <span style={divider} />
          <span style={{ ...timeText, whiteSpace: 'nowrap' }}>{t('weekday')}</span>
          <span style={divider} />
          <span style={timeText}>{t('date')}</span>
        </Reveal>
        <Reveal
          style={{
            marginTop: 8,
            fontStyle: 'italic',
            fontSize: 12,
            color: TAN,
            textAlign: 'center',
          }}
        >
          {t('lunarDate')}
        </Reveal>
        <Reveal style={{ marginTop: 33 }}>
          <MapPinIcon />
        </Reveal>
        <Reveal
          style={{
            marginTop: 18,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
          }}
        >
          <span style={{ ...label600, fontSize: 16, lineHeight: 1.5 }}>{t('venue')}</span>
          <span style={{ ...label600, fontWeight: 400, lineHeight: 1.5 }}>{t('venueHall')}</span>
          <span
            style={{
              marginTop: 8,
              width: 227,
              fontStyle: 'italic',
              fontSize: 12,
              lineHeight: 1.5,
              color: TAN,
              textAlign: 'center',
            }}
          >
            {t('venueAddress')}
          </span>
        </Reveal>
        <Reveal
          style={{
            position: 'relative',
            marginTop: 17,
            width: 313,
            height: 196,
            borderRadius: 8,
            background: CREAM_2,
            boxShadow: RING,
          }}
        >
          <img
            src={mapUrl ?? '/invite/map.png'}
            alt={t('mapAlt')}
            style={{
              position: 'absolute',
              left: -19,
              top: 28,
              width: 351,
              height: 145,
              objectFit: 'cover',
            }}
          />
        </Reveal>
        <Reveal style={{ marginTop: 18 }}>
          <a
            href={mapsUrl ?? 'https://maps.google.com/?q=The+Mira+Central+Park+Bien+Hoa'}
            target="_blank"
            rel="noreferrer"
            className="invite-pill-solid"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              height: 28,
              boxSizing: 'border-box',
              padding: '6px 12px',
              borderRadius: 25,
              background: INK,
              color: CREAM,
              fontSize: 12,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            {t('openMaps')}
          </a>
        </Reveal>
        <Reveal style={{ marginTop: 32 }}>
          <ClockIcon />
        </Reveal>
        <Reveal style={{ marginTop: 18, fontFamily: SCRIPT, fontSize: 24, color: INK }}>
          {t('timeline')}
        </Reveal>
        <Reveal style={{ position: 'relative', marginTop: 21, width: 180, padding: '4px 0' }}>
          <div
            style={{
              position: 'absolute',
              left: 66,
              top: 2,
              bottom: 2,
              width: 1,
              background: 'rgba(120,105,93,0.55)',
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={timelineRow}>
              <div
                style={{
                  width: 54,
                  height: 54,
                  background: 'url(/invite/icon-camera.png) center / 140% no-repeat',
                  flexShrink: 0,
                }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ ...timelineText, fontWeight: 600 }}>{t('timelineWelcomeTime')}</span>
                <span style={timelineText}>{t('timelineWelcome')}</span>
              </div>
            </div>
            <div style={timelineRow}>
              <div
                style={{
                  width: 54,
                  height: 54,
                  background: 'url(/invite/icon-toast.png) center / 130% no-repeat',
                  flexShrink: 0,
                }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ ...timelineText, fontWeight: 600 }}>{t('timelinePartyTime')}</span>
                <span style={timelineText}>{t('timelineParty')}</span>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
      <div style={{ margin: '18px -40px 0', height: 12, display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            height: 6,
            background: 'url(/invite/lace-h.png) repeat-x',
            backgroundSize: 'auto 6px',
          }}
        />
        <div
          style={{
            height: 6,
            background: 'url(/invite/lace-h.png) repeat-x',
            backgroundSize: 'auto 6px',
          }}
        />
      </div>
    </div>
  );
}

// The two glyphs between letter blocks — inline SVG paths from the prototype.
function MapPinIcon() {
  return (
    <svg width="14" height="18" viewBox="0 0 14 18" fill="none" style={{ color: INK }} aria-hidden>
      <path
        transform="translate(0.2 13.5) scale(12 -12)"
        d="M 1.104 0.803 C 1.117 0.795 1.125 0.779 1.125 0.766 L 1.125 0.109 C 1.125 0.09 1.111 0.072 1.094 0.064 L 0.766 -0.061 C 0.756 -0.064 0.744 -0.064 0.734 -0.061 L 0.375 0.059 L 0.063 -0.061 C 0.049 -0.066 0.031 -0.064 0.02 -0.055 C 0.006 -0.047 0 -0.031 0 -0.016 L 0 0.641 C 0 0.66 0.012 0.676 0.029 0.684 L 0.357 0.809 C 0.367 0.813 0.379 0.813 0.389 0.809 L 0.748 0.689 L 1.061 0.809 C 1.074 0.814 1.092 0.813 1.104 0.803 L 1.104 0.803 Z M 0.094 0.607 L 0.094 0.051 L 0.328 0.141 L 0.328 0.697 L 0.094 0.607 Z M 0.703 0.049 L 0.703 0.605 L 0.422 0.699 L 0.422 0.143 L 0.703 0.049 Z M 0.797 0.051 L 1.031 0.141 L 1.031 0.697 L 0.797 0.607 L 0.797 0.051 L 0.797 0.051 Z"
        fill="currentColor"
      />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="12" height="18" viewBox="0 0 12 18" fill="none" style={{ color: INK }} aria-hidden>
      <path
        transform="translate(0 13.5) scale(12 -12)"
        d="M 0.906 0.375 C 0.906 0.52 0.828 0.652 0.703 0.727 C 0.576 0.799 0.422 0.799 0.297 0.727 C 0.17 0.652 0.094 0.52 0.094 0.375 C 0.094 0.229 0.17 0.096 0.297 0.021 C 0.422 -0.051 0.576 -0.051 0.703 0.021 C 0.828 0.096 0.906 0.229 0.906 0.375 Z M 0 0.375 C 0 0.553 0.094 0.717 0.25 0.807 C 0.404 0.896 0.594 0.896 0.75 0.807 C 0.904 0.717 1 0.553 1 0.375 C 1 0.195 0.904 0.031 0.75 -0.059 C 0.594 -0.148 0.404 -0.148 0.25 -0.059 C 0.094 0.031 0 0.195 0 0.375 Z M 0.453 0.641 C 0.453 0.666 0.473 0.688 0.5 0.688 C 0.525 0.688 0.547 0.666 0.547 0.641 L 0.547 0.398 L 0.713 0.289 C 0.734 0.273 0.74 0.244 0.727 0.223 C 0.711 0.201 0.682 0.195 0.66 0.211 L 0.473 0.336 C 0.461 0.344 0.453 0.359 0.453 0.375 L 0.453 0.641 Z"
        fill="currentColor"
      />
    </svg>
  );
}
