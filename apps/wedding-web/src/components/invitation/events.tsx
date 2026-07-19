import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { CREAM, CREAM_2, INK, TAN, TAN_LIGHT } from './theme';
import { Reveal, GrowLine } from './reveal';

// Per-variant palette (§2.4 rev): the light ticket sits on cream, the dark one
// is the inverse — the arch frame itself carries its fill, so only text/rule
// colours differ here.
const LIGHT = { title: INK, value: INK, muted: TAN_LIGHT, rule: TAN };
const DARK = { title: CREAM, value: CREAM, muted: 'rgb(230,219,207)', rule: CREAM_2 };

// Geometry lifted 1:1 from Figma (node 107:243). Two things are per-variant and
// easy to get wrong: the arch SVG carries an ASYMMETRIC drop-shadow bleed (the
// shadow falls on opposite sides), and the text block sits at a different offset
// inside each arch — the light card's block rides high, the dark one drops 20px.
const SHAPE_W = 142.993;
const SHAPE_H = 305;
const GEOM = {
  light: {
    img: { left: -7.99, top: -6.01, width: 152.99, height: 315 },
    body: { top: 6.77, height: 285 },
    gap: 18,
  },
  dark: {
    img: { left: -3.0, top: -2.99, width: 153.0, height: 315 },
    body: { top: 20.36, height: 283 },
    gap: 16,
  },
} as const;

// Figma trims the title to cap height (10px at 14px type). Without this the
// heading measures ~19px and shoves the whole block down past the arch.
const TITLE_TRIM = { lineHeight: 1, textBox: 'trim-both cap alphabetic' } as CSSProperties;

function Ticket({
  delay,
  variant,
  title,
  time,
  date,
  lunarDate,
  place,
  address,
  atTime,
}: {
  delay?: number;
  variant: 'light' | 'dark';
  title: string;
  time: string;
  date: string;
  lunarDate: string;
  place: string;
  address: string;
  atTime: string;
}) {
  const c = variant === 'dark' ? DARK : LIGHT;
  const g = GEOM[variant];

  const value: CSSProperties = { fontWeight: 500, fontSize: 12, lineHeight: 1.5, color: c.value };
  const muted: CSSProperties = {
    fontStyle: 'italic',
    fontSize: 10,
    lineHeight: 1.5,
    color: c.muted,
    textAlign: 'center',
  };
  const row: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    alignSelf: 'stretch',
  };
  const ruled: CSSProperties = {
    ...row,
    borderBottom: `0.5px solid ${c.rule}`,
    paddingBottom: 10,
  };

  // 囍 mark: one shared SVG recoloured via mask, so the dark ticket needs no
  // second asset.
  const mark = (
    <div
      style={{
        width: 24.516,
        height: 24,
        flexShrink: 0,
        backgroundColor: c.value,
        mask: 'url(/invite/double-happiness.svg) center / contain no-repeat',
        WebkitMask: 'url(/invite/double-happiness.svg) center / contain no-repeat',
      }}
    />
  );

  return (
    <Reveal
      delay={delay}
      style={{ position: 'relative', width: SHAPE_W, height: SHAPE_H, flexShrink: 0 }}
    >
      <img
        alt=""
        aria-hidden
        src={`/invite/card-${variant}.svg`}
        // maxWidth: the global img{max-width:100%} reset would clamp the bleed
        // width back to the shape box and drag the arch ~8px off-axis.
        style={{ position: 'absolute', maxWidth: 'none', ...g.img }}
      />
      <div
        style={{
          position: 'absolute',
          left: -0.5,
          right: -0.5,
          top: g.body.top,
          height: g.body.height,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: g.gap,
          padding: '24px 18px',
          boxSizing: 'border-box',
        }}
      >
        {variant === 'light' && mark}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 10,
            alignSelf: 'stretch',
            textAlign: 'center',
            wordBreak: 'break-word',
          }}
        >
          <span
            style={{
              ...TITLE_TRIM,
              fontWeight: 600,
              fontSize: 14,
              textTransform: 'uppercase',
              color: c.title,
              whiteSpace: 'nowrap',
            }}
          >
            {title}
          </span>
          <div style={ruled}>
            <span style={muted}>{atTime}</span>
            <span style={{ ...value, textTransform: 'uppercase' }}>{time}</span>
          </div>
          <div style={ruled}>
            <span style={{ ...value, textTransform: 'uppercase' }}>{date}</span>
            <span style={muted}>{lunarDate}</span>
          </div>
          <div style={row}>
            <span style={{ ...value, whiteSpace: 'nowrap' }}>{place}</span>
            <span style={muted}>{address}</span>
          </div>
        </div>
        {variant === 'dark' && mark}
      </div>
    </Reveal>
  );
}

// Events (§2.4 rev): embossed floral ground, "together" rule on top, two arch
// tickets staggered — the dark one dropped 65px below the light one.
export function Events() {
  const t = useTranslations('events');
  return (
    <div
      style={{
        position: 'relative',
        height: 686,
        overflow: 'hidden',
        // Nền khớp letter/gallery (CREAM) — không phải CREAM_2 riêng của section này.
        background: CREAM,
      }}
    >
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 112.69,
          height: 574.59,
          background: 'url(/invite/emboss.png) 0 -16.5px / 393px 574.59px no-repeat',
          mixBlendMode: 'darken',
          opacity: 0.24,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: 168,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 18,
        }}
      >
        <GrowLine style={{ flex: '1 0 0', width: 0.5 }} background={TAN} />
        <Reveal
          style={{
            fontStyle: 'italic',
            fontSize: 8,
            lineHeight: 'normal',
            letterSpacing: 6,
            paddingLeft: 6,
            textTransform: 'uppercase',
            color: TAN,
            textAlign: 'center',
            whiteSpace: 'nowrap',
          }}
        >
          {t('together')}
        </Reveal>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 39.27,
          top: 220.22,
          display: 'flex',
          gap: 27.97,
          alignItems: 'flex-start',
        }}
      >
        <Ticket
          variant="light"
          title={t('vuQuy')}
          time={t('vuQuyTime')}
          date={t('date')}
          lunarDate={t('lunarDate')}
          place={t('vuQuyPlace')}
          address={t('vuQuyAddress')}
          atTime={t('atTime')}
        />
        <div style={{ marginTop: 65.27 }}>
          <Ticket
            delay={150}
            variant="dark"
            title={t('thanhHon')}
            time={t('thanhHonTime')}
            date={t('date')}
            lunarDate={t('lunarDate')}
            place={t('thanhHonPlace')}
            address={t('thanhHonAddress')}
            atTime={t('atTime')}
          />
        </div>
      </div>
    </div>
  );
}
