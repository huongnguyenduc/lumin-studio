'use client';

import { useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi, ApiError, type AdminEvent } from '@/lib/admin-api';
import { card, inputBase, kicker, pillSolid, CREAM_2, GREEN, HAIRLINE, INK, RING } from './ui';

const uploadLabel: CSSProperties = {
  alignSelf: 'flex-start',
  padding: '6px 14px',
  borderRadius: 20,
  boxShadow: RING,
  fontSize: 11,
  cursor: 'pointer',
};

// Venue/timeline/ceremony fields for one event — same shape as EventData
// (site-settings.ts), fixed to the 2-timeline-stop / 2-ceremony-ticket layout
// Letter/Events already render.
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

// Venue/schedule editor for one event (§ multi-event admin). Collapsible,
// draft/save pattern lifted from SettingsPanel — same shallow-merge PATCH
// semantics, just scoped to one event's `data` column instead of the global
// settings row. name/subdomain are separate columns (not in `data`) so they
// get their own draft state, submitted on the same "Lưu" button.
export function EventPanel({
  event,
  onSaved,
  onError,
}: {
  event: AdminEvent;
  onSaved: (next: AdminEvent) => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations('admin.eventPanel');
  const tSaved = useTranslations('admin.toasts')('saved');
  const [open, setOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState<string | undefined>(undefined);
  const [subdomainDraft, setSubdomainDraft] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [savedToast, setSavedToast] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const val = (key: string): string => {
    if (key in draft) return draft[key];
    const v = event.data[key];
    return typeof v === 'string' ? v : '';
  };
  const patch = (key: string, value: string) => setDraft((d) => ({ ...d, [key]: value }));

  const subdomainLabel = event.subdomain ? event.subdomain.replace(/\.luminstudio\.vn$/, '') : '';

  const save = async () => {
    const body: { name?: string; subdomain?: string; data?: Record<string, string> } = {};
    if (nameDraft !== undefined) body.name = nameDraft;
    if (subdomainDraft !== undefined) body.subdomain = subdomainDraft;
    if (Object.keys(draft).length > 0) body.data = draft;
    if (Object.keys(body).length === 0) return;
    setSaving(true);
    try {
      const next = await adminApi.patchEvent(event.slug, body);
      setDraft({});
      setNameDraft(undefined);
      setSubdomainDraft(undefined);
      onSaved(next);
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2600);
    } catch (err) {
      onError(
        err instanceof ApiError && err.code === 'SUBDOMAIN_TAKEN'
          ? t('subdomainTaken')
          : t('saveFailed'),
      );
    } finally {
      setSaving(false);
    }
  };

  const uploadMap = async (file: File) => {
    setUploading(true);
    try {
      patch('mapUrl', await adminApi.upload('map', file));
    } catch {
      onError(t('uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

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
    <div style={{ ...card, padding: '16px 20px', display: 'flex', flexDirection: 'column' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          userSelect: 'none',
          padding: 0,
          fontFamily: 'inherit',
          color: INK,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 13 }}>{t('heading')}</span>
        <span style={{ fontSize: 11, color: INK }}>{t('subtitle')}</span>
        <span style={{ flexGrow: 1 }} />
        {savedToast ? (
          <span style={{ fontStyle: 'italic', fontSize: 12, color: GREEN }}>{tSaved}</span>
        ) : null}
        {uploading ? (
          <span style={{ fontStyle: 'italic', fontSize: 12, color: INK }}>{t('uploading')}</span>
        ) : null}
        <span style={{ fontSize: 12 }}>{open ? t('collapse') : t('expand')}</span>
      </button>
      {open ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            borderTop: `0.5px solid ${HAIRLINE}`,
            marginTop: 14,
            paddingTop: 16,
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={kicker}>{t('field.name')}</span>
              <input
                value={nameDraft ?? event.name}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder={t('placeholder.name')}
                aria-label={t('field.name')}
                style={{ ...inputBase, borderRadius: 8, padding: '9px 14px' }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={kicker}>{t('field.subdomain')}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  value={subdomainDraft ?? subdomainLabel}
                  onChange={(e) => setSubdomainDraft(e.target.value)}
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
                  background: mapUrl
                    ? `${CREAM_2} url(${mapUrl}) center / cover no-repeat`
                    : CREAM_2,
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
                  if (f) void uploadMap(f);
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
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              style={{
                ...pillSolid,
                padding: '9px 22px',
                letterSpacing: '0.08em',
                opacity: saving ? 0.6 : 1,
                cursor: saving ? 'default' : 'pointer',
              }}
            >
              {saving ? t('saving') : t('save')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
