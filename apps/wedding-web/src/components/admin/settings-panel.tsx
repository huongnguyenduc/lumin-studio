'use client';

import { useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi, type Settings } from '@/lib/admin-api';
import type { GalleryImage } from '@/lib/site-settings';
import {
  card,
  inputBase,
  kicker,
  pillSolid,
  CREAM_2,
  GREEN,
  HAIRLINE,
  INK,
  TAN,
  TAN_LIGHT,
  RING,
} from './ui';

const uploadLabel: CSSProperties = {
  alignSelf: 'flex-start',
  padding: '6px 14px',
  borderRadius: 20,
  boxShadow: RING,
  fontSize: 11,
  cursor: 'pointer',
};

// Site settings (§3.5). Values in the JSONB settings row: heroUrl, mapUrl,
// musicUrl/musicName, gallery (string[] of URLs), mapsUrl, siteTitle, siteDesc,
// ogUrl, iconUrl. Files upload via presign→Garage; the URL lands in the draft
// and persists on "Lưu cài đặt" (PATCH merge).
export function SettingsPanel({
  settings,
  onSaved,
  onError,
}: {
  settings: Settings;
  onSaved: (next: Settings) => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations('admin.settings');
  const tSaved = useTranslations('admin.toasts')('saved');
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Settings>({});
  const [savedToast, setSavedToast] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);

  const val = <T,>(key: string, fallback: T): T => {
    if (key in draft) return draft[key] as T;
    return (settings[key] as T) ?? fallback;
  };
  const patch = (p: Settings) => setDraft((d) => ({ ...d, ...p }));

  const gallery = val<GalleryImage[]>('gallery', []);

  const uploadFile = async (kind: string, file: File, apply: (url: string) => void) => {
    setUploading(kind);
    try {
      apply(await adminApi.upload(kind, file));
    } catch {
      onError(t('uploadFailed'));
    } finally {
      setUploading(null);
    }
  };

  const filePick =
    (kind: string, apply: (url: string, name: string) => void) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = '';
      for (const f of files.slice(0, 1)) {
        void uploadFile(kind, f, (url) => apply(url, f.name));
      }
    };

  const save = async () => {
    if (Object.keys(draft).length === 0) return;
    try {
      const next = await adminApi.patchSettings(draft);
      setDraft({});
      onSaved(next);
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 2600);
    } catch {
      onError(t('uploadFailed'));
    }
  };

  const previewBox = (url: string | null, height: number): CSSProperties => ({
    position: 'relative',
    height,
    borderRadius: 8,
    overflow: 'hidden',
    boxShadow: RING,
    background: url ? `${CREAM_2} url(${url}) center / cover no-repeat` : CREAM_2,
  });

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
        <span style={{ fontSize: 11, color: TAN_LIGHT }}>{t('subtitle')}</span>
        <span style={{ flexGrow: 1 }} />
        {savedToast ? (
          <span style={{ fontStyle: 'italic', fontSize: 12, color: GREEN }}>{tSaved}</span>
        ) : null}
        {uploading ? (
          <span style={{ fontStyle: 'italic', fontSize: 12, color: TAN }}>{t('uploading')}</span>
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={kicker}>{t('hero')}</span>
              <div style={previewBox(val<string | null>('heroUrl', null), 110)} />
              <label style={uploadLabel}>
                {t('changeImage')}
                <input
                  type="file"
                  accept="image/*"
                  onChange={filePick('hero', (url) => patch({ heroUrl: url }))}
                  style={{ display: 'none' }}
                />
              </label>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={kicker}>{t('music')}</span>
              <div
                style={{
                  height: 110,
                  borderRadius: 8,
                  boxShadow: RING,
                  background: CREAM_2,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <span
                  style={{
                    fontStyle: 'italic',
                    fontSize: 11,
                    color: INK,
                    maxWidth: '90%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {val<string>('musicName', '') || t('noMusic')}
                </span>
              </div>
              <label style={uploadLabel}>
                {t('uploadMusic')}
                <input
                  type="file"
                  accept="audio/*"
                  onChange={filePick('music', (url, name) =>
                    patch({ musicUrl: url, musicName: name }),
                  )}
                  style={{ display: 'none' }}
                />
              </label>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={kicker}>{t('gallery', { count: gallery.length })}</span>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {gallery.map((img, i) => (
                <div
                  key={img.url + i}
                  role="button"
                  tabIndex={0}
                  title={t('setFocalPoint')}
                  aria-label={t('setFocalPoint')}
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = Math.round(((e.clientX - rect.left) / rect.width) * 100);
                    const y = Math.round(((e.clientY - rect.top) / rect.height) * 100);
                    const g = gallery.slice();
                    g[i] = { ...g[i], x, y };
                    patch({ gallery: g });
                  }}
                  onKeyDown={(e) => {
                    const step = 5;
                    const delta: Record<string, [number, number]> = {
                      ArrowLeft: [-step, 0],
                      ArrowRight: [step, 0],
                      ArrowUp: [0, -step],
                      ArrowDown: [0, step],
                    };
                    const d = delta[e.key];
                    if (!d) return;
                    e.preventDefault();
                    const g = gallery.slice();
                    const cur = g[i];
                    g[i] = {
                      ...cur,
                      x: Math.min(100, Math.max(0, (cur.x ?? 50) + d[0])),
                      y: Math.min(100, Math.max(0, (cur.y ?? 50) + d[1])),
                    };
                    patch({ gallery: g });
                  }}
                  style={{
                    position: 'relative',
                    width: 84,
                    height: 84,
                    borderRadius: 8,
                    overflow: 'hidden',
                    boxShadow: RING,
                    cursor: 'crosshair',
                    background: `url(${img.url}) ${img.x ?? 50}% ${img.y ?? 50}% / cover no-repeat`,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      position: 'absolute',
                      left: `${img.x ?? 50}%`,
                      top: `${img.y ?? 50}%`,
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      transform: 'translate(-50%, -50%)',
                      background: 'rgba(255,251,248,0.9)',
                      boxShadow: '0 0 0 1.5px rgba(59,47,39,0.65)',
                      pointerEvents: 'none',
                    }}
                  />
                  <button
                    type="button"
                    title={t('removePhoto')}
                    aria-label={t('removePhoto')}
                    onClick={(e) => {
                      e.stopPropagation();
                      patch({ gallery: gallery.filter((_, j) => j !== i) });
                    }}
                    style={galleryBtn('rgba(59,47,39,0.65)', { top: 4, right: 4 })}
                  >
                    {'×'}
                  </button>
                  <div
                    style={{ position: 'absolute', bottom: 4, left: 4, display: 'flex', gap: 3 }}
                  >
                    <button
                      type="button"
                      aria-label={t('moveLeft')}
                      onClick={() => {
                        if (i === 0) return;
                        const g = gallery.slice();
                        [g[i - 1], g[i]] = [g[i], g[i - 1]];
                        patch({ gallery: g });
                      }}
                      style={galleryBtn('rgba(59,47,39,0.55)')}
                    >
                      {'‹'}
                    </button>
                    <button
                      type="button"
                      aria-label={t('moveRight')}
                      onClick={() => {
                        if (i === gallery.length - 1) return;
                        const g = gallery.slice();
                        [g[i + 1], g[i]] = [g[i], g[i + 1]];
                        patch({ gallery: g });
                      }}
                      style={galleryBtn('rgba(59,47,39,0.55)')}
                    >
                      {'›'}
                    </button>
                  </div>
                </div>
              ))}
              <label
                style={{
                  width: 84,
                  height: 84,
                  borderRadius: 8,
                  border: `1px dashed ${TAN}`,
                  boxSizing: 'border-box',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  fontSize: 22,
                  color: TAN,
                  cursor: 'pointer',
                }}
              >
                {'+'}
                <span style={{ fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  {t('addPhotos')}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = '';
                    // Sequential so order matches the picker; each lands in the draft.
                    void (async () => {
                      let g = gallery.slice();
                      for (const f of files) {
                        try {
                          g = [...g, { url: await adminApi.upload('gallery', f) }];
                          patch({ gallery: g });
                        } catch {
                          onError(t('uploadFailed'));
                          break;
                        }
                      }
                    })();
                  }}
                  style={{ display: 'none' }}
                />
              </label>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={kicker}>{t('siteTitle')}</span>
            <input
              value={val<string>('siteTitle', '')}
              onChange={(e) => patch({ siteTitle: e.target.value })}
              aria-label={t('siteTitle')}
              style={{ ...inputBase, borderRadius: 8, padding: '9px 14px' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={kicker}>{t('siteDesc')}</span>
            <textarea
              value={val<string>('siteDesc', '')}
              onChange={(e) => patch({ siteDesc: e.target.value })}
              aria-label={t('siteDesc')}
              style={{
                ...inputBase,
                height: 56,
                borderRadius: 8,
                padding: '9px 14px',
                lineHeight: 1.6,
                resize: 'vertical',
              }}
            />
          </div>
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ ...previewBox(val<string | null>('ogUrl', null), 34), width: 64 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={kicker}>{t('og')}</span>
                <label style={{ ...uploadLabel, padding: '5px 12px' }}>
                  {t('changeImage')}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={filePick('og', (url) => patch({ ogUrl: url }))}
                    style={{ display: 'none' }}
                  />
                </label>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ ...previewBox(val<string | null>('iconUrl', null), 34), width: 34 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={kicker}>{t('icon')}</span>
                <label style={{ ...uploadLabel, padding: '5px 12px' }}>
                  {t('changeImage')}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={filePick('icon', (url) => patch({ iconUrl: url }))}
                    style={{ display: 'none' }}
                  />
                </label>
              </div>
            </div>
            <div style={{ flexGrow: 1 }} />
            <button
              type="button"
              onClick={() => void save()}
              style={{ ...pillSolid, padding: '9px 22px', letterSpacing: '0.08em' }}
            >
              {t('save')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function galleryBtn(bg: string, pos: CSSProperties = {}): CSSProperties {
  return {
    ...pos,
    position: pos.top !== undefined ? 'absolute' : 'static',
    width: 18,
    height: 18,
    borderRadius: 9,
    border: 'none',
    background: bg,
    color: 'rgb(255,251,248)',
    fontSize: 11,
    lineHeight: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontFamily: 'inherit',
  };
}
