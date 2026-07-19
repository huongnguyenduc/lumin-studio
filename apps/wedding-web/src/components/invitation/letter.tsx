import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import type { EventData } from '@/lib/site-settings';
import { INK, TAN, TERRACOTTA_SOFT, CREAM, SCRIPT } from './theme';
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
// Date strip (§2.3 rev): three cells joined by 0.5px rules instead of free dividers.
const dateCell: CSSProperties = {
  padding: '2px 16px',
  fontWeight: 600,
  fontSize: 18,
  lineHeight: 'normal',
  textTransform: 'uppercase',
  color: INK,
  whiteSpace: 'nowrap',
  // Figma: fontFeatureSettings '"cpsp" 1' — capital-spacing OpenType feature,
  // Playfair Display hỗ trợ, thêm tracking nhẹ cho chữ hoa (thiếu ở bản port đầu).
  fontFeatureSettings: '"cpsp" 1, "lnum" 1, "pnum" 1',
};
const timelineLabel: CSSProperties = {
  fontSize: 12,
  lineHeight: 1.5,
  textTransform: 'uppercase',
  color: INK,
  textAlign: 'center',
  // Figma: same OpenType feature set as dateCell (capital-spacing + lining
  // figures), plus ordn/dlig for the "17:30" style time readout.
  fontFeatureSettings: '"cpsp" 1, "ordn" 1, "dlig" 1, "lnum" 1, "pnum" 1',
};

// A 48px photo medallion for the timeline endpoints; inset percentages are the
// Figma crop of the full exported image.
function Medallion({ src, inset }: { src: string; inset: { l: number; t: number; s: number } }) {
  return (
    <div style={{ position: 'relative', width: 48, height: 48, overflow: 'hidden' }}>
      <img
        alt=""
        aria-hidden
        src={src}
        style={{
          position: 'absolute',
          maxWidth: 'none',
          left: `${inset.l}%`,
          top: `${inset.t}%`,
          width: `${inset.s}%`,
          height: `${inset.s}%`,
        }}
      />
    </div>
  );
}

// Letter (§2.3 rev, Figma 107:239): the invitation text framed by vertical lace
// strips, closed by two horizontal lace strips. guestLabel = personalized
// salutation (SSR). Names run bigger with no rings mark; timeline is horizontal.
export function Letter({
  guestLabel,
  event = {},
}: {
  guestLabel: string | null;
  event?: EventData;
}) {
  const t = useTranslations('letter');
  const v = (key: keyof EventData, fallbackKey: string) => event[key] || t(fallbackKey);
  return (
    // 33.5px: giữ content 313px như Figma sau khi frame thu còn ~380 (canvas trừ 6.75 mỗi bên).
    <div style={{ position: 'relative', padding: '42px 33.5px 0' }}>
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
            color: TERRACOTTA_SOFT,
            textAlign: 'center',
            textTransform: 'capitalize',
          }}
        >
          {guestLabel ?? t('anonymousGuest')}
        </Reveal>
        <Reveal delay={200} style={{ ...label600, marginTop: 48 }}>
          {t('toAttend')}
        </Reveal>
        <Reveal
          style={{
            marginTop: 16,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 18,
            textTransform: 'capitalize',
          }}
        >
          <span style={{ fontFamily: SCRIPT, fontSize: 48, lineHeight: 'normal', color: INK }}>
            {t('bride')}
          </span>
          <span style={{ fontFamily: SCRIPT, fontSize: 48, lineHeight: 'normal', color: INK }}>
            {t('groom')}
          </span>
        </Reveal>
        <Reveal style={{ marginTop: 24, display: 'flex', alignItems: 'center' }}>
          <span style={{ ...dateCell, borderRight: `0.5px solid ${TAN}` }}>
            {v('time', 'time')}
          </span>
          <span
            style={{
              ...dateCell,
              borderLeft: `0.5px solid ${TAN}`,
              borderRight: `0.5px solid ${TAN}`,
            }}
          >
            {v('weekday', 'weekday')}
          </span>
          <span style={{ ...dateCell, borderLeft: `0.5px solid ${TAN}` }}>{v('date', 'date')}</span>
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
          {v('lunarDate', 'lunarDate')}
        </Reveal>
        <Reveal style={{ marginTop: 48 }}>
          <img alt="" aria-hidden src="/invite/icon-map.svg" style={{ width: 16, height: 14 }} />
        </Reveal>
        <Reveal
          style={{
            marginTop: 16,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
          }}
        >
          <span style={{ ...label600, fontSize: 16, lineHeight: 1.5 }}>
            {v('venueName', 'venue')}
          </span>
          <span style={{ ...label600, fontSize: 16, fontWeight: 400, lineHeight: 1.5 }}>
            {v('venueHall', 'venueHall')}
          </span>
          <span
            style={{
              marginTop: 6,
              width: 256,
              fontStyle: 'italic',
              fontSize: 12,
              lineHeight: 1.5,
              color: TAN,
              textAlign: 'center',
            }}
          >
            {v('venueAddress', 'venueAddress')}
          </span>
        </Reveal>
        <Reveal
          style={{
            position: 'relative',
            marginTop: 16,
            width: 313,
            height: 196,
            borderRadius: 12,
            border: `0.5px solid ${INK}`,
            boxSizing: 'border-box',
            overflow: 'hidden',
          }}
        >
          <img
            src={event.mapUrl ?? '/invite/map.png'}
            alt={t('mapAlt')}
            style={{
              position: 'absolute',
              left: 3,
              top: 34,
              width: 305,
              height: 145,
              objectFit: 'cover',
            }}
          />
        </Reveal>
        <Reveal style={{ marginTop: 16 }}>
          <a
            href={event.mapsUrl ?? 'https://maps.google.com/?q=The+Mira+Central+Park+Bien+Hoa'}
            target="_blank"
            rel="noreferrer"
            className="invite-pill-solid"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              height: 28,
              boxSizing: 'border-box',
              padding: '6px 12px',
              borderRadius: 24,
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
        <Reveal style={{ marginTop: 36 }}>
          <img alt="" aria-hidden src="/invite/icon-clock.svg" style={{ width: 15, height: 15 }} />
        </Reveal>
        <Reveal
          style={{
            marginTop: 16,
            fontWeight: 600,
            fontSize: 16,
            lineHeight: 1.5,
            textTransform: 'uppercase',
            color: INK,
          }}
        >
          {t('timeline')}
        </Reveal>
        <Reveal
          style={{
            marginTop: 8,
            width: 281,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div
            style={{
              width: 80,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Medallion
              src="/invite/timeline-arch.png"
              inset={{ l: -18.12, t: -15.28, s: 136.24 }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ ...timelineLabel, fontWeight: 600 }}>
                {v('timelineWelcomeTime', 'timelineWelcomeTime')}
              </span>
              <span style={timelineLabel}>{v('timelineWelcome', 'timelineWelcome')}</span>
            </div>
          </div>
          {/* Dotted connector between the two moments; the icons sit at row centre
              so the line lands mid-medallion (Figma anchors it at y=47). */}
          <img
            alt=""
            aria-hidden
            src="/invite/timeline-line.svg"
            style={{
              flex: '1 0 0',
              minWidth: 1,
              height: 3,
              alignSelf: 'flex-start',
              marginTop: 46,
            }}
          />
          <div
            style={{
              width: 80,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <Medallion
              src="/invite/timeline-toast.png"
              inset={{ l: -29.01, t: -15.35, s: 146.35 }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ ...timelineLabel, fontWeight: 600 }}>
                {v('timelinePartyTime', 'timelinePartyTime')}
              </span>
              <span style={timelineLabel}>{v('timelineParty', 'timelineParty')}</span>
            </div>
          </div>
        </Reveal>
      </div>
      <div
        style={{ margin: '36px -33.5px 0', height: 12, display: 'flex', flexDirection: 'column' }}
      >
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
