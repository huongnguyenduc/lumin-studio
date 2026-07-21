'use client';

import { type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import type { AdminEvent } from '@/lib/admin-api';
import { inputBase, kicker, CREAM_2, INK, RING } from './ui';

// Presentational body of the venue/timeline tab. Draft (data fields + name +
// subdomain) lives in the parent SettingsDrawer; this only reads via `val`/
// `nameValue`/`subdomainValue` and writes via `patch`/`onNameChange`/
// `onSubdomainChange` + the injected `uploadMap`. Lifted from the former
// standalone EventPanel.
type DataField =
  | 'date'
  | 'weekday'
  | 'lunarDate'
  | 'time'
  | 'venueName'
  | 'venueHall'
  | 'venueAddress'
  | 'mapsUrl'
  | 'timelineWelcomeTime'
  | 'timelineWelcome'
  | 'timelinePartyTime'
  | 'timelineParty'
  | 'vuQuyTime'
  | 'vuQuyPlace'
  | 'vuQuyAddress'
  | 'thanhHonTime'
  | 'thanhHonPlace'
  | 'thanhHonAddress'
  | 'ceremonyDate'
  | 'ceremonyLunarDate';

const uploadLabel: CSSProperties = {
  alignSelf: 'flex-start',
  padding: '6px 14px',
  borderRadius: 20,
  boxShadow: RING,
  fontSize: 11,
  cursor: 'pointer',
};

export function EventFields({
  event,
  val,
  patch,
  nameValue,
  subdomainValue,
  onNameChange,
  onSubdomainChange,
  uploadMap,
}: {
  event: AdminEvent;
  val: (key: string) => string;
  patch: (key: string, value: string) => void;
  nameValue: string;
  subdomainValue: string;
  onNameChange: (v: string) => void;
  onSubdomainChange: (v: string) => void;
  uploadMap: (file: File) => void;
}) {
  const t = useTranslations('admin.eventPanel');

  const field = (key: DataField) => (
    <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={kicker}>{t(`field.${key}`)}</span>
      <input
        value={val(key)}
        onChange={(e) => patch(key, e.target.value)}
        placeholder={t(`placeholder.${key}`)}
        aria-label={t(`field.${key}`)}
        style={{ ...inputBase, borderRadius: 8, padding: '9px 14px' }}
      />
    </div>
  );

  const mapUrl = val('mapUrl');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={kicker}>{t('field.name')}</span>
          <input
            value={nameValue}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder={t('placeholder.name')}
            aria-label={t('field.name')}
            style={{ ...inputBase, borderRadius: 8, padding: '9px 14px' }}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={kicker}>{t('field.subdomain')}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              value={subdomainValue}
              onChange={(e) => onSubdomainChange(e.target.value)}
              placeholder={t('placeholder.subdomain')}
              aria-label={t('field.subdomain')}
              style={{ ...inputBase, flexGrow: 1, borderRadius: 8, padding: '9px 14px' }}
            />
            <span style={{ fontSize: 12, color: INK, whiteSpace: 'nowrap' }}>
              {t('domainSuffix')}
            </span>
          </div>
          {event.subdomain ? (
            <a
              href={`https://${event.subdomain}`}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: 11, color: INK }}
            >
              {`https://${event.subdomain}`}
            </a>
          ) : null}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {(['date', 'weekday', 'lunarDate'] as const).map(field)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {(['time', 'venueName', 'venueHall'] as const).map(field)}
      </div>
      {field('venueAddress')}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end' }}>
        <div style={{ flexGrow: 1 }}>{field('mapsUrl')}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={kicker}>{t('field.mapUrl')}</span>
          <div
            style={{
              width: 84,
              height: 60,
              borderRadius: 8,
              overflow: 'hidden',
              boxShadow: RING,
              background: mapUrl ? `${CREAM_2} url(${mapUrl}) center / cover no-repeat` : CREAM_2,
            }}
          />
        </div>
        <label style={uploadLabel}>
          {t('changeMap')}
          <input
            type="file"
            accept="image/*"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) uploadMap(f);
            }}
            style={{ display: 'none' }}
          />
        </label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
        {(['timelineWelcomeTime', 'timelineWelcome'] as const).map(field)}
        {(['timelinePartyTime', 'timelineParty'] as const).map(field)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
        {field('ceremonyDate')}
        {field('ceremonyLunarDate')}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {(['vuQuyTime', 'vuQuyPlace', 'vuQuyAddress'] as const).map(field)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {(['thanhHonTime', 'thanhHonPlace', 'thanhHonAddress'] as const).map(field)}
      </div>
    </div>
  );
}
