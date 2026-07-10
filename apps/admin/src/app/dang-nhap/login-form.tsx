'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button, Input } from '@lumin/ui';
import { login } from '@/lib/auth-actions';

/**
 * Admin credential form (P3-a). Native `required`/`type=email` do the empty/format guarding (rung 4:
 * platform over JS); the Server Action does the real auth and re-issues the session cookie. On
 * success we replace → `/` and refresh so the now-authenticated dashboard re-renders; on failure we
 * surface a uniform message (no email-enumeration signal, matching core-api's single 401).
 */
export function LoginForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(e.currentTarget);
    const result = await login({
      email: String(form.get('email') ?? '').trim(),
      password: String(form.get('password') ?? ''),
    });
    if (result.ok) {
      router.replace('/');
      router.refresh();
      return; // stay pending — the route is navigating away
    }
    setError(result.reason === 'invalid' ? t('invalid') : t('error'));
    setPending(false);
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Input
        name="email"
        type="email"
        label={t('email')}
        autoComplete="username"
        required
        disabled={pending}
      />
      <Input
        name="password"
        type="password"
        label={t('password')}
        autoComplete="current-password"
        required
        disabled={pending}
      />
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? t('submitting') : t('submit')}
      </Button>
    </form>
  );
}
