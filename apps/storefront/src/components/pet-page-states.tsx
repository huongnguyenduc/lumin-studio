import { getTranslations } from 'next-intl/server';
import { CtaLink } from './cta-link';
import { ClaimAccountForm } from './claim-account-form';
import { LoginForm } from './login-form';
import { checkoutMatch } from '@/lib/customer-auth';

// Presentational (server) states for the /t/{shortId} pet page (P3-t t-3): the "new tag" welcome (2a) and
// the unavailable states (not-found / not-ready / error). Zero-JS server components — the only interactive
// surface is the onboarding wizard (pet-onboarding.tsx). The live ACTIVATED page (the 3 view-states) is
// pet-page.tsx (t-4a). Mobile-first (one-handed), sentence-case copy, all keyed under petTag.*.

const PAW = '🐾';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-[420px] flex-col px-5 py-10">
      {children}
    </main>
  );
}

// NewTagWelcome — 2a: a freshly-scanned ENCODED tag, viewer not signed in. Checks checkoutMatch first: if
// the order behind this tag has a claimable guest account, the "claim" form (one password field) replaces
// the login/register CTAs — the checkout name+phone already did the rest. Falls back to plain login/register
// (?next resumes here) for the no-match case (gift, mua hộ, or the account was already claimed).
export async function NewTagWelcome({ shortId }: { shortId: string }) {
  const t = await getTranslations('petTag.welcome');
  const match = await checkoutMatch(shortId);
  if (match.matched) {
    return (
      <Shell>
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <ClaimAccountForm shortId={shortId} name={match.name} phoneMasked={match.phoneMasked} />
        </div>
      </Shell>
    );
  }
  if (match.loginEmail) {
    // A second+ tag for a customer who already claimed on an earlier one (P3-t) — the login form
    // embedded directly (no Shell — LoginForm is already a full standalone screen, mirrors the real
    // /tai-khoan/dang-nhap page) with the email prefilled so they don't have to retype it.
    return <LoginForm next={`/t/${shortId}`} initialEmail={match.loginEmail} />;
  }
  const loginHref = `/tai-khoan/dang-nhap?next=${encodeURIComponent(`/t/${shortId}`)}`;
  const registerHref = `/tai-khoan/dang-ky?next=${encodeURIComponent(`/t/${shortId}`)}`;
  return (
    <Shell>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <span className="rounded-pill border border-accent-teal bg-accent-teal/10 px-3 py-1 font-mono text-xs font-bold text-accent-teal">
          {t('badge')}
        </span>
        <h1 className="mt-4 font-display text-3xl font-extrabold text-text-strong">
          {t('heading')}
        </h1>
        <p className="mt-3 max-w-[260px] text-sm text-text-muted">{t('intro')}</p>
        <CtaLink href={loginHref} variant="pop" className="mt-8 w-full">
          {t('loginCta')}
        </CtaLink>
        <CtaLink href={registerHref} variant="outline" className="mt-3 w-full">
          {t('registerCta')}
        </CtaLink>
      </div>
      <p className="mt-6 text-center font-mono text-[11px] leading-relaxed text-text-muted">
        {t('footnote')}
      </p>
    </Shell>
  );
}

// PetPageUnavailable — not-found (bad shortId), not-ready (UNENCODED, chip not written), or error (network).
export async function PetPageUnavailable({
  variant,
}: {
  variant: 'notFound' | 'notReady' | 'error';
}) {
  const t = await getTranslations('petTag.unavailable');
  return (
    <Shell>
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <span className="text-5xl" aria-hidden="true">
          {PAW}
        </span>
        <h1 className="mt-4 font-display text-2xl font-bold text-text-strong">
          {t(`${variant}Title`)}
        </h1>
        <p className="mt-3 max-w-[280px] text-sm text-text-muted">{t(`${variant}Body`)}</p>
        <CtaLink href="/" variant="outline" className="mt-8">
          {t('home')}
        </CtaLink>
      </div>
    </Shell>
  );
}
