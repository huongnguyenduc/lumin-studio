'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { adminApi, ApiError } from '@/lib/admin-api';
import { card, inputBase, kicker, pillSolid, RED, SCRIPT, INK } from './ui';

export function Login({ onSuccess }: { onSuccess: () => void }) {
  const t = useTranslations('admin.login');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminApi.login(password, location.hostname);
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError(t('wrong'));
      else setError(t('error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '60vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <form
        onSubmit={submit}
        style={{
          ...card,
          padding: '36px 40px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
          width: 320,
        }}
      >
        <span style={{ fontFamily: SCRIPT, fontSize: 30, color: INK }}>{t('brand')}</span>
        <span style={kicker}>{t('heading')}</span>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('passwordPlaceholder')}
          aria-label={t('passwordPlaceholder')}
          style={{ ...inputBase, width: '100%', borderRadius: 22, padding: '10px 16px' }}
        />
        {error ? <span style={{ fontSize: 12, color: RED }}>{error}</span> : null}
        <button type="submit" disabled={busy} style={{ ...pillSolid, opacity: busy ? 0.6 : 1 }}>
          {t('submit')}
        </button>
      </form>
    </div>
  );
}
