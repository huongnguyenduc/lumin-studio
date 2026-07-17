'use client';

import { useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { CREAM, INK } from './theme';
import { Reveal } from './reveal';

const pillBase: CSSProperties = {
  padding: '7px 18px',
  borderRadius: 22,
  border: 'none',
  boxShadow: `0 0 0 0.5px ${CREAM}`,
  fontSize: 12,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  fontFamily: 'inherit',
};

// RSVP (§2.6): two pills, mutually exclusive, changeable any time (idempotent
// upsert). Rendered only for a valid guest link — the anonymous card hides the
// section (HANDOFF §9 open item, recommended behavior).
export function Rsvp({ guestId, initial }: { guestId: string; initial: 'yes' | 'no' | null }) {
  const t = useTranslations('rsvp');
  const [rsvp, setRsvp] = useState<'yes' | 'no' | null>(initial);

  const choose = (v: 'yes' | 'no') => {
    setRsvp(v); // optimistic — the write is idempotent, a retry just re-sends
    void fetch(`/api/invite/${encodeURIComponent(guestId)}/rsvp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rsvp: v }),
    }).catch(() => {});
  };

  const pill = (v: 'yes' | 'no') => {
    const selected = rsvp === v;
    return (
      <button
        type="button"
        onClick={() => choose(v)}
        className={selected ? undefined : 'invite-pill-ghost'}
        style={{
          ...pillBase,
          background: selected ? CREAM : 'transparent',
          color: selected ? INK : CREAM,
          fontWeight: selected ? 600 : 400,
        }}
      >
        {selected ? t(v === 'yes' ? 'yesSelected' : 'noSelected') : t(v === 'yes' ? 'yes' : 'no')}
      </button>
    );
  };

  return (
    <div
      style={{
        background: INK,
        padding: '60px 40px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 24,
      }}
    >
      <Reveal style={{ fontFamily: 'var(--font-script), cursive', fontSize: 27, color: CREAM }}>
        {t('heading')}
      </Reveal>
      <Reveal
        style={{ width: 289, fontSize: 12, lineHeight: 1.55, color: CREAM, textAlign: 'center' }}
      >
        {t('intro1')}
      </Reveal>
      <Reveal
        style={{ width: 280, fontSize: 12, lineHeight: 1.55, color: CREAM, textAlign: 'center' }}
      >
        {t('intro2')}
        <br />
        {t('regards')}
      </Reveal>
      <Reveal style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
        {pill('yes')}
        {pill('no')}
      </Reveal>
      {rsvp ? (
        <span
          style={{
            fontStyle: 'italic',
            fontSize: 11,
            color: 'rgb(220,207,197)',
            textAlign: 'center',
            marginTop: -10,
          }}
        >
          {rsvp === 'yes' ? t('thanksYes') : t('thanksNo')}
        </span>
      ) : null}
    </div>
  );
}
