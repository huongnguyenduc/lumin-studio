import type { CSSProperties, ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { CREAM, INK, TAN, TAN_LIGHT, SCRIPT } from './theme';
import { Reveal } from './reveal';

// Ticket-shaped cards (§2.4): octagonal clip-path, double border via 3 stacked
// clip-path layers (cream → tan inset 4.5 → cream inset 5.2).
const TICKET_CLIP =
  'polygon(0 6.8%, 15.6% 0, 84.4% 0, 100% 6.8%, 100% 93.2%, 84.4% 100%, 15.6% 100%, 0 93.2%)';

const rowStyle: CSSProperties = {
  borderTop: `0.5px solid ${TAN}`,
  padding: '8px 0 10px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 2,
};
const smallItalic: CSSProperties = {
  fontStyle: 'italic',
  fontSize: 9,
  lineHeight: 1.4,
  color: TAN_LIGHT,
  textAlign: 'center',
};
const value500: CSSProperties = {
  fontWeight: 500,
  fontSize: 12,
  lineHeight: 1.5,
  color: INK,
};

function Ticket({
  delay,
  title,
  time,
  date,
  lunarDate,
  place,
  address,
  atTime,
}: {
  delay?: number;
  title: string;
  time: string;
  date: string;
  lunarDate: string;
  place: string;
  address: string;
  atTime: string;
}) {
  const layer = (inset: number | string, bg: string): ReactNode => (
    <div style={{ position: 'absolute', inset, background: bg, clipPath: TICKET_CLIP }} />
  );
  return (
    <Reveal
      delay={delay}
      style={{
        position: 'relative',
        width: 144.5,
        height: 304,
        filter: 'drop-shadow(0px 3px 4px rgba(0,0,0,0.25))',
        flexShrink: 0,
      }}
    >
      {layer(0, CREAM)}
      {layer(4.5, TAN)}
      {layer(5.2, CREAM)}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px 15px',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            width: 24,
            height: 24,
            background: 'url(/invite/double-happiness.svg) center / contain no-repeat',
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', alignSelf: 'stretch' }}>
          <span
            style={{
              fontWeight: 600,
              fontSize: 13,
              lineHeight: 1,
              textTransform: 'uppercase',
              color: INK,
              textAlign: 'center',
              whiteSpace: 'nowrap',
              paddingBottom: 10,
            }}
          >
            {title}
          </span>
          <div style={rowStyle}>
            <span style={{ fontStyle: 'italic', fontSize: 10, lineHeight: 1.5, color: TAN_LIGHT }}>
              {atTime}
            </span>
            <span style={{ ...value500, textTransform: 'uppercase' }}>{time}</span>
          </div>
          <div style={rowStyle}>
            <span style={value500}>{date}</span>
            <span style={smallItalic}>{lunarDate}</span>
          </div>
          <div style={{ ...rowStyle, padding: '8px 0 0' }}>
            <span style={{ ...value500, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
              {place}
            </span>
            <span style={smallItalic}>{address}</span>
          </div>
        </div>
      </div>
    </Reveal>
  );
}

// Events (§2.4): background photo with 24% brown tint, two tickets, script
// letterspaced "together".
export function Events() {
  const t = useTranslations('events');
  return (
    <div
      style={{
        position: 'relative',
        height: 589,
        background:
          'linear-gradient(rgba(120,105,93,0.24), rgba(120,105,93,0.24)), url(/invite/together.jpg) 50% 0 / cover no-repeat',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '68px 40px',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        <Ticket
          title={t('vuQuy')}
          time={t('vuQuyTime')}
          date={t('date')}
          lunarDate={t('lunarDate')}
          place={t('vuQuyPlace')}
          address={t('vuQuyAddress')}
          atTime={t('atTime')}
        />
        <Ticket
          delay={150}
          title={t('thanhHon')}
          time={t('thanhHonTime')}
          date={t('date')}
          lunarDate={t('lunarDate')}
          place={t('thanhHonPlace')}
          address={t('thanhHonAddress')}
          atTime={t('atTime')}
        />
      </div>
      <div style={{ flexGrow: 1 }} />
      <Reveal
        style={{
          fontFamily: SCRIPT,
          fontSize: 14,
          letterSpacing: '1.1em',
          paddingLeft: '1.1em',
          textTransform: 'uppercase',
          color: 'rgb(220,207,197)',
          textAlign: 'center',
        }}
      >
        {t('together')}
      </Reveal>
    </div>
  );
}
