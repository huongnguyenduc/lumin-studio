'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
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
              {/* 140×304 = the public hero's own 393×852 design canvas, scaled down —
                  same crop box the visitor sees, not a generic wide preview strip. */}
              <FocalPicker
                url={val<string | null>('heroUrl', null)}
                x={val<number>('heroX', 50)}
                y={val<number>('heroY', 0)}
                width={140}
                height={304}
                label={t('setFocalPoint')}
                errorLabel={t('imageLoadFailed')}
                onChange={(x, y) => patch({ heroX: x, heroY: y })}
              />
              <label style={uploadLabel}>
                {t('changeImage')}
                <input
                  type="file"
                  accept="image/*"
                  onChange={filePick('hero', (url) => patch({ heroUrl: url, heroX: 50, heroY: 0 }))}
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
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', String(i));
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const from = Number(e.dataTransfer.getData('text/plain'));
                    if (Number.isNaN(from) || from === i) return;
                    const g = gallery.slice();
                    const [moved] = g.splice(from, 1);
                    g.splice(i, 0, moved);
                    patch({ gallery: g });
                  }}
                  style={{ position: 'relative', width: 84, height: 84, cursor: 'grab' }}
                >
                  <FocalPicker
                    url={img.url}
                    x={img.x ?? 50}
                    y={img.y ?? 50}
                    width={84}
                    height={84}
                    label={t('setFocalPoint')}
                    errorLabel={t('imageLoadFailed')}
                    onChange={(x, y) => {
                      const g = gallery.slice();
                      g[i] = { ...g[i], x, y };
                      patch({ gallery: g });
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={kicker}>{t('storyHeading')}</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
              <input
                value={val<string>('storyLine1', '')}
                onChange={(e) => patch({ storyLine1: e.target.value })}
                aria-label={t('storyLine1')}
                placeholder={t('storyLine1')}
                style={{ ...inputBase, borderRadius: 8, padding: '9px 14px' }}
              />
              <input
                value={val<string>('storyLine2', '')}
                onChange={(e) => patch({ storyLine2: e.target.value })}
                aria-label={t('storyLine2')}
                placeholder={t('storyLine2')}
                style={{ ...inputBase, borderRadius: 8, padding: '9px 14px' }}
              />
            </div>
            {(['storyCaption1', 'storyCaption2', 'storyCaption3'] as const).map((key) => (
              <textarea
                key={key}
                value={val<string>(key, '')}
                onChange={(e) => patch({ [key]: e.target.value })}
                aria-label={t(key)}
                placeholder={t(key)}
                style={{
                  ...inputBase,
                  height: 44,
                  borderRadius: 8,
                  padding: '9px 14px',
                  lineHeight: 1.5,
                  resize: 'vertical',
                }}
              />
            ))}
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

// Click-or-drag focal-point picker: shows the image at its real crop (object-fit:
// cover, positioned at x/y%) so what you see here is what the public site renders.
// Pointer capture makes it a genuine drag ("nắm kéo"), not just click-to-jump.
function FocalPicker({
  url,
  x,
  y,
  width,
  height,
  label,
  onChange,
  errorLabel,
}: {
  url: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  onChange: (x: number, y: number) => void;
  errorLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);

  const setFromPoint = (clientX: number, clientY: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    onChange(
      Math.round(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100))),
      Math.round(Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100))),
    );
  };

  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      title={label}
      aria-label={label}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setFromPoint(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (e.buttons !== 1) return;
        setFromPoint(e.clientX, e.clientY);
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
        onChange(Math.min(100, Math.max(0, x + d[0])), Math.min(100, Math.max(0, y + d[1])));
      }}
      style={{
        position: 'relative',
        width,
        height,
        borderRadius: 8,
        overflow: 'hidden',
        boxShadow: RING,
        cursor: 'grab',
        touchAction: 'none',
        background: CREAM_2,
      }}
    >
      {url ? (
        <img
          src={url}
          alt=""
          draggable={false}
          onError={() => setBroken(true)}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: `${x}% ${y}%`,
            pointerEvents: 'none',
          }}
        />
      ) : null}
      {broken ? (
        <span
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            fontSize: 10,
            padding: 6,
            color: 'rgb(185,58,26)',
            background: 'rgba(255,251,248,0.92)',
          }}
        >
          {errorLabel}
        </span>
      ) : null}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: `${x}%`,
          top: `${y}%`,
          width: 12,
          height: 12,
          borderRadius: 6,
          transform: 'translate(-50%, -50%)',
          background: 'rgba(255,251,248,0.9)',
          boxShadow: '0 0 0 1.5px rgba(59,47,39,0.65)',
          pointerEvents: 'none',
        }}
      />
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
