'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { INK, TAN, SCRIPT } from './theme';
import { Reveal } from './reveal';

// Gallery (§2.5): 12 photos, 3-col dense grid with locked span pattern, lightbox
// with keyboard support (Esc/←/→), wrap-around, scrim click closes.
const IMAGES = ['g02', 'g03', 'g04', 'g05', 'g06', 'g07', 'g08', 'g12', 'g01', 'g09', 'g10', 'g11'];
// span pattern + reveal stagger per prototype, indexed like IMAGES
const CELLS: { col?: number; row?: number; delay?: number }[] = [
  { col: 2, row: 2 },
  { delay: 100 },
  { delay: 180 },
  { row: 2 },
  { col: 2, row: 2, delay: 100 },
  {},
  { row: 2, delay: 100 },
  { row: 2, delay: 180 },
  { delay: 60 },
  {},
  { delay: 100 },
  { delay: 180 },
];

const navBtn: CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 20,
  border: 'none',
  padding: 0,
  background: 'transparent',
  boxShadow: '0 0 0 0.5px rgba(255,251,248,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'rgb(255,251,248)',
  fontSize: 20,
  cursor: 'pointer',
};

function CrossIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
      <path d="M1 1 L11 11 M11 1 L1 11" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="9" height="16" viewBox="0 0 9 16" fill="none" aria-hidden>
      <path d="M8 1 L1 8 L8 15" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function Gallery() {
  const t = useTranslations('gallery');
  const [index, setIndex] = useState(-1);
  const n = IMAGES.length;

  useEffect(() => {
    if (index < 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIndex(-1);
      if (e.key === 'ArrowLeft') setIndex((i) => (i + n - 1) % n);
      if (e.key === 'ArrowRight') setIndex((i) => (i + 1) % n);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, n]);

  return (
    <div
      style={{
        padding: '64px 39.5px 72px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <Reveal
        style={{
          fontFamily: SCRIPT,
          fontSize: 44,
          lineHeight: 1.2,
          color: INK,
          textAlign: 'center',
        }}
      >
        {t('heading')}
      </Reveal>
      <Reveal
        style={{
          marginTop: 8,
          fontWeight: 600,
          fontSize: 11,
          letterSpacing: '0.3em',
          textTransform: 'uppercase',
          color: TAN,
        }}
      >
        {t('kicker')}
      </Reveal>
      <div
        style={{
          marginTop: 30,
          width: 314,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gridTemplateRows: 'repeat(7, 118px)',
          gap: 16,
          gridAutoFlow: 'dense',
        }}
      >
        {IMAGES.map((img, i) => (
          <Reveal
            key={img}
            delay={CELLS[i].delay}
            style={{
              gridColumn: CELLS[i].col ? `span ${CELLS[i].col}` : undefined,
              gridRow: CELLS[i].row ? `span ${CELLS[i].row}` : undefined,
            }}
          >
            <button
              type="button"
              onClick={() => setIndex(i)}
              aria-label={t('photoAlt', { index: i + 1 })}
              style={{
                width: '100%',
                height: '100%',
                border: 'none',
                padding: 0,
                background: `url(/invite/${img}.jpg) center / cover no-repeat`,
                cursor: 'pointer',
              }}
            />
          </Reveal>
        ))}
      </div>
      {index >= 0 ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('photoAlt', { index: index + 1 })}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 60,
            background: 'rgba(32,26,21,0.94)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {/* Scrim click closes (§2.5); the image/buttons sit above so their clicks don't. */}
          <button
            type="button"
            onClick={() => setIndex(-1)}
            aria-label={t('close')}
            style={{
              position: 'absolute',
              inset: 0,
              border: 'none',
              padding: 0,
              background: 'transparent',
              cursor: 'default',
            }}
          />
          <button
            type="button"
            onClick={() => setIndex(-1)}
            aria-label={t('close')}
            className="invite-lb-btn"
            style={{
              ...navBtn,
              position: 'absolute',
              top: 18,
              right: 18,
              width: 36,
              height: 36,
              borderRadius: 18,
            }}
          >
            <CrossIcon />
          </button>
          <img
            src={`/invite/${IMAGES[index]}.jpg`}
            alt={t('photoAlt', { index: index + 1 })}
            style={{
              position: 'relative',
              maxWidth: '86vw',
              maxHeight: '72vh',
              objectFit: 'contain',
              boxShadow: '0 12px 48px rgba(0,0,0,0.5)',
            }}
          />
          <span
            style={{
              position: 'relative',
              marginTop: 14,
              fontSize: 11,
              letterSpacing: '0.25em',
              color: 'rgb(220,207,197)',
            }}
          >
            {t('counter', { current: index + 1, total: n })}
          </span>
          <button
            type="button"
            onClick={() => setIndex((index + n - 1) % n)}
            aria-label={t('prev')}
            className="invite-lb-btn"
            style={{ ...navBtn, position: 'absolute', left: 10, top: '50%', translate: '0 -50%' }}
          >
            <ChevronIcon />
          </button>
          <button
            type="button"
            onClick={() => setIndex((index + 1) % n)}
            aria-label={t('next')}
            className="invite-lb-btn"
            style={{
              ...navBtn,
              position: 'absolute',
              right: 10,
              top: '50%',
              translate: '0 -50%',
              transform: 'scaleX(-1)',
            }}
          >
            <ChevronIcon />
          </button>
        </div>
      ) : null}
    </div>
  );
}
