'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button, Input } from '@lumin/ui';
import { claimPetTagAccount } from '@/lib/customer-auth';

type ClaimError = 'alreadyClaimed' | 'validation' | 'networkError';

/**
 * The first-scan "claim your checkout account" form (P3-t): the tag's order already carries the
 * customer's name + a masked phone (checkoutMatch), so onboarding only needs ONE new field — a
 * password — instead of a full registration. On success the browser is already signed in
 * (claimPetTagAccount mints the session cookie); re-navigating to the same shortId now resolves the
 * onboarding wizard as the owner.
 */
export function ClaimAccountForm({
  shortId,
  name,
  phoneMasked,
}: {
  shortId: string;
  name: string;
  phoneMasked: string;
}) {
  const t = useTranslations('petTag.welcome.claim');
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ClaimError | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError('validation');
      return;
    }
    setError(null);
    setPending(true);
    const res = await claimPetTagAccount(shortId, password);
    if (res.ok) {
      router.replace(`/t/${shortId}`);
      router.refresh(); // re-read the fresh session cookie so the page resolves onboarding, not welcome
      return;
    }
    setPending(false);
    setError(
      res.code === 'validation'
        ? 'validation'
        : res.code === 'already_claimed'
          ? 'alreadyClaimed'
          : 'networkError',
    );
  };

  return (
    <div className="w-full">
      <span className="rounded-pill border border-accent-teal bg-accent-teal/10 px-3 py-1 font-mono text-xs font-bold text-accent-teal">
        {t('badge')}
      </span>
      <h1 className="mt-4 font-display text-3xl font-extrabold text-text-strong">
        {t('heading', { name })}
      </h1>
      <p className="mt-3 text-sm text-text-muted">{t('intro', { phoneMasked })}</p>
      <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-4 text-left">
        <Input
          label={t('passwordLabel')}
          placeholder={t('passwordPlaceholder')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          autoComplete="new-password"
        />
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
      <p className="mt-4 text-center text-sm text-text-muted">
        {t('notMe')}{' '}
        <Link
          href={`/tai-khoan/dang-nhap?next=${encodeURIComponent(`/t/${shortId}`)}`}
          className="font-medium text-text-strong underline underline-offset-2 hover:text-accent-flame"
        >
          {t('notMeCta')}
        </Link>
      </p>
    </div>
  );
}
