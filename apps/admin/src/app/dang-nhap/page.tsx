import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LoginForm } from './login-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('auth');
  // Login is never a search result — keep it out of any crawl (admin is Cloudflare-gated anyway).
  return { title: t('metaTitle'), robots: { index: false, follow: false } };
}

/**
 * Admin login (`/dang-nhap`, P3-a). Sits OUTSIDE the (app) route group, so it renders full-bleed
 * with no sidebar. A warm brand panel (hidden on small screens) beside the credential form. The
 * form itself is a client component; this shell is a static server component (copy from i18n).
 * Design: `designs/Lumin Admin - Hi-fi.dc.html` §10 — login only (registration/forgot-password are
 * out: the owner is provisioned via `make seed-owner`, ADR-030; staff arrive by invite, P3-q).
 */
export default async function LoginPage() {
  const t = await getTranslations('auth');

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-2xl border border-border-subtle bg-surface-card shadow-pop md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <aside className="hidden flex-col justify-between gap-6 bg-surface-sunken p-8 md:flex">
          <div className="flex items-baseline gap-1.5 font-display text-3xl font-extrabold tracking-tight text-text-strong">
            {t('brand')}
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-accent-flame" />
          </div>
          <p className="text-sm leading-relaxed text-text-muted">{t('brandTagline')}</p>
        </aside>

        <div className="flex flex-col gap-1 p-8">
          <h1 className="text-2xl">{t('title')}</h1>
          <p className="text-sm text-text-muted">{t('subtitle')}</p>
          <div className="mt-6">
            <LoginForm />
          </div>
        </div>
      </div>
    </div>
  );
}
