'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi, ApiError } from '@/lib/admin-api';
import { card, inputBase, kicker, pillGhost, pillSolid, GREEN, RED } from './ui';

// Self-service password change for whoever is logged in — master changes the
// master password, a couple session changes its own wedding's password
// (server infers which from the session scope, HANDOFF multi-couple).
export function ChangePassword({
  onClose,
  onError,
}: {
  onClose: () => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations('admin.password');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next.length < 8 || next.length > 72) {
      onError(t('badNew'));
      return;
    }
    setBusy(true);
    try {
      await adminApi.changePassword(current, next);
      setDone(true);
      setCurrent('');
      setNext('');
    } catch (err) {
      onError(err instanceof ApiError && err.status === 401 ? t('wrongCurrent') : t('badNew'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{ ...card, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <span style={kicker}>{t('heading')}</span>
      {done ? (
        <span style={{ fontSize: 13, color: GREEN }}>{t('done')}</span>
      ) : (
        <form
          onSubmit={(e) => void submit(e)}
          style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={kicker}>{t('current')}</span>
            <input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              aria-label={t('current')}
              style={{ ...inputBase, width: 220, borderRadius: 8, padding: '9px 14px' }}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={kicker}>{t('new')}</span>
            <input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              aria-label={t('new')}
              style={{ ...inputBase, width: 220, borderRadius: 8, padding: '9px 14px' }}
            />
          </div>
          <button type="submit" disabled={busy} style={{ ...pillSolid, opacity: busy ? 0.6 : 1 }}>
            {t('submit')}
          </button>
        </form>
      )}
      <button
        type="button"
        onClick={onClose}
        style={{ ...pillGhost, alignSelf: 'flex-start', color: RED }}
        className="wa-pill-ghost"
      >
        {t('cancel')}
      </button>
    </div>
  );
}
