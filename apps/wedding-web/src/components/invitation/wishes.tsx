'use client';

import { useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import type { Wish } from '@/lib/types';
import { CREAM, INK, TAN, TAN_LIGHT, TERRACOTTA, RING, SCRIPT } from './theme';
import { WISH_COLORS } from './theme';
import { timeAgo } from '@/lib/time';
import { Reveal } from './reveal';

const inputBase: CSSProperties = {
  width: 171,
  boxSizing: 'border-box',
  border: 'none',
  outline: 'none',
  background: 'transparent',
  boxShadow: RING,
  fontFamily: 'inherit',
  fontSize: 11,
  color: INK,
};

// Letter card on the wall + the live preview share one look (§2.7/§2.8 — final
// style "letters", option 1a).
function LetterCard({
  bg,
  text,
  name,
  when,
}: {
  bg: string;
  text: string;
  name: string;
  when: string;
}) {
  return (
    <div
      style={{
        background: bg,
        borderRadius: 8,
        boxShadow: `${RING}, 0 2px 8px rgba(101,101,101,0.08)`,
        padding: '18px 20px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <span style={{ fontStyle: 'italic', fontSize: 12, lineHeight: 1.7, color: INK }}>
        “{text}”
      </span>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 12,
        }}
      >
        <span style={{ fontFamily: SCRIPT, fontSize: 18, color: TERRACOTTA }}>{name}</span>
        <span style={{ fontStyle: 'italic', fontSize: 10, color: TAN_LIGHT, whiteSpace: 'nowrap' }}>
          {when}
        </span>
      </div>
    </div>
  );
}

// Wish form (§2.7) + wishes wall (§2.8). SSR passes the current wall; a sent
// wish is prepended locally. ponytail: no polling/refetch — the wall refreshes
// on next visit; add refetch-on-focus if the couple wants it livelier.
export function Wishes({
  guestId,
  guestLabel,
  initialWishes,
}: {
  guestId: string | null;
  guestLabel: string | null;
  initialWishes: Wish[];
}) {
  const t = useTranslations('wish');
  const tw = useTranslations('wall');
  const [name, setName] = useState(guestLabel ?? '');
  const [text, setText] = useState('');
  const [color, setColor] = useState(0);
  const [sent, setSent] = useState(false);
  const [wishes, setWishes] = useState(initialWishes);
  const [limit, setLimit] = useState(4);

  const send = () => {
    const trimmed = text.trim();
    if (!trimmed) return; // empty = no-op (§2.7)
    const finalName = name.trim() || guestLabel || t('defaultName');
    const bg = WISH_COLORS[color].bg;
    setSent(true);
    setText('');
    setWishes((w) => [
      {
        id: 'local',
        name: finalName,
        text: trimmed,
        color: bg,
        createdAt: new Date().toISOString(),
      },
      ...w,
    ]);
    void fetch('/api/wishes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guestId: guestId ?? '', name: finalName, text: trimmed, color: bg }),
    }).catch(() => {});
  };

  const shown = wishes.slice(0, limit);
  const preview = !sent && (text.trim() !== '' || name.trim() !== '');

  return (
    <>
      <div
        style={{
          padding: '68px 40px 8px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <Reveal
          style={{
            position: 'relative',
            width: 310,
            height: 475,
            background: 'url(/invite/wish-paper.png) center / cover no-repeat',
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: '72px 44px 76px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 14,
            }}
          >
            <span style={{ fontSize: 12, lineHeight: 1.6, color: INK, textAlign: 'center' }}>
              {t('intro')}
            </span>
            {sent ? (
              <>
                <span style={{ fontFamily: SCRIPT, fontSize: 28, color: TERRACOTTA }}>
                  {t('sentHeading')}
                </span>
                <span
                  style={{
                    fontStyle: 'italic',
                    fontSize: 11,
                    lineHeight: 1.6,
                    color: TAN,
                    textAlign: 'center',
                    width: 180,
                  }}
                >
                  {t('sentBody')}
                </span>
              </>
            ) : (
              <>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('namePlaceholder')}
                  aria-label={t('namePlaceholder')}
                  style={{ ...inputBase, borderRadius: 25, padding: '8px 14px' }}
                />
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={t('textPlaceholder')}
                  aria-label={t('textPlaceholder')}
                  maxLength={500}
                  style={{
                    ...inputBase,
                    height: 108,
                    borderRadius: 14,
                    padding: '10px 14px',
                    lineHeight: 1.6,
                    resize: 'none',
                  }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontStyle: 'italic', fontSize: 10, color: TAN }}>
                    {t('colorLabel')}
                  </span>
                  {WISH_COLORS.map((c, i) => (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setColor(i)}
                      title={t(c.key)}
                      aria-label={t(c.key)}
                      aria-pressed={color === i}
                      style={{
                        // 44px tap target (a11y rule); the 18px visual dot is the inner span.
                        width: 44,
                        height: 44,
                        margin: -13, // keep the dots at their designed 10px-gap rhythm
                        border: 'none',
                        padding: 0,
                        background: 'transparent',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                      }}
                    >
                      <span
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: 9,
                          background: c.bg,
                          boxShadow:
                            color === i ? `0 0 0 1px ${CREAM}, 0 0 0 2.5px ${TERRACOTTA}` : RING,
                        }}
                      />
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={send}
                  className="invite-pill-solid"
                  style={{
                    marginTop: 4,
                    padding: '8px 20px',
                    borderRadius: 25,
                    border: 'none',
                    background: INK,
                    color: CREAM,
                    fontSize: 11,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {t('send')}
                </button>
              </>
            )}
          </div>
        </Reveal>
        {preview ? (
          <div
            style={{
              marginTop: 20,
              width: 310,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <span
              style={{
                fontWeight: 600,
                fontSize: 10,
                letterSpacing: '0.28em',
                textTransform: 'uppercase',
                color: TAN,
                textAlign: 'center',
              }}
            >
              {t('previewLabel')}
            </span>
            <LetterCard
              bg={WISH_COLORS[color].bg}
              text={text.trim() || t('previewEmpty')}
              name={name.trim() || t('defaultName')}
              when={t('previewNow')}
            />
          </div>
        ) : null}
      </div>

      <div
        style={{
          padding: '56px 24px 24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <Reveal style={{ fontFamily: SCRIPT, fontSize: 27, color: INK }}>{tw('heading')}</Reveal>
        <Reveal
          style={{
            marginTop: 8,
            fontWeight: 600,
            fontSize: 10,
            letterSpacing: '0.28em',
            textTransform: 'uppercase',
            color: TAN,
          }}
        >
          {tw('kicker')}
        </Reveal>
        <div
          style={{
            marginTop: 26,
            alignSelf: 'stretch',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
          }}
        >
          {shown.map((w) => (
            <LetterCard
              key={w.id + w.createdAt}
              bg={w.color ?? CREAM}
              text={w.text}
              name={w.name}
              when={timeAgo(w.createdAt)}
            />
          ))}
          {wishes.length > limit ? (
            <button
              type="button"
              onClick={() => setLimit((l) => l + 6)}
              className="invite-pill-ghost-tan"
              style={{
                alignSelf: 'center',
                marginTop: 4,
                padding: '6px 16px',
                borderRadius: 22,
                border: 'none',
                background: 'transparent',
                boxShadow: RING,
                fontSize: 11,
                color: INK,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {tw('more')}
            </button>
          ) : null}
        </div>
      </div>
    </>
  );
}
