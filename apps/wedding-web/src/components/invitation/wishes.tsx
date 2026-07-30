'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import type { Wish } from '@/lib/types';
import { CREAM, INK, TAN, TAN_LIGHT, TERRACOTTA, RING, SCRIPT } from './theme';
import { WISH_COLORS } from './theme';
import { timeAgo } from '@/lib/time';
import { Reveal } from './reveal';
import { storedToken } from '@/lib/guest-identity';

// editTokens map wish id -> the once-issued secret that lets THIS browser
// self-edit that wish (HANDOFF §2.8 follow-up) — never sent anywhere except
// back to the PATCH endpoint. Keyed per-browser, not per-guest: a wish
// created before this feature, or opened on another device, has none.
const EDIT_TOKENS_KEY = 'wedding_wish_edit_tokens_v1';

function editTokens(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(EDIT_TOKENS_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

function saveEditToken(id: string, token: string) {
  try {
    localStorage.setItem(EDIT_TOKENS_KEY, JSON.stringify({ ...editTokens(), [id]: token }));
  } catch {
    // No self-edit for this wish, but it's already sent — not worth failing over.
  }
}

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
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span
          style={{
            fontStyle: 'italic',
            fontSize: 12,
            lineHeight: 1.7,
            color: INK,
            whiteSpace: 'pre-line',
          }}
        >
          “{text}”
        </span>
        <img src="/image/card-decor.svg" alt="card decor" style={{ width: 30, height: 48 }} />
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          gap: 12,
        }}
      >
        <span style={{ fontSize: 12, color: INK, fontWeight: 600 }}>{name}</span>
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
  identityEnabled,
  initialWishes,
  couple,
}: {
  guestId: string | null;
  guestLabel: string | null;
  identityEnabled: boolean;
  initialWishes: Wish[];
  couple: string;
}) {
  const t = useTranslations('wish');
  const tw = useTranslations('wall');
  const [name, setName] = useState(guestLabel ?? '');
  const [text, setText] = useState('');
  const [color, setColor] = useState(0);
  const [sent, setSent] = useState(false);
  const [wishes, setWishes] = useState(initialWishes);
  const [limit, setLimit] = useState(4);
  // Populated post-mount (localStorage isn't available during SSR) — which
  // wishes THIS browser can self-edit. Two independent sources: a per-wish
  // editToken kept locally since sending it, and (for wishes from BEFORE that
  // feature existed) a server lookup by personalized guestId / consented GI
  // identity — whichever the wish was originally submitted with.
  const [myEditTokens, setMyEditTokens] = useState<Record<string, string>>({});
  const [editableIds, setEditableIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const tokens = editTokens();
    setMyEditTokens(tokens);
    setEditableIds(new Set(Object.keys(tokens)));
    if (!guestId && !identityEnabled) return;
    void fetch(`/api/wishes/mine?host=${encodeURIComponent(location.hostname)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guestId: guestId ?? '',
        identityToken: identityEnabled ? storedToken() : '',
      }),
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { ids: string[] };
        setEditableIds((s) => new Set([...s, ...data.ids]));
      })
      .catch(() => {});
  }, [guestId, identityEnabled]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editText, setEditText] = useState('');
  const [editColor, setEditColor] = useState(0);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState(false);
  // Mirror the name typed at RSVP (or the guest label) until the guest edits
  // this field themselves — after that their own wording wins, including an
  // empty one. Keyed on `name` instead would refill mid-deletion.
  const renamed = useRef(false);
  useEffect(() => {
    if (!renamed.current && guestLabel) setName(guestLabel);
  }, [guestLabel]);

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
    // location.hostname routes the wish to THIS host's wedding wall (multi-couple).
    void fetch(`/api/wishes?host=${encodeURIComponent(location.hostname)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guestId: guestId ?? '',
        identityToken: identityEnabled ? storedToken() : '',
        name: finalName,
        text: trimmed,
        color: bg,
      }),
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { id: string; editToken?: string };
        setWishes((w) => w.map((item) => (item.id === 'local' ? { ...item, id: data.id } : item)));
        if (data.editToken) saveEditToken(data.id, data.editToken);
        setEditableIds((s) => new Set(s).add(data.id));
      })
      .catch(() => {});
  };

  const startEdit = (w: Wish) => {
    setEditingId(w.id);
    setEditName(w.name);
    setEditText(w.text);
    const idx = WISH_COLORS.findIndex((c) => c.bg === w.color);
    setEditColor(idx >= 0 ? idx : 0);
    setEditError(false);
  };

  const saveEdit = async (id: string) => {
    const trimmed = editText.trim();
    if (!trimmed) return;
    setEditSaving(true);
    setEditError(false);
    try {
      const res = await fetch(
        `/api/wishes/${encodeURIComponent(id)}?host=${encodeURIComponent(location.hostname)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            editToken: myEditTokens[id] ?? '',
            guestId: guestId ?? '',
            identityToken: identityEnabled ? storedToken() : '',
            name: editName.trim() || t('defaultName'),
            text: trimmed,
            color: WISH_COLORS[editColor].bg,
          }),
        },
      );
      if (!res.ok) {
        setEditError(true);
        return;
      }
      const data = (await res.json()) as Wish;
      setWishes((w) => w.map((item) => (item.id === id ? { ...item, ...data } : item)));
      setEditingId(null);
    } catch {
      setEditError(true);
    } finally {
      setEditSaving(false);
    }
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
            background: 'url(/image/wishes-background.webp) center / cover no-repeat',
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
              {t('intro', { couple })}
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
                  {t('sentBody', { couple })}
                </span>
              </>
            ) : (
              <>
                <input
                  value={name}
                  onChange={(e) => {
                    renamed.current = true;
                    setName(e.target.value);
                  }}
                  placeholder={t('namePlaceholder')}
                  aria-label={t('namePlaceholder')}
                  style={{ ...inputBase, borderRadius: 25, padding: '8px 14px' }}
                />
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={t('textPlaceholder')}
                  aria-label={t('textPlaceholder')}
                  maxLength={2000}
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
          padding: '60px 40px 40px',
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
          {shown.map((w) =>
            editingId === w.id ? (
              <div
                key={w.id + w.createdAt}
                style={{
                  background: w.color ?? CREAM,
                  borderRadius: 8,
                  boxShadow: RING,
                  padding: '18px 20px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  aria-label={t('namePlaceholder')}
                  style={{
                    ...inputBase,
                    width: '100%',
                    borderRadius: 25,
                    padding: '8px 14px',
                  }}
                />
                <textarea
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  aria-label={t('textPlaceholder')}
                  maxLength={2000}
                  style={{
                    ...inputBase,
                    width: '100%',
                    height: 108,
                    borderRadius: 14,
                    padding: '10px 14px',
                    lineHeight: 1.6,
                    resize: 'none',
                  }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {WISH_COLORS.map((c, i) => (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setEditColor(i)}
                      title={t(c.key)}
                      aria-label={t(c.key)}
                      aria-pressed={editColor === i}
                      style={{
                        width: 44,
                        height: 44,
                        margin: -13,
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
                            editColor === i
                              ? `0 0 0 1px ${CREAM}, 0 0 0 2.5px ${TERRACOTTA}`
                              : RING,
                        }}
                      />
                    </button>
                  ))}
                </div>
                {editError ? (
                  <span style={{ fontSize: 10, color: TERRACOTTA }}>{t('editError')}</span>
                ) : null}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    disabled={editSaving}
                    onClick={() => void saveEdit(w.id)}
                    className="invite-pill-solid"
                    style={{
                      padding: '6px 16px',
                      borderRadius: 22,
                      border: 'none',
                      background: INK,
                      color: CREAM,
                      fontSize: 11,
                      cursor: editSaving ? 'default' : 'pointer',
                      opacity: editSaving ? 0.6 : 1,
                      fontFamily: 'inherit',
                    }}
                  >
                    {t('save')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    style={{
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
                    {t('cancel')}
                  </button>
                </div>
              </div>
            ) : (
              <div key={w.id + w.createdAt} style={{ display: 'flex', flexDirection: 'column' }}>
                <LetterCard
                  bg={w.color ?? CREAM}
                  text={w.text}
                  name={w.name}
                  when={timeAgo(w.createdAt)}
                />
                {editableIds.has(w.id) ? (
                  <button
                    type="button"
                    onClick={() => startEdit(w)}
                    style={{
                      alignSelf: 'flex-end',
                      marginTop: 4,
                      border: 'none',
                      background: 'transparent',
                      fontSize: 10,
                      color: TAN,
                      textDecoration: 'underline',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {t('edit')}
                  </button>
                ) : null}
              </div>
            ),
          )}
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
