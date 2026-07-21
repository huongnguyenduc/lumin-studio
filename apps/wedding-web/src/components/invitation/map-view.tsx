'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { INK } from './theme';
import { Reveal } from './reveal';
import { MapLightbox } from './map-lightbox';

// The venue map on the invitation is a tiny 305×145 thumbnail — too small to
// read street names. Tapping it opens a full-screen zoomable/pannable view
// (MapLightbox). The little corner glyph hints it's expandable.
export function MapView({
  mapUrl,
  mapsUrl,
  alt,
}: {
  mapUrl: string;
  mapsUrl?: string;
  alt: string;
}) {
  const t = useTranslations('letter');
  const [open, setOpen] = useState(false);
  return (
    <>
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
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t('viewMap')}
          style={{
            position: 'absolute',
            inset: 0,
            border: 'none',
            padding: 0,
            background: 'transparent',
            cursor: 'zoom-in',
          }}
        >
          <img
            src={mapUrl}
            alt={alt}
            style={{
              position: 'absolute',
              left: 3,
              top: 34,
              width: 305,
              height: 145,
              objectFit: 'cover',
            }}
          />
          {/* Expand affordance, bottom-right of the thumbnail. */}
          <span
            aria-hidden
            style={{
              position: 'absolute',
              right: 10,
              bottom: 10,
              width: 26,
              height: 26,
              borderRadius: 8,
              background: 'rgba(59,47,39,0.62)',
              color: 'rgb(255,251,248)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
              <path
                d="M5 1 H1 V5 M8 1 H12 V5 M12 8 V12 H8 M1 8 V12 H5"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          </span>
        </button>
      </Reveal>
      {open ? (
        <MapLightbox src={mapUrl} alt={alt} mapsUrl={mapsUrl} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
