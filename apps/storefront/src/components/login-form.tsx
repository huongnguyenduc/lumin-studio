'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button, Input } from '@lumin/ui';
import { loginCustomer } from '@/lib/customer-auth';
import { safeNextPath } from '@/lib/next-path';

type LoginError = 'invalidCredentials' | 'validation' | 'networkError' | 'formError';

/**
 * Customer login (/tai-khoan/dang-nhap, P1-s). email + password → a Server Action that authenticates
 * server-side (CORE_API_URL never reaches the client) and mints the session cookie, then routes to the
 * account hub. The action returns only a closed error `code` — the uniform 401 (unknown email OR wrong
 * password) surfaces as one message, no enumeration (ADR-030). Reads/writes ONLY the session; no order
 * creation or status change (Phase-1/2 boundary).
 */
export function LoginForm({ next }: { next?: string }) {
  const t = useTranslations('account.login');
  const router = useRouter();
  // Post-login return target (P3-t t-3: the pet-tag welcome links here with ?next=/t/{shortId}). Guarded
  // against open redirects; defaults to the account hub. Forwarded to the register link so a brand-new
  // customer comes back to the same place after signing up.
  const returnTo = safeNextPath(next);
  const registerHref = next
    ? `/tai-khoan/dang-ky?next=${encodeURIComponent(returnTo)}`
    : '/tai-khoan/dang-ky';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<LoginError | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('formError');
      return;
    }
    setError(null);
    setPending(true);
    const res = await loginCustomer(email, password);
    if (res.ok) {
      router.push(returnTo);
      router.refresh(); // invalidate any prefetched (logged-out) hub payload → re-read the fresh cookie
      return;
    }
    setPending(false);
    setError(
      res.code === 'invalid_credentials'
        ? 'invalidCredentials'
        : res.code === 'validation'
          ? 'validation'
          : 'networkError',
    );
  };

  return (
    <section className="mx-auto w-full max-w-[420px] px-4 py-6 md:px-6 md:py-10">
      <h1 className="font-display text-2xl font-bold text-text-strong md:text-3xl">
        {t('heading')}
      </h1>
      <p className="mt-1 text-sm text-text-muted">{t('intro')}</p>

      <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-4">
        <Input
          label={t('emailLabel')}
          placeholder={t('emailPlaceholder')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          inputMode="email"
          autoComplete="email"
        />
        <Input
          label={t('passwordLabel')}
          placeholder={t('passwordPlaceholder')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          autoComplete="current-password"
        />
        {/* Uniform, form-level error (either field, or a rejected credential) — a standalone role=alert,
            never bound to one Input (WCAG 3.3.1: don't mark one field invalid on a uniform 401). */}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {t(`errors.${error}`)}
          </p>
        ) : null}
        <Button
          type="submit"
          variant="pop"
          className="w-full"
          disabled={pending}
          aria-busy={pending}
        >
          {t('submit')}
        </Button>
      </form>

      <div className="mt-6 flex flex-col gap-2 text-sm text-text-muted">
        <p>
          {t('noAccount')}{' '}
          <Link
            href={registerHref}
            className="font-medium text-text-strong underline underline-offset-2 hover:text-accent-flame"
          >
            {t('registerLink')}
          </Link>
        </p>
        <Link
          href="/tra-cuu-don"
          className="font-medium text-text-strong underline underline-offset-2 hover:text-accent-flame"
        >
          {t('guestLookup')}
        </Link>
      </div>
    </section>
  );
}
