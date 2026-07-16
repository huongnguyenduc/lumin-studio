'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button, Input } from '@lumin/ui';
import { registerCustomer } from '@/lib/customer-auth';
import { safeNextPath } from '@/lib/next-path';

type RegisterError =
  | 'emailTaken'
  | 'nameInvalid'
  | 'passwordTooShort'
  | 'validation'
  | 'networkError'
  | 'formError';

/**
 * Customer registration (/tai-khoan/dang-ky, P1-s). name + email + phone + password → a Server Action
 * that creates the account server-side and mints the session cookie (register returns Set-Cookie → the
 * new customer is logged in), then routes to the return target. Client-side min-checks mirror the server
 * bounds (name 2..60 runes, password ≥8) for fast feedback; the server re-validates authoritatively.
 * The one field-error safe to surface is 409 EMAIL_TAKEN (bound to the email field). `next` (P3-t t-3)
 * carries the pet-tag return path through registration too, guarded against open redirects.
 */
export function RegisterForm({ next }: { next?: string }) {
  const t = useTranslations('account.register');
  const router = useRouter();
  const returnTo = safeNextPath(next);
  const loginHref = next
    ? `/tai-khoan/dang-nhap?next=${encodeURIComponent(returnTo)}`
    : '/tai-khoan/dang-nhap';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<RegisterError | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !phone.trim() || !password) {
      setError('formError');
      return;
    }
    // Rune count (code points) matches the server's Go-rune bound; password length is a fast pre-check —
    // the server enforces the real 8..72 byte bound.
    const nameLen = [...name.trim()].length;
    if (nameLen < 2 || nameLen > 60) {
      setError('nameInvalid');
      return;
    }
    if (password.length < 8) {
      setError('passwordTooShort');
      return;
    }
    setError(null);
    setPending(true);
    const res = await registerCustomer({
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      password,
    });
    if (res.ok) {
      router.push(returnTo);
      router.refresh(); // invalidate any prefetched (logged-out) hub payload → re-read the fresh cookie
      return;
    }
    setPending(false);
    setError(
      res.code === 'email_taken'
        ? 'emailTaken'
        : res.code === 'validation'
          ? 'validation'
          : 'networkError',
    );
  };

  // Field-bound errors where the offending field is unambiguous; the rest is a form-level alert.
  const emailError = error === 'emailTaken' ? t('errors.emailTaken') : undefined;
  const nameError = error === 'nameInvalid' ? t('errors.nameInvalid') : undefined;
  const passwordError = error === 'passwordTooShort' ? t('errors.passwordTooShort') : undefined;
  const formLevel =
    error === 'formError' || error === 'validation' || error === 'networkError'
      ? t(`errors.${error}`)
      : null;

  return (
    <section className="mx-auto w-full max-w-[440px] px-4 py-8 md:px-6 md:py-12">
      {/* Hi-fi 07: centred auth card (same shell as LoginForm). */}
      <div className="rounded-lg border-2 border-border-strong bg-surface-card p-6 shadow-pop md:p-8">
        <h1 className="text-center font-display text-xl font-bold text-text-strong md:text-2xl">
          {t('heading')}
        </h1>
        <p className="mt-1 text-center text-sm text-text-muted">{t('intro')}</p>

        <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-4">
          <Input
            label={t('nameLabel')}
            placeholder={t('namePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            error={nameError}
          />
          <Input
            label={t('emailLabel')}
            placeholder={t('emailPlaceholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            inputMode="email"
            autoComplete="email"
            error={emailError}
          />
          <Input
            label={t('phoneLabel')}
            placeholder={t('phonePlaceholder')}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
          />
          <Input
            label={t('passwordLabel')}
            placeholder={t('passwordPlaceholder')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            type="password"
            autoComplete="new-password"
            hint={t('passwordHint')}
            error={passwordError}
          />
          {formLevel ? (
            <p role="alert" className="text-sm text-danger">
              {formLevel}
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

        <p className="mt-6 text-center text-sm text-text-muted">
          {t('haveAccount')}{' '}
          <Link
            href={loginHref}
            className="font-medium text-text-strong underline underline-offset-2 hover:text-accent-flame"
          >
            {t('loginLink')}
          </Link>
        </p>
      </div>
    </section>
  );
}
