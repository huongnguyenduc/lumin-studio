'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi, type Settings } from '@/lib/admin-api';
import type { GalleryImage } from '@/lib/site-settings';
import { inputBase, kicker, CREAM_2, GREEN, INK, TAN, RING } from './ui';

// Presentational body of the site-settings tab (hero/music/gallery/story/meta).
// Draft state lives in the parent SettingsDrawer (which owns one shared Huỷ/Lưu
// bar across both tabs); this component only reads `val` and writes via `patch`
// and the injected `uploadFile`. UI-only state (audio preview, drag target)
// stays local. Lifted verbatim from the former standalone SettingsPanel.
const uploadLabel: CSSProperties = {
  alignSelf: 'flex-start',
  padding: '6px 14px',
  borderRadius: 20,
  boxShadow: RING,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

// The drawer renders outside the admin page's `zoom: 1.15` ancestor (see
// settings-drawer.tsx), so it doesn't inherit that ambient magnification —
// these local overrides of the shared `kicker`/`inputBase` tokens keep field
// labels and input text a touch bigger/bolder so they stay just as readable.
const fieldLabel: CSSProperties = { ...kicker, fontSize: 12, fontWeight: 600 };
const fieldInput: CSSProperties = {
  ...inputBase,
  fontSize: 14,
  borderRadius: 8,
  padding: '9px 14px',
};

// Crop ratio the public gallery actually renders at (Gallery.tsx: 3-col grid,
// 313px canvas, 118px fixed row height ⇒ a single cell's colWidth/rowHeight ≈
// 0.79, close to 4:5). A cell spanning `col`×`row` isn't the same shape as a
// single cell scaled up — e.g. the {col:2} tile in block 2 is landscape
// (~1.6), not portrait — so the ratio has to scale by span, not stay fixed.
// Using CSS aspect-ratio (instead of the old fixed 130px pixel row height)
// means every tile keeps its true proportion at whatever width this section
// ends up rendering at.
function galleryAspect(cell: { col?: number; row?: number }): string {
  return `${4 * (cell.col ?? 1)} / ${5 * (cell.row ?? 1)}`;
}

type GalleryCell = { col?: number; row?: number };
const GALLERY_BLOCKS: {
  cells: GalleryCell[];
  captionKey: 'storyCaption1' | 'storyCaption2' | 'storyCaption3';
}[] = [
  { cells: [{ col: 2, row: 2 }, {}, {}], captionKey: 'storyCaption1' },
  { cells: [{}, {}, {}, {}, { col: 2 }], captionKey: 'storyCaption2' },
  { cells: [{ col: 3, row: 2 }, {}, {}, {}], captionKey: 'storyCaption3' },
];

export function SettingsFields({
  val,
  patch,
  uploadFile,
  onError,
}: {
  val: <T>(key: string, fallback: T) => T;
  patch: (p: Settings) => void;
  uploadFile: (kind: string, file: File, apply: (url: string) => void) => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations('admin.settings');
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const previewRef = useRef<HTMLAudioElement | null>(null);

  const togglePreview = () => {
    if (previewPlaying) {
      previewRef.current?.pause();
      setPreviewPlaying(false);
      return;
    }
    const url = val<string>('musicUrl', '');
    if (!url) return;
    if (!previewRef.current) previewRef.current = new Audio();
    const audio = previewRef.current;
    audio.src = url;
    audio.volume = val<number>('musicVolume', 0.6);
    audio.loop = true;
    audio.onended = () => setPreviewPlaying(false);
    void audio.play().then(() => setPreviewPlaying(true));
  };

  useEffect(() => () => previewRef.current?.pause(), []);

  const gallery = val<GalleryImage[]>('gallery', []);

  const reorderGallery = (from: number, to: number) => {
    if (Number.isNaN(from) || from === to) return;
    const g = gallery.slice();
    const [moved] = g.splice(from, 1);
    g.splice(to, 0, moved);
    patch({ gallery: g });
  };

  const filePick =
    (kind: string, apply: (url: string, name: string) => void) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = '';
      for (const f of files.slice(0, 1)) uploadFile(kind, f, (url) => apply(url, f.name));
    };

  let galleryOffset = 0;
  const galleryBlocks = GALLERY_BLOCKS.map((b, bi) => {
    const isLast = bi === GALLERY_BLOCKS.length - 1;
    const want = isLast ? Math.max(b.cells.length, gallery.length - galleryOffset) : b.cells.length;
    const count = Math.min(want, Math.max(0, gallery.length - galleryOffset));
    const cells = Array.from({ length: count }, (_, ci) => b.cells[ci] ?? {});
    const out = { ...b, cells, offset: galleryOffset };
    galleryOffset += count;
    return out;
  }).filter((b) => b.cells.length > 0);

  const previewBox = (url: string | null, height: number): CSSProperties => ({
    position: 'relative',
    height,
    borderRadius: 8,
    overflow: 'hidden',
    boxShadow: RING,
    background: url ? `${CREAM_2} url(${url}) center / cover no-repeat` : CREAM_2,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={fieldLabel}>{t('hero')}</span>
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
          <span style={fieldLabel}>{t('music')}</span>
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
                fontSize: 12,
                fontWeight: 500,
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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
            <button
              type="button"
              onClick={togglePreview}
              disabled={!val<string>('musicUrl', '')}
              style={{
                ...uploadLabel,
                cursor: val<string>('musicUrl', '') ? 'pointer' : 'default',
                opacity: val<string>('musicUrl', '') ? 1 : 0.5,
              }}
            >
              {previewPlaying ? t('stopPreview') : t('playPreview')}
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 500, color: INK }}>{t('defaultVolume')}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(val<number>('musicVolume', 0.6) * 100)}
              onChange={(e) => {
                const v = Number(e.target.value) / 100;
                patch({ musicVolume: v });
                if (previewRef.current) previewRef.current.volume = v;
              }}
              aria-label={t('defaultVolume')}
              style={{ flexGrow: 1, cursor: 'pointer' }}
            />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={fieldLabel}>{t('storyHeading')}</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          <input
            value={val<string>('storyLine1', '')}
            onChange={(e) => patch({ storyLine1: e.target.value })}
            aria-label={t('storyLine1')}
            placeholder={t('storyLine1')}
            style={fieldInput}
          />
          <input
            value={val<string>('storyLine2', '')}
            onChange={(e) => patch({ storyLine2: e.target.value })}
            aria-label={t('storyLine2')}
            placeholder={t('storyLine2')}
            style={fieldInput}
          />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={fieldLabel}>{t('gallery', { count: gallery.length })}</span>
        {/* Fills close to the drawer's full content width (was capped at an
            arbitrary 480px) — each tile below keeps the public site's true
            portrait crop via aspect-ratio instead of a fixed row height, so it
            stays correct at whatever width this ends up rendering. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, width: '100%' }}>
          {galleryBlocks.map((block, bi) => (
            <div key={bi} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gridAutoRows: 'auto',
                  gap: 12,
                  gridAutoFlow: 'dense',
                }}
              >
                {block.cells.map((cell, ci) => {
                  const i = block.offset + ci;
                  const img = gallery[i];
                  return (
                    <div
                      key={img.url + i}
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (dragOverIndex !== i) setDragOverIndex(i);
                      }}
                      onDragLeave={() => setDragOverIndex((cur) => (cur === i ? null : cur))}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragOverIndex(null);
                        reorderGallery(Number(e.dataTransfer.getData('text/plain')), i);
                      }}
                      style={{
                        position: 'relative',
                        aspectRatio: galleryAspect(cell),
                        gridColumn: cell.col ? `span ${cell.col}` : undefined,
                        gridRow: cell.row ? `span ${cell.row}` : undefined,
                      }}
                    >
                      <FocalPicker
                        url={img.url}
                        x={img.x ?? 50}
                        y={img.y ?? 50}
                        width="100%"
                        height="100%"
                        label={t('setFocalPoint')}
                        errorLabel={t('imageLoadFailed')}
                        onChange={(x, y) => {
                          const g = gallery.slice();
                          g[i] = { ...g[i], x, y };
                          patch({ gallery: g });
                        }}
                      />
                      <span
                        draggable
                        title={t('reorderPhoto')}
                        aria-label={t('reorderPhoto')}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', String(i));
                        }}
                        style={galleryBtn('rgba(59,47,39,0.65)', { top: 6, left: 6 }, 24)}
                      >
                        {'⠿'}
                      </span>
                      <label
                        title={t('replacePhoto')}
                        aria-label={t('replacePhoto')}
                        style={galleryBtn('rgba(59,47,39,0.65)', { bottom: 6, right: 6 }, 24)}
                      >
                        {'⟳'}
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            if (!file) return;
                            uploadFile('gallery', file, (url) => {
                              const g = gallery.slice();
                              g[i] = { ...g[i], url };
                              patch({ gallery: g });
                            });
                          }}
                          style={{ display: 'none' }}
                        />
                      </label>
                      <button
                        type="button"
                        title={t('removePhoto')}
                        aria-label={t('removePhoto')}
                        onClick={(e) => {
                          e.stopPropagation();
                          patch({ gallery: gallery.filter((_, j) => j !== i) });
                        }}
                        style={galleryBtn('rgba(59,47,39,0.65)', { top: 6, right: 6 }, 24)}
                      >
                        {'×'}
                      </button>
                      {dragOverIndex === i ? (
                        <div
                          aria-hidden
                          style={{
                            position: 'absolute',
                            inset: 0,
                            borderRadius: 8,
                            boxShadow: `0 0 0 3px ${GREEN}`,
                            background: 'rgba(76,140,90,0.18)',
                            pointerEvents: 'none',
                          }}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <textarea
                value={val<string>(block.captionKey, '')}
                onChange={(e) => patch({ [block.captionKey]: e.target.value })}
                aria-label={t(block.captionKey)}
                placeholder={t(block.captionKey)}
                style={{
                  ...inputBase,
                  height: 44,
                  borderRadius: 8,
                  padding: '8px 12px',
                  fontSize: 13,
                  lineHeight: 1.5,
                  resize: 'vertical',
                }}
              />
            </div>
          ))}
          <label
            style={{
              // Matches one grid column above (3 cols, 12px gaps) so it reads
              // as part of the same row rather than a fixed, now-undersized square.
              width: 'calc((100% - 24px) / 3)',
              aspectRatio: galleryAspect({}),
              borderRadius: 8,
              border: `1px dashed ${TAN}`,
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 4,
              fontSize: 26,
              color: INK,
              cursor: 'pointer',
            }}
          >
            {'+'}
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
              }}
            >
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
                  let failed = 0;
                  for (const f of files) {
                    try {
                      g = [...g, { url: await adminApi.upload('gallery', f) }];
                      patch({ gallery: g });
                    } catch {
                      failed += 1;
                    }
                  }
                  if (failed > 0) onError(t('uploadFailedCount', { failed, total: files.length }));
                })();
              }}
              style={{ display: 'none' }}
            />
          </label>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={fieldLabel}>{t('siteTitle')}</span>
        <input
          value={val<string>('siteTitle', '')}
          onChange={(e) => patch({ siteTitle: e.target.value })}
          aria-label={t('siteTitle')}
          style={fieldInput}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={fieldLabel}>{t('siteDesc')}</span>
        <textarea
          value={val<string>('siteDesc', '')}
          onChange={(e) => patch({ siteDesc: e.target.value })}
          aria-label={t('siteDesc')}
          style={{
            ...inputBase,
            height: 56,
            borderRadius: 8,
            padding: '9px 14px',
            fontSize: 14,
            lineHeight: 1.6,
            resize: 'vertical',
          }}
        />
      </div>
      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ ...previewBox(val<string | null>('ogUrl', null), 34), width: 64 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={fieldLabel}>{t('og')}</span>
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
            <span style={fieldLabel}>{t('icon')}</span>
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
      </div>
    </div>
  );
}

// Click-or-drag focal-point picker: shows the image at its real crop (object-fit:
// cover, positioned at x/y%) so what you see here is what the public site renders.
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
  width: number | string;
  height: number | string;
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

function galleryBtn(bg: string, pos: CSSProperties = {}, size = 18): CSSProperties {
  return {
    ...pos,
    position: Object.keys(pos).length > 0 ? 'absolute' : 'static',
    width: size,
    height: size,
    borderRadius: size / 2,
    border: 'none',
    background: bg,
    color: 'rgb(255,251,248)',
    fontSize: Math.round(size * 0.6),
    lineHeight: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontFamily: 'inherit',
  };
}
