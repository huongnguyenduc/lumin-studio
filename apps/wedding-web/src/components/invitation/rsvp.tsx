'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { CREAM, INK } from './theme';
import { Reveal } from './reveal';
import { saveSharedRSVP } from '@/lib/guest-identity';

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
export function Rsvp({
  guestId,
  eventSlug,
  initial,
  couple,
  name,
  onNameChange,
  enabled,
  guestLabel,
}: {
  guestId: string | null;
  eventSlug: string;
  initial: 'yes' | 'no' | null;
  couple: string;
  name?: string;
  onNameChange?: (name: string) => void;
  enabled: boolean;
  guestLabel?: string | null;
}) {
  const t = useTranslations('rsvp');
  const tLetter = useTranslations('letter');
  const salutation = guestLabel ?? tLetter('anonymousGuest');
  const [rsvp, setRsvp] = useState<'yes' | 'no' | null>(initial);
  const [nameError, setNameError] = useState(false);
  useEffect(() => setRsvp(initial), [initial]);

  // Chỉ tên do KHÁCH TỰ GÕ mới được đẩy lên. Tên khôi phục từ profile vốn đã
  // nằm sẵn trên server — bám theo `initial` để đoán thì hỏng đúng ca lưu
  // tên-chưa-RSVP (`initial` vẫn null nên mỗi lần mở trang lại ghi đè lại nó).
  const userEdited = useRef(false);
  const savedName = useRef<string | null>(null);

  // Tự lưu tên sau khi ngưng gõ, kể cả khi khách CHƯA chọn tham dự — gửi
  // rsvp:null, server giữ nguyên lựa chọn cũ nếu đã có (coalesce).
  useEffect(() => {
    if (guestId || !enabled || !userEdited.current) return;
    const trimmed = (name ?? '').trim();
    if (!trimmed || trimmed === savedName.current) return;
    const timer = setTimeout(() => {
      const previous = savedName.current;
      savedName.current = trimmed;
      void saveSharedRSVP({ eventSlug, name: trimmed, rsvp }).catch(() => {
        savedName.current = previous; // hỏng thì lần gõ kế tiếp thử lại
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [name, rsvp, enabled, guestId, eventSlug]);

  const choose = (v: 'yes' | 'no') => {
    if (!enabled) return;
    if (!guestId && !name?.trim()) {
      setNameError(true);
      return;
    }
    setNameError(false);
    setRsvp(v); // optimistic — the write is idempotent, a retry just re-sends
    if (guestId) {
      const qs = new URLSearchParams({ host: location.hostname, event: eventSlug });
      void fetch(`/api/invite/${encodeURIComponent(guestId)}/rsvp?${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rsvp: v }),
      }).catch(() => {});
    } else {
      const trimmed = name!.trim();
      savedName.current = trimmed; // tránh debounce gửi lại y hệt ngay sau đó
      void saveSharedRSVP({ eventSlug, name: trimmed, rsvp: v }).catch(() => {
        savedName.current = null;
      });
    }
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
        background: 'url(/image/rsvp-background.webp) center / 100% 100% no-repeat',
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
        {t('intro1', { guestLabel: salutation })}
      </Reveal>
      <Reveal
        style={{ width: 280, fontSize: 12, lineHeight: 1.55, color: CREAM, textAlign: 'center' }}
      >
        {t('intro2', { guestLabel: salutation })}
        <br />
        {t('regards')}
      </Reveal>
      {/* Ô tên + 2 nút nằm chung MỘT cột `fit-content`: cột co theo hàng nút,
          ô tên `width:100%` nên mép trái/phải luôn trùng mép 2 nút — kể cả khi
          nhãn đổi sang "✓ Tham dự được" làm hàng nút rộng ra. `size={1}` để
          chiều rộng mặc định 20 ký tự của <input> không kéo cột phình. */}
      <Reveal
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: 12,
          width: 'fit-content',
        }}
      >
        {!guestId ? (
          <input
            id="shared-rsvp-name"
            size={1}
            value={name ?? ''}
            onChange={(event) => {
              userEdited.current = true;
              onNameChange?.(event.target.value);
            }}
            maxLength={100}
            placeholder={t('nameLabel')}
            aria-label={t('nameLabel')}
            aria-invalid={nameError}
            aria-describedby={nameError ? 'shared-rsvp-name-error' : undefined}
            className="invite-rsvp-name"
            style={{
              width: '100%',
              minWidth: 0,
              boxSizing: 'border-box',
              border: 'none',
              outline: 'none',
              borderRadius: 22,
              padding: '7px 18px',
              // Trong suốt = ăn theo nền section; giữ ring 0.5px như pill
              // "Không tham dự được" để ô vẫn thấy được mà không chọi tông.
              background: 'transparent',
              boxShadow: `0 0 0 0.5px ${CREAM}`,
              color: CREAM,
              fontFamily: 'inherit',
              fontSize: 12,
              textAlign: 'center',
            }}
          />
        ) : null}
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
          {pill('yes')}
          {pill('no')}
        </div>
        {!guestId && nameError ? (
          <span
            id="shared-rsvp-name-error"
            style={{ color: CREAM, fontSize: 11, textAlign: 'center' }}
          >
            {t('nameRequired')}
          </span>
        ) : !guestId && !enabled ? (
          <span style={{ color: CREAM, fontSize: 11, textAlign: 'center' }}>
            {t('identityRequired')}
          </span>
        ) : null}
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
          {rsvp === 'yes' ? t('thanksYes', { couple }) : t('thanksNo')}
        </span>
      ) : null}
    </div>
  );
}
