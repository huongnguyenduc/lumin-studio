'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { INK, SCRIPT } from './theme';
import { Reveal } from './reveal';

// Gallery (§2.5 rev, Figma 132:212): script two-line heading, then three photo
// blocks with a caption under each. 12 slots (3+5+4); extra host photos flow into the
// last block as 1×1 (lightbox indexes the flat list). Keyboard lightbox kept.
const IMAGES = ['g02', 'g03', 'g04', 'g05', 'g06', 'g07', 'g08', 'g12', 'g01', 'g09', 'g10', 'g11'];
type Cell = { col?: number; row?: number; delay?: number };
const BLOCKS: { cells: Cell[]; captionKey: string; captionPad: number }[] = [
  {
    cells: [{ col: 2, row: 2 }, { delay: 100 }, { delay: 180 }],
    captionKey: 'caption1',
    captionPad: 24,
  },
  {
    cells: [{}, { delay: 100 }, { delay: 180 }, {}, { col: 2, delay: 100 }],
    captionKey: 'caption2',
    captionPad: 36,
  },
  {
    cells: [{ col: 3, row: 2 }, { delay: 100 }, { delay: 180 }, { delay: 260 }],
    captionKey: 'caption3',
    captionPad: 36,
  },
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

export function Gallery({ images }: { images?: string[] }) {
  const t = useTranslations('gallery');
  const [index, setIndex] = useState(-1);
  // Host-configured list (§3.5) or the built-in 12. The span pattern covers the
  // first 12 cells; extra images continue as 1×1 (CELLS lookup falls through).
  const srcs = images ?? IMAGES.map((img) => `/invite/${img}.jpg`);
  const n = srcs.length;

  // Deal srcs into the 3 fixed blocks; anything past the 11 patterned slots
  // joins the last block as 1×1 cells. Short lists just leave trailing blocks empty.
  let offset = 0;
  const blocks = BLOCKS.map((b, bi) => {
    const isLast = bi === BLOCKS.length - 1;
    const want = isLast ? Math.max(b.cells.length, n - offset) : b.cells.length;
    const count = Math.min(want, Math.max(0, n - offset));
    const cells = Array.from({ length: count }, (_, ci) => b.cells[ci] ?? {});
    const out = { ...b, cells, offset };
    offset += count;
    return out;
  }).filter((b) => b.cells.length > 0);

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
          position: 'relative',
          width: 260,
          display: 'flex',
          flexDirection: 'column',
          gap: 17,
          fontFamily: SCRIPT,
          fontSize: 40,
          lineHeight: 'normal',
          textBox: 'trim-both cap alphabetic',
          color: INK,
        }}
      >
        <span>{t('line1')}</span>
        <span style={{ textAlign: 'right' }}>{t('line2')}</span>
        {/* Con dấu HG (asset chung với envelope) — nhỏ, đứng tách bên trái "Forever.",
            không đè lên chữ (design để hở một khoảng trước chữ F). */}
        <img
          src="/invite/stamp.png"
          alt=""
          aria-hidden
          style={{
            position: 'absolute',
            left: 74,
            top: 73,
            width: 42,
            height: 42,
            filter: 'drop-shadow(1px 2px 5px rgba(101,101,101,0.35))',
          }}
        />
      </Reveal>
      <div style={{ marginTop: 36, width: 313, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {blocks.map((block, bi) => (
          <div key={bi} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gridAutoRows: 118,
                gap: 16,
                gridAutoFlow: 'dense',
              }}
            >
              {block.cells.map((cell, ci) => {
                const i = block.offset + ci;
                return (
                  <Reveal
                    key={srcs[i] + i}
                    delay={cell.delay}
                    style={{
                      gridColumn: cell.col ? `span ${cell.col}` : undefined,
                      gridRow: cell.row ? `span ${cell.row}` : undefined,
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
                        background: `url(${srcs[i]}) center / cover no-repeat`,
                        cursor: 'pointer',
                      }}
                    />
                  </Reveal>
                );
              })}
            </div>
            <p
              style={{
                margin: 0,
                padding: `0 ${block.captionPad}px`,
                fontSize: 12,
                lineHeight: 1.5,
                color: INK,
                textAlign: 'center',
              }}
            >
              {t(block.captionKey)}
            </p>
          </div>
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
            src={srcs[index]}
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
